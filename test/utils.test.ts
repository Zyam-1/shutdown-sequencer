import { describe, it, expect } from 'vitest';
import { raceWithTimeout, assertNever } from '../src/utils.js';

describe('raceWithTimeout', () => {
  it('handles non-Error promise rejection by wrapping it in an Error', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const rejectingPromise = Promise.reject('raw string error');

    await expect(
      raceWithTimeout(rejectingPromise, 1000, 'test-phase'),
    ).rejects.toThrow('raw string error');
  });

  it('handles Error promise rejection by throwing the original error', async () => {
    const originalError = new Error('custom error');
    const rejectingPromise = Promise.reject(originalError);

    try {
      await raceWithTimeout(rejectingPromise, 1000, 'test-phase');
      expect.fail('Should have rejected');
    } catch (err) {
      expect(err).toBe(originalError);
    }
  });
});

describe('assertNever', () => {
  it('throws an error with the unexpected value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow('Unexpected value: unexpected');
  });
});
