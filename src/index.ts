// ============================================================================
// Public API — Named exports only
//
// No `export default` anywhere in this package. This avoids CJS/ESM interop
// ambiguity for consumers using `require()` vs `import`.
// ============================================================================

// Factory function — the primary entry point
export { createShutdownManager } from './shutdown-manager.js';

// Types — consumers need these for typing their own options/interfaces
export type {
  ShutdownManager,
  ShutdownManagerOptions,
  PhaseOptions,
  Logger,
} from './types.js';

// Error classes — consumers may want to catch specific errors
export {
  PhaseTimeoutError,
  StallDetectedError,
  DuplicatePhaseError,
  UnknownDependencyError,
} from './errors.js';
