import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScheduler } from '../src/scheduler.js';
import { PhaseTimeoutError, StallDetectedError } from '../src/errors.js';
import type { Phase } from '../src/types.js';
import type { SchedulerCallbacks } from '../src/scheduler.js';

/**
 * Create a no-op callbacks object for tests that don't care about lifecycle events.
 */
function noopCallbacks(): SchedulerCallbacks {
  return {
    onPhaseStart: vi.fn(),
    onPhaseComplete: vi.fn(),
    onPhaseError: vi.fn(),
  };
}

/** Quiet logger to avoid noise in test output. */
const silentLogger = { log: vi.fn() };

/** Create a phase helper to reduce boilerplate. */
function makePhase(overrides: Partial<Phase> & { name: string }): Phase {
  return {
    fn: () => Promise.resolve(),
    after: [],
    timeout: undefined,
    ...overrides,
  };
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Parallel execution', () => {
    it('runs independent phases concurrently, not sequentially', async () => {
      const PHASE_DURATION_MS = 100;
      const phaseA = makePhase({
        name: 'a',
        fn: () => new Promise<void>((r) => setTimeout(r, PHASE_DURATION_MS)),
      });
      const phaseB = makePhase({
        name: 'b',
        fn: () => new Promise<void>((r) => setTimeout(r, PHASE_DURATION_MS)),
      });

      const start = Date.now();
      const result = await runScheduler([phaseA, phaseB], 5000, noopCallbacks(), silentLogger);
      const elapsed = Date.now() - start;

      // If run in parallel: ~100ms. If sequential: ~200ms.
      // Use 180ms threshold to account for CI jitter.
      expect(elapsed).toBeLessThan(180);
      expect(result.succeeded).toContain('a');
      expect(result.succeeded).toContain('b');
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('Ordering (after dependencies)', () => {
    it('does not start a phase until its after-dependencies complete', async () => {
      const executionOrder: string[] = [];

      const phaseA = makePhase({
        name: 'a',
        fn: async () => {
          await new Promise<void>((r) => setTimeout(r, 50));
          executionOrder.push('a');
        },
      });
      const phaseB = makePhase({
        name: 'b',
        after: ['a'],
        fn: () => {
          executionOrder.push('b');
        },
      });

      await runScheduler([phaseA, phaseB], 5000, noopCallbacks(), silentLogger);

      expect(executionOrder).toEqual(['a', 'b']);
    });

    it('handles diamond dependencies: A → B, A → C, B+C → D', async () => {
      const executionOrder: string[] = [];

      const a = makePhase({
        name: 'a',
        fn: () => { executionOrder.push('a'); },
      });
      const b = makePhase({
        name: 'b',
        after: ['a'],
        fn: () => { executionOrder.push('b'); },
      });
      const c = makePhase({
        name: 'c',
        after: ['a'],
        fn: () => { executionOrder.push('c'); },
      });
      const d = makePhase({
        name: 'd',
        after: ['b', 'c'],
        fn: () => { executionOrder.push('d'); },
      });

      await runScheduler([a, b, c, d], 5000, noopCallbacks(), silentLogger);

      // A must come first, D must come last. B and C can be in either order.
      expect(executionOrder[0]).toBe('a');
      expect(executionOrder[3]).toBe('d');
      expect(executionOrder.slice(1, 3).sort()).toEqual(['b', 'c']);
    });
  });

  describe('Isolation', () => {
    it('a phase that throws does not prevent unrelated phases from running', async () => {
      const callbacks = noopCallbacks();
      const phaseA = makePhase({
        name: 'a',
        fn: () => { throw new Error('a-failed'); },
      });
      const phaseB = makePhase({
        name: 'b',
        fn: () => Promise.resolve(),
      });

      const result = await runScheduler([phaseA, phaseB], 5000, callbacks, silentLogger);

      expect(result.succeeded).toContain('b');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.name).toBe('a');
    });

    it('a failed dependency still unblocks downstream phases', async () => {
      const executionOrder: string[] = [];

      const phaseA = makePhase({
        name: 'a',
        fn: () => { throw new Error('a-failed'); },
      });
      const phaseB = makePhase({
        name: 'b',
        after: ['a'],
        fn: () => { executionOrder.push('b'); },
      });

      const result = await runScheduler([phaseA, phaseB], 5000, noopCallbacks(), silentLogger);

      // B should still run even though A failed
      expect(executionOrder).toContain('b');
      expect(result.succeeded).toContain('b');
      expect(result.failed).toHaveLength(1);
    });
  });

  describe('Global deadline', () => {
    it('abandons phases that exceed the global timeout', async () => {
      const callbacks = noopCallbacks();
      const GLOBAL_TIMEOUT_MS = 100;
      const SLOW_PHASE_MS = 500;

      const slowPhase = makePhase({
        name: 'slow',
        fn: () => new Promise<void>((r) => setTimeout(r, SLOW_PHASE_MS)),
      });

      const result = await runScheduler(
        [slowPhase],
        GLOBAL_TIMEOUT_MS,
        callbacks,
        silentLogger,
      );

      // The phase should be reported as failed due to timeout
      expect(result.failed.length).toBeGreaterThan(0);
      const failedPhase = result.failed.find((f) => f.name === 'slow');
      expect(failedPhase).toBeDefined();
      expect(failedPhase?.error).toBeInstanceOf(PhaseTimeoutError);
    });

    it('reports remaining phases when global budget is exhausted between waves', async () => {
      const callbacks = noopCallbacks();
      const GLOBAL_TIMEOUT_MS = 80;

      // Wave 1: 'fast-but-slow-enough' takes just long enough to exhaust the budget
      // Wave 2: 'after-phase' should be abandoned because budget is gone
      const fastPhase = makePhase({
        name: 'fast-but-slow-enough',
        fn: () => new Promise<void>((r) => setTimeout(r, GLOBAL_TIMEOUT_MS + 50)),
        timeout: GLOBAL_TIMEOUT_MS + 50,
      });
      const afterPhase = makePhase({
        name: 'after-phase',
        after: ['fast-but-slow-enough'],
        fn: () => Promise.resolve(),
      });

      const result = await runScheduler(
        [fastPhase, afterPhase],
        GLOBAL_TIMEOUT_MS,
        callbacks,
        silentLogger,
      );

      // after-phase should be abandoned (budget exhausted before wave 2)
      expect(result.timedOut).toBe(true);
      const abandoned = result.failed.find((f) => f.name === 'after-phase');
      expect(abandoned).toBeDefined();
    });
  });

  describe('Per-phase timeout', () => {
    it('per-phase timeout triggers before global deadline', async () => {
      const callbacks = noopCallbacks();
      const PER_PHASE_TIMEOUT_MS = 50;
      const GLOBAL_TIMEOUT_MS = 5000;
      const SLOW_PHASE_MS = 500;

      const slowPhase = makePhase({
        name: 'slow',
        timeout: PER_PHASE_TIMEOUT_MS,
        fn: () => new Promise<void>((r) => setTimeout(r, SLOW_PHASE_MS)),
      });

      const start = Date.now();
      const result = await runScheduler(
        [slowPhase],
        GLOBAL_TIMEOUT_MS,
        callbacks,
        silentLogger,
      );
      const elapsed = Date.now() - start;

      // Should timeout around 50ms, not wait the full 5000ms global
      expect(elapsed).toBeLessThan(200);
      expect(result.failed).toHaveLength(1);

      const error = result.failed[0]?.error;
      expect(error).toBeInstanceOf(PhaseTimeoutError);
      if (error instanceof PhaseTimeoutError) {
        expect(error.phaseName).toBe('slow');
        expect(error.timeoutMs).toBe(PER_PHASE_TIMEOUT_MS);
      }
    });
  });

  describe('Stall detection', () => {
    it('detects when no phases are eligible and throws StallDetectedError', async () => {
      // Phase B depends on 'nonexistent' which is registered but depends on B (circular)
      const phaseA = makePhase({
        name: 'a',
        after: ['b'],
      });
      const phaseB = makePhase({
        name: 'b',
        after: ['a'],
      });

      await expect(
        runScheduler([phaseA, phaseB], 5000, noopCallbacks(), silentLogger),
      ).rejects.toThrow(StallDetectedError);
    });

    it('includes diagnostic info about which phases are stuck and why', async () => {
      const phaseA = makePhase({
        name: 'a',
        after: ['b'],
      });
      const phaseB = makePhase({
        name: 'b',
        after: ['a'],
      });

      try {
        await runScheduler([phaseA, phaseB], 5000, noopCallbacks(), silentLogger);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StallDetectedError);
        if (err instanceof StallDetectedError) {
          expect(err.stalledPhases).toContain('a');
          expect(err.stalledPhases).toContain('b');
          expect(err.waitingOn['a']).toContain('b');
          expect(err.waitingOn['b']).toContain('a');
        }
      }
    });
  });

  describe('Lifecycle callbacks', () => {
    it('calls onPhaseStart, onPhaseComplete for successful phases', async () => {
      const callbacks = noopCallbacks();
      const phase = makePhase({
        name: 'test-phase',
        fn: () => Promise.resolve(),
      });

      await runScheduler([phase], 5000, callbacks, silentLogger);

      expect(callbacks.onPhaseStart).toHaveBeenCalledWith('test-phase');
      expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('test-phase', expect.any(Number));
    });

    it('calls onPhaseError for failed phases', async () => {
      const callbacks = noopCallbacks();
      const phase = makePhase({
        name: 'failing',
        fn: () => { throw new Error('boom'); },
      });

      await runScheduler([phase], 5000, callbacks, silentLogger);

      expect(callbacks.onPhaseError).toHaveBeenCalledWith('failing', expect.any(Error));
    });
  });

  describe('Edge cases', () => {
    it('handles zero phases', async () => {
      const result = await runScheduler([], 5000, noopCallbacks(), silentLogger);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.timedOut).toBe(false);
    });

    it('handles sync phase functions', async () => {
      const phase = makePhase({
        name: 'sync',
        fn: () => { /* sync no-op */ },
      });

      const result = await runScheduler([phase], 5000, noopCallbacks(), silentLogger);

      expect(result.succeeded).toContain('sync');
    });
  });
});
