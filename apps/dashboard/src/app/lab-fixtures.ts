import type {
  EndpointCandidateView,
  ObserverStatus,
  RegistryStatus,
  ScenarioId,
  WorkerNetwork,
  WorkerState,
} from './lab-model.js';

/**
 * SIMULATED fixtures for the dashboard shell. Nothing here was observed: identifiers are
 * synthetic, the RPC origin uses the reserved `.example` domain, and timings are authored.
 * Worker specifier addresses are the documented Anon-RPC examples (docs/idea.md §6); the shell
 * does not load or verify those workers.
 */

export const TOR_JS_SPECIFIER = '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e';
export const PASSTHROUGH_SPECIFIER = '0x4fd77be300f31c5fe6ab266d35d27750a3478d27';

export const FIXTURE_ENDPOINT: EndpointCandidateView = {
  endpointId: 'sepolia-fixture-01',
  chainId: '11155111',
  chainName: 'Sepolia',
  rpcOrigin: 'https://sepolia.rpc.example',
  publisher: {
    creator: '0x000000000000000000000000000000000000f1c7',
    owner: '0x000000000000000000000000000000000000f1c7',
  },
  entityKey: '0xf1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7f1c7',
  schema: 'monolith.rpc.v1',
  source: {
    repository: 'github.com/ethereum-lists/chains',
    revision: 'fixture-0000000',
    license: 'MIT',
    snapshotSha256: '0000000000000000000000000000000000000000000000000000000000f1c7f1c7',
  },
};

export const FIXTURE_REGISTRY_REVISION = 'fixture-r1';

/** Authored travel times. Tor-like circuits are slow; these are not measurements. */
export const FIXTURE_TIMINGS = {
  probeMs: 1100,
  privateMs: 1500,
  degradedMs: 2900,
  passthroughMs: 520,
  directMs: 420,
  leakMs: 460,
  hopIntervalMs: 1150,
} as const;

export const CALLSITES = {
  probe: 'registry/validate-endpoint.ts',
  balance: 'checkout/balance.ts:41',
  directComparison: 'lab/direct-comparison.ts',
  leak: 'payments/status.ts:27',
} as const;

export interface ScenarioFixture {
  readonly id: ScenarioId;
  readonly label: string;
  readonly summary: string;
  readonly worker: {
    readonly state: WorkerState;
    readonly network: WorkerNetwork;
    readonly hopsReady: number;
    readonly note: string | null;
  };
  readonly registry: RegistryStatus;
  readonly observer: ObserverStatus;
}

export const SCENARIOS: readonly ScenarioFixture[] = [
  {
    id: 'cold-start',
    label: 'Cold start',
    summary: 'The worker bootstraps its circuit, then reports ready.',
    worker: { state: 'BOOTSTRAPPING', network: 'Tor-JS', hopsReady: 0, note: null },
    registry: 'fresh',
    observer: 'available',
  },
  {
    id: 'warm',
    label: 'Worker ready',
    summary: 'A verified-looking worker is ready and the registry is fresh.',
    worker: { state: 'READY', network: 'Tor-JS', hopsReady: 3, note: null },
    registry: 'fresh',
    observer: 'available',
  },
  {
    id: 'degraded',
    label: 'Degraded gateway',
    summary: 'Reads still use the worker, but slowly.',
    worker: {
      state: 'DEGRADED',
      network: 'Tor-JS',
      hopsReady: 3,
      note: 'The demo gateway is near capacity. Reads are slower but still protected.',
    },
    registry: 'fresh',
    observer: 'available',
  },
  {
    id: 'worker-unavailable',
    label: 'Worker unavailable',
    summary: 'No worker answers. Private reads must block, not fall back.',
    worker: {
      state: 'BLOCKED',
      network: 'Tor-JS',
      hopsReady: 0,
      note: 'WORKER_UNAVAILABLE: the gateway did not answer. Protected reads are blocked.',
    },
    registry: 'fresh',
    observer: 'available',
  },
  {
    id: 'passthrough',
    label: 'Passthrough worker',
    summary: 'A valid bundle that does not anonymize. It earns no protected credit.',
    worker: {
      state: 'READY',
      network: 'Passthrough',
      hopsReady: 0,
      note: 'Passthrough is NOT_ANONYMIZED. Privacy-required reads refuse it.',
    },
    registry: 'fresh',
    observer: 'available',
  },
  {
    id: 'registry-expired',
    label: 'Registry expired',
    summary: 'The Arkiv snapshot is past its expiry, so the endpoint is refused.',
    worker: { state: 'READY', network: 'Tor-JS', hopsReady: 3, note: null },
    registry: 'expired',
    observer: 'available',
  },
  {
    id: 'observer-unavailable',
    label: 'Observer unavailable',
    summary: 'Reads leave through the worker but the endpoint does not answer.',
    worker: { state: 'READY', network: 'Tor-JS', hopsReady: 3, note: null },
    registry: 'fresh',
    observer: 'unavailable',
  },
];

export function scenarioById(id: ScenarioId): ScenarioFixture {
  const found = SCENARIOS.find((scenario) => scenario.id === id);
  if (found === undefined) throw new Error(`Unknown fixture scenario: ${id}`);
  return found;
}

export const DEFAULT_SCENARIO: ScenarioId = 'cold-start';
