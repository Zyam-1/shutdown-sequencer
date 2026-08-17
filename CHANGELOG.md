# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
