# shutdown-sequencer

[![Bundle Size](https://img.shields.io/badge/bundle-<2KB%20gzipped-brightgreen)](https://bundlephobia.com/package/shutdown-sequencer)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-blue)](https://www.typescriptlang.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#)

Dependency-aware, ordered shutdown for Node.js services. Phases run in parallel where possible, with per-phase and global timeouts, and clear diagnostics when something stalls.

## The Problem

Every long-running Node.js service needs graceful shutdown — on deploy, on scale-down, on crash recovery. You need to drain HTTP requests, disconnect queue consumers, and close DB connections, **in the right order**, **within a time budget**.

Existing solutions handle pieces of this, but none model shutdown as an **ordered, dependency-aware process**. Hand-rolled `shutdown.ts` files consistently get two things wrong:

1. **Ordering** — closing a DB pool before in-flight requests that still need it have finished.
2. **Diagnosability** — when a cleanup step hangs, the process either hangs forever or gets SIGKILLed with no indication of *which* step was stuck.

## Install

```bash
npm install shutdown-sequencer
```

## Quick Start (10 lines)

```ts
import { createShutdownManager } from 'shutdown-sequencer';

const shutdown = createShutdownManager({ timeout: 30_000 });

shutdown.addPhase('drain-http', () => httpTerminator.terminate());
shutdown.addPhase('stop-consumers', () => kafkaConsumer.disconnect());
shutdown.addPhase('close-db', () => pgPool.end(), {
  after: ['drain-http', 'stop-consumers'],
});

shutdown.listen();
```

That's it. On `SIGTERM`/`SIGINT`:

1. `drain-http` and `stop-consumers` run **in parallel** (no dependency between them)
2. `close-db` waits for both to finish, then runs
3. The process exits cleanly

## API Reference

### `createShutdownManager(options?)`

Create a new shutdown manager instance.

```ts
import { createShutdownManager } from 'shutdown-sequencer';

const manager = createShutdownManager({
  timeout: 30_000,                           // Global deadline (default: 30s)
  logger: console,                           // Any { log: (...args) => void }
  onPhaseStart: (name) => {},                // Called when a phase begins
  onPhaseComplete: (name, durationMs) => {}, // Called on success
  onPhaseError: (name, err) => {},           // Called on failure/timeout
});
```

### `manager.addPhase(name, fn, options?)`

Register a named shutdown phase. Returns `this` for chaining.

```ts
manager.addPhase('close-db', () => pool.end(), {
  after: ['drain-http'],  // Run after these phases complete
  timeout: 5_000,         // Per-phase timeout (capped at global budget)
});
```

- **Throws `DuplicatePhaseError`** if a phase with the same name already exists.
- Phases can be registered in any order — dependency validation happens at trigger time.

### `manager.listen()`

Install `SIGTERM`/`SIGINT` handlers. Returns `this` for chaining.

```ts
manager.addPhase('drain-http', fn).listen();
```

- Calls `process.exit(0)` after successful shutdown, `process.exit(1)` if any phase threw, timed out, or was abandoned at the global deadline.
- A second signal during shutdown forces `process.exit(1)` immediately (double-signal handling).
- Logs a warning if running as PID 1 (common Docker misconfiguration).

### `manager.unlisten()`

Remove the signal handlers installed by `listen()`. Returns `this` for chaining.

```ts
const manager = createShutdownManager().addPhase('drain-http', fn).listen();

// later — detach from the process
manager.unlisten();
```

- Safe to call without a prior `listen()`, and safe to call twice — both are no-ops.
- Mainly for test suites and hot-reload setups that create many managers in one process, where leaked handlers accumulate until Node warns with `MaxListenersExceededWarning`.
- Detaches handlers only. It does **not** reset `isShuttingDown()` or abort a sequence already running, and during a shutdown it also removes the double-signal force-exit escape hatch.

### `manager.trigger(signal)`

Manually trigger shutdown. **Does not call `process.exit()`** — resolves when all phases complete. Designed for testing.

```ts
await manager.trigger('test');
// All phases have run, process is still alive
```

- Phase failures do **not** reject the promise — they're reported via `onPhaseError` and the sequence continues.
- It **does** reject on a malformed dependency graph: `UnknownDependencyError` for a typo in `after`, or `StallDetectedError` for a cycle. Wrap in `try`/`catch` if your graph is built dynamically.

### `manager.isShuttingDown()`

Returns `true` once shutdown has begun, `false` before. Flips synchronously when the signal arrives — before any phase runs — and never flips back.

```ts
app.get('/readyz', (_req, res) => {
  res.sendStatus(manager.isShuttingDown() ? 503 : 200);
});
```

See [Kubernetes](#kubernetes) for the full probe recipe.

### Error Classes

All errors carry structured context fields, not just a message string:

| Error | When | Fields |
|---|---|---|
| `DuplicatePhaseError` | `addPhase()` with an existing name | `phaseName` |
| `UnknownDependencyError` | `trigger()` finds an `after` reference to an unregistered phase | `phaseName`, `unknownDep` |
| `PhaseTimeoutError` | A phase exceeds its timeout | `phaseName`, `timeoutMs` |
| `StallDetectedError` | Circular or unresolvable dependencies detected | `stalledPhases`, `waitingOn` |

```ts
import { PhaseTimeoutError, UnknownDependencyError } from 'shutdown-sequencer';
```

## How It Works

Shutdown runs in **waves** (Kahn's algorithm-style topological execution):

1. Find all phases whose `after` dependencies are satisfied
2. Run them concurrently via `Promise.allSettled`
3. Mark all as completed (even if they failed — a partial shutdown is better than a stalled one)
4. Repeat until done, or detect a stall

A phase that throws or times out is **reported but not fatal** — the sequence continues, because the process is exiting either way. A *malformed graph* is different: an unknown `after` reference or a dependency cycle aborts the sequence, because there is no valid order to run.

## Kubernetes

The correct shutdown order in Kubernetes is **stop advertising readiness → wait for the endpoints controller to propagate → then drain**. If you drain immediately on `SIGTERM`, new requests still arrive at a pod that's already closing, because removing a pod from Service endpoints is asynchronous.

This package deliberately does not bind a port or serve probe endpoints (see [Non-Goals](#non-goals)). Instead it exposes the state, which you wire into the HTTP server you already have:

```ts
const shutdown = createShutdownManager({ timeout: 30_000 });

// Readiness: fails the moment shutdown begins, so K8s stops sending traffic.
app.get('/readyz', (_req, res) => {
  res.sendStatus(shutdown.isShuttingDown() ? 503 : 200);
});

// Liveness: only answers "is this process running" — keep it independent of
// shutdown state, or K8s may SIGKILL the pod mid-drain.
app.get('/healthz', (_req, res) => res.sendStatus(200));

// Give the endpoints controller time to observe the failing readiness probe
// before draining. Tune to your cluster; 5s is a common starting point.
shutdown.addPhase('await-endpoint-propagation', () => sleep(5_000));

shutdown.addPhase('drain-http', () => httpTerminator.terminate(), {
  after: ['await-endpoint-propagation'],
});
shutdown.addPhase('close-db', () => pgPool.end(), { after: ['drain-http'] });

shutdown.listen();
```

The propagation delay is just another phase, so the dependency graph enforces the ordering for you.

Make sure `terminationGracePeriodSeconds` exceeds the manager's global `timeout`, or the kubelet will `SIGKILL` before your phases finish:

```yaml
spec:
  terminationGracePeriodSeconds: 40  # > the 30s timeout above
```

## Non-Goals

These are explicitly **not** in scope:

- **Serving** readiness/liveness endpoints — no port is bound. `isShuttingDown()` gives you the state; wire it into your own server, or use [lightship](https://github.com/gajus/lightship) / [terminus](https://github.com/godaddy/terminus) if you want probe endpoints managed for you.
- Framework-specific plugins (Express middleware, NestJS module)
- Retry logic for failed phases
- Distributed/multi-process coordination

## Comparison

| Feature | shutdown-sequencer | http-terminator | @godaddy/terminus | lightship |
|---|---|---|---|---|
| Dependency ordering | ✅ `after: [...]` | ❌ | ❌ | ❌ |
| Parallel execution | ✅ | N/A | ❌ | ❌ |
| Per-phase timeouts | ✅ | ✅ (HTTP only) | ❌ (global only) | ❌ (global only) |
| Stall diagnostics | ✅ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ✅ | ❌ | ❌ |
| Readiness state for probes | ✅ `isShuttingDown()` | ❌ | ✅ | ✅ |
| Serves probe endpoints | ❌ (non-goal) | ❌ | ✅ | ✅ |
| Bundle size | <2KB | ~5KB | ~15KB | ~25KB |

Competitor rows reflect their documented behavior at the time of writing; check their current docs before relying on this table.

## License

MIT
