# shutdown-sequencer

[![Bundle Size](https://img.shields.io/badge/bundle-<2KB%20gzipped-brightgreen)](https://bundlephobia.com/package/shutdown-sequencer)
[![Node](https://img.shields.io/badge/node-%3E%3D16-blue)](https://nodejs.org)
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

- Calls `process.exit(0)` after successful shutdown, `process.exit(1)` if any phase errored.
- A second signal during shutdown forces `process.exit(1)` immediately (double-signal handling).
- Logs a warning if running as PID 1 (common Docker misconfiguration).

### `manager.trigger(signal)`

Manually trigger shutdown. **Does not call `process.exit()`** — resolves when all phases complete. Designed for testing.

```ts
await manager.trigger('test');
// All phases have run, process is still alive
```

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

A phase that throws or times out is **reported but not fatal** — the sequence continues, because the process is exiting either way.

## Non-Goals (v1)

These are explicitly **not** in scope for v1:

- Kubernetes readiness/liveness probe integration (use [lightship](https://github.com/gajus/lightship) or [terminus](https://github.com/godaddy/terminus))
- Framework-specific plugins (Express middleware, NestJS module)
- Retry logic for failed phases
- Distributed/multi-process coordination

## Comparison

| Feature | shutdown-sequencer | http-terminator | @godaddy/terminus | lightship |
|---|---|---|---|---|
| Dependency ordering | ✅ `after: [...]` | ❌ | ❌ | ❌ |
| Parallel execution | ✅ | N/A | ❌ | ❌ |
| Per-phase timeouts | ✅ | ✅ (HTTP only) | ✅ (global only) | ✅ (global only) |
| Stall diagnostics | ✅ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ✅ | ❌ | ❌ |
| K8s probe integration | ❌ (non-goal) | ❌ | ✅ | ✅ |
| Bundle size | <2KB | ~5KB | ~15KB | ~25KB |

## License

MIT
