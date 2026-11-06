import { createMonolithTransport } from '@monolith/transport';
import { makeError } from '@monolith/shared';
import { readBalance } from '@monolith-agent-example';

const endpointId = 'mn029_endpoint_001';
const origin = 'https://rpc.mn029.example';
const address = `0x${'0'.repeat(40)}`;
const readIds = { witness: 'mn029_witness_001', example: 'mn029_example_001', probe: 'monolith_probe_1' };
const callsites = { witness: 'agent.witness', example: 'agent.example', probe: 'transport.chain-probe' };
const publisher = `0x${'1'.repeat(40)}`;
const quantity = (value) => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

/** This entry, adapters and all assertions remain outside the candidate copy. */
globalThis.monolithAgentScenario = async ({ scenario }) => {
  if (!['regression', 'repaired', 'worker-unavailable'].includes(scenario)) throw new Error('Invalid fixed scenario.');
  const traces = [];
  const attempts = [];
  let role = null;
  let pending = null;
  let closed = false;
  let sequence = 0;
  const driver = {
    route: 'anon-nym', evidence: 'SIMULATED',
    async initialize(signal) {
      return closed || signal.aborted || scenario === 'worker-unavailable'
        ? { ok: false, error: makeError('WORKER_UNAVAILABLE') } : { ok: true, value: undefined };
    },
    async exchange(url, request, signal) {
      if (closed || signal.aborted || pending || !role || url !== `${origin}/`
        || !['eth_chainId', 'eth_getBalance'].includes(request.method)) {
        return { ok: false, error: makeError('POLICY_DENIED') };
      }
      const value = request.method === 'eth_chainId' ? '0xa' : '0x1';
      pending = { eventId: `protected_event_${++sequence}`, ref: { readId: readIds[role], attempt: 1 },
        endpointId, chainId: '10', method: request.method, originAlias: 'rpc', callsiteAlias: callsites[role],
        route: 'anon-nym', sent: true, completed: true, durationMs: 0, workerVerified: true, evidence: 'SIMULATED' };
      attempts.push(pending);
      return { ok: true, value: { jsonrpc: '2.0', id: request.id, result: value } };
    },
    async close() { closed = true; pending = null; },
  };
  const sink = { emit(trace) {
    traces.push(clone(trace));
    if (pending && pending.ref.readId === trace.readId && pending.method === trace.method
      && pending.ref.attempt === trace.attempt && pending.callsiteAlias === trace.callsite) pending = null;
  } };
  const transport = createMonolithTransport({
    policy: { privacyRequired: true, allowedChains: ['10'], allowedMethods: ['eth_chainId', 'eth_getBalance'],
      allowDirectDebugControl: false, failClosed: true },
    driver, clock: { now: () => new Date().toISOString() }, traceSink: sink,
    trustedPublishers: [{ creator: publisher, owner: publisher }], approvedOrigins: [origin],
    allowedCallsites: ['agent.witness', 'agent.example'], maxAttempts: 1,
    requestTimeoutMs: 5_000, initializationTimeoutMs: 5_000, validationTtlMs: 30_000,
  });
  const endpoint = { endpointId, chainId: '10', chainName: 'Fixed synthetic Optimism example', rpcUrl: `${origin}/`,
    publisher: { creator: publisher, owner: publisher }, entityKey: `0x${'0'.repeat(64)}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { url: 'https://example.com/monolith-agent-example', revision: 'SIMULATED-fixed-original-example',
      licenseUrl: 'https://example.com/MIT', snapshotSha256: '0'.repeat(64) } };
  const reads = ['probe', 'witness', 'example'].map((name) => ({
    readId: readIds[name], endpointId, chainId: '10', method: name === 'probe' ? 'eth_chainId' : 'eth_getBalance',
    callsiteAlias: callsites[name], scenarioAlias: 'fixed-balance', privacyRequired: true,
  }));
  let usefulSucceeded = false;
  let witnessSucceeded = false;
  let workerReady = false;
  let failure = null;
  async function privateRead(which = 'example') {
    role = which;
    try {
      const result = await transport.read({ readId: readIds[which], endpointId, chainId: '10',
        method: 'eth_getBalance', params: [address, 'latest'], callsite: callsites[which] });
      return result.ok && quantity(result.value) ? { ok: true, value: result.value } : { ok: false };
    } finally { role = null; }
  }
  async function regressionRead() {
    // Deliberate negative control, reached only under the controller's explicit opt-in.
    const response = await fetch(`${origin}/`, { method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: readIds.example, method: 'eth_getBalance', params: [address, 'latest'] }) });
    const body = await response.json();
    return { ok: response.ok && body?.id === readIds.example && quantity(body?.result) };
  }
  try {
    const initialized = await transport.initialize();
    workerReady = initialized.ok;
    if (initialized.ok) {
      role = 'probe';
      const admitted = await transport.validateEndpoint(endpoint);
      role = null;
      if (!admitted.ok) failure = admitted.error.code;
      else {
        witnessSucceeded = (await privateRead('witness')).ok;
        usefulSucceeded = (await readBalance({ privateRead: () => privateRead('example'), regressionRead })).ok === true;
      }
    } else {
      failure = initialized.error.code;
      // Exercise the real transport's pre-send failure with the same useful read.
      await privateRead('witness');
      await privateRead('example');
    }
  } catch { failure = 'SCENARIO_UNAVAILABLE'; }
  finally { await transport.close(); }
  // The collector checks these blocked attempts against independent zero-send capture.
  for (const trace of traces) {
    if (!attempts.some((attempt) => attempt.ref.readId === trace.readId && attempt.ref.attempt === trace.attempt)) {
      attempts.push({ eventId: `blocked_event_${++sequence}`, ref: { readId: trace.readId, attempt: trace.attempt },
        endpointId, chainId: '10', method: trace.method, originAlias: 'rpc', callsiteAlias: trace.callsite,
        route: trace.route, sent: false, completed: false, durationMs: 0, workerVerified: false, evidence: 'SIMULATED' });
    }
  }
  return { traces, attempts, reads, workerReady, usefulSucceeded, witnessSucceeded,
    failure, closed, pendingBound: pending === null };
};
