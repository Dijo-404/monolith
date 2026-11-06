import { createMonolithTransport } from '@monolith/transport';
import { createBrowserDriver } from '@monolith/transport/browser';
import type { BrowserDriver } from '@monolith/transport/browser';
import { httpResultSchema, makeError, observerRunSchema, validateRpcResponse } from '@monolith/shared';
import type { EndpointCandidate, MonolithTransport, Result, RpcTrace } from '@monolith/shared';
import { captureLabConfiguration, createDirectLabDriver, createLabDriver, SYNTHETIC_ADDRESS } from './lab-driver.js';
import type { LabConfiguration, Role } from './lab-driver.js';

const clock = { now: () => new Date().toISOString() };
const progress = { phase: 'IDLE' };
const traces: RpcTrace[] = [];
let settings: Readonly<LabConfiguration> | undefined;
let base: BrowserDriver | undefined;
let protectedLab: ReturnType<typeof createLabDriver> | undefined;
let directLab: ReturnType<typeof createLabDriver> | undefined;
let transport: MonolithTransport | undefined;
let startedAt: string | undefined;
let pairStarted = false;
let closed = false;
const update = (phase: string) => {
  progress.phase = phase;
  const status = document.querySelector('#status');
  if (status) status.textContent = phase;
};
const sink = { emit: (trace: RpcTrace) => {
  traces.push(trace);
  protectedLab?.bindTrace(trace);
} };

