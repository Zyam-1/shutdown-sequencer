// ============================================================================
// Scheduler — Wave-based topological phase executor
//
// Implements Kahn's algorithm over registered phases: each "wave" runs all
// phases whose dependencies are satisfied, concurrently via Promise.allSettled.
// Failed phases still count as completed (a partial graceful shutdown is
// better than a stalled one).
// ============================================================================

import { PhaseTimeoutError, StallDetectedError } from './errors.js';
import type { Logger, Phase } from './types.js';
import { raceWithTimeout } from './utils.js';

/**
 * Result of running the scheduler. Carries per-phase outcome data for
 * diagnostics and exit-code decisions.
 */
export interface SchedulerResult {
  /** Total wall-clock time of the shutdown sequence in milliseconds. */
  totalDurationMs: number;
  /** Names of phases that completed successfully. */
  succeeded: string[];
  /** Names of phases that threw or timed out, with their errors. */
  failed: Array<{ name: string; error: unknown }>;
  /** Whether the global deadline was hit before all phases finished. */
  timedOut: boolean;
}

/** Callbacks the scheduler invokes during execution. */
export interface SchedulerCallbacks {
  onPhaseStart: (name: string) => void;
  onPhaseComplete: (name: string, durationMs: number) => void;
  onPhaseError: (name: string, err: unknown) => void;
}

/**
 * Execute a set of phases in dependency-ordered waves.
 *
 * @param phases - All registered phases
 * @param globalTimeoutMs - Maximum total shutdown time
 * @param callbacks - Lifecycle callbacks for observability
 * @param logger - Logger instance for diagnostic output
 * @returns A promise that resolves with the scheduler result
 */
export async function runScheduler(
  phases: readonly Phase[],
  globalTimeoutMs: number,
  callbacks: SchedulerCallbacks,
  logger: Logger,
): Promise<SchedulerResult> {
  const startTime = Date.now();
  const completed = new Set<string>();
  const succeeded: string[] = [];
  const failed: Array<{ name: string; error: unknown }> = [];
  const remaining = new Set(phases.map((p) => p.name));
  const phaseMap = new Map(phases.map((p) => [p.name, p]));
  let timedOut = false;

  while (remaining.size > 0) {
    // Check if global deadline has already been exceeded
    const elapsed = Date.now() - startTime;
    const globalBudgetRemaining = globalTimeoutMs - elapsed;

    if (globalBudgetRemaining <= 0) {
      // Global timeout — abandon all remaining phases
      timedOut = true;
      for (const name of remaining) {
        const error = new PhaseTimeoutError(name, globalTimeoutMs);
        failed.push({ name, error });
        callbacks.onPhaseError(name, error);
      }
      logger.log(
        `[shutdown-sequencer] Global timeout (${globalTimeoutMs}ms) reached. ` +
          `Abandoning ${remaining.size} remaining phase(s): ${[...remaining].join(', ')}`,
      );
      break;
    }

    // Find the next wave: phases whose dependencies are all completed
    const wave: Phase[] = [];
    for (const name of remaining) {
      const phase = phaseMap.get(name);
      // Safety: phase must exist — we built remaining from the same source
      if (!phase) continue;

      const depsResolved = phase.after.every((dep) => completed.has(dep));
      if (depsResolved) {
        wave.push(phase);
      }
    }

    // Stall detection: no eligible phases but work remains
    if (wave.length === 0) {
      const stalledPhases = [...remaining];
      const waitingOn: Record<string, string[]> = {};
      for (const name of remaining) {
        const phase = phaseMap.get(name);
        if (phase) {
          waitingOn[name] = phase.after.filter((dep) => !completed.has(dep));
        }
      }
      const error = new StallDetectedError(stalledPhases, waitingOn);
      logger.log(`[shutdown-sequencer] ${error.message}`);
      throw error;
    }

    // Execute the wave concurrently
    const waveResults = await Promise.allSettled(
      wave.map(async (phase) => {
        callbacks.onPhaseStart(phase.name);
        const phaseStart = Date.now();

        // Per-phase timeout: use the smaller of (phase timeout, remaining global budget)
        const elapsedNow = Date.now() - startTime;
        const currentBudget = globalTimeoutMs - elapsedNow;
        const effectiveTimeout =
          phase.timeout !== undefined ? Math.min(phase.timeout, currentBudget) : currentBudget;

        try {
          const result = phase.fn();
          // Handle both sync and async phase functions
          if (result instanceof Promise) {
            await raceWithTimeout(result, effectiveTimeout, phase.name);
          }
          const duration = Date.now() - phaseStart;
          callbacks.onPhaseComplete(phase.name, duration);
          return { name: phase.name, duration };
        } catch (err: unknown) {
          callbacks.onPhaseError(phase.name, err);
          throw err;
        }
      }),
    );

    // Process results: move all wave phases to completed regardless of outcome
    for (let i = 0; i < wave.length; i++) {
      const phase = wave[i];
      // Safety: wave and waveResults are parallel arrays, always same length
      if (!phase) continue;
      const result = waveResults[i];
      if (!result) continue;

      remaining.delete(phase.name);
      completed.add(phase.name);

      if (result.status === 'rejected') {
        failed.push({ name: phase.name, error: result.reason });
      } else {
        succeeded.push(phase.name);
      }
    }
  }

  return {
    totalDurationMs: Date.now() - startTime,
    succeeded,
    failed,
    timedOut,
  };
}
