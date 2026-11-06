import { describe, expect, it } from 'vitest';
import { observerRunSchema, type ObserverRun, type Result } from '@monolith/shared';
import { DiagnosticsStore, isLabRpcId, isLabRunId } from '../../src/domain/diagnostics.js';

const RUN = 'run-11111111-1111-4111-8111-111111111111';
const OTHER_RUN = 'run-22222222-2222-4222-8222-222222222222';
const BASELINE = 'rpc-11111111-1111-4111-8111-111111111111';
const OTHER_RPC = 'rpc-22222222-2222-4222-8222-222222222222';
const THIRD_RPC = 'rpc-33333333-3333-4333-8333-333333333333';
const START = Date.parse('2030-01-01T00:00:00Z');
const TTL = 300_000;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function setup(options: { maxRuns?: number; maxObservations?: number } = {}) {
  let time = START;
  const store = new DiagnosticsStore({ nowMs: () => time, ...options });
  return { store, setTime: (next: number) => { time = next; } };
}

function observationClasses(run: ObserverRun) {
  return run.observations.map((observation) => observation.sourceClass);
}

function scheduler() {
  const jobs: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];
  return {
    jobs,
    scheduleExpiry(callback: () => void, delayMs: number) {
      const job = { callback, delayMs, cancelled: false };
      jobs.push(job);
      return () => { job.cancelled = true; };
    },
  };
}

describe('synthetic lab identifiers', () => {
  it('accepts only prefixed UUIDv4 IDs for diagnostic correlation', () => {
    expect(isLabRunId(RUN)).toBe(true);
    expect(isLabRpcId(BASELINE)).toBe(true);
    expect(isLabRunId(RUN.toUpperCase())).toBe(true);
    for (const input of [undefined, null, [], 'private-order-sentinel', BASELINE, RUN.replace('-4111-', '-1111-')]) {
      expect(isLabRunId(input)).toBe(false);
    }
    for (const input of [undefined, null, {}, RUN, '0x1111111111111111111111111111111111111111', BASELINE.replace('-8111-', '-7111-')]) {
      expect(isLabRpcId(input)).toBe(false);
    }
  });
});

