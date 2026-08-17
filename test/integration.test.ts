import { describe, it, expect, vi } from 'vitest';
import { createShutdownManager } from '../src/index.js';

/**
 * Integration test: verifies the full end-to-end flow as described in the
 * README example usage. Registers multiple phases with dependencies and
 * verifies execution order via an event log.
 *
 * This mirrors the real-world scenario:
 *   drain-http ──┐
 *                ├──→ close-db
 *   stop-consumers ─┘
 */
describe('Integration: end-to-end shutdown sequence', () => {
  it('executes phases in correct dependency order', async () => {
    const events: string[] = [];
    const logger = { log: vi.fn() };

    const shutdown = createShutdownManager({
      timeout: 5000,
      logger,
      onPhaseStart: (name) => events.push(`start:${name}`),
      onPhaseComplete: (name) => events.push(`complete:${name}`),
    });

    // Simulate real services
    shutdown.addPhase('drain-http', async () => {
      await new Promise<void>((r) => setTimeout(r, 20));
    });

    shutdown.addPhase('stop-consumers', async () => {
      await new Promise<void>((r) => setTimeout(r, 20));
    });

    shutdown.addPhase('close-db', async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
    }, {
      after: ['drain-http', 'stop-consumers'],
    });

    await shutdown.trigger('test');

    // Verify drain-http and stop-consumers both started before close-db
    const drainStart = events.indexOf('start:drain-http');
    const stopStart = events.indexOf('start:stop-consumers');
    const closeDbStart = events.indexOf('start:close-db');

    expect(drainStart).toBeGreaterThanOrEqual(0);
    expect(stopStart).toBeGreaterThanOrEqual(0);
    expect(closeDbStart).toBeGreaterThan(drainStart);
    expect(closeDbStart).toBeGreaterThan(stopStart);

    // Verify close-db started only after both dependencies completed
    const drainComplete = events.indexOf('complete:drain-http');
    const stopComplete = events.indexOf('complete:stop-consumers');

    expect(closeDbStart).toBeGreaterThan(drainComplete);
    expect(closeDbStart).toBeGreaterThan(stopComplete);

    // All phases should have completed
    expect(events.filter((e) => e.startsWith('complete:'))).toHaveLength(3);
  });

  it('handles mixed success and failure gracefully', async () => {
    const events: string[] = [];
    const errors: Array<{ name: string; err: unknown }> = [];
    const logger = { log: vi.fn() };

    const shutdown = createShutdownManager({
      timeout: 5000,
      logger,
      onPhaseStart: (name) => events.push(`start:${name}`),
      onPhaseComplete: (name) => events.push(`complete:${name}`),
      onPhaseError: (name, err) => errors.push({ name, err }),
    });

    shutdown.addPhase('drain-http', () => {
      throw new Error('Connection reset');
    });

    shutdown.addPhase('stop-consumers', async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
    });

    // close-db depends on drain-http (which fails) — should still run
    shutdown.addPhase('close-db', async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
    }, {
      after: ['drain-http', 'stop-consumers'],
    });

    await shutdown.trigger('test');

    // drain-http failed, but close-db and stop-consumers should still complete
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe('drain-http');
    expect(events).toContain('complete:stop-consumers');
    expect(events).toContain('complete:close-db');
  });
});
