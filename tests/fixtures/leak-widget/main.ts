import { makeError, type EndpointCandidate, type RpcTrace } from '@monolith/shared';
import { createMonolithTransport, type TransportDriver } from '@monolith/transport';
import type { DeclaredRead, MeasuredAttempt } from '@monolith/privacy-analyzer';
import fixture from './manifest.json';
import { leakingReceipt, unexplainedRead } from './leak-widget.js';

const endpointId = 'fixture_endpoint_001';
const publisher = `0x${'11'.repeat(20)}`;
const traces: RpcTrace[] = [];
type Measurement = MeasuredAttempt;
const attempts: Measurement[] = [];
let outstanding: Measurement | undefined;
let eventSequence = 0;
let balanceAttempts = 0;
let mode = 'fixed';

const candidate: EndpointCandidate = {
  endpointId, chainId: '1', chainName: 'SIMULATED Ethereum', rpcUrl: fixture.rpcUrl,
  publisher: { creator: publisher, owner: publisher }, entityKey: `0x${'22'.repeat(32)}`,
  expiresAt: '2030-01-01T01:00:00.000Z', source: { url: 'https://source.monolith.example/data',
    revision: 'fixture-v1', licenseUrl: 'https://source.monolith.example/license', snapshotSha256: '33'.repeat(32) },
};

