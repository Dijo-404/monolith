// All data in these tests is SIMULATED. A coherent claimed-live input tests the
// validator's logic only; no test contacts a worker, observer or chain.
import { describe, expect, it } from 'vitest';
import { validatePairedProof } from './proof.mjs';

const BALANCE = '28b70527485da666aefed1d98fe8d088b2bc0878b0ef2637c49d6733d9f1df03';
const CHAIN = '37047d9fa98f2102688f6d8f5163bbe33308161d4f482b3e5853043ce6c7163b';
const START = '2030-01-01T00:00:00.000Z';
const NOW = '2030-01-01T00:01:00.000Z';
const at = (second) => new Date(Date.parse(START) + second * 1000).toISOString();
const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function simulatedClaimedLive() {
  const roles = ['direct-baseline', 'direct-control', 'protected-probe', 'protected-comparison'];
  const inventory = roles.map((role, index) => ({
    rpcId: `rpc-${uuid(index + 1)}`, role, method: role === 'protected-probe' ? 'eth_chainId' : 'eth_getBalance',
    readId: role === 'protected-probe' ? 'monolith_probe_1' : `mn009_${uuid(index + 1)}`,
    attempt: 1, issuedAt: at(20 + index * 5), completedAt: at(24 + index * 5),
    result: role === 'protected-probe' ? '0x1' : '0x0',
    requestFingerprint: role === 'protected-probe' ? CHAIN : BALANCE,
  }));
  const trace = (entry) => ({ schemaVersion: 1, readId: entry.readId, attempt: entry.attempt,
    endpointId: 'mn009_configured_ethereum', chainId: '1', method: entry.method,
    callsite: entry.role === 'protected-probe' ? 'transport.chain-probe' : 'observer.proof.read',
    route: entry.role.startsWith('direct-') ? 'direct-debug' : 'anon-nym', durationMs: 4000,
    success: true, bootstrap: false, evidence: 'OBSERVED_LIVE', payloadVisibility: 'rpc-endpoint-can-read' });
  const bootstraps = ['hash', 'resolvers'].map((part) => ({ ...trace(inventory[0]),
    readId: `bootstrap_${part}`, method: 'eth_call', callsite: `transport.bootstrap.${part}`,
    route: 'direct-bootstrap', bootstrap: true }));
  return { schemaVersion: 1, runId: `run-${uuid(10)}`, startedAt: START, completedAt: at(40),
    evidence: 'OBSERVED_LIVE', inventory,
    diagnostics: { schemaVersion: 1, runId: `run-${uuid(10)}`, expiresAt: at(310),
      observations: inventory.map((entry) => ({ rpcId: entry.rpcId, method: entry.method,
        addressPresent: entry.method === 'eth_getBalance',
        sourceClass: entry.role.startsWith('direct-') ? 'baseline' : 'different-from-baseline',
        durationMs: 4000, success: true })) },
    worker: { network: 'nym', specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
      workerHash: `0x${'a'.repeat(64)}`, harnessVersion: '0.4.0',
      verification: 'harness-ready-after-specifier-lookup', bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP',
      bootstrapCalls: 2, privacyLabel: 'ANONYMIZING_WORKER', observedAt: at(8) },
    resolverResponses: [{ status: 200, bytes: 123456, keccak256: `0x${'a'.repeat(64)}` }],
    traces: [...bootstraps, ...inventory.map(trace)],
    boundary: { ordinaryProtectedTargetRequests: 0, detectionSelfCheck: true },
    topology: { mode: 'trusted-proxy', verified: true }, shutdown: { closed: true },
  };
}