describe('operator registration and bounded retention', () => {
  it('requires private registration and rejects duplicate or non-synthetic runs', () => {
    const { store } = setup();
    expect(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.register('private-order-sentinel', BASELINE)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.register(RUN, 'private-order-sentinel')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.register(RUN, BASELINE).ok).toBe(true);
    expect(store.register(RUN, OTHER_RPC)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(unwrap(store.get(RUN)).observations).toEqual([]);
  });

  it('expires at the exact five-minute boundary without extending on access', () => {
    const { store, setTime } = setup();
    unwrap(store.register(RUN, BASELINE));
    const expiresAt = '2030-01-01T00:05:00.000Z';
    setTime(START + TTL - 1);
    expect(unwrap(store.get(RUN)).expiresAt).toBe(expiresAt);
    const ticket = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    store.complete(ticket, 1, true);
    expect(unwrap(store.get(RUN)).expiresAt).toBe(expiresAt);
    setTime(START + TTL);
    expect(store.get(RUN)).toMatchObject({ ok: false, error: { code: 'EVIDENCE_EXPIRED' } });
    setTime(START + TTL + 1);
    expect(store.get(RUN)).toMatchObject({ ok: false, error: { code: 'EVIDENCE_EXPIRED' } });
    expect(store.get(OTHER_RUN)).toMatchObject({ ok: false, error: { code: 'EVIDENCE_EXPIRED' } });
  });

  it('prunes expired runs before capacity checks and allows fresh registration', () => {
    const { store, setTime } = setup({ maxRuns: 1 });
    unwrap(store.register(RUN, BASELINE));
    expect(store.register(OTHER_RUN, OTHER_RPC)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    setTime(START + TTL);
    expect(store.register(OTHER_RUN, OTHER_RPC).ok).toBe(true);
    expect(store.get(RUN).ok).toBe(false);
  });

  it('reserves capacity before upstream completion and cannot exceed the observation limit', () => {
    const { store } = setup({ maxObservations: 2 });
    unwrap(store.register(RUN, BASELINE));
    const first = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    const second = unwrap(store.reserve(RUN, OTHER_RPC, 'eth_getBalance', true, '192.0.2.2'));
    expect(store.reserve(RUN, THIRD_RPC, 'eth_chainId', false, undefined)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    store.complete(second, 2, false);
    store.complete(first, 5, true);
    expect(unwrap(store.get(RUN)).observations).toHaveLength(2);
    expect(store.reserve(RUN, THIRD_RPC, 'eth_chainId', false, undefined)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('scheduled retention cleanup', () => {
  it('deletes idle run state when the retention timer fires independently of later access', () => {
    const timers = scheduler();
    const store = new DiagnosticsStore({ nowMs: () => START, maxRuns: 1, scheduleExpiry: timers.scheduleExpiry });
    unwrap(store.register(RUN, BASELINE));
    const ticket = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.123'));
    store.complete(ticket, 1, true);
    const expiry = timers.jobs[0];
    expect(expiry?.delayMs).toBe(TTL);
    // Fire the injected retention timer without another store access. A fixed
    // wall clock also proves removal did not depend on a later lazy-prune call.
    expiry?.callback();
    expect(expiry?.cancelled).toBe(true);
    expect(store.get(RUN)).toMatchObject({ ok: false, error: { code: 'EVIDENCE_EXPIRED' } });
    expect(store.register(OTHER_RUN, OTHER_RPC).ok).toBe(true);
    store.complete(ticket, 2, true);
    expect(unwrap(store.get(OTHER_RUN)).observations).toEqual([]);
  });

  it('cancels a pruned timer and prevents its stale callback from deleting a replacement run', () => {
    const timers = scheduler();
    let now = START;
    const store = new DiagnosticsStore({ nowMs: () => now, scheduleExpiry: timers.scheduleExpiry });
    unwrap(store.register(RUN, BASELINE));
    const original = timers.jobs[0];
    now += TTL;
    expect(store.get(RUN).ok).toBe(false);
    expect(original?.cancelled).toBe(true);
    unwrap(store.register(RUN, BASELINE));
    const replacement = timers.jobs[1];
    original?.callback();
    expect(store.get(RUN).ok).toBe(true);
    expect(replacement?.cancelled).toBe(false);
    store.clear();
    expect(replacement?.cancelled).toBe(true);
  });

  it('cancels every scheduled expiry during shutdown', () => {
    const timers = scheduler();
    const store = new DiagnosticsStore({ nowMs: () => START, scheduleExpiry: timers.scheduleExpiry });
    unwrap(store.register(RUN, BASELINE));
    unwrap(store.register(OTHER_RUN, OTHER_RPC));
    store.clear();
    expect(timers.jobs).toHaveLength(2);
    expect(timers.jobs.every((job) => job.cancelled)).toBe(true);
    for (const job of timers.jobs) job.callback();
    expect(store.get(RUN).ok).toBe(false);
    expect(store.get(OTHER_RUN).ok).toBe(false);
  });
});

describe('source-class evidence', () => {
  it('fixes unknown classification before the baseline and never rewrites pending observations', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const earlier = unwrap(store.reserve(RUN, OTHER_RPC, 'eth_chainId', false, '192.0.2.2'));
    const baseline = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    store.complete(baseline, 1, true);
    store.complete(earlier, 2, true);
    expect(observationClasses(unwrap(store.get(RUN)))).toEqual(['baseline', 'unknown']);
  });

  it('compares trusted identities only and prevents baseline overwrite by repeated baseline IDs', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const first = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    const replay = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.2'));
    const samePeer = unwrap(store.reserve(RUN, OTHER_RPC, 'eth_getBalance', true, '192.0.2.1'));
    const unknownPeer = unwrap(store.reserve(RUN, THIRD_RPC, 'eth_chainId', false, undefined));
    store.complete(replay, 1, true);
    store.complete(samePeer, 2, true);
    store.complete(first, 3, true);
    store.complete(unknownPeer, 4, false);
    expect(observationClasses(unwrap(store.get(RUN)))).toEqual(['different-from-baseline', 'baseline', 'baseline', 'unknown']);
  });

  it('keeps an unknown initial baseline inconclusive rather than accepting a later substitute', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const first = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, undefined));
    const substitute = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    store.complete(first, 1, true);
    store.complete(substitute, 2, true);
    expect(observationClasses(unwrap(store.get(RUN)))).toEqual(['unknown', 'unknown']);
  });
});

describe('completion isolation and redaction', () => {
  it('does not resurrect expired diagnostics or append an old ticket after re-registration', () => {
    const { store, setTime } = setup();
    unwrap(store.register(RUN, BASELINE));
    const stale = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    setTime(START + TTL);
    store.complete(stale, 25, true);
    expect(store.get(RUN).ok).toBe(false);
    unwrap(store.register(RUN, BASELINE));
    store.complete(stale, 25, true);
    const fresh = unwrap(store.reserve(RUN, OTHER_RPC, 'eth_chainId', false, '192.0.2.1'));
    store.complete(fresh, 1, true);
    expect(observationClasses(unwrap(store.get(RUN)))).toEqual(['unknown']);
  });

  it('requires exact ticket identity and completes a reservation at most once', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const ticket = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    store.complete({ ...ticket }, 1, true);
    expect(unwrap(store.get(RUN)).observations).toEqual([]);
    store.complete(ticket, 2, true);
    store.complete(ticket, 3, false);
    expect(unwrap(store.get(RUN)).observations).toHaveLength(1);
    expect(unwrap(store.get(RUN)).observations[0]?.durationMs).toBe(2);
  });

  it('exports only shared sanitized scalar fields and returns detached snapshots', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const peer = '192.0.2.123';
    const ticket = unwrap(store.reserve(RUN, BASELINE, 'eth_getBalance', true, peer));
    expect(JSON.stringify(ticket)).not.toContain(peer);
    store.complete(ticket, 25, true);
    const first = unwrap(store.get(RUN));
    expect(observerRunSchema.safeParse(first).success).toBe(true);
    expect(JSON.stringify(first)).not.toContain(peer);
    expect(Object.keys(first.observations[0] ?? {}).sort()).toEqual([
      'addressPresent', 'durationMs', 'method', 'rpcId', 'sourceClass', 'success',
    ]);
    const observation = first.observations[0];
    if (observation) observation.sourceClass = 'unknown';
    first.observations.length = 0;
    expect(observationClasses(unwrap(store.get(RUN)))).toEqual(['baseline']);
  });

  it('rejects payload-bearing IDs without echoing their submitted values', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const result = store.reserve(RUN, 'synthetic-private-order-sentinel', 'eth_chainId', false, '192.0.2.123');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-order-sentinel');
    expect(JSON.stringify(result)).not.toContain('192.0.2.123');
  });

  it('clears run state and invalidates outstanding tickets on shutdown', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    const stale = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
    store.clear();
    expect(store.get(RUN).ok).toBe(false);
    unwrap(store.register(RUN, BASELINE));
    store.complete(stale, 5, true);
    expect(unwrap(store.get(RUN)).observations).toEqual([]);
  });

  it('does not emit invalid timing values into public diagnostics', () => {
    const { store } = setup();
    unwrap(store.register(RUN, BASELINE));
    for (const duration of [-1, NaN, Infinity]) {
      const ticket = unwrap(store.reserve(RUN, BASELINE, 'eth_chainId', false, '192.0.2.1'));
      store.complete(ticket, duration, true);
    }
    expect(unwrap(store.get(RUN)).observations).toEqual([]);
  });
});
