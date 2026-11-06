// SIMULATED controller ports only. No HTTP, browser worker, SDK or Arkiv contact occurs.
import { describe, expect, it, vi } from 'vitest';
import { createLiveLabController } from '../../../apps/dashboard/src/features/lab/live-controller.ts';
import { LIVE_REGISTRY_POLICY, LIVE_RPC_URL } from '../../../apps/dashboard/src/features/registry/live-policy.ts';
import { deriveSandboxWalkthrough } from '../../../apps/dashboard/src/features/sandbox/SandboxWalkthrough.tsx';

const ORIGIN = 'https://observer.monolith.example.org';
const START = Date.parse('2030-01-01T00:00:00.000Z');
const ok = (value) => ({ ok: true, value });
const unavailable = () => ({ ok: false, error: { code: 'WORKER_UNAVAILABLE',
  message: 'The anonymity worker is unavailable.', retryable: true } });

function softwareFixture({ workerUnavailable = false, startup = null } = {}) {
  let time = START;
  let sequence = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const now = () => new Date(time).toISOString();
  const allocations = new Map();
  const receipts = new Map();
  const calls = [];
  let drivers = 0;
  let closes = 0;
  let ready = false;
  const metadata = () => ready ? { network: 'nym', specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
    workerHash: `0x${'a'.repeat(64)}`, harnessVersion: '0.4.0', verification: 'harness-ready-after-specifier-lookup',
    bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP', bootstrapCalls: 2,
    privacyLabel: 'ANONYMIZING_WORKER', observedAt: now() } : null;
  function record(url, rpc, route) {
    const parsed = new URL(url);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.searchParams.get('endpointId')).toBe('lab_optimism');
    const runId = parsed.searchParams.get('runId');
    expect(allocations.has(runId)).toBe(true);
    calls.push({ runId, rpc: structuredClone(rpc), route });
    time += 100;
    receipts.get(runId).push({ rpcId: rpc.id, method: rpc.method,
      addressPresent: rpc.method === 'eth_getBalance',
      sourceClass: route === 'direct' ? 'baseline' : 'different-from-baseline',
      durationMs: 100, success: true });
    return { jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'eth_chainId' ? '0xa' : '0x1' };
  }
  const controller = createLiveLabController({ enabled: true, observerOrigin: ORIGIN,
    clock: { now }, uuid, elapsed: () => time - START,
    createDriver(sink) {
      drivers++;
      return { route: 'anon-nym', evidence: 'SIMULATED', getMetadata: metadata,
        async initialize() {
          if (startup) await startup;
          if (workerUnavailable) return unavailable();
          if (!ready) for (const part of ['hash', 'resolvers']) sink.emit({
            schemaVersion: 1, readId: `bootstrap_${part}`, attempt: 1, endpointId: 'bootstrap_mainnet',
            chainId: '1', method: 'eth_call', callsite: `transport.bootstrap.${part}`,
            route: 'direct-bootstrap', durationMs: 100, success: true, bootstrap: true,
            evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read',
          });
          ready = true;
          return ok(undefined);
        },
        async exchange(url, request, signal) {
          return ready && !signal.aborted ? ok(record(url, request, 'nym')) : unavailable();
        },
        async close() { ready = false; closes++; },
      };
    },
    async allocate() {
      const allocation = { schemaVersion: 1, runId: `run-${uuid()}`, baselineRpcId: `rpc-${uuid()}`,
        expiresAt: new Date(time + 300_000).toISOString() };
      allocations.set(allocation.runId, allocation);
      receipts.set(allocation.runId, []);
      return ok(allocation);
    },
    registry: { async load() {
      // A synthetic external DTO exercises production admission. Its marker is not live evidence:
      // every driver, read and exported analysis remains explicitly SIMULATED.
      return ok({ schemaVersion: 1, revision: 'simulated_registry_revision', evidence: 'OBSERVED_LIVE',
        origin: 'arkiv-query', generatedAt: now(), expiresAt: new Date(time + 30_000).toISOString(),
        endpoints: [{ endpointId: 'rpc_simulated_endpoint', chainId: '10', chainName: 'SIMULATED OP Mainnet',
          rpcUrl: LIVE_RPC_URL, publisher: LIVE_REGISTRY_POLICY.trustedPublishers[0], entityKey: `0x${'c'.repeat(64)}`,
          expiresAt: new Date(time + 600_000).toISOString(), source: {
            url: `${LIVE_REGISTRY_POLICY.source.urlPrefix}10.json`, revision: LIVE_REGISTRY_POLICY.source.revision,
            licenseUrl: LIVE_REGISTRY_POLICY.source.licenseUrl,
            snapshotSha256: LIVE_REGISTRY_POLICY.source.snapshotSha256,
          } }],
      });
    } },
    async diagnostics(allocation) {
      return ok({ schemaVersion: 1, runId: allocation.runId, expiresAt: allocation.expiresAt,
        observations: structuredClone(receipts.get(allocation.runId)) });
    },
    async directFetch(url, options) {
      return new Response(JSON.stringify(record(url, JSON.parse(options.body), 'direct')),
        { headers: { 'content-type': 'application/json' } });
    },
  });
  return { controller, calls, allocations, get drivers() { return drivers; }, get closes() { return closes; } };
}

