import { createMonolithTransport } from '@monolith/transport';
import { createBrowserDriver } from '@monolith/transport/browser';
import type { EndpointCandidate, RpcTrace } from '@monolith/shared';

const TARGET = 'https://ethereum-rpc.publicnode.com';
const clock = { now: () => new Date().toISOString() };
const progress = { phase: 'IDLE' };
const update = (phase: string) => {
  progress.phase = phase;
  const status = document.querySelector('#status');
  if (status) status.textContent = phase;
};

/** The directory candidate is a synthetic local configuration, not an Arkiv observation. */
function candidate(): EndpointCandidate {
  const publisher = '0x1111111111111111111111111111111111111111';
  return {
    endpointId: 'mn007_configured_ethereum', chainId: '1', chainName: 'Ethereum configured test target',
    rpcUrl: TARGET, publisher: { creator: publisher, owner: publisher }, entityKey: `0x${'0'.repeat(64)}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    source: { url: 'https://example.com/monolith-mn007-synthetic-configuration',
      revision: 'SIMULATED-local-configuration-not-Arkiv', licenseUrl: 'https://example.com/MIT',
      snapshotSha256: '0'.repeat(64) },
  };
}

async function runPackageRead() {
  const started = performance.now();
  const traces: RpcTrace[] = [];
  const sink = { emit: (trace: RpcTrace) => traces.push(trace) };
  const driver = createBrowserDriver({
    hostUrl: new URL('./host.html', location.href).href, network: 'nym',
    bootstrapRpcUrl: 'https://ethereum.publicnode.com', approvedOrigins: [TARGET], traceSink: sink,
  });
  const endpoint = candidate();
  const transport = createMonolithTransport({
    policy: { privacyRequired: true, allowedChains: ['1'], allowedMethods: ['eth_chainId'],
      allowDirectDebugControl: false, failClosed: true },
    driver, clock, traceSink: sink, trustedPublishers: [endpoint.publisher], approvedOrigins: [TARGET],
    allowedCallsites: ['transport.acceptance.read'], maxAttempts: 2,
    initializationTimeoutMs: 180_000, requestTimeoutMs: 60_000, validationTtlMs: 120_000,
  });
  const readId = `mn007_${crypto.randomUUID()}`;
  const request = { readId, endpointId: endpoint.endpointId, chainId: '1', method: 'eth_chainId' as const,
    params: [], callsite: 'transport.acceptance.read' };
  let stage = 'BOOTSTRAPPING';
  let failure: string | null = null;
  let result: string | null = null;
  let endpointValidated = false;
  let metadata: ReturnType<typeof driver.getMetadata> = null;
  update(stage);
  try {
    const initialized = await transport.initialize();
    if (!initialized.ok) { failure = initialized.error.code; return; }
    stage = 'PROTECTED_CHAIN_PROBE'; update(stage);
    const validated = await transport.validateEndpoint(endpoint);
    if (!validated.ok) { failure = validated.error.code; return; }
    endpointValidated = true;
    stage = 'PROTECTED_PACKAGE_READ'; update(stage);
    const read = await transport.read(request);
    if (!read.ok) { failure = read.error.code; return; }
    if (read.value !== '0x1') { failure = 'UNEXPECTED_CHAIN_RESULT'; return; }
    result = read.value;
    metadata = driver.getMetadata();
    stage = 'READ_RETURNED';
  } finally {
    // The metadata is public specifier data; preserve before close clears runtime readiness.
    const readState = transport.getState();
    metadata ??= driver.getMetadata();
    await transport.close();
    await transport.close();
    const postCloseRead = await transport.read({ ...request, readId: `mn007_${crypto.randomUUID()}` });
    const observation = {
      schemaVersion: 1, observedAt: clock.now(),
      evidence: result === '0x1' && failure === null ? 'OBSERVED_LIVE' : 'BLOCKED',
      stage, failure, result, endpointValidated, readState,
      durationMs: Math.round(performance.now() - started),
      endpointConfiguration: { evidence: 'SIMULATED', origin: 'local-configuration',
        description: 'Synthetic fixture identity and provenance; target manually approved. No Arkiv claim.' },
      target: { origin: TARGET, expectedChainId: '1', method: 'eth_chainId' },
      worker: metadata, traces,
      shutdown: { state: transport.getState(), iframeCount: document.querySelectorAll('iframe').length,
        postCloseReadRejected: !postCloseRead.ok,
        postCloseErrorCode: postCloseRead.ok ? null : postCloseRead.error.code,
        metadataCleared: driver.getMetadata() === null },
      limitations: ['MN-009 paired observer source evidence remains UNTESTED.',
        'The destination can read JSON-RPC payloads.',
        'Worker bootstrap is non-anonymous and reported separately.',
        'Independent interception covers ordinary browser HTTP to the configured target; excludes WebRTC/KPS.',
        'No Arkiv product-use or application-wide coverage claim.'],
    };
    Object.assign(window, { packageObservation: observation });
    update(failure ? 'BLOCKED' : stage);
  }
}

let closeProbeDriver: ReturnType<typeof createBrowserDriver> | undefined;
async function runCloseProbe() {
  const traceSink = { emit: (_trace: RpcTrace) => undefined };
  closeProbeDriver = createBrowserDriver({
    hostUrl: new URL('./host.html', location.href).href, network: 'nym',
    bootstrapRpcUrl: 'https://bootstrap.monolith.example', approvedOrigins: [TARGET], traceSink,
  });
  const driver = closeProbeDriver;
  const result = await driver.initialize(new AbortController().signal);
  return { evidence: 'SIMULATED', initializationRejected: !result.ok,
    errorCode: result.ok ? null : result.error.code,
    iframeCount: document.querySelectorAll('iframe').length, metadataCleared: driver.getMetadata() === null };
}

Object.assign(window, { runPackageRead, runCloseProbe, closeProbeNow: () => closeProbeDriver?.close(),
  monolithProgress: progress });