function endpoint(): EndpointCandidate {
  if (!settings) throw new Error('Lab configuration unavailable.');
  const publisher = '0x1111111111111111111111111111111111111111';
  return {
    endpointId: 'mn009_ethereum', chainId: '1', chainName: 'Ethereum configured observer target',
    rpcUrl: settings.target, publisher: { creator: publisher, owner: publisher }, entityKey: `0x${'0'.repeat(64)}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    source: { url: 'https://example.com/monolith-mn009-synthetic-configuration',
      revision: 'SIMULATED-operator-configuration-not-Arkiv', licenseUrl: 'https://example.com/MIT',
      snapshotSha256: '0'.repeat(64) },
  };
}

async function warm(input: LabConfiguration) {
  if (base || closed) return { ok: false, code: 'LAB_ALREADY_STARTED', failure: 'LAB_ALREADY_STARTED' };
  startedAt = clock.now();
  try {
    settings = captureLabConfiguration(input);
    Object.defineProperty(window, 'mn009HostConfiguration', { value: settings, writable: false, configurable: false });
    update('BOOTSTRAPPING');
    base = createBrowserDriver({
      hostUrl: new URL('./host.html', location.href).href, network: 'nym',
      bootstrapRpcUrl: 'https://ethereum.publicnode.com', approvedOrigins: [new URL(settings.target).origin], traceSink: sink,
    });
    const initialized = await base.initialize(AbortSignal.timeout(180_000));
    if (!initialized.ok) { update('BLOCKED'); return { ok: false, code: initialized.error.code, failure: initialized.error.code }; }
    update('WORKER_READY');
    return { ok: true, worker: base.getMetadata(), startedAt, failure: null };
  } catch { update('BLOCKED'); return { ok: false, code: 'WORKER_UNAVAILABLE', failure: 'WORKER_UNAVAILABLE' }; }
}

async function directRead(role: Extract<Role, 'direct-baseline' | 'direct-control'>): Promise<Result<void>> {
  if (!settings || !directLab) return { ok: false, error: makeError('WORKER_UNAVAILABLE') };
  const lab = directLab;
  const readId = `mn009_${crypto.randomUUID()}`;
  const began = performance.now();
  update(role === 'direct-baseline' ? 'DIRECT_BASELINE' : 'DIRECT_CONTROL');
  const request = { jsonrpc: '2.0' as const, id: readId, method: 'eth_getBalance' as const,
    params: [SYNTHETIC_ADDRESS, 'latest'] };
  const result = await lab.run(role, () => lab.driver.exchange(settings!.target, request, AbortSignal.timeout(15_000)));
  const envelope = result.ok ? validateRpcResponse(result.value, readId) : result;
  const accepted = envelope.ok && typeof envelope.value.result === 'string'
    && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(envelope.value.result);
  const trace: RpcTrace = {
    schemaVersion: 1, readId, attempt: 1, endpointId: 'mn009_ethereum', chainId: '1', method: 'eth_getBalance',
    callsite: 'mn009.direct', route: 'direct-debug', durationMs: Math.round(performance.now() - began),
    success: accepted, bootstrap: false, evidence: 'OBSERVED_LIVE', payloadVisibility: 'rpc-endpoint-can-read',
    ...(!accepted ? { errorCode: envelope.ok ? 'RPC_RESPONSE_INVALID' as const : envelope.error.code } : {}),
  };
  lab.bindTrace(trace);
  traces.push(trace);
  return accepted ? { ok: true, value: undefined } : { ok: false,
    error: makeError(envelope.ok ? 'RPC_RESPONSE_INVALID' : envelope.error.code) };
}

async function pair() {
  if (pairStarted || !settings || !base?.getMetadata() || closed) return { failure: 'LAB_NOT_READY' };
  pairStarted = true;
  const configuration = settings;
  const browser = base;
  const worker = base.getMetadata();
  let failure: string | null = null;
  const execute = async (): Promise<string | null> => {
    directLab = createLabDriver(createDirectLabDriver(configuration), configuration);
    const initialized = await directLab.driver.initialize(AbortSignal.timeout(1_000));
    if (!initialized.ok) return initialized.error.code;
    const baseline = await directRead('direct-baseline');
    if (!baseline.ok) return baseline.error.code;
    // This same-source control deliberately uses a client case label of "protected".
    const control = await directRead('direct-control');
    if (!control.ok) return control.error.code;
    update('VERIFYING_DIRECT_BASELINE');
    const diagnosticsUrl = new URL(`/api/observer/runs/${configuration.runId}`, configuration.target).href;
    const response = await fetch(diagnosticsUrl, { credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || response.url !== diagnosticsUrl
      || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return 'BASELINE_UNCONFIRMED';
    const text = await response.text();
    if (text.length > 512 * 1024) return 'BASELINE_UNCONFIRMED';
    const parsed = httpResultSchema(observerRunSchema).safeParse(JSON.parse(text));
    if (!parsed.success || !parsed.data.ok || parsed.data.value.runId !== configuration.runId
      || Date.parse(parsed.data.value.expiresAt) <= Date.now()) return 'BASELINE_UNCONFIRMED';
    const observations = parsed.data.value.observations;
    if (observations.length !== directLab.inventory.length
      || directLab.inventory.some((row) => observations.filter((item) => item.rpcId === row.rpcId
        && item.method === 'eth_getBalance' && item.addressPresent && item.success && item.sourceClass === 'baseline').length !== 1)
    ) return 'BASELINE_UNCONFIRMED';
    protectedLab = createLabDriver(browser, configuration);
    const candidate = endpoint();
    transport = createMonolithTransport({
      policy: { privacyRequired: true, allowedChains: ['1'], allowedMethods: ['eth_chainId', 'eth_getBalance'],
        allowDirectDebugControl: false, failClosed: true }, driver: protectedLab.driver, clock, traceSink: sink,
      trustedPublishers: [candidate.publisher], approvedOrigins: [new URL(configuration.target).origin],
      allowedCallsites: ['mn009.protected'], maxAttempts: 1, initializationTimeoutMs: 180_000,
      requestTimeoutMs: 60_000, validationTtlMs: 120_000,
    });
    const initializedProtected = await transport.initialize();
    if (!initializedProtected.ok) return initializedProtected.error.code;
    update('PROTECTED_CHAIN_PROBE');
    const validated = await protectedLab.run('protected-probe', () => transport!.validateEndpoint(candidate));
    if (!validated.ok) return validated.error.code;
    update('PROTECTED_COMPARISON');
    const read = await protectedLab.run('protected-comparison', () => transport!.read({
      readId: `mn009_${crypto.randomUUID()}`, endpointId: candidate.endpointId, chainId: '1',
      method: 'eth_getBalance', params: [SYNTHETIC_ADDRESS, 'latest'], callsite: 'mn009.protected',
    }));
    if (!read.ok) return read.error.code;
    update('PAIRED_READS_RETURNED');
    return null;
  };
  try { failure = await execute(); }
  catch { failure = 'UPSTREAM_UNAVAILABLE'; }
  finally {
    const observation = {
      startedAt, completedAt: clock.now(), worker, failure,
      inventory: [...directLab?.inventory ?? [], ...protectedLab?.inventory ?? []].map((row) => ({ ...row })),
      traces: traces.map((trace) => ({ ...trace })),
      endpointConfiguration: { evidence: 'SIMULATED', origin: 'operator-approved-local-configuration',
        description: 'Synthetic publisher/provenance; real configured observer. No Arkiv product-use claim.' },
    };
    Object.assign(window, { mn009Observation: observation });
    if (failure) update('BLOCKED');
  }
  return (window as Window & { mn009Observation?: unknown }).mn009Observation;
}

async function close() {
  closed = true;
  await directLab?.driver.close();
  if (transport) await transport.close();
  else await base?.close();
  const rejected = transport ? await transport.read({
    readId: `mn009_${crypto.randomUUID()}`, endpointId: 'mn009_ethereum', chainId: '1',
    method: 'eth_getBalance', params: [SYNTHETIC_ADDRESS, 'latest'], callsite: 'mn009.protected',
  }) : { ok: false };
  update('CLOSED');
  return { closed: !transport || transport.getState() === 'CLOSED',
    iframeCount: document.querySelectorAll('iframe').length, metadataCleared: base?.getMetadata() === null,
    postCloseReadRejected: !rejected.ok };
}

Object.assign(window, { mn009: { warm, pair, close }, mn009Progress: progress });
