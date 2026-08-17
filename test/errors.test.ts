import { describe, it, expect } from 'vitest';
import {
  PhaseTimeoutError,
  StallDetectedError,
  DuplicatePhaseError,
  UnknownDependencyError,
} from '../src/errors.js';

describe('PhaseTimeoutError', () => {
  it('sets name, message, and structured fields', () => {
    const err = new PhaseTimeoutError('close-db', 5000);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PhaseTimeoutError);
    expect(err.name).toBe('PhaseTimeoutError');
    expect(err.phaseName).toBe('close-db');
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain('close-db');
    expect(err.message).toContain('5000');
  });
});

describe('StallDetectedError', () => {
  it('sets name, message, and structured fields', () => {
    const stalledPhases = ['phase-b', 'phase-c'];
    const waitingOn = {
      'phase-b': ['phase-a'],
      'phase-c': ['phase-a', 'phase-b'],
    };
    const err = new StallDetectedError(stalledPhases, waitingOn);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StallDetectedError);
    expect(err.name).toBe('StallDetectedError');
    expect(err.stalledPhases).toEqual(['phase-b', 'phase-c']);
    expect(err.waitingOn).toEqual(waitingOn);
    expect(err.message).toContain('2 phase(s)');
    expect(err.message).toContain('phase-b');
    expect(err.message).toContain('phase-c');
  });
});

describe('DuplicatePhaseError', () => {
  it('sets name, message, and structured fields', () => {
    const err = new DuplicatePhaseError('drain-http');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DuplicatePhaseError);
    expect(err.name).toBe('DuplicatePhaseError');
    expect(err.phaseName).toBe('drain-http');
    expect(err.message).toContain('drain-http');
    expect(err.message).toContain('already registered');
  });
});

describe('UnknownDependencyError', () => {
  it('sets name, message, and structured fields', () => {
    const err = new UnknownDependencyError('close-db', 'drainn-http');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnknownDependencyError);
    expect(err.name).toBe('UnknownDependencyError');
    expect(err.phaseName).toBe('close-db');
    expect(err.unknownDep).toBe('drainn-http');
    expect(err.message).toContain('close-db');
    expect(err.message).toContain('drainn-http');
    expect(err.message).toContain('never registered');
  });
});
