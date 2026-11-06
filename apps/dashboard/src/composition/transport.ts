import {
  chainIdSchema, makeError, readRequestSchema,
  type Clock, type EndpointCandidate, type ErrorCode, type JsonValue,
  type MonolithTransport, type ReadRequest, type RegistryManifest,
  type Result, type TraceSink, type WorkerState,
} from '@monolith/shared';
import { createMonolithTransport, type AllowedCall, type TransportOptions } from '@monolith/transport';
import { createBrowserDriver } from '@monolith/transport/browser';
import { admitRegistryManifest, createRegistryClient, type RegistryPolicy } from './registry.js';

export type RegistrySelection = { manifest: RegistryManifest; endpoint: EndpointCandidate; routingEndpointId: string };
export type RegistryRead = Pick<ReadRequest, 'readId' | 'method' | 'params' | 'callsite'>;
export type RegistryTransport = {
  select(chainId: string): Promise<Result<RegistrySelection>>;
  read(request: RegistryRead): Promise<Result<JsonValue>>;
  getSelection(): RegistrySelection | null;
  getState(): WorkerState;
  close(): Promise<void>;
};
type Options = {
  transportOptions: Omit<TransportOptions, 'maxAttempts'>;
  registry: { load(chainId: string, signal?: AbortSignal): Promise<Result<RegistryManifest>> };
  policy: RegistryPolicy;
};
const failure = <T>(code: ErrorCode): Result<T> => ({ ok: false, error: makeError(code) });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Owns selection authority; metadata and endpoint readiness have independent lifetimes. */
export function createRegistryTransport(options: Options): RegistryTransport {
  const { registry } = options;
  const { clock } = options.transportOptions;
  // A retry is a new application call and must reenter current selection checks.
  // Hidden retries inside an obsolete read could otherwise outlive replacement.
  const transport: MonolithTransport = createMonolithTransport({
    ...options.transportOptions, maxAttempts: 1,
    policy: { ...options.transportOptions.policy, privacyRequired: true,
      allowDirectDebugControl: false, failClosed: true },
  });
  const policy = copy(options.policy);
  let generation = 0;
  let selection: RegistrySelection | null = null;
  let loading: AbortController | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;

  const current = (expected: number) => !closed && generation === expected;
  const check = (value: RegistrySelection): ErrorCode | undefined => {
    try {
      const admitted = admitRegistryManifest(value.manifest, value.endpoint.chainId, policy, clock.now());
      if (!admitted.ok) return admitted.error.code;
      if (!['READY', 'DEGRADED'].includes(transport.getState())) return 'WORKER_UNAVAILABLE';
      return undefined;
    } catch { return 'REGISTRY_UNTRUSTED'; }
  };
  const selected = (): Result<RegistrySelection> => {
    if (closed) return failure('WORKER_UNAVAILABLE');
    if (!selection) return failure('ENDPOINT_REJECTED');
    const invalid = check(selection);
    if (invalid) { selection = null; return failure(invalid); }
    return { ok: true, value: selection };
  };

  async function select(chainId: string): Promise<Result<RegistrySelection>> {
    if (closed) return failure('WORKER_UNAVAILABLE');
    // Each selected revision gets a distinct capability in the transport's maps.
    // Bound those maps for a long-lived tab; recreate the session after this limit.
    if (generation >= 128) {
      generation = 129; selection = null; loading?.abort();
      return failure('RATE_LIMITED');
    }
    const expected = ++generation;
    selection = null;
    loading?.abort();
    const controller = new AbortController();
    loading = controller;
    try {
      if (!chainIdSchema.safeParse(chainId).success) return failure('INVALID_INPUT');
      // Worker startup can take minutes. Acquire the 30-second manifest afterwards.
      const initialized = await transport.initialize();
      if (!current(expected)) return failure('ENDPOINT_REJECTED');
      if (!initialized.ok) return failure(initialized.error.code);
      const loaded = await registry.load(chainId, controller.signal);
      if (!current(expected)) return failure('ENDPOINT_REJECTED');
      if (!loaded.ok) return failure(loaded.error.code);
      const admitted = admitRegistryManifest(loaded.value, chainId, policy, clock.now());
      if (!admitted.ok) return admitted;
      const manifest = admitted.value;
      const endpoint = manifest.endpoints[0];
      if (!endpoint) return failure('REGISTRY_UNAVAILABLE');
      // Shorten, never extend, the endpoint capability. This also constrains every
      // internal retry at the transport boundary, not just the UI's next read.
      // The local capability ID maps back to the original public discovery ID.
      // A new generation cannot reuse a probe cached for an earlier revision.
      const routingEndpointId = `registry_selection_${expected}`;
      const capability = { ...endpoint, endpointId: routingEndpointId, expiresAt: new Date(Math.min(
        Date.parse(manifest.expiresAt), Date.parse(endpoint.expiresAt),
      )).toISOString() };
      const validated = await transport.validateEndpoint(capability);
      if (!current(expected)) return failure('ENDPOINT_REJECTED');
      if (!validated.ok) return failure(validated.error.code);
      if (JSON.stringify(validated.value) !== JSON.stringify(capability)) return failure('ENDPOINT_REJECTED');
      const candidate = { manifest, endpoint, routingEndpointId };
      const invalid = check(candidate);
      if (invalid) return failure(invalid);
      selection = candidate;
      return { ok: true, value: copy(candidate) };
    } catch { return failure('REGISTRY_UNAVAILABLE'); }
    finally { if (loading === controller) loading = undefined; }
  }

  async function read(input: RegistryRead): Promise<Result<JsonValue>> {
    const ready = selected();
    if (!ready.ok) return ready;
    const active = ready.value;
    const expected = generation;
    // endpointId and chainId cannot be supplied by widgets or derived from a
    // stale UI object. All ordinary reads use the current selected capability.
    const parsed = readRequestSchema.safeParse({ ...input,
      endpointId: active.routingEndpointId, chainId: active.endpoint.chainId });
    if (!parsed.success || Object.keys(input).some((key) => !['readId', 'method', 'params', 'callsite'].includes(key))) {
      return failure('INVALID_INPUT');
    }
    try {
      const result = await transport.read(parsed.data);
      if (!current(expected) || selection !== active) return failure('ENDPOINT_REJECTED');
      const invalid = check(active);
      if (invalid) { selection = null; return failure(invalid); }
      if (!result.ok && ['CHAIN_MISMATCH', 'REGISTRY_EXPIRED', 'ENDPOINT_REJECTED',
        'WORKER_UNAVAILABLE', 'WORKER_INTEGRITY_FAILED'].includes(result.error.code)) selection = null;
      return result;
    } catch { selection = null; return failure('WORKER_UNAVAILABLE'); }
  }

  return {
    select, read,
    getSelection() { const value = selected(); return value.ok ? copy(value.value) : null; },
    getState() {
      if (closed) return 'CLOSED';
      if (selected().ok) return transport.getState();
      const state = transport.getState();
      return state === 'BOOTSTRAPPING' ? state : 'BLOCKED';
    },
    close() {
      if (closing) return closing;
      closed = true; generation++; selection = null; loading?.abort();
      closing = Promise.resolve().then(() => transport.close()).catch(() => undefined);
      return closing;
    },
  };
}