async function bootstrapFixture() {
  const response = await fetch(fixture.bootstrapUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'bootstrap_fixture_001', method: 'eth_call',
      params: [{ to: fixture.bootstrapContract, data: fixture.bootstrapSelector }, 'latest'] }) });
  await response.json();
  traces.push({ schemaVersion: 1, readId: 'bootstrap_fixture_001', attempt: 1, endpointId: 'bootstrap_endpoint_001',
    chainId: '1', method: 'eth_call', callsite: 'fixture.bootstrap', route: 'direct-bootstrap',
    durationMs: 1, success: true, bootstrap: true, evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read' });
}

async function explicitDirectControl() {
  const response = await fetch(fixture.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `control_${fixture.seed}`, method: 'eth_getBalance',
      params: [`0x${'00'.repeat(20)}`, 'latest'] }) });
  await response.json();
  traces.push({ schemaVersion: 1, readId: 'fixture_control_001', attempt: 1, endpointId, chainId: '1',
    method: 'eth_getBalance', callsite: 'fixture.control', route: 'direct-debug', durationMs: 1,
    success: true, bootstrap: false, evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read' });
}

/** Test-owned port only: it does not claim to be the Anon-RPC SDK or an anonymity network. */
const driver: TransportDriver = {
  route: 'anon-nym', evidence: 'SIMULATED',
  async initialize() {
    if (mode === 'outage') return { ok: false, error: makeError('WORKER_UNAVAILABLE') };
    await bootstrapFixture();
    return { ok: true, value: undefined };
  },
  async exchange(_url, rpc) {
    if (outstanding) throw new Error('Concurrent fixture exchange denied.');
    const fail = rpc.method === 'eth_getBalance' && (mode === 'block-all' || mode === 'retry' && ++balanceAttempts === 1);
    outstanding = { eventId: `fixture_event_${++eventSequence}`, endpointId, chainId: '1', method: rpc.method,
      originAlias: 'rpc', route: 'anon-nym', sent: true, completed: !fail, durationMs: 1,
      workerVerified: true, evidence: 'SIMULATED' };
    attempts.push(outstanding);
    return fail ? { ok: false, error: makeError('UPSTREAM_TIMEOUT') }
      : { ok: true, value: { jsonrpc: '2.0', id: rpc.id,
        result: rpc.method === 'eth_chainId' ? '0x1' : rpc.method === 'eth_getTransactionReceipt' ? null : '0x2a' } };
  },
  async close() {},
};

async function run(nextMode: string) {
  if (!['fixed', 'leak', 'retry', 'outage', 'block-all', 'unexplained', 'missing-trace', 'direct-control'].includes(nextMode)) throw new Error('Unknown fixture.');
  mode = nextMode;
  traces.length = 0; attempts.length = 0; outstanding = undefined; eventSequence = 0; balanceAttempts = 0;
  const transport = createMonolithTransport({
    policy: { privacyRequired: true, allowedChains: ['1'], allowedMethods: ['eth_chainId', 'eth_getBalance', 'eth_getTransactionReceipt'],
      allowDirectDebugControl: false, failClosed: true }, driver,
    clock: { now: () => '2030-01-01T00:00:00.000Z' },
    trustedPublishers: [{ creator: publisher, owner: publisher }], approvedOrigins: [new URL(fixture.rpcUrl).origin],
    allowedCallsites: ['fixture.balance', 'fixture.receipt'], maxAttempts: 2,
    traceSink: { emit(trace) {
      traces.push(trace);
      if (outstanding) {
        if (outstanding.method !== trace.method || outstanding.completed !== trace.success) throw new Error('Fixture binding mismatch.');
        outstanding.ref = { readId: trace.readId, attempt: trace.attempt };
        outstanding.callsiteAlias = trace.callsite;
        outstanding = undefined;
      } else if (trace.route === 'blocked') {
        attempts.push({ eventId: `fixture_event_${++eventSequence}`, ref: { readId: trace.readId, attempt: trace.attempt },
          endpointId: trace.endpointId, chainId: trace.chainId, method: trace.method, callsiteAlias: trace.callsite,
          originAlias: 'rpc', route: 'blocked', sent: false, completed: false, durationMs: 0,
          workerVerified: false, evidence: 'SIMULATED' });
      }
    } },
  });
  const reads: DeclaredRead[] = [{ readId: 'fixture_balance_001', endpointId, chainId: '1', method: 'eth_getBalance',
    callsiteAlias: 'fixture.balance', scenarioAlias: 'fixture', privacyRequired: true },
  { readId: 'fixture_receipt_001', endpointId, chainId: '1', method: 'eth_getTransactionReceipt',
    callsiteAlias: 'fixture.receipt', scenarioAlias: 'fixture', privacyRequired: true }];
  let balance;
  let receipt;
  let receiptSucceeded: boolean;
  try {
    const initialized = await transport.initialize();
    if (initialized.ok) await transport.validateEndpoint(candidate);
    balance = await transport.read({ readId: 'fixture_balance_001', endpointId, chainId: '1',
      params: [`0x${'00'.repeat(20)}`, 'latest'], method: 'eth_getBalance', callsite: 'fixture.balance' });
    if (mode === 'leak') {
      const leaked = await leakingReceipt(fixture.rpcUrl, fixture.seed);
      receiptSucceeded = leaked.jsonrpc === '2.0' && leaked.id === `leak_${fixture.seed}` && leaked.result === null;
    } else {
      receipt = await transport.read({ readId: 'fixture_receipt_001', endpointId, chainId: '1',
        params: [`0x${'00'.repeat(32)}`], method: 'eth_getTransactionReceipt', callsite: 'fixture.receipt' });
      receiptSucceeded = receipt.ok;
    }
    if (mode === 'unexplained') await unexplainedRead(fixture.rpcUrl, fixture.seed);
    if (mode === 'direct-control') {
      reads.push({ readId: 'fixture_control_001', endpointId, chainId: '1', method: 'eth_getBalance',
        callsiteAlias: 'fixture.control', scenarioAlias: 'fixture', privacyRequired: false });
      await explicitDirectControl();
    }
    // The legitimate privacy-required chain probe is eligible, never a bootstrap exception.
    const probe = traces.find((entry) => entry.callsite === 'transport.chain-probe');
    if (probe) reads.push({ readId: probe.readId, endpointId, chainId: '1', method: probe.method,
      callsiteAlias: probe.callsite, scenarioAlias: 'fixture', privacyRequired: true });
    if (mode === 'missing-trace') traces.splice(traces.findIndex((entry) => entry.readId === 'fixture_balance_001'), 1);
    return { evidence: 'SIMULATED', seed: fixture.seed, reads, traces, attempts,
      usefulReadSucceeded: balance.ok && balance.value === '0x2a' && receiptSucceeded,
      balanceResult: balance.ok ? balance.value : null, driverExchangeCount: eventSequence,
      failures: [balance, receipt].filter((value) => value && !value.ok).map((value) => value && !value.ok ? value.error.code : '') };
  } finally { await transport.close(); }
}

Object.assign(globalThis, { fixtureRun: run });
