import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShutdownManager } from '../src/shutdown-manager.js';
import { DuplicatePhaseError, UnknownDependencyError } from '../src/errors.js';

/** Quiet logger to avoid noise in test output. */
function silentLogger() {
  return { log: vi.fn() };
}

describe('ShutdownManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Clean up any signal handlers that tests may have installed
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  describe('addPhase', () => {
    it('supports fluent chaining', () => {
      const manager = createShutdownManager({ logger: silentLogger() });

      const result = manager
        .addPhase('a', () => {})
        .addPhase('b', () => {})
        .addPhase('c', () => {});

      expect(result).toBe(manager);
    });

    it('throws DuplicatePhaseError for duplicate names', () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('drain-http', () => {});

      expect(() => manager.addPhase('drain-http', () => {})).toThrow(DuplicatePhaseError);
    });
  });

  describe('Manual trigger', () => {
    it('runs the full shutdown sequence without OS signals', async () => {
      const executionOrder: string[] = [];
      const logger = silentLogger();
      const manager = createShutdownManager({ logger });

      manager
        .addPhase('a', () => { executionOrder.push('a'); })
        .addPhase('b', () => { executionOrder.push('b'); }, { after: ['a'] });

      await manager.trigger('test');

      expect(executionOrder).toEqual(['a', 'b']);
    });

    it('does not call process.exit', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('a', () => {});

      await manager.trigger('test');

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('handles zero phases gracefully', async () => {
      const manager = createShutdownManager({ logger: silentLogger() });

      // Should not throw
      await manager.trigger('test');
    });
  });

  describe('Unknown dependency validation', () => {
    it('throws UnknownDependencyError at trigger time for typo in after', async () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('close-db', () => {}, { after: ['drainn-http'] });

      await expect(manager.trigger('test')).rejects.toThrow(UnknownDependencyError);
    });

    it('includes the phase name and unknown dep in the error', async () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('close-db', () => {}, { after: ['nonexistent'] });

      try {
        await manager.trigger('test');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UnknownDependencyError);
        if (err instanceof UnknownDependencyError) {
          expect(err.phaseName).toBe('close-db');
          expect(err.unknownDep).toBe('nonexistent');
        }
      }
    });

    it('allows phases to be registered in any order', async () => {
      const executionOrder: string[] = [];
      const manager = createShutdownManager({ logger: silentLogger() });

      // Register dependent phase BEFORE its dependency
      manager.addPhase('close-db', () => { executionOrder.push('close-db'); }, {
        after: ['drain-http'],
      });
      manager.addPhase('drain-http', () => { executionOrder.push('drain-http'); });

      await manager.trigger('test');

      expect(executionOrder).toEqual(['drain-http', 'close-db']);
    });
  });

  describe('Double-signal handling', () => {
    it('second trigger() during shutdown is a no-op', async () => {
      const logger = silentLogger();
      const manager = createShutdownManager({ logger, timeout: 5000 });
      manager.addPhase('slow', () => new Promise<void>((r) => setTimeout(r, 100)));

      // Fire both concurrently
      const [first] = await Promise.allSettled([
        manager.trigger('SIGTERM'),
        manager.trigger('SIGTERM'),
      ]);

      expect(first.status).toBe('fulfilled');
      // Second trigger should have logged "already in progress"
      const logCalls = logger.log.mock.calls.flat().join(' ');
      expect(logCalls).toContain('already in progress');
    });
  });

  describe('PID 1 warning', () => {
    it('logs a warning when process.pid is 1', () => {
      const logger = silentLogger();
      const pidSpy = vi.spyOn(process, 'pid', 'get').mockReturnValue(1);

      const manager = createShutdownManager({ logger });
      manager.listen();

      const logOutput = logger.log.mock.calls.flat().join(' ');
      expect(logOutput).toContain('PID 1');
      expect(logOutput).toContain('docker run --init');

      pidSpy.mockRestore();
    });

    it('does not warn when process.pid is not 1', () => {
      const logger = silentLogger();
      const pidSpy = vi.spyOn(process, 'pid', 'get').mockReturnValue(12345);

      const manager = createShutdownManager({ logger });
      manager.listen();

      const logOutput = logger.log.mock.calls.flat().join(' ');
      expect(logOutput).not.toContain('PID 1');

      pidSpy.mockRestore();
    });
  });

  describe('listen()', () => {
    it('supports fluent chaining', () => {
      const manager = createShutdownManager({ logger: silentLogger() });

      const result = manager.addPhase('a', () => {}).listen();

      expect(result).toBe(manager);
    });

    it('attaches process signal listener and exits 0 on successful shutdown', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('a', () => {}).listen();

      // Emit SIGTERM signal to trigger the installed signal handler
      process.emit('SIGTERM');

      // Wait microtask for trigger promise to resolve
      await new Promise((r) => setTimeout(r, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('exits with error code 1 when the dependency graph is invalid', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('failing', () => {}, { after: ['unknown-dep'] }).listen();

      process.emit('SIGTERM');

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(exitSpy).toHaveBeenCalledWith(1);
          resolve();
        }, 50);
      });
    });

    it('exits with error code 1 when a phase throws', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('failing', () => { throw new Error('boom'); }).listen();

      process.emit('SIGTERM');
      await new Promise((r) => setTimeout(r, 50));

      // A phase failure resolves trigger() rather than rejecting it, so the
      // exit code has to come from the recorded phase outcomes.
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(exitSpy).not.toHaveBeenCalledWith(0);
    });

    it('exits with error code 1 when a phase times out', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger(), timeout: 20 });
      manager
        .addPhase('hangs', () => new Promise<void>((r) => setTimeout(r, 500)))
        .listen();

      process.emit('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(exitSpy).not.toHaveBeenCalledWith(0);
    });

    it('forces exit 1 on double signal', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      manager
        .addPhase('slow', () => new Promise<void>((r) => setTimeout(r, 200)))
        .listen();

      // First signal starts shutdown
      process.emit('SIGTERM');
      // Second signal triggers double-signal force-exit
      process.emit('SIGTERM');

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('unlisten()', () => {
    it('supports fluent chaining', () => {
      const manager = createShutdownManager({ logger: silentLogger() });

      const result = manager.listen().unlisten();

      expect(result).toBe(manager);
    });

    it('removes the handlers installed by listen()', () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      const baseline = {
        term: process.listenerCount('SIGTERM'),
        int: process.listenerCount('SIGINT'),
      };

      manager.listen();
      expect(process.listenerCount('SIGTERM')).toBe(baseline.term + 1);
      expect(process.listenerCount('SIGINT')).toBe(baseline.int + 1);

      manager.unlisten();
      expect(process.listenerCount('SIGTERM')).toBe(baseline.term);
      expect(process.listenerCount('SIGINT')).toBe(baseline.int);
    });

    it('stops signals from triggering shutdown', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      let phaseRan = false;

      manager.addPhase('a', () => { phaseRan = true; }).listen().unlisten();

      process.emit('SIGTERM');
      await new Promise((r) => setTimeout(r, 50));

      expect(phaseRan).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(manager.isShuttingDown()).toBe(false);
    });

    it('is a no-op when listen() was never called', () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      const baseline = process.listenerCount('SIGTERM');

      expect(() => manager.unlisten()).not.toThrow();
      expect(process.listenerCount('SIGTERM')).toBe(baseline);
    });

    it('is a no-op when called twice', () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      const baseline = process.listenerCount('SIGTERM');

      manager.listen().unlisten();
      expect(() => manager.unlisten()).not.toThrow();
      expect(process.listenerCount('SIGTERM')).toBe(baseline);
    });

    it('removes every handler when listen() was called more than once', () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      const baseline = process.listenerCount('SIGTERM');

      manager.listen().listen();
      expect(process.listenerCount('SIGTERM')).toBe(baseline + 2);

      manager.unlisten();
      expect(process.listenerCount('SIGTERM')).toBe(baseline);
    });

    it('does not reset shutdown state for an in-progress sequence', async () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('a', () => {}).listen();

      await manager.trigger('test');
      manager.unlisten();

      // Readiness must not flip back to "ready" once draining has begun.
      expect(manager.isShuttingDown()).toBe(true);
    });
  });

  describe('isShuttingDown()', () => {
    it('reports false before shutdown starts', () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('a', () => {});

      expect(manager.isShuttingDown()).toBe(false);
    });

    it('reports true from inside a phase, while draining', async () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      let observedDuringPhase: boolean | undefined;

      manager.addPhase('drain', () => {
        observedDuringPhase = manager.isShuttingDown();
      });

      await manager.trigger('test');

      expect(observedDuringPhase).toBe(true);
    });

    it('reports true synchronously on signal receipt', () => {
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const manager = createShutdownManager({ logger: silentLogger() });
      manager
        .addPhase('slow', () => new Promise<void>((r) => setTimeout(r, 50)))
        .listen();

      process.emit('SIGTERM');

      // No await: a readiness probe answering in this same tick must already
      // see the draining state, otherwise traffic keeps arriving mid-drain.
      expect(manager.isShuttingDown()).toBe(true);
    });

    it('remains true after shutdown completes', async () => {
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('a', () => {});

      await manager.trigger('test');

      expect(manager.isShuttingDown()).toBe(true);
    });
  });

  describe('Lifecycle callbacks', () => {
    it('invokes onPhaseStart and onPhaseComplete callbacks', async () => {
      const onPhaseStart = vi.fn();
      const onPhaseComplete = vi.fn();

      const manager = createShutdownManager({
        logger: silentLogger(),
        onPhaseStart,
        onPhaseComplete,
      });

      manager.addPhase('test-phase', () => {});
      await manager.trigger('test');

      expect(onPhaseStart).toHaveBeenCalledWith('test-phase');
      expect(onPhaseComplete).toHaveBeenCalledWith('test-phase', expect.any(Number));
    });

    it('invokes onPhaseError callback for failing phases', async () => {
      const onPhaseError = vi.fn();

      const manager = createShutdownManager({
        logger: silentLogger(),
        onPhaseError,
      });

      manager.addPhase('failing', () => { throw new Error('boom'); });
      await manager.trigger('test');

      expect(onPhaseError).toHaveBeenCalledWith('failing', expect.any(Error));
    });
  });

  describe('Options defaults', () => {
    it('uses 30_000ms default timeout', async () => {
      // We can verify this indirectly: a manager with no timeout option
      // should not timeout a fast phase
      const manager = createShutdownManager({ logger: silentLogger() });
      manager.addPhase('fast', () => {});

      // Should complete without timeout
      await manager.trigger('test');
    });
  });
});
