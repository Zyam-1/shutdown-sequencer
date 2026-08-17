// ============================================================================
// Errors — Structured error classes
//
// Every error extends Error, sets this.name, and carries structured context
// fields so consumers can programmatically inspect failures, not just read
// a message string.
// ============================================================================

/**
 * Thrown when a shutdown phase exceeds its timeout budget.
 *
 * Carried by the `onPhaseError` callback and included in shutdown results
 * so operators can identify which phase stalled.
 */
export class PhaseTimeoutError extends Error {
  readonly phaseName: string;
  readonly timeoutMs: number;

  constructor(phaseName: string, timeoutMs: number) {
    super(`Phase "${phaseName}" timed out after ${timeoutMs}ms`);
    this.name = 'PhaseTimeoutError';
    this.phaseName = phaseName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when the scheduler detects a stall: phases remain unfinished, but
 * none are eligible to run because their dependencies will never resolve.
 *
 * This typically indicates a typo in an `after` reference or a circular
 * dependency chain. The error carries the full diagnostic: which phases
 * are stuck and exactly which dependency each is waiting on.
 */
export class StallDetectedError extends Error {
  readonly stalledPhases: readonly string[];
  readonly waitingOn: Readonly<Record<string, readonly string[]>>;

  constructor(
    stalledPhases: readonly string[],
    waitingOn: Readonly<Record<string, readonly string[]>>,
  ) {
    const details = stalledPhases
      .map((p) => {
        const deps = waitingOn[p];
        return `  "${p}" waiting on: [${deps?.join(', ') ?? ''}]`;
      })
      .join('\n');
    super(`Shutdown stalled — ${stalledPhases.length} phase(s) cannot proceed:\n${details}`);
    this.name = 'StallDetectedError';
    this.stalledPhases = stalledPhases;
    this.waitingOn = waitingOn;
  }
}

/**
 * Thrown when {@link ShutdownManager.addPhase} is called with a name that
 * has already been registered. Phase names must be unique.
 */
export class DuplicatePhaseError extends Error {
  readonly phaseName: string;

  constructor(phaseName: string) {
    super(`Phase "${phaseName}" is already registered`);
    this.name = 'DuplicatePhaseError';
    this.phaseName = phaseName;
  }
}

/**
 * Thrown at `trigger()`/`listen()` time when a phase's `after` array
 * references a name that was never registered via `addPhase()`.
 *
 * Validation is deferred to trigger-time (not addPhase-time) so that
 * phases can be registered in any order across modules.
 */
export class UnknownDependencyError extends Error {
  readonly phaseName: string;
  readonly unknownDep: string;

  constructor(phaseName: string, unknownDep: string) {
    super(
      `Phase "${phaseName}" depends on "${unknownDep}", which was never registered. ` +
        `Check for typos in the "after" array.`,
    );
    this.name = 'UnknownDependencyError';
    this.phaseName = phaseName;
    this.unknownDep = unknownDep;
  }
}
