# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-18

### Added

- `isShuttingDown()` on `ShutdownManager` — reports whether draining has begun, for wiring into a Kubernetes readiness probe. Flips synchronously on signal receipt, before any phase runs, and never flips back. The package still binds no port and serves no endpoints.
- `unlisten()` on `ShutdownManager` — removes the signal handlers installed by `listen()`, for test suites and hot-reload setups that would otherwise leak handlers until Node emits `MaxListenersExceededWarning`. Idempotent, and safe to call without a prior `listen()`.
- README "Kubernetes" section: the readiness → propagation-delay → drain recipe, modelled with an ordinary phase, plus the `terminationGracePeriodSeconds` constraint.
- CI now installs the packed tarball into a scratch project and smoke-tests both `require()` and `import()` before publish, to catch entry-point/exports mismatches.
- `repository`, `bugs`, and `homepage` fields — required for `npm publish --provenance`, which the release workflow uses.

### Fixed

- `package.json` `main`/`module`/`exports` pointed at `dist/index.cjs` and `dist/index.d.cts`, files the build never produced — `require('shutdown-sequencer')` failed with `MODULE_NOT_FOUND` for every CommonJS consumer. Entry points now match the actual build output (`dist/index.js` for CJS, `dist/index.mjs` for ESM).
- Signal-driven shutdown exited `0` when a phase threw or timed out, contradicting the documented "`process.exit(1)` if any phase errored". Phase outcomes are now recorded and reflected in the exit code, so orchestrators and monitoring can distinguish a clean drain from a failed one.
- A second `SIGTERM`/`SIGINT` during shutdown logged a misleading "starting shutdown..." line before the force-exit message. The double-signal check now runs first.
- README Node version badge said `>=16`; the package has required `>=20` since the Node 18 support drop.
- README comparison table listed per-phase timeouts for `@godaddy/terminus` and `lightship` as `✅ (global only)`, which contradicted itself.
- `CONTRIBUTING.md` linked to a `CODING_RULES.md` that does not exist, and to a stale `#non-goals-v1` README anchor.

### Notes

- 48 tests across 5 files.

## [0.1.0] - 2026-08-18

### Added

- `createShutdownManager()` factory with configurable global timeout, logger, and lifecycle callbacks
- `addPhase()` with declarative `after` dependency ordering and per-phase timeouts
- `listen()` for automatic `SIGTERM`/`SIGINT` handling with `process.exit()`
- `trigger()` for manual/testable shutdown without `process.exit()`
- Wave-based topological scheduler — parallel execution where dependencies allow
- Structured error classes: `PhaseTimeoutError`, `StallDetectedError`, `DuplicatePhaseError`, `UnknownDependencyError`
- Double-signal force-exit (FR6): second signal during shutdown forces `process.exit(1)`
- Stall detection (FR7): circular or unresolvable dependencies are reported with full diagnostics
- PID 1 warning (FR8): logs a warning when running without an init system in containers
- Dual CJS/ESM build with TypeScript declarations
- Zero runtime dependencies
- 34 tests across 4 test files (unit, integration)
