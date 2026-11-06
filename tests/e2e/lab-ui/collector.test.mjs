// SIMULATED adapter/observer receipts. No worker, provider or chain is contacted.
import { describe, expect, it, vi } from 'vitest';
import { correlateLiveRun } from '../../../apps/dashboard/src/features/lab/correlate.ts';
import { createMappedLiveDriver, observerReadUrl } from '../../../apps/dashboard/src/features/lab/wire-driver.ts';
import { sendDirectFixture } from '../../../apps/dashboard/src/features/lab/direct-fixture.ts';
import { LIVE_RPC_URL } from '../../../apps/dashboard/src/features/registry/live-policy.ts';

const ORIGIN = 'https://observer.monolith.example.org';
const NOW = '2030-01-01T00:00:10.000Z';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const allocation = { schemaVersion: 1, runId: `run-${uuid(1)}`, baselineRpcId: `rpc-${uuid(2)}`,
  expiresAt: '2030-01-01T00:05:00.000Z' };
const worker = { network: 'nym', specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
  workerHash: `0x${'a'.repeat(64)}`, harnessVersion: '0.4.0', verification: 'harness-ready-after-specifier-lookup',
  bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP', bootstrapCalls: 2, privacyLabel: 'ANONYMIZING_WORKER', observedAt: NOW };
const ok = (value) => ({ ok: true, value });
const copy = (value) => structuredClone(value);

function scenario(mode = 'compare') {
  const roles = ['direct-control', 'probe', 'private', ...(mode === 'leak' ? ['leak'] : mode === 'repair' ? ['repair'] : [])];
  const reads = roles.map((role, n) => {
    const logicalReadId = role === 'probe' ? 'monolith_probe_1' : `read_fixture_${n}`;
    const callsite = role === 'probe' ? 'transport.chain-probe' : role === 'direct-control' ? 'lab.direct'
      : role === 'private' ? 'lab.balance' : 'lab.widget';
    const trace = { schemaVersion: 1, readId: logicalReadId, attempt: 1, endpointId: 'fixture_endpoint', chainId: '10',
      method: role === 'probe' ? 'eth_chainId' : 'eth_getBalance', callsite,
      route: role === 'direct-control' ? 'direct-debug' : 'anon-nym', durationMs: 200,
      success: true, bootstrap: false, evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read' };
    return { rpcId: role === 'direct-control' ? allocation.baselineRpcId : `rpc-${uuid(10 + n)}`,
      logicalReadId, role, method: trace.method, chainId: '10', endpointId: trace.endpointId,
      startedAt: '2030-01-01T00:00:01.000Z', completedAt: NOW, durationMs: 200,
      success: true, result: role === 'probe' ? '0xa' : '0x1', trace: role === 'leak' ? null : trace, evidence: 'SIMULATED' };
  });
  const bootstraps = ['hash', 'resolvers'].map((part) => ({ schemaVersion: 1, readId: `bootstrap_${part}`, attempt: 1,
    endpointId: 'bootstrap_mainnet', chainId: '1', method: 'eth_call', callsite: `transport.bootstrap.${part}`,
    route: 'direct-bootstrap', durationMs: 100, success: true, bootstrap: true,
    evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read' }));
  return { allocation: copy(allocation), reads, traces: [...bootstraps, ...reads.flatMap((row) => row.trace ? [row.trace] : [])],
    worker: copy(worker), observerOrigin: ORIGIN, mode, now: NOW, reportRunId: 'report_simulated_01', completedWithoutError: true,
    diagnostics: { schemaVersion: 1, runId: allocation.runId, expiresAt: allocation.expiresAt,
      observations: reads.map((row) => ({ rpcId: row.rpcId, method: row.method,
        addressPresent: row.method === 'eth_getBalance', sourceClass: row.role === 'direct-control' || row.role === 'leak'
          ? 'baseline' : 'different-from-baseline', durationMs: 150, success: true })) } };
}

describe('independent wire inventory and accounting', () => {
  it('counts the explicit direct control and excludes only the two disclosed bootstraps', () => {
    const result = correlateLiveRun(scenario());
    expect(result.exactInventory).toBe(true);
    expect(result.sourceComparison).toBe('confirmed');
    expect(result.analysis.report).toMatchObject({ evidence: 'SIMULATED', eligibleReads: 3, protectedReads: 2,
      successfulReads: 3, protectedCoverage: 2 / 3 });
    expect(result.analysis.report.scope.bootstrapExclusions).toHaveLength(2);
  });
  it('detects a real fixture bypass from its independent receipt without inventing a wrapper trace', () => {
    const result = correlateLiveRun(scenario('leak'));
    expect(result.widgetPrivacy).toBe('fail');
    expect(result.analysis.report).toMatchObject({ eligibleReads: 4, protectedReads: 2 });
    expect(result.analysis.report.findings.some((finding) => finding.code === 'DIRECT_BYPASS')).toBe(true);
    expect(result.analysis.report.findings.some((finding) => finding.code === 'MISSING_TRACE')).toBe(true);
  });
  it('accepts the useful repaired widget while retaining direct-control denominator', () => {
    const result = correlateLiveRun(scenario('repair'));
    expect(result.widgetPrivacy).toBe('pass');
    expect(result.analysis.report).toMatchObject({ eligibleReads: 4, protectedReads: 3, protectedCoverage: 0.75 });
    expect(result.analysis.summary.functionalAcceptance).toBe('pass');
  });
  it.each(['extra', 'duplicate', 'missing', 'method', 'address', 'wrong-run', 'expired', 'unknown-source', 'same-source', 'unverified-worker'])(
    'refuses protection credit on independent %s disagreement', (fault) => {
      const input = scenario('repair');
      if (fault === 'extra') input.diagnostics.observations.push({ ...input.diagnostics.observations[0], rpcId: `rpc-${uuid(99)}` });
      if (fault === 'duplicate') input.diagnostics.observations.push(input.diagnostics.observations[0]);
      if (fault === 'missing') input.diagnostics.observations.pop();
      if (fault === 'method') input.diagnostics.observations[1].method = 'eth_getBalance';
      if (fault === 'address') input.diagnostics.observations[1].addressPresent = true;
      if (fault === 'wrong-run') input.diagnostics.runId = `run-${uuid(88)}`;
      if (fault === 'expired') input.now = allocation.expiresAt;
      if (fault === 'unknown-source') input.diagnostics.observations[1].sourceClass = 'unknown';
      if (fault === 'same-source') input.diagnostics.observations[2].sourceClass = 'baseline';
      if (fault === 'unverified-worker') input.worker.privacyLabel = 'NOT_ANONYMIZED';
      const result = correlateLiveRun(input);
      expect(result.widgetPrivacy).not.toBe('pass');
      expect(result.sourceComparison).not.toBe('confirmed');
      expect(result.codes.length).toBeGreaterThan(0);
      if (fault === 'extra') {
        expect(result.unmatchedObservations).toBe(1);
        expect(result.analysis.report.eligibleReads).toBe(5);
        expect(result.analysis.report.findings.some((finding) => finding.code === 'UNEXPLAINED_EGRESS')).toBe(true);
      }
    },
  );
  it('does not call a default private read an observed source comparison', () => {
    const input = scenario();
    input.mode = 'private';
    input.reads.shift(); input.traces.splice(2, 1); input.diagnostics.observations.shift();
    for (const row of input.diagnostics.observations) row.sourceClass = 'unknown';
    const result = correlateLiveRun(input);
    expect(result.exactInventory).toBe(true);
    expect(result.sourceComparison).toBe('not-run');
    expect(result.analysis.summary.functionalAcceptance).toBe('unresolved');
    expect(result.analysis.report.protectedReads).toBe(0);
  });
});

describe('raw registry URL to protected observer capability', () => {
  function setup(response) {
    const reads = [];
    const exchange = vi.fn(async (_url, request) => ok(response ?? { jsonrpc: '2.0', id: request.id, result: '0xa' }));
    const close = vi.fn(async () => {});
    const mapping = createMappedLiveDriver({ base: { route: 'anon-nym', evidence: 'SIMULATED',
      initialize: async () => ok(undefined), exchange, close }, observerOrigin: ORIGIN,
      runId: allocation.runId, uuid: () => uuid(20), now: () => NOW, elapsed: () => 100,
      context: () => ({ role: 'probe', logicalReadId: null }), onRead: (row) => reads.push(row) });
    return { mapping, exchange, reads, close };
  }
  const probe = { jsonrpc: '2.0', id: 'monolith_rpc_1', method: 'eth_chainId', params: [] };
  it('uses only the fixed observer map, validates the wire response and restores the exact internal ID', async () => {
    const { mapping, exchange, reads } = setup();
    const result = await mapping.driver.exchange(LIVE_RPC_URL, probe, new AbortController().signal);
    expect(exchange.mock.calls[0][0]).toBe(`${ORIGIN}/api/observer/read?endpointId=lab_optimism&runId=${allocation.runId}`);
    expect(exchange.mock.calls[0][1].id).toBe(`rpc-${uuid(20)}`);
    expect(result).toEqual(ok({ jsonrpc: '2.0', id: 'monolith_rpc_1', result: '0xa' }));
    expect(reads.at(-1).trace).toBe(null);
    mapping.bindTrace({ schemaVersion: 1, readId: 'monolith_probe_1', attempt: 1, endpointId: 'registry_selection_1',
      chainId: '10', method: 'eth_chainId', callsite: 'transport.chain-probe', route: 'anon-nym',
      durationMs: 100, success: true, bootstrap: false, evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read' });
    expect(reads.at(-1).logicalReadId).toBe('monolith_probe_1');
  });
  it.each(['https://mainnet.optimism.io', 'https://evil.example.org/', `${LIVE_RPC_URL}?secret=yes`, 'http://127.0.0.1']) (
    'rejects unmapped or expanded URL %s before delegating', async (url) => {
      const { mapping, exchange } = setup();
      expect((await mapping.driver.exchange(url, probe, new AbortController().signal)).ok).toBe(false);
      expect(exchange).not.toHaveBeenCalled();
    },
  );
  it('refuses a mismatched wire ID instead of binding by method/timing/result', async () => {
    const { mapping } = setup({ jsonrpc: '2.0', id: 'wrong-id', result: '0xa' });
    expect(await mapping.driver.exchange(LIVE_RPC_URL, probe, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'RPC_RESPONSE_INVALID' } });
  });
  it('revokes the run capability without closing the separately owned worker', async () => {
    const { mapping, exchange, close } = setup();
    await mapping.driver.close();
    expect((await mapping.driver.exchange(LIVE_RPC_URL, probe, new AbortController().signal)).ok).toBe(false);
    expect(exchange).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
});

describe('explicit isolated direct fixture', () => {
  it('does not issue a direct request without explicit consent', async () => {
    const fetch = vi.fn();
    const result = await sendDirectFixture({ consent: false, role: 'leak', evidence: 'SIMULATED', observerOrigin: ORIGIN, allocation,
      endpointId: 'fixture_endpoint', uuid: () => uuid(30), now: () => NOW, elapsed: () => 0,
      send: fetch, signal: new AbortController().signal, onRead: () => {} });
    expect(result).toMatchObject({ ok: false, error: { code: 'POLICY_DENIED' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not accept a caller source/path expansion in the configured observer origin', () => {
    for (const origin of [`${ORIGIN}/arbitrary`, 'http://127.0.0.1', `https://user:private@observer.example.org`]) {
      expect(() => observerReadUrl(origin, allocation.runId)).toThrow('Invalid live observer configuration.');
    }
  });
});
