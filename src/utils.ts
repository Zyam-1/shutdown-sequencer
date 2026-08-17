// ============================================================================
// Utils — Small, focused helper functions
// ============================================================================

import { PhaseTimeoutError } from './errors.js';

/**
 * Race a promise against a timeout. If the timeout fires first, the returned
 * promise rejects with a {@link PhaseTimeoutError}.
 *
 * The original promise is NOT cancelled (JavaScript has no cancellation
 * primitive) — it simply becomes unobserved. This is acceptable for shutdown
 * phases since the process is exiting.
 *
 * @param promise - The phase's cleanup function promise
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param phaseName - Phase name for error reporting
 */
export function raceWithTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  phaseName: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PhaseTimeoutError(phaseName, timeoutMs));
    }, timeoutMs);

    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Exhaustive switch helper.
 *
 * Place in the `default` case of a `switch` over a discriminated union.
 * If all cases are handled, TypeScript narrows the parameter to `never`
 * and this function is unreachable. If a new variant is added to the union,
 * the resulting compile error forces you to handle it.
 */
export function assertNever(x: never): never {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  throw new Error(`Unexpected value: ${x}`);
}
