// Pure acceptance of a measured MN-009 input. The caller supplies observations;
// this function neither contacts a worker nor upgrades SIMULATED observations.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RUN = new RegExp(`^run-${UUID}$`);
const RPC = new RegExp(`^rpc-${UUID}$`);
const READ = new RegExp(`^(?:mn009_${UUID}|monolith_probe_[1-9]\\d*)$`);
const HASH = /^0x[0-9a-f]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const BALANCE_FINGERPRINT = '28b70527485da666aefed1d98fe8d088b2bc0878b0ef2637c49d6733d9f1df03';
const CHAIN_FINGERPRINT = '37047d9fa98f2102688f6d8f5163bbe33308161d4f482b3e5853043ce6c7163b';
const SPECIFIERS = Object.freeze({
  nym: '0x3acd9742c68f6d993066ae25533e09b9e1f60ed0',
  tor: '0x700da3193d35fa54cd3fbf29b66f2a2a0385659e',
});
const ROLES = new Set(['direct-baseline', 'direct-control', 'protected-probe', 'protected-comparison']);
const SOURCE_CLASSES = new Set(['baseline', 'different-from-baseline', 'unknown']);
const TRACE_KEYS = ['schemaVersion', 'readId', 'attempt', 'endpointId', 'chainId', 'method', 'callsite',
  'route', 'durationMs', 'success', 'bootstrap', 'evidence', 'payloadVisibility'];
const INVENTORY_KEYS = ['rpcId', 'role', 'method', 'readId', 'attempt', 'issuedAt', 'completedAt',
  'result', 'requestFingerprint'];
