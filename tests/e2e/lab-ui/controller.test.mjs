// SIMULATED real-shaped ports: no browser worker, Arkiv or external HTTP contact.
import { describe, expect, it, vi } from 'vitest';
import { createLiveLabController } from '../../../apps/dashboard/src/features/lab/live-controller.ts';
import { LIVE_REGISTRY_POLICY, LIVE_RPC_URL } from '../../../apps/dashboard/src/features/registry/live-policy.ts';


const START = Date.parse('2030-01-01T00:00:00.000Z');
const ORIGIN = 'https://observer.monolith.example.org';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code, retryable: true,
  message: code === 'WORKER_UNAVAILABLE' ? 'The anonymity worker is unavailable.' : 'The upstream is unavailable.' } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture(faults = {}) {
  let time = START;
  let sequence = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const now = () => new Date(time).toISOString();
  const allocations = new Map();
  const receipts = new Map();
  const baselines = new Set();
  const calls = [];
  const close = vi.fn();
  const metadata = () => ({ network: 'nym', specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
    workerHash: `0x${'a'.repeat(64)}`, harnessVersion: '0.4.0', verification: 'harness-ready-after-specifier-lookup',
    bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP', bootstrapCalls: 2, privacyLabel: 'ANONYMIZING_WORKER', observedAt: now() });
  function record(url, rpc, route) {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN || parsed.searchParams.get('endpointId') !== 'lab_optimism') throw Error('Unexpected URL');
    const runId = parsed.searchParams.get('runId');
    const run = allocations.get(runId);
    if (!run) throw Error('Unknown synthetic run');
    calls.push({ url, rpc: structuredClone(rpc), route });
    time += 200;
    if (rpc.id === run.baselineRpcId) baselines.add(runId);
    const sourceClass = !baselines.has(runId) ? 'unknown' : route === 'direct' ? 'baseline' : 'different-from-baseline';
    receipts.get(runId).push({ rpcId: rpc.id, method: rpc.method, addressPresent: rpc.method === 'eth_getBalance',
      sourceClass, durationMs: 150, success: true });
    return { jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'eth_chainId' ? faults.wrongChain ? '0x1' : '0xa' : '0x1' };
  }
  const createDriver = vi.fn((sink) => {
    let ready = false;
    return { route: 'anon-nym', evidence: 'SIMULATED',
      async initialize() {
        if (faults.warmDeferred) await faults.warmDeferred.promise;
        if (faults.warmFailure) return fail('WORKER_UNAVAILABLE');
        if (!ready) for (const part of ['hash', 'resolvers']) sink.emit({ schemaVersion: 1, readId: `bootstrap_${part}`, attempt: 1,
          endpointId: 'bootstrap_mainnet', chainId: '1', method: 'eth_call', callsite: `transport.bootstrap.${part}`,
          route: 'direct-bootstrap', durationMs: 100, success: true, bootstrap: true,
          evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read' });
        ready = true; return ok(undefined);
      },
      getMetadata: () => ready ? metadata() : null,
      async exchange(url, request, signal) {
        if (!ready || signal.aborted) return fail('WORKER_UNAVAILABLE');
        if (faults.networkFailure) return fail('UPSTREAM_UNAVAILABLE');
        return ok(record(url, request, 'nym'));
      },
      async close() { ready = false; close(); },
    };
  });
  const allocate = vi.fn(async () => {
    const allocation = { schemaVersion: 1, runId: `run-${uuid()}`, baselineRpcId: `rpc-${uuid()}`,
      expiresAt: new Date(time + 300_000).toISOString() };
    allocations.set(allocation.runId, allocation); receipts.set(allocation.runId, []);
    return ok(allocation);
  });
  const registry = { load: vi.fn(async () => ok({
    schemaVersion: 1, revision: 'simulated_registry_revision', evidence: 'OBSERVED_LIVE', origin: 'arkiv-query',
    generatedAt: now(), expiresAt: new Date(time + (faults.expiredRegistry ? -1 : 30_000)).toISOString(),
    endpoints: [{ endpointId: 'rpc_simulated_endpoint', chainId: '10', chainName: 'SIMULATED OP Mainnet', rpcUrl: LIVE_RPC_URL,
      publisher: LIVE_REGISTRY_POLICY.trustedPublishers[0], entityKey: `0x${'c'.repeat(64)}`,
      expiresAt: new Date(time + 600_000).toISOString(), source: {
        url: `${LIVE_REGISTRY_POLICY.source.urlPrefix}10.json`, revision: LIVE_REGISTRY_POLICY.source.revision,
        licenseUrl: LIVE_REGISTRY_POLICY.source.licenseUrl, snapshotSha256: LIVE_REGISTRY_POLICY.source.snapshotSha256,
      } }],
  })) };
  const diagnostics = vi.fn(async (allocation) => {
    const observations = structuredClone(receipts.get(allocation.runId));
    if (faults.extraReceipt) observations.push({ ...observations[0], rpcId: `rpc-${uuid()}` });
    return ok({ schemaVersion: 1, runId: allocation.runId, expiresAt: allocation.expiresAt, observations });
  });
  const directFetch = vi.fn(async (url, options) => new Response(JSON.stringify(record(url, JSON.parse(options.body), 'direct')),
    { headers: { 'content-type': 'application/json' } }));
  const controller = createLiveLabController({ enabled: !faults.disabled, observerOrigin: ORIGIN,
    createDriver, allocate, registry, diagnostics, directFetch,
    clock: { now }, uuid, elapsed: () => time - START });
  return { controller, createDriver, allocate, registry, diagnostics, directFetch, calls, close, allocations };
}

describe('live controller lifecycle and independent accounting', () => {
  it('starts private without any direct control and leaves origin comparison explicitly unresolved', async () => {
    const f = fixture();
    await f.controller.run('private');
    const state = f.controller.getSnapshot();
    expect(state.phase).toBe('READY');
    expect(state.reads.map((read) => read.role)).toEqual(['probe', 'private']);
    expect(state.correlation.sourceComparison).toBe('not-run');
    expect(state.correlation.analysis.report.evidence).toBe('SIMULATED');
    expect(f.directFetch).not.toHaveBeenCalled();
    expect(f.calls.every((call) => call.route === 'nym')).toBe(true);
    await f.controller.close();
  });
  it('uses a single reusable worker across sequential fresh private/comparison/leak/repair runs', async () => {
    const f = fixture();
    for (const mode of ['private', 'compare', 'leak', 'repair']) {
      await f.controller.run(mode);
      const snapshot = f.controller.getSnapshot();
      expect(snapshot.phase, JSON.stringify({ mode, error: snapshot.error,
        codes: snapshot.correlation?.codes, widget: snapshot.correlation?.widgetPrivacy,
        source: snapshot.correlation?.sourceComparison, roles: snapshot.reads.map((row) => row.role) })).toBe('READY');
    }
    const state = f.controller.getSnapshot();
    expect(f.createDriver).toHaveBeenCalledTimes(1);
    expect(f.allocate).toHaveBeenCalledTimes(4);
    expect(new Set(f.allocations.keys()).size).toBe(4);
    expect(state.correlation.widgetPrivacy).toBe('pass');
    expect(state.correlation.analysis.report).toMatchObject({ eligibleReads: 4, protectedReads: 3, protectedCoverage: 0.75 });
    expect(state.previousLeakReport).toMatchObject({ eligibleReads: 4, protectedReads: 2 });
    expect(state.milestones).toEqual({ privateRead: true, comparison: true, leak: true, repair: true });
    const exported = JSON.parse(f.controller.exportReport());
    expect(exported.report.evidence).toBe('SIMULATED');
    expect(exported.previousLeakReport.findings.some((finding) => finding.code === 'DIRECT_BYPASS')).toBe(true);
    for (const value of ['params', 'headers', 'rawIp', 'baselinePeer']) expect(Object.hasOwn(exported, value)).toBe(false);
    await f.controller.close();
  });
  it('serializes rapid actions before the first await, rather than racing run allocations', async () => {
    const f = fixture();
    await Promise.all([f.controller.run('private'), f.controller.run('compare')]);
    expect(f.allocate).toHaveBeenCalledTimes(1);
    expect(f.directFetch).not.toHaveBeenCalled();
    await f.controller.close();
  });
  it.each(['warmFailure', 'networkFailure', 'wrongChain', 'expiredRegistry', 'extraReceipt'])(
    'fails closed on %s without any automatic direct request', async (fault) => {
      const f = fixture({ [fault]: true });
      await f.controller.run('private');
      expect(f.controller.getSnapshot().phase).toBe('BLOCKED');
      expect(f.controller.getSnapshot().error).not.toBe(null);
      expect(f.directFetch).not.toHaveBeenCalled();
      if (fault === 'warmFailure') expect(f.allocate).not.toHaveBeenCalled();
      if (fault === 'expiredRegistry') expect(f.calls).toHaveLength(0);
      await f.controller.close();
    },
  );
  it('does not begin bootstrap or metadata work when the deployment is unconfigured', async () => {
    const f = fixture({ disabled: true });
    await f.controller.run('private');
    expect(f.createDriver).not.toHaveBeenCalled(); expect(f.allocate).not.toHaveBeenCalled();
    expect(f.directFetch).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'BLOCKED', error: 'POLICY_DENIED' });
    await f.controller.close();
  });
  it('destroys a pending worker and ignores its late initialization after controller close', async () => {
    const warmDeferred = deferred();
    const f = fixture({ warmDeferred });
    const pending = f.controller.run('private');
    await vi.waitFor(() => expect(f.createDriver).toHaveBeenCalledTimes(1));
    await f.controller.close();
    warmDeferred.resolve(); await pending;
    expect(f.allocate).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().phase).toBe('CLOSED');
    expect(f.close).toHaveBeenCalled();
    await f.controller.run('private');
    expect(f.createDriver).toHaveBeenCalledTimes(1);
  });
});
