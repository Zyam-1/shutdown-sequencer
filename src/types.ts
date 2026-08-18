// ============================================================================
// Types — Public API surface for shutdown-sequencer
// ============================================================================

/**
 * Options for {@link createShutdownManager}.
 *
 * All fields are optional — sensible defaults are applied when omitted.
 */
export interface ShutdownManagerOptions {
  /**
   * Global deadline in milliseconds. If all shutdown phases have not completed
   * within this budget, remaining phases are abandoned and reported via
   * {@link onPhaseError}. Default: `30_000` (30 seconds).
   */
  timeout?: number;

  /**
   * Custom logger instance. Must expose a `log` method matching `console.log`
   * signature. Defaults to `console` if omitted.
   */
  logger?: Logger;

  /** Called immediately before a phase's cleanup function begins execution. */
  onPhaseStart?: (name: string) => void;

  /**
   * Called when a phase completes successfully.
   * @param name - Phase name
   * @param durationMs - Wall-clock execution time in milliseconds
   */
  onPhaseComplete?: (name: string, durationMs: number) => void;

  /**
   * Called when a phase throws an error or exceeds its timeout.
   * @param name - Phase name
   * @param err - The error thrown, or a {@link PhaseTimeoutError}
   */
  onPhaseError?: (name: string, err: unknown) => void;
}

/**
 * Minimal logger interface. Any object with a `log` method works —
 * `console`, pino, winston, or a custom implementation.
 */
export interface Logger {
  log: (...args: unknown[]) => void;
}

/**
 * Options for an individual shutdown phase, passed to
 * {@link ShutdownManager.addPhase}.
 */
export interface PhaseOptions {
  /**
   * Names of phases that must complete (successfully or with error) before
   * this phase is eligible to run. Phases not listed here may run in parallel.
   */
  after?: string[];

  /**
   * Per-phase timeout in milliseconds. Capped at whatever remains of the
   * global deadline at the time this phase starts. If omitted, the phase
   * uses the remaining global budget as its timeout.
   */
  timeout?: number;
}

/**
 * Internal representation of a registered shutdown phase.
 * Not exported from the package — consumers interact via {@link ShutdownManager}.
 */
export interface Phase {
  readonly name: string;
  readonly fn: () => void | Promise<void>;
  readonly after: readonly string[];
  readonly timeout: number | undefined;
}

/**
 * The public ShutdownManager interface returned by {@link createShutdownManager}.
 *
 * All mutating methods return `this` for fluent chaining:
 * ```ts
 * shutdown.addPhase('a', fn).addPhase('b', fn).listen();
 * ```
 */
export interface ShutdownManager {
  /**
   * Register a named shutdown phase.
   *
   * @param name - Unique identifier for this phase (used in `after` references)
   * @param fn - Cleanup function, may be sync or async
   * @param opts - Optional ordering and timeout configuration
   * @returns `this` for chaining
   * @throws {@link DuplicatePhaseError} if a phase with this name already exists
   */
  addPhase(
    name: string,
    fn: () => void | Promise<void>,
    opts?: PhaseOptions,
  ): ShutdownManager;

  /**
   * Install process signal handlers (`SIGTERM`, `SIGINT`) that trigger
   * the shutdown sequence on receipt. After the sequence completes,
   * `process.exit()` is called automatically.
   *
   * If `process.pid === 1`, logs a warning about signal forwarding
   * in containerized environments.
   *
   * A second signal during an in-progress shutdown forces an immediate
   * `process.exit(1)`.
   *
   * @returns `this` for chaining
   */
  listen(): ShutdownManager;

  /**
   * Remove the `SIGTERM`/`SIGINT` handlers installed by {@link listen},
   * detaching this manager from the process.
   *
   * Safe to call when {@link listen} was never called, and safe to call more
   * than once — both are no-ops. If {@link listen} was called repeatedly,
   * every handler it registered is removed.
   *
   * Useful in test suites and hot-reload setups that build many managers in
   * one process, where leaked handlers otherwise accumulate until Node emits
   * a `MaxListenersExceededWarning`.
   *
   * This only detaches handlers. It does not reset {@link isShuttingDown} or
   * abort a sequence already in progress — and while a shutdown is running it
   * also removes the double-signal force-exit escape hatch.
   *
   * @returns `this` for chaining
   */
  unlisten(): ShutdownManager;

  /**
   * Manually trigger the shutdown sequence. Unlike signal-triggered shutdown,
   * this does **not** call `process.exit()` — it resolves when all phases
   * complete (or the global deadline is reached), leaving the process alive
   * so callers can perform additional cleanup.
   *
   * Individual phase failures do **not** reject this promise — they are
   * reported via `onPhaseError` and the sequence continues. Only a malformed
   * dependency graph rejects, since no meaningful shutdown order exists.
   *
   * Primarily useful for testing.
   *
   * @param signal - Descriptive label for logging (e.g., `'test'`, `'manual'`)
   * @throws {@link UnknownDependencyError} if any phase references an
   *   unregistered dependency name
   * @throws {@link StallDetectedError} if the dependency graph contains a
   *   cycle, leaving phases that can never become eligible to run
   */
  trigger(signal: string): Promise<void>;

  /**
   * Whether the shutdown sequence has begun.
   *
   * Flips to `true` synchronously when a signal is received (or `trigger()`
   * is called), before any phase runs, and never returns to `false`.
   *
   * The intended use is a Kubernetes readiness probe: report "not ready" as
   * soon as shutdown starts so the endpoints controller stops routing new
   * traffic to this pod while in-flight work drains.
   *
   * @example
   * ```ts
   * app.get('/readyz', (_req, res) => {
   *   res.sendStatus(shutdown.isShuttingDown() ? 503 : 200);
   * });
   * ```
   */
  isShuttingDown(): boolean;
}
