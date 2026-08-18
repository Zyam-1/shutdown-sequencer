// ============================================================================
// ShutdownManager — Lifecycle & signal handling
//
// This is the user-facing API. It wraps the scheduler with signal handling,
// double-signal force-exit, PID 1 warnings, and dependency
// validation.
// ============================================================================

import {
  DEFAULT_TIMEOUT_MS,
  FORCE_EXIT_CODE,
  ERROR_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  SHUTDOWN_SIGNALS,
} from './constants.js';
import { DuplicatePhaseError, UnknownDependencyError } from './errors.js';
import { runScheduler } from './scheduler.js';
import type { Logger, Phase, PhaseOptions, ShutdownManager, ShutdownManagerOptions } from './types.js';

/**
 * Create a new shutdown manager instance.
 *
 * This is the primary entry point for the package. Returns a
 * {@link ShutdownManager} that can register phases, listen for process
 * signals, or be triggered manually for testing.
 *
 * @example
 * ```ts
 * import { createShutdownManager } from 'shutdown-sequencer';
 *
 * const shutdown = createShutdownManager({ timeout: 30_000 });
 *
 * shutdown.addPhase('drain-http', () => httpTerminator.terminate());
 * shutdown.addPhase('close-db', () => pool.end(), { after: ['drain-http'] });
 * shutdown.listen();
 * ```
 *
 * @param options - Configuration for timeouts, logging, and lifecycle callbacks
 */
export function createShutdownManager(options?: ShutdownManagerOptions): ShutdownManager {
  const globalTimeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const logger: Logger = options?.logger ?? console;
  const onPhaseStart = options?.onPhaseStart ?? noop;
  const onPhaseComplete = options?.onPhaseComplete ?? noop;
  const onPhaseError = options?.onPhaseError ?? noop;

  const phases = new Map<string, Phase>();
  let shuttingDown = false;
  // Tracks whether the completed sequence had any phase failures, so
  // signal-driven shutdown can pick the right exit code. trigger() itself
  // resolves on phase failure, so the outcome cannot be inferred from the
  // promise alone.
  let anyPhaseFailed = false;
  const signalHandlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = [];

  /**
   * Validate that every `after` dependency references a registered phase.
   * Called at trigger-time so phases can be registered in any order.
   */
  function validateDependencies(): void {
    for (const [, phase] of phases) {
      for (const dep of phase.after) {
        if (!phases.has(dep)) {
          throw new UnknownDependencyError(phase.name, dep);
        }
      }
    }
  }

  const manager: ShutdownManager = {
    addPhase(
      name: string,
      fn: () => void | Promise<void>,
      opts?: PhaseOptions,
    ): ShutdownManager {
      if (phases.has(name)) {
        throw new DuplicatePhaseError(name);
      }

      phases.set(name, {
        name,
        fn,
        after: opts?.after ?? [],
        timeout: opts?.timeout,
      });

      return manager;
    },

    listen(): ShutdownManager {
      // PID 1 warning for containerized environments
      if (process.pid === 1) {
        logger.log(
          '[shutdown-sequencer] WARNING: Running as PID 1. Signals (SIGTERM/SIGINT) may not ' +
            'be forwarded to this process without an init system. Consider using ' +
            '`docker run --init` or tini to ensure graceful shutdown works correctly.',
        );
      }

      for (const signal of SHUTDOWN_SIGNALS) {
        const handler = (): void => {
          if (shuttingDown) {
            // Double-signal force-exit
            logger.log(
              `[shutdown-sequencer] Received ${signal} again during shutdown. Forcing exit.`,
            );
            process.exit(FORCE_EXIT_CODE);
            return;
          }

          logger.log(`[shutdown-sequencer] Received ${signal}, starting shutdown...`);

          // Run shutdown and exit when complete
          void manager.trigger(signal).then(
            () => {
              process.exit(anyPhaseFailed ? ERROR_EXIT_CODE : SUCCESS_EXIT_CODE);
            },
            (err: unknown) => {
              logger.log('[shutdown-sequencer] Shutdown completed with errors:', err);
              process.exit(ERROR_EXIT_CODE);
            },
          );
        };

        process.on(signal, handler);
        signalHandlers.push({ signal, handler });
      }

      return manager;
    },

    unlisten(): ShutdownManager {
      for (const { signal, handler } of signalHandlers) {
        process.removeListener(signal, handler);
      }
      signalHandlers.length = 0;

      return manager;
    },

    async trigger(signal: string): Promise<void> {
      // If already shutting down via trigger(), a second trigger() is a no-op.
      // Force-exit is only for signal-based double-invocation (handled in listen()).
      if (shuttingDown) {
        logger.log(
          `[shutdown-sequencer] Shutdown already in progress (triggered by "${signal}"). Ignoring.`,
        );
        return;
      }

      // Set synchronously, before any await, so isShuttingDown() reports the
      // draining state to readiness probes from the moment the signal lands.
      shuttingDown = true;
      logger.log(
        `[shutdown-sequencer] Shutdown triggered (${signal}). ` +
          `${phases.size} phase(s) registered, ${globalTimeout}ms deadline.`,
      );

      // Validate all dependency references before starting
      validateDependencies();

      if (phases.size === 0) {
        logger.log('[shutdown-sequencer] No phases registered. Shutdown complete.');
        return;
      }

      const result = await runScheduler(
        [...phases.values()],
        globalTimeout,
        { onPhaseStart, onPhaseComplete, onPhaseError },
        logger,
      );

      logger.log(
        `[shutdown-sequencer] Shutdown complete in ${result.totalDurationMs}ms. ` +
          `${result.succeeded.length} succeeded, ${result.failed.length} failed.`,
      );

      if (result.failed.length > 0) {
        anyPhaseFailed = true;
        logger.log(
          '[shutdown-sequencer] Failed phases: ' +
            result.failed.map((f) => f.name).join(', '),
        );
      }
    },

    isShuttingDown(): boolean {
      return shuttingDown;
    },
  };

  return manager;
}

function noop(): void {
  // Intentional no-op — used as the default for optional lifecycle callbacks
}
