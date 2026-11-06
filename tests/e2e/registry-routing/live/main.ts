import type { JsonValue, RpcTrace } from '@monolith/shared';
import type { RegistryPolicy } from '../../../../apps/dashboard/src/composition/registry.js';
import { createBrowserRegistryTransport } from '../../../../apps/dashboard/src/composition/transport.js';

type PublicConfiguration = { chainId: string; policy: RegistryPolicy };
const configuration = (globalThis as typeof globalThis & { monolithRegistryConfiguration?: PublicConfiguration })
  .monolithRegistryConfiguration;
if (!configuration || configuration.chainId !== '10') throw new Error('Missing accepted public operator configuration.');
const clock = { now: () => new Date().toISOString() };
const progress = { phase: 'IDLE' };
const update = (phase: string) => {
  progress.phase = phase;
  const element = document.querySelector('#status');
  if (element) element.textContent = phase;
};

async function runRegistryRead() {
  // Configuration is injected by the runner from the already accepted immutable import,
  // independently of the fresh HTTP response which supplies the actual candidate.
  const pins = configuration as PublicConfiguration;
  const started = performance.now();
  const traces: RpcTrace[] = [];
  const sink = { emit: (trace: RpcTrace) => {
    traces.push(trace);
    if (trace.bootstrap) update('BOOTSTRAPPING');
    else if (trace.callsite === 'transport.chain-probe') update('PROTECTED_CHAIN_PROBE');
  } };
  const session = createBrowserRegistryTransport({
    hostUrl: new URL('./host.html', location.href).href, network: 'nym',
    bootstrapRpcUrl: 'https://ethereum.publicnode.com',
    registryUrl: new URL('/api/registry/chains', location.href).href,
    registryPolicy: pins.policy, allowedChains: [pins.chainId],
    allowedMethods: ['eth_chainId', 'eth_blockNumber'], allowedCallsites: ['registry.acceptance.block'],
    traceSink: sink, clock, initializationTimeoutMs: 180_000, requestTimeoutMs: 25_000,
  });
  let failure: string | null = null;
  let result: JsonValue = null;
  let selection: ReturnType<typeof session.getSelection> = null;
  let selectedAt: string | null = null;
  let readReturnedAt: string | null = null;
  update('BOOTSTRAPPING');
  try {
    const selected = await session.select(pins.chainId);
    if (!selected.ok) { failure = selected.error.code; return; }
    selection = selected.value;
    selectedAt = clock.now();
    update('PROTECTED_APPLICATION_READ');
    const read = await session.read({ readId: `mn013_${crypto.randomUUID()}`, method: 'eth_blockNumber',
      params: [], callsite: 'registry.acceptance.block' });
    readReturnedAt = clock.now();
    if (!read.ok) { failure = read.error.code; return; }
    if (typeof read.value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(read.value)) {
      failure = 'UNEXPECTED_BLOCK_RESULT'; return;
    }
    result = read.value;
    update('READ_RETURNED');
  } catch {
    failure = 'LIVE_COMPOSITION_FAILED';
  } finally {
    const readState = session.getState();
    const metadata = session.getWorkerMetadata();
    const selectionAtReadEnd = session.getSelection();
    await session.close();
    await session.close();
    const postClose = await session.read({ readId: `mn013_${crypto.randomUUID()}`, method: 'eth_blockNumber',
      params: [], callsite: 'registry.acceptance.block' });
    const observation = {
      schemaVersion: 1, observedAt: clock.now(),
      evidence: typeof result === 'string' && failure === null ? 'OBSERVED_LIVE' : 'BLOCKED',
      phase: progress.phase, failure, result, readState, durationMs: Math.round(performance.now() - started),
      selectedAt, readReturnedAt, selection, selectionAtReadEnd,
      operatorPins: pins, worker: metadata, traces,
      shutdown: { state: session.getState(), iframeCount: document.querySelectorAll('iframe').length,
        selectionCleared: session.getSelection() === null, metadataCleared: session.getWorkerMetadata() === null,
        postCloseReadRejected: !postClose.ok, postCloseErrorCode: postClose.ok ? null : postClose.error.code },
      limitations: [
        'Public chain metadata uses an ordinary same-origin HTTP request and server-side Arkiv query; neither is anonymous.',
        'Worker bootstrap is non-anonymous and recorded separately.',
        'The destination RPC can read JSON-RPC payloads.',
        'Independent interception covers ordinary browser HTTP to the approved candidate origin; it excludes WebRTC/KPS.',
        'MN-009 paired observer source evidence remains BLOCKED independently.',
        'This run does not establish application-wide coverage, browser DNS pinning or sponsor eligibility.',
      ],
    };
    Object.assign(window, { registryObservation: observation });
    update(failure ? 'BLOCKED' : 'READ_RETURNED');
  }
}

Object.assign(window, { runRegistryRead, monolithProgress: progress });