describe('real controller to sandbox presenter with simulated ports', () => {
  it('retains the actual measured bypass then reruns the same useful intent with fresh identities', async () => {
    const f = softwareFixture();
    try {
      await f.controller.run('leak');
      const beforeState = f.controller.getSnapshot();
      const before = JSON.parse(f.controller.exportReport());
      expect(deriveSandboxWalkthrough(beforeState)).toMatchObject({ outcome: 'leak-observed', evidence: 'SIMULATED', canRepair: true });
      expect(beforeState.reads.find((read) => read.role === 'leak')).toMatchObject({ success: true, result: '0x1', trace: null });
      expect(before.report.findings.some((finding) => finding.code === 'DIRECT_BYPASS')).toBe(true);
      const beforeCalls = structuredClone(f.calls);

      await f.controller.run('repair');
      const afterState = f.controller.getSnapshot();
      const after = JSON.parse(f.controller.exportReport());
      expect(deriveSandboxWalkthrough(afterState)).toMatchObject({ outcome: 'repaired', evidence: 'SIMULATED' });
      expect(afterState.reads.find((read) => read.role === 'repair')).toMatchObject({ success: true, result: '0x1', evidence: 'SIMULATED' });
      expect(after.report).toMatchObject({ eligibleReads: 4, protectedReads: 3, successfulReads: 4, protectedCoverage: 0.75 });
      expect(after.previousLeakReport).toEqual(before.report);
      expect(after.scenario).toEqual(before.scenario);
      expect(after.scenario.seed).toBe('monolith-zero-address-balance-v1');
      expect(after.fixturePatch.before).toEqual(before.widgetFixture);
      expect(after.fixturePatch.after).toEqual(after.widgetFixture);
      expect(after.fixturePatch.operations[1]).toEqual({ op: 'replace', path: '/route', value: 'anon-nym' });
      expect(afterState.allocation.runId).not.toBe(beforeState.allocation.runId);
      expect(after.report.runId).not.toBe(before.report.runId);
      const afterCalls = f.calls.slice(beforeCalls.length);
      const intent = (calls) => calls.map(({ rpc }) => ({ method: rpc.method, params: rpc.params }));
      expect(intent(afterCalls)).toEqual(intent(beforeCalls));
      const wireIds = beforeCalls.concat(afterCalls).map(({ rpc }) => rpc.id);
      expect(new Set(wireIds).size).toBe(wireIds.length);
      expect(beforeCalls.map((call) => call.route)).toEqual(['direct', 'nym', 'nym', 'direct']);
      expect(afterCalls.map((call) => call.route)).toEqual(['direct', 'nym', 'nym', 'nym']);
      expect(f.drivers).toBe(1);
      expect(f.allocations.size).toBe(2);
    } finally { await f.controller.close(); }
  });

  it('does not enable repair when its first action repairs without a retained measured failure', async () => {
    const f = softwareFixture();
    try {
      await f.controller.run('repair');
      expect(f.controller.getSnapshot().correlation.widgetPrivacy).toBe('pass');
      expect(deriveSandboxWalkthrough(f.controller.getSnapshot())).toMatchObject({ outcome: 'incomplete', canRepair: false });
    } finally { await f.controller.close(); }
  });

  it('blocks unavailable worker startup with no RPC, allocation or successful result', async () => {
    const f = softwareFixture({ workerUnavailable: true });
    try {
      await f.controller.run('leak');
      expect(f.controller.getSnapshot()).toMatchObject({ phase: 'BLOCKED', error: 'WORKER_UNAVAILABLE' });
      expect(deriveSandboxWalkthrough(f.controller.getSnapshot())).toMatchObject({ outcome: 'blocked', canRepair: false });
      expect(f.calls).toEqual([]);
      expect(f.allocations.size).toBe(0);
      expect(f.controller.exportReport()).toBeNull();
    } finally { await f.controller.close(); }
  });

  it('cannot revive a repaired pass after close or a late worker completion', async () => {
    const f = softwareFixture();
    await f.controller.run('leak');
    await f.controller.run('repair');
    expect(deriveSandboxWalkthrough(f.controller.getSnapshot()).outcome).toBe('repaired');
    await f.controller.close();
    expect(deriveSandboxWalkthrough(f.controller.getSnapshot())).toMatchObject({ outcome: 'blocked', canInject: false, canRepair: false });
    let finishStartup;
    const startup = new Promise((resolve) => { finishStartup = resolve; });
    const late = softwareFixture({ startup });
    const running = late.controller.run('leak');
    await vi.waitFor(() => expect(late.drivers).toBe(1));
    await late.controller.close();
    finishStartup();
    await running;
    expect(late.controller.getSnapshot().phase).toBe('CLOSED');
    expect(deriveSandboxWalkthrough(late.controller.getSnapshot()).outcome).toBe('blocked');
    expect(late.calls).toEqual([]);
    expect(late.allocations.size).toBe(0);
  });
});