export type BrowserRegistryOptions = {
  hostUrl: string;
  network: 'tor' | 'nym';
  bootstrapRpcUrl: string;
  registryUrl: string;
  registryPolicy: RegistryPolicy;
  allowedChains: string[];
  allowedMethods: ReadRequest['method'][];
  allowedCallsites: readonly string[];
  traceSink: TraceSink;
  clock?: Clock;
  allowedCalls?: readonly AllowedCall[];
  torGateways?: readonly string[];
  requestTimeoutMs?: number;
  initializationTimeoutMs?: number;
};

/** Production browser composition; pins are operator configuration, never manifest fields.
 * hostUrl must serve an application-owned asset which calls installBrowserHost().
 * The metadata request and enumerated specifier bootstrap are ordinary contacts.
 */
export function createBrowserRegistryTransport(options: BrowserRegistryOptions) {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const registryPolicy = copy(options.registryPolicy);
  const driver = createBrowserDriver({
    hostUrl: options.hostUrl, network: options.network, bootstrapRpcUrl: options.bootstrapRpcUrl,
    approvedOrigins: registryPolicy.approvedOrigins, traceSink: options.traceSink,
    ...(options.torGateways ? { torGateways: options.torGateways } : {}),
  });
  const transportOptions: Omit<TransportOptions, 'maxAttempts'> = {
    policy: { privacyRequired: true, allowedChains: [...options.allowedChains],
      allowedMethods: [...options.allowedMethods], allowDirectDebugControl: false, failClosed: true },
    driver, clock, traceSink: options.traceSink,
    trustedPublishers: registryPolicy.trustedPublishers, approvedOrigins: registryPolicy.approvedOrigins,
    allowedCallsites: [...options.allowedCallsites],
    ...(options.allowedCalls ? { allowedCalls: options.allowedCalls } : {}),
    ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    ...(options.initializationTimeoutMs ? { initializationTimeoutMs: options.initializationTimeoutMs } : {}),
  };
  const registry = createRegistryClient({ url: options.registryUrl, policy: registryPolicy, clock });
  const session = createRegistryTransport({ transportOptions, registry, policy: registryPolicy });
  return { ...session, getWorkerMetadata: () => driver.getMetadata() };
}