const OBSERVATION_KEYS = ['rpcId', 'method', 'addressPresent', 'sourceClass', 'durationMs', 'success'];
const WORKER_KEYS = ['network', 'specifier', 'workerHash', 'harnessVersion', 'verification', 'bootstrap',
  'bootstrapCalls', 'privacyLabel', 'observedAt'];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value, keys, optional = []) {
  return object(value) && keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => keys.includes(key) || optional.includes(key));
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() === value ? instant : null;
}
function duration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300_000;
}
function boundedString(value, maximum = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
function outcome(verdict, code, simulated = false) {
  return { schemaVersion: 1, sourceTask: 'MN-009',
    evidence: simulated ? 'SIMULATED' : verdict === 'OBSERVED_LIVE' ? 'OBSERVED_LIVE' : 'BLOCKED',
    verdict, codes: code ? [code] : [], paired: null };
}
function traceShape(trace) {
  return exact(trace, TRACE_KEYS, ['errorCode']) && trace.schemaVersion === 1
    && boundedString(trace.readId) && Number.isInteger(trace.attempt) && trace.attempt >= 1 && trace.attempt <= 3
    && boundedString(trace.endpointId) && trace.chainId === '1' && boundedString(trace.callsite)
    && duration(trace.durationMs) && typeof trace.success === 'boolean' && typeof trace.bootstrap === 'boolean'
    && trace.payloadVisibility === 'rpc-endpoint-can-read'
    && ['OBSERVED_LIVE', 'SIMULATED'].includes(trace.evidence);
}

/**
 * Validate and project a paired run while its five-minute diagnostics are fresh.
 * A structurally accepted claimed observation still relies on the runner's
 * actual captured bytes, socket topology controls and source/compiled hashes.
 * No free-text input, address, params, raw IP or request fingerprint is exported.
 */
export function validatePairedProof(input, nowISO) {
  const simulated = object(input) && input.evidence === 'SIMULATED';
  const reject = (code) => outcome('BLOCKED', code, simulated);
  if (!exact(input, ['schemaVersion', 'runId', 'startedAt', 'completedAt', 'evidence', 'inventory',
    'diagnostics', 'worker', 'resolverResponses', 'traces', 'boundary', 'topology', 'shutdown'])
    || input.schemaVersion !== 1 || !RUN.test(input.runId)
    || !['OBSERVED_LIVE', 'SIMULATED'].includes(input.evidence)) return reject('INVALID_PROOF_INPUT');
  const started = timestamp(input.startedAt);
  const completed = timestamp(input.completedAt);
  const now = timestamp(nowISO);
  if (started === null || completed === null || now === null || started > completed || completed > now
    || completed - started > 600_000) return reject('INVALID_PROOF_TIME');
  const diagnostics = input.diagnostics;
  if (!exact(diagnostics, ['schemaVersion', 'runId', 'expiresAt', 'observations'])
    || diagnostics.schemaVersion !== 1 || diagnostics.runId !== input.runId
    || !Array.isArray(diagnostics.observations) || diagnostics.observations.length > 64) {
    return reject('INVALID_DIAGNOSTICS');
  }
  const expires = timestamp(diagnostics.expiresAt);
  if (expires === null || expires <= now || expires - 300_000 < started
    || expires - 300_000 > completed) return reject('EVIDENCE_EXPIRED');
  if (!Array.isArray(input.inventory) || input.inventory.length < 3 || input.inventory.length > 64) {
    return reject('INVALID_REQUEST_INVENTORY');
  }
  const inventory = input.inventory;
  const issuedIds = new Set();
  const logicalAttempts = new Set();
  let previousCompleted = started;
  let baseline;
  let controlCount = 0;
  let comparison;
  let protectedStarted = false;
  let probeCount = 0;
  for (const [index, entry] of inventory.entries()) {
    if (!exact(entry, INVENTORY_KEYS) || !RPC.test(entry.rpcId) || !READ.test(entry.readId)
      || !ROLES.has(entry.role) || entry.attempt !== 1
      || issuedIds.has(entry.rpcId) || logicalAttempts.has(`${entry.readId}:${entry.attempt}`)) {
      return reject('INVALID_REQUEST_INVENTORY');
    }
    issuedIds.add(entry.rpcId);
    logicalAttempts.add(`${entry.readId}:${entry.attempt}`);
    const issued = timestamp(entry.issuedAt);
    const finished = timestamp(entry.completedAt);
    if (issued === null || finished === null || issued < previousCompleted || finished < issued
      || finished > completed || issued < expires - 300_000) return reject('INVALID_REQUEST_ORDER');
    previousCompleted = finished;
    if (typeof entry.result !== 'string' || !QUANTITY.test(entry.result)) return reject('RPC_READ_FAILED');
    if (entry.role === 'direct-baseline') {
      if (index !== 0 || baseline) return reject('INVALID_BASELINE_ORDER');
      baseline = entry;
    } else if (!baseline) return reject('INVALID_BASELINE_ORDER');
    if (entry.role === 'direct-control' && protectedStarted) return reject('INVALID_REQUEST_ORDER');
    if (entry.role === 'direct-control') controlCount++;
    if (entry.role.startsWith('protected-')) protectedStarted = true;
    if (entry.role === 'protected-probe') {
      if (entry.method !== 'eth_chainId' || entry.requestFingerprint !== CHAIN_FINGERPRINT
        || entry.result !== '0x1' || comparison) return reject('CHAIN_PROBE_INVALID');
      probeCount++;
    } else if (entry.method !== 'eth_getBalance' || entry.requestFingerprint !== BALANCE_FINGERPRINT) {
      return reject('COMPARED_PAYLOAD_MISMATCH');
    }
    if (entry.role === 'protected-comparison') {
      if (comparison || index !== inventory.length - 1 || probeCount === 0) return reject('INVALID_COMPARISON_ORDER');
      comparison = entry;
    }
  }
  if (!baseline || !comparison || probeCount === 0) return reject('INCOMPLETE_PAIRED_RUN');
  if (controlCount !== 1) return reject('DIRECT_CONTROL_INVENTORY_INVALID');
  // Different block heights can produce different genuine balance values. We
  // compare request inputs, not equality of changing chain-state responses.
  const observations = new Map();
  for (const observation of diagnostics.observations) {
    if (!exact(observation, OBSERVATION_KEYS) || !RPC.test(observation.rpcId)
      || !issuedIds.has(observation.rpcId) || observations.has(observation.rpcId)
      || !SOURCE_CLASSES.has(observation.sourceClass) || typeof observation.addressPresent !== 'boolean'
      || !duration(observation.durationMs) || observation.success !== true) {
      return reject('DIAGNOSTIC_INVENTORY_MISMATCH');
    }
    observations.set(observation.rpcId, observation);
  }
  if (observations.size !== inventory.length) return reject('DIAGNOSTIC_INVENTORY_MISMATCH');
  for (const entry of inventory) {
    const observation = observations.get(entry.rpcId);
    if (observation.method !== entry.method || observation.addressPresent !== (entry.method === 'eth_getBalance')) {
      return reject('DIAGNOSTIC_CONTENT_MISMATCH');
    }
  }
  const worker = input.worker;
  if (!exact(worker, WORKER_KEYS) || !Object.hasOwn(SPECIFIERS, worker.network)
    || typeof worker.specifier !== 'string' || worker.specifier.toLowerCase() !== SPECIFIERS[worker.network]
    || !HASH.test(worker.workerHash) || worker.harnessVersion !== '0.4.0'
    || worker.verification !== 'harness-ready-after-specifier-lookup'
    || worker.bootstrap !== 'NON_ANONYMOUS_SPECIFIER_LOOKUP' || worker.bootstrapCalls !== 2
    || worker.privacyLabel !== 'ANONYMIZING_WORKER') return reject('WORKER_NOT_VERIFIED');
  const workerAt = timestamp(worker.observedAt);
  if (workerAt === null || workerAt < started || workerAt > Date.parse(baseline.issuedAt)) {
    return reject('WORKER_TIME_MISMATCH');
  }
  if (!Array.isArray(input.resolverResponses) || input.resolverResponses.length === 0
    || input.resolverResponses.length > 16 || !input.resolverResponses.some((reply) =>
      exact(reply, ['status', 'bytes', 'keccak256']) && reply.status === 200
      && Number.isSafeInteger(reply.bytes) && reply.bytes > 0 && reply.bytes <= 64 * 1024 * 1024
      && reply.keccak256 === worker.workerHash)) return reject('WORKER_BUNDLE_UNCONFIRMED');
  if (!Array.isArray(input.traces) || input.traces.length !== inventory.length + 2
    || input.traces.some((trace) => !traceShape(trace))) return reject('TRACE_INVENTORY_MISMATCH');
  const appTraces = input.traces.filter((trace) => !trace.bootstrap);
  const bootstrapTraces = input.traces.filter((trace) => trace.bootstrap);
  if (bootstrapTraces.length !== 2 || bootstrapTraces.some((trace) => !trace.success
    || trace.route !== 'direct-bootstrap' || trace.method !== 'eth_call'
    || trace.evidence !== input.evidence || Object.hasOwn(trace, 'errorCode')
    || !['transport.bootstrap.hash', 'transport.bootstrap.resolvers'].includes(trace.callsite)
    || trace.readId !== `bootstrap_${trace.callsite.split('.').at(-1)}`)
    || new Set(bootstrapTraces.map((trace) => trace.callsite)).size !== 2) return reject('BOOTSTRAP_UNDISCLOSED');
  const traceTuples = new Set();
  for (const entry of inventory) {
    const matching = appTraces.filter((trace) => trace.readId === entry.readId && trace.attempt === entry.attempt);
    const expectedRoute = entry.role.startsWith('direct-') ? 'direct-debug' : `anon-${worker.network}`;
    const trace = matching[0];
    if (matching.length !== 1 || !trace.success || trace.method !== entry.method || trace.route !== expectedRoute
      || trace.evidence !== input.evidence || Object.hasOwn(trace, 'errorCode')) return reject('TRACE_INVENTORY_MISMATCH');
    traceTuples.add(`${trace.readId}:${trace.attempt}`);
  }
  if (traceTuples.size !== appTraces.length) return reject('TRACE_INVENTORY_MISMATCH');
  if (!exact(input.boundary, ['ordinaryProtectedTargetRequests', 'detectionSelfCheck'])
    || input.boundary.ordinaryProtectedTargetRequests !== 0 || input.boundary.detectionSelfCheck !== true) {
    return reject('PROTECTED_HTTP_BOUNDARY_FAILED');
  }
  if (!exact(input.shutdown, ['closed']) || input.shutdown.closed !== true) return reject('WORKER_NOT_CLOSED');
  if (!exact(input.topology, ['mode', 'verified'])
    || !['direct', 'trusted-proxy', 'unknown'].includes(input.topology.mode)
    || typeof input.topology.verified !== 'boolean') return reject('INVALID_TOPOLOGY');
  const project = (entry) => {
    const observation = observations.get(entry.rpcId);
    return { rpcId: entry.rpcId, readId: entry.readId, attempt: entry.attempt, role: entry.role,
      method: entry.method, result: entry.result, issuedAt: entry.issuedAt, completedAt: entry.completedAt,
      sourceClass: observation.sourceClass, addressPresent: observation.addressPresent,
      durationMs: observation.durationMs };
  };
  const paired = {
    runId: input.runId, startedAt: input.startedAt, completedAt: input.completedAt,
    observerExpiresAt: diagnostics.expiresAt, method: 'eth_getBalance',
    payload: 'fixed-synthetic-zero-address-latest', direct: project(baseline), protected: project(comparison),
    inventory: inventory.map(project),
    traces: input.traces.map((trace) => ({
      rpcId: trace.bootstrap ? null : inventory.find((entry) => entry.readId === trace.readId
        && entry.attempt === trace.attempt).rpcId,
      readId: trace.readId, attempt: trace.attempt, method: trace.method, route: trace.route,
      success: trace.success, bootstrap: trace.bootstrap, durationMs: trace.durationMs,
      evidence: trace.evidence, payloadVisibility: trace.payloadVisibility,
    })),
    worker: {
      network: worker.network, specifier: SPECIFIERS[worker.network], workerHash: worker.workerHash,
      harnessVersion: '0.4.0', verification: 'harness-ready-after-specifier-lookup',
      bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP', bootstrapCalls: 2,
      privacyLabel: 'ANONYMIZING_WORKER', observedAt: worker.observedAt,
    },
    bootstrapExclusions: ['transport.bootstrap.hash', 'transport.bootstrap.resolvers'],
    topology: { mode: input.topology.mode, verified: input.topology.verified },
    boundary: { ordinaryProtectedTargetRequests: 0, detectionSelfCheck: true },
    shutdown: { closed: true },
    limitations: [
      'Source difference supports only a verified, conclusive paired run; this record does not prove general anonymity.',
      'The observer and destination can read RPC methods and payloads.',
      'The two specifier bootstrap calls are non-anonymous and excluded from paired application reads.',
      'Configured HTTP interception excludes worker WebRTC/KPS and unrelated browser traffic.',
      'Registry product use and application-wide routing coverage require their own evidence.',
    ],
  };
  const inconclusive = (code) => ({ ...outcome('INCONCLUSIVE', code, simulated), paired: simulated ? null : paired });
  if (input.topology.mode === 'unknown' || !input.topology.verified) return inconclusive('SOURCE_TOPOLOGY_UNVERIFIED');
  if (inventory.some((entry) => entry.role.startsWith('direct-')
    && observations.get(entry.rpcId).sourceClass !== 'baseline')) return inconclusive('DIRECT_BASELINE_UNESTABLISHED');
  if (inventory.some((entry) => entry.role.startsWith('protected-')
    && observations.get(entry.rpcId).sourceClass !== 'different-from-baseline')) {
    return inconclusive('DISTINCT_PROTECTED_SOURCE_UNESTABLISHED');
  }
  if (simulated) return reject('SIMULATED_EVIDENCE');
  return { ...outcome('OBSERVED_LIVE'), paired };
}
