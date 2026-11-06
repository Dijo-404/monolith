import { describe, expect, it } from 'vitest';
import { commandActions, guideSteps, type GuideCommand } from '../src/app/guide.js';
import type { LabState } from '../src/app/lab-model.js';
import { createLabState, deriveChecks, labReducer } from '../src/app/lab-reducer.js';

const T0 = 1_800_000_000_000;

function command(state: LabState, name: GuideCommand, now = T0): LabState {
  return commandActions(name, now).reduce(labReducer, state);
}

function settleAll(state: LabState): LabState {
  let next = state;
  for (let guard = 0; guard < 10; guard++) {
    const pending = next.reads.filter((read) => read.outcome === 'in-flight');
    if (pending.length === 0) return next;
    for (const read of pending) next = labReducer(next, { type: 'read-settled', epoch: next.epoch, id: read.id, now: T0 + 5_000 });
  }
  throw new Error('reads never settled');
}

const step = (state: LabState, id: string) => guideSteps(state).find((item) => item.id === id);

describe('guided demo', () => {
  it('starts with nothing done and the private step waiting for the worker on a cold start', () => {
    const state = createLabState('cold-start', T0);
    const steps = guideSteps(state);
    expect(steps.map((item) => item.done)).toEqual([false, false, false, false]);
    expect(steps[0]?.primary?.command).toBe('send-direct');
    expect(step(state, 'protect')?.primary?.disabled).toBe(true);
    expect(step(state, 'protect')?.hint).toMatch(/Starting the worker/);
  });

  it('keeps each route in the comparison across a new run', () => {
    let state = settleAll(command(createLabState('warm', T0), 'send-direct'));
    state = settleAll(command(state, 'send-private'));
    expect(state.observed.direct?.originSeen).toBe('your-network');
    expect(state.observed.anon?.originSeen).toBe('exit-relay');
    expect(step(state, 'baseline')?.done).toBe(true);
    expect(step(state, 'protect')?.done).toBe(true);

    const rerun = labReducer(state, { type: 'new-run' });
    expect(rerun.reads).toEqual([]);
    expect(rerun.observed).toEqual(state.observed);
  });

  it('marks the leak caught, then fixed only after a clean rerun recomputes the check', () => {
    let state = settleAll(command(createLabState('warm', T0), 'inject-leak'));
    expect(state.milestones.leakCaught).toBe(true);
    expect(step(state, 'leak')?.done).toBe(false);
    expect(step(state, 'leak')?.primary?.command).toBe('fix-leak');
    expect(deriveChecks(state).find((check) => check.id === 'GT-03')?.status).toBe('fail');

    state = settleAll(command(state, 'fix-leak', T0 + 10));
    expect(state.leakInjected).toBe(false);
    expect(state.reads.some((read) => read.bypass)).toBe(false);
    expect(deriveChecks(state).find((check) => check.id === 'GT-03')?.status).toBe('pass');
    expect(step(state, 'leak')?.done).toBe(true);
  });

  it('takes the network offline, blocks the next private read and brings it back', () => {
    let state = command(createLabState('warm', T0), 'go-offline');
    expect(state.worker.state).toBe('BLOCKED');
    expect(step(state, 'outage')?.primary?.command).toBe('send-private');

    state = settleAll(command(state, 'send-private'));
    expect(state.reads.at(-1)).toMatchObject({ outcome: 'blocked', errorCode: 'WORKER_UNAVAILABLE', lane: 'anon' });
    expect(state.reads.some((read) => read.lane === 'direct')).toBe(false);
    expect(step(state, 'outage')?.done).toBe(true);
    expect(step(state, 'outage')?.secondary?.command).toBe('bring-online');

    state = command(state, 'bring-online');
    expect(state.worker.state).toBe('BOOTSTRAPPING');
  });

  it('forgets demo progress only when a new scenario loads', () => {
    const progressed = settleAll(command(createLabState('warm', T0), 'send-direct'));
    expect(progressed.milestones.baseline).toBe(true);
    const reloaded = labReducer(progressed, { type: 'load-scenario', scenario: 'warm', now: T0 + 1 });
    expect(reloaded.milestones.baseline).toBe(false);
    expect(reloaded.observed).toEqual({ direct: null, anon: null });
  });

  it('discloses a bypass that keeps firing while a managed read fails closed', () => {
    let state = settleAll(command(createLabState('warm', T0), 'inject-leak'));
    state = command(state, 'go-offline');
    state = settleAll(command(state, 'send-private'));

    expect(state.reads.some((read) => read.outcome === 'blocked' && read.errorCode === 'WORKER_UNAVAILABLE')).toBe(true);
    expect(state.reads.filter((read) => read.bypass && read.outcome === 'arrived')).toHaveLength(2);
    expect(step(state, 'outage')?.title).not.toMatch(/nothing leaks/);
    expect(step(state, 'outage')?.result).toContain('injected widget still sends directly');
    expect(deriveChecks(state).find((check) => check.id === 'GT-03')?.status).toBe('fail');
    expect(deriveChecks(state).find((check) => check.id === 'GT-04')?.detail).toContain('widget still bypasses');
  });
});
