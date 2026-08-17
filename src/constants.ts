// ============================================================================
// Constants — Named values replacing magic numbers/strings
// ============================================================================

/** Default global shutdown deadline in milliseconds (30 seconds). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Exit code used on double-signal force-exit. */
export const FORCE_EXIT_CODE = 1;

/** Exit code for a shutdown where at least one phase errored. */
export const ERROR_EXIT_CODE = 1;

/** Exit code for a fully successful shutdown. */
export const SUCCESS_EXIT_CODE = 0;

/** Signals to intercept when `listen()` is called. */
export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
