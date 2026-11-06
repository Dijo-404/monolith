import { describe, expect, it } from 'vitest';
import type { LabAction, LabState, ReadRow } from '../src/app/lab-model.js';
import { canRunRead, createLabState, deriveChecks, labReducer, tallyRun } from '../src/app/lab-reducer.js';

const T0 = 1_800_000_000_000;

function run(state: LabState, ...actions: LabAction[]): LabState {
  return actions.reduce(labReducer, state);
}

function settleAll(state: LabState, now = T0 + 10_000): LabState {
  let next = state;
  // Settling a probe appends the real read, so loop until nothing is in flight.
  for (let guard = 0; guard < 10; guard++) {
    const pending = next.reads.filter((read) => read.outcome === 'in-flight');
    if (pending.length === 0) return next;
    for (const read of pending) next = labReducer(next, { type: 'read-settled', epoch: next.epoch, id: read.id, now });
  }
  throw new Error('reads never settled');
}

function check(state: LabState, id: string) {
  return deriveChecks(state).find((item) => item.id === id);
}

const directLaneReads = (reads: readonly ReadRow[]) => reads.filter((read) => read.lane === 'direct' || read.lane === 'leak');

describe('lab shell policy', () => {
  it('starts in private mode with no reads and waits for the worker on a cold start', () => {
    const state = createLabState('cold-start', T0);
    expect(state.privateMode).toBe(true);
    expect(state.worker.state).toBe('BOOTSTRAPPING');
    expect(state.reads).toEqual([]);
    expect(canRunRead(state)).toBe(false);
    expect(labReducer(state, { type: 'run-read', now: T0 })).toBe(state);
  });

  it('validates the Arkiv endpoint through the worker before the balance read leaves', () => {
    let state = run(createLabState('warm', T0), { type: 'run-read', now: T0 });
    expect(state.reads).toHaveLength(1);
    expect(state.reads[0]).toMatchObject({ method: 'eth_chainId', route: 'anon-tor', kind: 'probe' });
    expect(state.registry.chainProbe).toBe('pending');

    state = settleAll(state);
    expect(state.registry.chainProbe).toBe('match');
    expect(state.reads.map((read) => [read.method, read.route, read.outcome])).toEqual([
      ['eth_chainId', 'anon-tor', 'arrived'],
      ['eth_getBalance', 'anon-tor', 'arrived'],
    ]);
    expect(state.reads[1]).toMatchObject({ originSeen: 'exit-relay', addressInPayload: true, evidence: 'SIMULATED' });
    expect(check(state, 'GT-02')?.status).toBe('pass');
  });

  it('needs a separate confirmation before the direct negative control sends anything', () => {
    const asked = run(createLabState('warm', T0), { type: 'ask-direct' });
    expect(asked.confirmingDirect).toBe(true);
    expect(asked.reads).toEqual([]);

    const cancelled = labReducer(asked, { type: 'cancel-direct' });
    expect(cancelled.reads).toEqual([]);

    const sent = settleAll(labReducer(asked, { type: 'confirm-direct', now: T0 }));
    expect(sent.reads).toHaveLength(1);
    expect(sent.reads[0]).toMatchObject({ kind: 'direct-comparison', route: 'direct-debug', originSeen: 'your-network' });
    expect(tallyRun(sent.reads).eligible).toBe(0);
    expect(check(sent, 'GT-01')?.status).toBe('pass');
  });

  it('blocks private reads when the worker is unavailable and never falls back to direct', () => {
    let state = run(createLabState('worker-unavailable', T0), { type: 'run-read', now: T0 }, { type: 'run-read', now: T0 + 50 });
    state = settleAll(state);
    expect(state.reads.every((read) => read.outcome === 'blocked' && read.errorCode === 'WORKER_UNAVAILABLE')).toBe(true);
    expect(directLaneReads(state.reads)).toEqual([]);
    expect(check(state, 'GT-04')?.status).toBe('pass');

    const retried = labReducer(state, { type: 'retry-worker' });
    expect(retried.worker.state).toBe('BOOTSTRAPPING');
  });

  it('refuses passthrough for privacy-required reads and gives it no protected credit', () => {
    const required = settleAll(run(createLabState('passthrough', T0), { type: 'run-read', now: T0 }));
    expect(required.reads[0]).toMatchObject({ outcome: 'blocked', errorCode: 'POLICY_DENIED' });

    const optional = settleAll(
      run(createLabState('passthrough', T0), { type: 'set-private-mode', on: false }, { type: 'run-read', now: T0 }),
    );
    expect(optional.reads[0]).toMatchObject({ route: 'passthrough', originSeen: 'your-network', privacyRequired: false });
    expect(tallyRun(optional.reads)).toMatchObject({ eligible: 0, viaWorker: 0 });
  });

  it('fails the bypass check on an injected leak and recomputes it on a clean rerun', () => {
    let state = run(createLabState('warm', T0), { type: 'set-leak', on: true, now: T0 }, { type: 'run-read', now: T0 + 10 });
    state = settleAll(state);
    const bypasses = state.reads.filter((read) => read.bypass);
    expect(bypasses.length).toBeGreaterThanOrEqual(1);
    expect(bypasses[0]).toMatchObject({ method: 'eth_getTransactionReceipt', callsite: 'payments/status.ts:27' });
    expect(bypasses.every((read) => !read.addressInPayload)).toBe(true);
    expect(check(state, 'GT-03')?.status).toBe('fail');
    expect(deriveChecks(state)[0]?.id).toBe('GT-03');

    state = settleAll(
      run(state, { type: 'set-leak', on: false, now: T0 + 20 }, { type: 'new-run' }, { type: 'run-read', now: T0 + 30 }),
    );
    expect(state.reads.some((read) => read.bypass)).toBe(false);
    expect(check(state, 'GT-03')?.status).toBe('pass');
  });

  it('refuses every read when the registry snapshot has expired', () => {
    const state = run(
      createLabState('registry-expired', T0),
      { type: 'run-read', now: T0 },
      { type: 'ask-direct' },
      { type: 'confirm-direct', now: T0 + 5 },
    );
    expect(state.reads.map((read) => [read.kind, read.outcome, read.errorCode])).toEqual([
      ['private', 'blocked', 'REGISTRY_EXPIRED'],
      ['direct-comparison', 'blocked', 'REGISTRY_EXPIRED'],
    ]);
  });

  it('sends no balance read when the endpoint cannot be validated', () => {
    const state = settleAll(run(createLabState('observer-unavailable', T0), { type: 'run-read', now: T0 }));
    expect(state.reads).toHaveLength(1);
    expect(state.reads[0]).toMatchObject({ method: 'eth_chainId', outcome: 'failed', errorCode: 'UPSTREAM_UNAVAILABLE' });
    expect(state.registry.chainProbe).toBe('not-run');
  });

  it('ignores settlements from a previous scenario', () => {
    const before = run(createLabState('warm', T0), { type: 'run-read', now: T0 });
    const staleId = before.reads[0]?.id ?? '';
    const after = run(before, { type: 'load-scenario', scenario: 'warm', now: T0 + 1 });
    const settled = labReducer(after, { type: 'read-settled', epoch: before.epoch, id: staleId, now: T0 + 2 });
    expect(settled).toBe(after);
    expect(settled.reads).toEqual([]);
  });

  it('reports no check as passed before any read runs', () => {
    const checks = deriveChecks(createLabState('warm', T0));
    expect(checks.every((item) => item.status === 'not-run' && item.evidence === 'SIMULATED')).toBe(true);
  });
});