function rejected(input, code, verdict = 'BLOCKED') {
  const result = validatePairedProof(input, NOW);
  const expected = { schemaVersion: 1, sourceTask: 'MN-009',
    evidence: input?.evidence === 'SIMULATED' ? 'SIMULATED' : 'BLOCKED',
    verdict, codes: [code] };
  if (verdict === 'INCONCLUSIVE' && input?.evidence !== 'SIMULATED') {
    expect(result).toMatchObject(expected);
    expect(result.paired.inventory).toHaveLength(input.inventory.length);
    expect(result.paired.traces).toHaveLength(input.traces.length);
  } else expect(result).toEqual({ ...expected, paired: null });
}

describe('MN-009 pure paired-proof validation with SIMULATED inputs', () => {
  it('accepts coherent claimed-live structure without asserting that this fixture was observed', () => {
    const result = validatePairedProof(simulatedClaimedLive(), NOW);
    expect(result.verdict).toBe('OBSERVED_LIVE');
    expect(result.paired.inventory).toHaveLength(4);
    expect(result.paired.direct.sourceClass).toBe('baseline');
    expect(result.paired.protected.sourceClass).toBe('different-from-baseline');
    expect(result.paired.protected.addressPresent).toBe(true);
    expect(result.paired.traces.filter((trace) => trace.bootstrap)).toHaveLength(2);
    expect(result.paired.traces.at(-1)).toMatchObject({ rpcId: result.paired.protected.rpcId,
      readId: result.paired.protected.readId, route: 'anon-nym' });
    expect(result.paired.bootstrapExclusions).toEqual(['transport.bootstrap.hash', 'transport.bootstrap.resolvers']);
  });

  it('never upgrades simulated observations despite internally consistent metadata', () => {
    const input = simulatedClaimedLive();
    input.evidence = 'SIMULATED';
    for (const trace of input.traces) trace.evidence = 'SIMULATED';
    rejected(input, 'SIMULATED_EVIDENCE');
  });

  it('accepts changing genuine chain-state balances for the exact same fixed synthetic inputs', () => {
    const input = simulatedClaimedLive();
    input.inventory.at(-1).result = '0x123';
    expect(validatePairedProof(input, NOW).verdict).toBe('OBSERVED_LIVE');
  });

  it('requires the forged-header direct control even when the caller claims a verified topology', () => {
    const input = simulatedClaimedLive();
    const removed = input.inventory.splice(1, 1)[0];
    input.traces = input.traces.filter((trace) => trace.readId !== removed.readId);
    input.diagnostics.observations = input.diagnostics.observations.filter((row) => row.rpcId !== removed.rpcId);
    rejected(input, 'DIRECT_CONTROL_INVENTORY_INVALID');
  });

  it('supports verified Tor metadata with the same exact inventory checks', () => {
    const input = simulatedClaimedLive();
    input.worker.network = 'tor';
    input.worker.specifier = '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e';
    for (const trace of input.traces) if (trace.route === 'anon-nym') trace.route = 'anon-tor';
    expect(validatePairedProof(input, NOW).verdict).toBe('OBSERVED_LIVE');
  });

  it.each([
    ['same ID duplicate', (input) => input.diagnostics.observations.push({ ...input.diagnostics.observations[0] })],
    ['conflicting duplicate', (input) => input.diagnostics.observations.push({ ...input.diagnostics.observations[0], sourceClass: 'different-from-baseline', method: 'eth_chainId' })],
    ['missing', (input) => input.diagnostics.observations.pop()],
    ['unexpected', (input) => { input.diagnostics.observations[0].rpcId = `rpc-${uuid(99)}`; }],
    ['failed', (input) => { input.diagnostics.observations[0].success = false; }],
  ])('rejects %s diagnostics rather than selecting a convenient row', (_label, mutate) => {
    const input = simulatedClaimedLive();
    mutate(input);
    rejected(input, 'DIAGNOSTIC_INVENTORY_MISMATCH');
  });

  it.each(['method', 'addressPresent'])('rejects mismatched observer %s', (field) => {
    const input = simulatedClaimedLive();
    input.diagnostics.observations[0][field] = field === 'method' ? 'eth_chainId' : false;
    rejected(input, 'DIAGNOSTIC_CONTENT_MISMATCH');
  });

  it('joins diagnostics by exact issued ID, independent of diagnostic completion array order', () => {
    const input = simulatedClaimedLive();
    input.diagnostics.observations.reverse();
    expect(validatePairedProof(input, NOW).verdict).toBe('OBSERVED_LIVE');
  });

  it.each([
    ['duplicate wire ID', (input) => { input.inventory[1].rpcId = input.inventory[0].rpcId; }],
    ['duplicate logical attempt', (input) => { input.inventory[1].readId = input.inventory[0].readId; }],
    ['non-random wire ID', (input) => { input.inventory[0].rpcId = 'monolith_rpc_1'; }],
    ['private read label', (input) => { input.inventory[0].readId = 'private-wallet-address'; }],
    ['unexpected retry', (input) => { input.inventory[0].attempt = 2; }],
  ])('rejects %s in issued inventory', (_label, mutate) => {
    const input = simulatedClaimedLive(); mutate(input); rejected(input, 'INVALID_REQUEST_INVENTORY');
  });

  it('rejects a baseline issued after another read', () => {
    const input = simulatedClaimedLive();
    input.inventory[0].role = 'direct-control';
    rejected(input, 'INVALID_BASELINE_ORDER');
  });

  it('rejects a protected comparison without an earlier protected chain probe', () => {
    const input = simulatedClaimedLive();
    input.inventory[2].role = 'protected-comparison';
    input.inventory[2].method = 'eth_getBalance';
    input.inventory[2].requestFingerprint = BALANCE;
    rejected(input, 'INVALID_COMPARISON_ORDER');
  });

  it('rejects overlapping or out-of-order request completion times', () => {
    const input = simulatedClaimedLive(); input.inventory[1].issuedAt = at(22);
    rejected(input, 'INVALID_REQUEST_ORDER');
  });

  it('rejects a direct control after protected dispatch has begun', () => {
    const input = simulatedClaimedLive();
    input.inventory[2].role = 'direct-control';
    input.inventory[2].method = 'eth_getBalance'; input.inventory[2].requestFingerprint = BALANCE;
    input.inventory[1].role = 'protected-probe'; input.inventory[1].method = 'eth_chainId';
    input.inventory[1].requestFingerprint = CHAIN; input.inventory[1].result = '0x1';
    rejected(input, 'INVALID_REQUEST_ORDER');
  });

  it.each(['0x2', '0x01', null])('rejects a wrong or noncanonical protected chain result %s', (result) => {
    const input = simulatedClaimedLive(); input.inventory[2].result = result;
    rejected(input, result === '0x2' ? 'CHAIN_PROBE_INVALID' : 'RPC_READ_FAILED');
  });

  it('rejects altered or private compared payload fingerprints', () => {
    const input = simulatedClaimedLive(); input.inventory.at(-1).requestFingerprint = 'f'.repeat(64);
    rejected(input, 'COMPARED_PAYLOAD_MISMATCH');
  });

  it.each(['passthrough', 'unknown'])('rejects %s as an anonymizing worker', (network) => {
    const input = simulatedClaimedLive(); input.worker.network = network;
    rejected(input, 'WORKER_NOT_VERIFIED');
  });

  it.each([
    ['specifier', '0x1111111111111111111111111111111111111111'],
    ['harnessVersion', '0.3.0'], ['bootstrapCalls', 1], ['privacyLabel', 'NOT_ANONYMIZED'],
    ['verification', 'caller-asserted'], ['bootstrap', 'anonymous'],
  ])('rejects invalid worker %s', (field, value) => {
    const input = simulatedClaimedLive(); input.worker[field] = value; rejected(input, 'WORKER_NOT_VERIFIED');
  });

  it('rejects readiness observed after baseline dispatch', () => {
    const input = simulatedClaimedLive(); input.worker.observedAt = at(25); rejected(input, 'WORKER_TIME_MISMATCH');
  });

  it.each([
    (input) => { input.resolverResponses[0].keccak256 = `0x${'b'.repeat(64)}`; },
    (input) => { input.resolverResponses[0].status = 404; },
    (input) => { input.resolverResponses[0].bytes = 0; },
    (input) => { input.resolverResponses = []; },
  ])('requires independently captured successful matching bundle bytes', (mutate) => {
    const input = simulatedClaimedLive(); mutate(input); rejected(input, 'WORKER_BUNDLE_UNCONFIRMED');
  });

  it.each([
    (input) => { input.traces.at(-1).route = 'direct-debug'; },
    (input) => { input.traces.at(-1).readId = input.traces[2].readId; },
    (input) => { input.traces.at(-1).success = false; },
    (input) => { input.traces.at(-1).evidence = 'SIMULATED'; },
    (input) => { input.traces.push({ ...input.traces.at(-1) }); },
    (input) => { input.traces.pop(); },
  ])('requires exact successful route/read/attempt trace identity', (mutate) => {
    const input = simulatedClaimedLive(); mutate(input); rejected(input, 'TRACE_INVENTORY_MISMATCH');
  });

  it('requires exactly the two separately disclosed specifier bootstrap operations', () => {
    const input = simulatedClaimedLive(); input.traces[1].callsite = 'transport.bootstrap.hash';
    rejected(input, 'BOOTSTRAP_UNDISCLOSED');
  });

  it('does not mix simulated bootstrap traces into a claimed live worker run', () => {
    const input = simulatedClaimedLive(); input.traces[0].evidence = 'SIMULATED';
    rejected(input, 'BOOTSTRAP_UNDISCLOSED');
  });

  it('rejects arbitrary bootstrap read labels before projecting trace identity', () => {
    const input = simulatedClaimedLive(); input.traces[0].readId = 'private-data-sentinel';
    rejected(input, 'BOOTSTRAP_UNDISCLOSED');
  });

  it.each([
    (input) => { input.boundary.ordinaryProtectedTargetRequests = 1; },
    (input) => { input.boundary.detectionSelfCheck = false; },
  ])('requires independent bypass detection and zero protected direct egress', (mutate) => {
    const input = simulatedClaimedLive(); mutate(input); rejected(input, 'PROTECTED_HTTP_BOUNDARY_FAILED');
  });

  it('requires completed worker cleanup', () => {
    const input = simulatedClaimedLive(); input.shutdown.closed = false; rejected(input, 'WORKER_NOT_CLOSED');
  });

  it.each([
    (input) => { input.topology.mode = 'unknown'; },
    (input) => { input.topology.verified = false; },
  ])('keeps unknown topology inconclusive', (mutate) => {
    const input = simulatedClaimedLive(); mutate(input); rejected(input, 'SOURCE_TOPOLOGY_UNVERIFIED', 'INCONCLUSIVE');
  });

  it('preserves validated measurements while retaining unverified topology and fixed safe fields', () => {
    const input = simulatedClaimedLive(); input.topology.verified = false;
    input.diagnostics.observations.at(-1).sourceClass = 'unknown';
    input.traces.at(-1).callsite = 'private-data-sentinel';
    input.traces.at(-1).endpointId = 'private-data-sentinel';
    const result = validatePairedProof(input, NOW);
    expect(result).toMatchObject({ evidence: 'BLOCKED', verdict: 'INCONCLUSIVE',
      codes: ['SOURCE_TOPOLOGY_UNVERIFIED'], paired: {
        topology: { mode: 'trusted-proxy', verified: false },
        protected: { sourceClass: 'unknown', method: 'eth_getBalance', addressPresent: true, result: '0x0' },
      } });
    expect(result.paired.inventory).toHaveLength(4);
    expect(result.paired.traces).toHaveLength(6);
    for (const forbidden of ['private-data-sentinel', 'requestFingerprint', 'params', BALANCE, CHAIN]) {
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
    expect(result.paired.traces.every((trace) => !Object.hasOwn(trace, 'callsite')
      && !Object.hasOwn(trace, 'endpointId'))).toBe(true);
  });

  it('does not expose a coherent simulated measurement as live when source is inconclusive', () => {
    const input = simulatedClaimedLive(); input.evidence = 'SIMULATED';
    for (const trace of input.traces) trace.evidence = 'SIMULATED';
    input.topology.mode = 'unknown';
    expect(validatePairedProof(input, NOW)).toMatchObject({ evidence: 'SIMULATED', verdict: 'INCONCLUSIVE',
      codes: ['SOURCE_TOPOLOGY_UNVERIFIED'], paired: null });
  });

  it.each(['unknown', 'different-from-baseline'])('keeps a direct source of %s inconclusive', (source) => {
    const input = simulatedClaimedLive(); input.diagnostics.observations[1].sourceClass = source;
    rejected(input, 'DIRECT_BASELINE_UNESTABLISHED', 'INCONCLUSIVE');
  });

  it.each(['unknown', 'baseline'])('keeps a protected source of %s inconclusive', (source) => {
    const input = simulatedClaimedLive(); input.diagnostics.observations.at(-1).sourceClass = source;
    rejected(input, 'DISTINCT_PROTECTED_SOURCE_UNESTABLISHED', 'INCONCLUSIVE');
  });

  it('expires precisely at the diagnostic deadline', () => {
    const input = simulatedClaimedLive(); input.diagnostics.expiresAt = NOW;
    rejected(input, 'EVIDENCE_EXPIRED');
  });

  it('rejects runs with registration before the claimed start', () => {
    const input = simulatedClaimedLive(); input.diagnostics.expiresAt = at(299);
    rejected(input, 'EVIDENCE_EXPIRED');
  });

  it.each([undefined, '2030-01-01T00:00:30.000Z', 'bad-time', '2030-01-01T00:01:00+00:00'])('rejects invalid verification time %s', (now) => {
    expect(validatePairedProof(simulatedClaimedLive(), now).codes).toEqual(['INVALID_PROOF_TIME']);
  });

  it.each([
    ['top-level', (input) => { input.rawIp = 'private-data-sentinel'; }, 'INVALID_PROOF_INPUT'],
    ['diagnostics', (input) => { input.diagnostics.observations[0].rawIp = 'private-data-sentinel'; }, 'DIAGNOSTIC_INVENTORY_MISMATCH'],
    ['worker', (input) => { input.worker.secret = 'private-data-sentinel'; }, 'WORKER_NOT_VERIFIED'],
    ['trace', (input) => { input.traces[0].params = ['private-data-sentinel']; }, 'TRACE_INVENTORY_MISMATCH'],
  ])('rejects unrecognized %s data without echoing it', (_label, mutate, code) => {
    const input = simulatedClaimedLive(); mutate(input); const result = validatePairedProof(input, NOW);
    expect(result.codes).toEqual([code]); expect(JSON.stringify(result)).not.toContain('private-data-sentinel');
  });

  it('projects only validated safe facts and discards arbitrary internal trace text', () => {
    const input = simulatedClaimedLive();
    input.traces[2].callsite = 'private-data-sentinel'; input.traces[2].endpointId = 'private-data-sentinel';
    const result = validatePairedProof(input, NOW);
    expect(result.verdict).toBe('OBSERVED_LIVE');
    const text = JSON.stringify(result);
    for (const forbidden of ['private-data-sentinel', 'requestFingerprint', 'params', BALANCE, CHAIN]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('returns a fixed failure for malformed primitive input', () => {
    for (const input of [null, undefined, false, 'private-data-sentinel', [], {}]) {
      rejected(input, 'INVALID_PROOF_INPUT');
    }
  });
});
