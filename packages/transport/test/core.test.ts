import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeError, rpcTraceSchema,
  type EndpointCandidate, type JsonRpcRequest, type JsonValue, type ReadRequest, type Result, type RpcTrace,
} from '@monolith/shared';
import { createMonolithTransport, type TransportDriver, type TransportOptions } from '@monolith/transport';

const publisher = `0x${'11'.repeat(20)}`;
const owner = `0x${'22'.repeat(20)}`;
const target = `0x${'33'.repeat(20)}`;
const hash = `0x${'44'.repeat(32)}`;
const baseTime = Date.parse('2030-01-01T00:00:00Z');
const candidate = (): EndpointCandidate => ({
  endpointId: 'endpoint_0001', chainId: '1', chainName: 'Synthetic Ethereum',
  rpcUrl: 'https://rpc.example.com/read', publisher: { creator: publisher, owner },
  entityKey: hash, expiresAt: '2030-01-01T00:10:00Z',
  source: { url: 'https://source.example.com/snapshot', revision: 'synthetic-revision-1',
    licenseUrl: 'https://source.example.com/license', snapshotSha256: '55'.repeat(32) },
});
const request = (overrides: Partial<ReadRequest> = {}): ReadRequest => ({
  readId: 'read_00000001', endpointId: 'endpoint_0001', chainId: '1', method: 'eth_blockNumber',
  params: [], callsite: 'lab.block-number', ...overrides,
});
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const failed = <T>(code: Parameters<typeof makeError>[0]): Result<T> => ({ ok: false, error: makeError(code) });
const response = (rpc: JsonRpcRequest, result: unknown = '0x1'): Result<unknown> => ok({ jsonrpc: '2.0', id: rpc.id, result });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class SimulatedDriver implements TransportDriver {
  route: TransportDriver['route'] = 'anon-nym';
  readonly evidence = 'SIMULATED';
  initialized = 0;
  closed = 0;
  calls: Array<{ url: string; request: JsonRpcRequest; signal: AbortSignal }> = [];
  boot: (signal: AbortSignal) => Promise<Result<void>> = async () => ok(undefined);
  handler: (rpc: JsonRpcRequest, signal: AbortSignal) => Promise<Result<unknown>> = async (rpc) => response(rpc);
  async initialize(signal: AbortSignal) { this.initialized++; return this.boot(signal); }
  async exchange(url: string, rpc: JsonRpcRequest, signal: AbortSignal) {
    this.calls.push({ url, request: structuredClone(rpc), signal });
    return this.handler(rpc, signal);
  }
  async close() { this.closed++; }
}

function fixture(overrides: Partial<TransportOptions> = {}) {
  let instant = baseTime;
  const driver = new SimulatedDriver();
  const traces: RpcTrace[] = [];
  const options: TransportOptions = {
    policy: { privacyRequired: true, allowedChains: ['1'], allowedMethods: [
      'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_call', 'eth_getTransactionReceipt',
    ], allowDirectDebugControl: false, failClosed: true },
    driver, clock: { now: () => new Date(instant).toISOString() },
    traceSink: { emit: (event) => traces.push(event) },
    trustedPublishers: [{ creator: publisher, owner }], approvedOrigins: ['https://rpc.example.com'],
    allowedCallsites: ['lab.block-number', 'lab.balance', 'lab.call', 'lab.receipt'],
    allowedCalls: [{ target, selector: '0xaabbccdd', blockTags: ['latest'] }],
    ...overrides,
  };
  const transport = createMonolithTransport(options);
  return { transport, driver, options, traces, advance: (ms: number) => { instant += ms; },
    ready: async () => { expect(await transport.initialize()).toEqual(ok(undefined));
      expect(await transport.validateEndpoint(candidate())).toEqual(ok(candidate())); } };
}

afterEach(() => vi.useRealTimers());

describe('SIMULATED transport lifecycle and fixed route', () => {
  it('requires worker initialization and a protected target probe before READY', async () => {
    const f = fixture();
    expect(f.transport.getState()).toBe('BLOCKED');
    expect(await f.transport.validateEndpoint(candidate())).toEqual(failed('WORKER_UNAVAILABLE'));
    expect(f.driver.calls).toHaveLength(0);
    expect(await f.transport.initialize()).toEqual(ok(undefined));
    expect(f.transport.getState()).toBe('DEGRADED');
    expect(await f.transport.initialize()).toEqual(ok(undefined));
    expect(f.driver.initialized).toBe(1);
    expect(await f.transport.validateEndpoint(candidate())).toEqual(ok(candidate()));
    expect(f.transport.getState()).toBe('READY');
    expect(f.driver.calls[0]?.request.method).toBe('eth_chainId');
    expect(f.traces[1]?.route).toBe('anon-nym');
    expect(f.traces[1]?.callsite).toBe('transport.chain-probe');
    await f.transport.close();
  });

  it('shares concurrent boot and discards a late ready result after close', async () => {
    const f = fixture();
    const boot = deferred<Result<void>>();
    let signal: AbortSignal | undefined;
    f.driver.boot = (value) => { signal = value; return boot.promise; };
    const first = f.transport.initialize();
    const second = f.transport.initialize();
    await Promise.resolve();
    expect(f.driver.initialized).toBe(1);
    expect(f.transport.getState()).toBe('BOOTSTRAPPING');
    await f.transport.close();
    expect(signal?.aborted).toBe(true);
    boot.resolve(ok(undefined));
    expect(await first).toEqual(failed('WORKER_UNAVAILABLE'));
    expect(await second).toEqual(failed('WORKER_UNAVAILABLE'));
    expect(f.transport.getState()).toBe('CLOSED');
    expect(await f.transport.initialize()).toEqual(failed('WORKER_UNAVAILABLE'));
    await f.transport.close();
    expect(f.driver.closed).toBe(1);
  });

  it('aborts a boot deadline and closes its driver without accepting late readiness', async () => {
    vi.useFakeTimers();
    const f = fixture({ initializationTimeoutMs: 5 });
    const boot = deferred<Result<void>>();
    let signal: AbortSignal | undefined;
    f.driver.boot = (value) => { signal = value; return boot.promise; };
    const pending = f.transport.initialize();
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toEqual(failed('UPSTREAM_TIMEOUT'));
    expect(signal?.aborted).toBe(true);
    expect(f.driver.closed).toBe(1);
    boot.resolve(ok(undefined));
    await Promise.resolve();
    expect(f.transport.getState()).toBe('BLOCKED');
  });

  it.each(['WORKER_UNAVAILABLE', 'WORKER_INTEGRITY_FAILED'] as const)(
    'initialization %s cannot reach a target', async (code) => {
      const f = fixture();
      f.driver.boot = async () => failed(code);
      expect(await f.transport.initialize()).toEqual(failed(code));
      expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
      expect(f.driver.calls).toHaveLength(0);
      expect(f.transport.getState()).toBe('BLOCKED');
    },
  );

  it.each(['passthrough', 'direct-debug'] as const)('required privacy denies %s before boot', async (route) => {
    const driver = new SimulatedDriver(); driver.route = route;
    const f = fixture({ driver });
    expect(await f.transport.initialize()).toEqual(failed('POLICY_DENIED'));
    expect(driver.initialized).toBe(0);
    expect(driver.calls).toHaveLength(0);
  });

  it.each(['passthrough', 'direct-debug'] as const)('keeps explicit %s control out of anonymous routes', async (route) => {
    const driver = new SimulatedDriver(); driver.route = route;
    const f = fixture({ driver, policy: { privacyRequired: false, allowedChains: ['1'],
      allowedMethods: ['eth_chainId', 'eth_blockNumber'], allowDirectDebugControl: route === 'direct-debug', failClosed: true } });
    await f.ready();
    expect(await f.transport.read(request())).toEqual(ok('0x1'));
    expect(f.traces.every((event) => event.route === route)).toBe(true);
    expect(f.traces.every((event) => event.evidence === 'SIMULATED')).toBe(true);
    await f.transport.close();
  });

  it('denies an unconsented direct driver and a driver route mutation', async () => {
    const direct = new SimulatedDriver(); direct.route = 'direct-debug';
    const denied = fixture({ driver: direct, policy: { privacyRequired: false, allowedChains: ['1'],
      allowedMethods: ['eth_chainId', 'eth_blockNumber'], allowDirectDebugControl: false, failClosed: true } });
    expect(await denied.transport.initialize()).toEqual(failed('POLICY_DENIED'));
    const f = fixture(); await f.ready();
    f.driver.route = 'direct-debug';
    expect(await f.transport.read(request())).toEqual(failed('WORKER_UNAVAILABLE'));
    expect(f.driver.calls).toHaveLength(1);
    await f.transport.close();
  });
});

describe('SIMULATED trust and endpoint validation', () => {
  it.each([
    ['unapproved origin', (value: EndpointCandidate) => { value.rpcUrl = 'https://evil.example.com'; }, 'TARGET_DENIED'],
    ['http', (value: EndpointCandidate) => { value.rpcUrl = 'http://rpc.example.com'; }, 'ENDPOINT_REJECTED'],
    ['IP literal', (value: EndpointCandidate) => { value.rpcUrl = 'https://127.0.0.1'; }, 'ENDPOINT_REJECTED'],
    ['credentials', (value: EndpointCandidate) => { value.rpcUrl = 'https://secret@rpc.example.com'; }, 'ENDPOINT_REJECTED'],
    ['API template', (value: EndpointCandidate) => { value.rpcUrl = 'https://rpc.example.com/${KEY}'; }, 'ENDPOINT_REJECTED'],
    ['wrong publisher', (value: EndpointCandidate) => { value.publisher.creator = target; }, 'REGISTRY_UNTRUSTED'],
    ['wrong owner', (value: EndpointCandidate) => { value.publisher.owner = publisher; }, 'REGISTRY_UNTRUSTED'],
    ['expired', (value: EndpointCandidate) => { value.expiresAt = '2030-01-01T00:00:00Z'; }, 'REGISTRY_EXPIRED'],
    ['chain denied', (value: EndpointCandidate) => { value.chainId = '2'; }, 'POLICY_DENIED'],
  ] as const)('rejects %s before any worker exchange', async (_name, mutate, code) => {
    const f = fixture(); await f.transport.initialize();
    const value = candidate(); mutate(value);
    expect(await f.transport.validateEndpoint(value)).toEqual(failed(code));
    expect(f.driver.calls).toHaveLength(0);
    await f.transport.close();
  });

  it('rejects mismatched chain through the same fixed driver and records the failed probe', async () => {
    const f = fixture(); await f.transport.initialize();
    f.driver.handler = async (rpc) => response(rpc, '0x2');
    expect(await f.transport.validateEndpoint(candidate())).toEqual(failed('CHAIN_MISMATCH'));
    expect(f.traces.at(-1)).toMatchObject({ route: 'anon-nym', success: false, errorCode: 'CHAIN_MISMATCH' });
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    await f.transport.close();
  });

  it('invalidates a previously validated endpoint if any later chain read disagrees', async () => {
    const f = fixture(); await f.ready();
    f.driver.handler = async (rpc) => response(rpc, '0x2');
    expect(await f.transport.read(request({ method: 'eth_chainId' }))).toEqual(failed('CHAIN_MISMATCH'));
    f.driver.handler = async (rpc) => response(rpc);
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(2);
    expect(f.transport.getState()).toBe('DEGRADED');
    await f.transport.close();
  });

  it('invalidates an existing endpoint when a replacement fails local publisher trust', async () => {
    const f = fixture(); await f.ready();
    const replacement = candidate(); replacement.publisher.owner = target;
    expect(await f.transport.validateEndpoint(replacement)).toEqual(failed('REGISTRY_UNTRUSTED'));
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(1);
    expect(f.transport.getState()).toBe('DEGRADED');
    await f.transport.close();
  });

  it('discards a response if endpoint expiry passes while the protected read is pending', async () => {
    const f = fixture({ validationTtlMs: 300_000 }); await f.transport.initialize();
    const expiring = candidate(); expiring.expiresAt = '2030-01-01T00:00:01Z';
    await f.transport.validateEndpoint(expiring);
    const pendingResult = deferred<Result<unknown>>();
    let rpc: JsonRpcRequest | undefined;
    f.driver.handler = (value) => { rpc = value; return pendingResult.promise; };
    const pending = f.transport.read(request());
    await Promise.resolve(); await Promise.resolve();
    f.advance(1_000);
    pendingResult.resolve(response(rpc!));
    expect(await pending).toEqual(failed('REGISTRY_EXPIRED'));
    expect(f.traces.at(-1)).toMatchObject({ success: false, errorCode: 'REGISTRY_EXPIRED' });
    await f.transport.close();
  });

  it('binds cached validation to URL, source revision, expiry and TTL', async () => {
    const f = fixture({ validationTtlMs: 50 }); await f.ready();
    expect(await f.transport.validateEndpoint(candidate())).toEqual(ok(candidate()));
    expect(f.driver.calls).toHaveLength(1);
    const changed = candidate(); changed.source.revision = 'synthetic-revision-2';
    expect(await f.transport.validateEndpoint(changed)).toEqual(ok(changed));
    expect(f.driver.calls).toHaveLength(2);
    changed.rpcUrl = 'https://rpc.example.com/other';
    await f.transport.validateEndpoint(changed);
    expect(f.driver.calls).toHaveLength(3);
    changed.expiresAt = '2030-01-01T00:09:00Z';
    await f.transport.validateEndpoint(changed);
    expect(f.driver.calls).toHaveLength(4);
    f.advance(50);
    expect(f.transport.getState()).toBe('DEGRADED');
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(4);
    await f.transport.validateEndpoint(changed);
    expect(f.driver.calls).toHaveLength(5);
    await f.transport.close();
  });

  it('copies candidates and the returned candidate before retaining a validated destination', async () => {
    const f = fixture(); await f.transport.initialize();
    const pending = deferred<Result<unknown>>();
    f.driver.handler = (rpc) => { queueMicrotask(() => pending.resolve(response(rpc))); return pending.promise; };
    const value = candidate();
    const validation = f.transport.validateEndpoint(value);
    value.rpcUrl = 'https://evil.example.com'; value.publisher.creator = target;
    const validated = await validation;
    expect(validated).toEqual(ok(candidate()));
    if (validated.ok) validated.value.rpcUrl = 'https://evil.example.com';
    f.driver.handler = async (rpc) => response(rpc);
    expect(await f.transport.read(request())).toEqual(ok('0x1'));
    expect(f.driver.calls.every((call) => call.url === candidate().rpcUrl)).toBe(true);
    await f.transport.close();
  });

  it('prevents an older concurrent validation from replacing a newer revision', async () => {
    const f = fixture(); await f.transport.initialize();
    const old = deferred<Result<unknown>>();
    let oldRequest: JsonRpcRequest | undefined;
    f.driver.handler = async (rpc) => {
      if (!oldRequest) { oldRequest = rpc; return old.promise; }
      return response(rpc);
    };
    const first = f.transport.validateEndpoint(candidate());
    await Promise.resolve(); await Promise.resolve();
    const current = candidate(); current.source.revision = 'synthetic-revision-2';
    expect(await f.transport.validateEndpoint(current)).toEqual(ok(current));
    expect(oldRequest).toBeDefined();
    old.resolve(response(oldRequest!));
    expect(await first).toEqual(failed('ENDPOINT_REJECTED'));
    expect(await f.transport.validateEndpoint(current)).toEqual(ok(current));
    expect(f.driver.calls).toHaveLength(2);
    await f.transport.close();
  });

  it.each([
    ['publisher rejection', (value: EndpointCandidate) => { value.publisher.creator = target; }, 'REGISTRY_UNTRUSTED'],
    ['owner rejection', (value: EndpointCandidate) => { value.publisher.owner = target; }, 'REGISTRY_UNTRUSTED'],
    ['expiry rejection', (value: EndpointCandidate) => { value.expiresAt = '2030-01-01T00:00:00Z'; }, 'REGISTRY_EXPIRED'],
    ['chain policy rejection', (value: EndpointCandidate) => { value.chainId = '2'; }, 'POLICY_DENIED'],
    ['origin rejection', (value: EndpointCandidate) => { value.rpcUrl = 'https://evil.example.com'; }, 'TARGET_DENIED'],
    ['malformed identifiable candidate', (value: EndpointCandidate) => { value.source.revision = ''; }, 'ENDPOINT_REJECTED'],
  ] as const)('revokes an older pending probe after a newer %s for the same endpoint', async (_name, mutate, code) => {
    const f = fixture(); await f.transport.initialize();
    const held = deferred<Result<unknown>>();
    const started = deferred<JsonRpcRequest>();
    let holdFirst = true;
    f.driver.handler = async (rpc) => {
      if (holdFirst) { holdFirst = false; started.resolve(rpc); return held.promise; }
      return response(rpc);
    };
    const older = f.transport.validateEndpoint(candidate());
    const olderRpc = await started.promise;
    const rejected = candidate(); mutate(rejected);
    expect(await f.transport.validateEndpoint(rejected)).toEqual(failed(code));
    expect(f.driver.calls).toHaveLength(1);

    held.resolve(response(olderRpc));
    expect(await older).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.transport.getState()).toBe('DEGRADED');
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(1);

    expect(await f.transport.validateEndpoint(candidate())).toEqual(ok(candidate()));
    expect(await f.transport.read(request())).toEqual(ok('0x1'));
    expect(f.driver.calls.map((call) => call.request.method)).toEqual([
      'eth_chainId', 'eth_chainId', 'eth_blockNumber',
    ]);
    await f.transport.close();
  });

  it('keeps a different endpoint usable when a rejected candidate revokes only its own pending probe', async () => {
    const f = fixture(); await f.transport.initialize();
    const other = { ...candidate(), endpointId: 'endpoint_0002' };
    expect(await f.transport.validateEndpoint(other)).toEqual(ok(other));
    const held = deferred<Result<unknown>>();
    const started = deferred<JsonRpcRequest>();
    f.driver.handler = async (rpc) => { started.resolve(rpc); return held.promise; };
    const older = f.transport.validateEndpoint(candidate());
    const olderRpc = await started.promise;
    const rejected = candidate(); rejected.publisher.creator = target;
    expect(await f.transport.validateEndpoint(rejected)).toEqual(failed('REGISTRY_UNTRUSTED'));
    held.resolve(response(olderRpc));
    expect(await older).toEqual(failed('ENDPOINT_REJECTED'));

    f.driver.handler = async (rpc) => response(rpc);
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(2);
    expect(await f.transport.read(request({ endpointId: other.endpointId }))).toEqual(ok('0x1'));
    expect(f.driver.calls).toHaveLength(3);
    expect(await f.transport.validateEndpoint(other)).toEqual(ok(other));
    expect(f.driver.calls).toHaveLength(3);
    await f.transport.close();
  });

  it('cannot publish endpoint readiness when the successful probe trace closes the transport', async () => {
    let onProbe: (() => void) | undefined;
    let closing: Promise<void> | undefined;
    const f = fixture({ traceSink: { emit: (event) => {
      if (event.callsite === 'transport.chain-probe' && event.success) onProbe?.();
    } } });
    await f.transport.initialize();
    onProbe = () => { onProbe = undefined; closing = f.transport.close(); };
    expect(await f.transport.validateEndpoint(candidate())).toEqual(failed('WORKER_UNAVAILABLE'));
    await closing;
    expect(f.transport.getState()).toBe('CLOSED');
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(1);
    expect(f.driver.closed).toBe(1);
  });

  it('rechecks expiry after the successful probe trace and requires a fresh candidate to recover', async () => {
    let onProbe: (() => void) | undefined;
    const f = fixture({ traceSink: { emit: (event) => {
      if (event.callsite === 'transport.chain-probe' && event.success) onProbe?.();
    } } });
    await f.transport.initialize();
    onProbe = () => { onProbe = undefined; f.advance(600_000); };
    expect(await f.transport.validateEndpoint(candidate())).toEqual(failed('REGISTRY_EXPIRED'));
    expect(f.transport.getState()).toBe('DEGRADED');
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(1);

    const fresh = candidate(); fresh.expiresAt = '2030-01-01T00:20:00Z';
    expect(await f.transport.validateEndpoint(fresh)).toEqual(ok(fresh));
    expect(await f.transport.read(request())).toEqual(ok('0x1'));
    expect(f.driver.calls).toHaveLength(3);
    await f.transport.close();
  });

  it('honors a newer local rejection from the successful probe trace before publishing readiness', async () => {
    let onProbe: (() => void) | undefined;
    let rejection: Promise<Result<EndpointCandidate>> | undefined;
    const f = fixture({ traceSink: { emit: (event) => {
      if (event.callsite === 'transport.chain-probe' && event.success) onProbe?.();
    } } });
    await f.transport.initialize();
    onProbe = () => {
      onProbe = undefined;
      const rejected = candidate(); rejected.publisher.owner = target;
      rejection = f.transport.validateEndpoint(rejected);
    };
    expect(await f.transport.validateEndpoint(candidate())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(await rejection).toEqual(failed('REGISTRY_UNTRUSTED'));
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(1);
    expect(await f.transport.validateEndpoint(candidate())).toEqual(ok(candidate()));
    expect(await f.transport.read(request())).toEqual(ok('0x1'));
    expect(f.driver.calls).toHaveLength(3);
    await f.transport.close();
  });

  it('lets a newer revision started by the successful probe trace exclusively establish readiness', async () => {
    let onProbe: (() => void) | undefined;
    let newer: Promise<Result<EndpointCandidate>> | undefined;
    const f = fixture({ traceSink: { emit: (event) => {
      if (event.callsite === 'transport.chain-probe' && event.success) onProbe?.();
    } } });
    await f.transport.initialize();
    const fresh = candidate(); fresh.source.revision = 'synthetic-revision-2';
    const held = deferred<Result<unknown>>();
    const started = deferred<JsonRpcRequest>();
    f.driver.handler = async (rpc) => {
      if (f.driver.calls.length === 1) return response(rpc);
      started.resolve(rpc); return held.promise;
    };
    onProbe = () => { onProbe = undefined; newer = f.transport.validateEndpoint(fresh); };
    const older = f.transport.validateEndpoint(candidate());
    const newerRpc = await started.promise;
    expect(await older).toEqual(failed('ENDPOINT_REJECTED'));
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    expect(f.driver.calls).toHaveLength(2);
    held.resolve(response(newerRpc));
    expect(await newer).toEqual(ok(fresh));
    f.driver.handler = async (rpc) => response(rpc);
    expect(await f.transport.validateEndpoint(fresh)).toEqual(ok(fresh));
    expect(await f.transport.read(request())).toEqual(ok('0x1'));
    expect(f.driver.calls).toHaveLength(3);
    await f.transport.close();
  });

  it('copies policy and call allowlists rather than adopting later capability expansion', async () => {
    const f = fixture(); await f.ready();
    f.options.policy.allowedChains.push('2');
    f.options.allowedCallsites = ['private wallet address'];
    expect(await f.transport.read(request({ chainId: '2' }))).toEqual(failed('POLICY_DENIED'));
    expect(await f.transport.read(request({ callsite: 'private wallet address' }))).toEqual(failed('POLICY_DENIED'));
    expect(f.traces.at(-1)?.callsite).toBe('transport.denied');
    await f.transport.close();
  });
});

describe('SIMULATED request, response and retry boundaries', () => {
  it('blocks ordinary reads until their exact endpoint and chain are validated', async () => {
    const f = fixture(); await f.transport.initialize();
    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    await f.transport.validateEndpoint(candidate());
    expect(await f.transport.read(request({ endpointId: 'other_endpoint' }))).toEqual(failed('ENDPOINT_REJECTED'));
    expect(await f.transport.read(request({ chainId: '2' }))).toEqual(failed('POLICY_DENIED'));
    expect(f.driver.calls).toHaveLength(1);
    await f.transport.close();
  });

  it.each([
    ['wrong id', (rpc: JsonRpcRequest) => ({ jsonrpc: '2.0', id: `${rpc.id}_wrong`, result: '0x1' }), 'RPC_RESPONSE_INVALID'],
    ['missing result', (rpc: JsonRpcRequest) => ({ jsonrpc: '2.0', id: rpc.id }), 'RPC_RESPONSE_INVALID'],
    ['batch', (rpc: JsonRpcRequest) => [{ jsonrpc: '2.0', id: rpc.id, result: '0x1' }], 'RPC_RESPONSE_INVALID'],
    ['result and error', (rpc: JsonRpcRequest) => ({ jsonrpc: '2.0', id: rpc.id, result: '0x1', error: { code: -1, message: target } }), 'RPC_RESPONSE_INVALID'],
    ['raw RPC error', (rpc: JsonRpcRequest) => ({ jsonrpc: '2.0', id: rpc.id, error: { code: -1, message: target } }), 'RPC_ERROR'],
    ['noncanonical quantity', (rpc: JsonRpcRequest) => ({ jsonrpc: '2.0', id: rpc.id, result: '0x01' }), 'RPC_RESPONSE_INVALID'],
    ['wrong result type', (rpc: JsonRpcRequest) => ({ jsonrpc: '2.0', id: rpc.id, result: 1 }), 'RPC_RESPONSE_INVALID'],
  ] as const)('rejects %s without leaking the provider message or retrying', async (_name, payload, code) => {
    const f = fixture(); await f.ready();
    f.driver.handler = async (rpc) => ok(payload(rpc));
    expect(await f.transport.read(request())).toEqual(failed(code));
    expect(f.driver.calls).toHaveLength(2);
    expect(JSON.stringify(f.traces)).not.toContain(target);
    expect(f.traces.at(-1)).toMatchObject({ success: false, errorCode: code });
    await f.transport.close();
  });

  it.each(['RATE_LIMITED', 'UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'WORKER_UNAVAILABLE'] as const)(
    'bounds %s retries to the same route and logical read ID', async (code) => {
      const f = fixture({ maxAttempts: 3 }); await f.ready();
      f.driver.handler = async () => failed(code);
      expect(await f.transport.read(request())).toEqual(failed(code));
      expect(f.driver.calls).toHaveLength(4);
      const reads = f.traces.filter((event) => event.readId === 'read_00000001');
      expect(reads.map((event) => event.attempt)).toEqual([1, 2, 3]);
      expect(reads.every((event) => event.route === 'anon-nym')).toBe(true);
      expect(new Set(f.driver.calls.slice(1).map((call) => call.url))).toEqual(new Set([candidate().rpcUrl]));
      expect(new Set(f.driver.calls.slice(1).map((call) => call.request.id)).size).toBe(3);
      await f.transport.close();
    },
  );

  it('keeps a blocked retry distinct when validation expires after a retryable failure', async () => {
    const traces: RpcTrace[] = [];
    let advance: (milliseconds: number) => void = () => undefined;
    const f = fixture({ maxAttempts: 2, validationTtlMs: 1, traceSink: { emit: (event) => {
      traces.push(event);
      if (event.readId === 'read_00000001' && event.errorCode === 'RATE_LIMITED') advance(2);
    } } });
    advance = f.advance;
    await f.ready();
    f.driver.handler = async () => failed('RATE_LIMITED');

    expect(await f.transport.read(request())).toEqual(failed('ENDPOINT_REJECTED'));
    // The expired retry is blocked before egress, but still needs its own correlation key.
    expect(f.driver.calls).toHaveLength(2); // protected chain probe + the first app attempt
    const reads = traces.filter((event) => event.readId === 'read_00000001');
    expect(reads.map((event) => event.attempt)).toEqual([1, 2]);
    expect(reads[0]).toMatchObject({ route: 'anon-nym', errorCode: 'RATE_LIMITED' });
    expect(reads[1]).toMatchObject({ route: 'blocked', errorCode: 'ENDPOINT_REJECTED' });
    await f.transport.close();
  });

  it('enforces real deadlines even when a simulated driver ignores abort', async () => {
    vi.useFakeTimers();
    const f = fixture({ requestTimeoutMs: 5, maxAttempts: 2 }); await f.ready();
    f.driver.handler = async () => new Promise(() => undefined);
    const pending = f.transport.read(request());
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual(failed('UPSTREAM_TIMEOUT'));
    expect(f.driver.calls.slice(1).every((call) => call.signal.aborted)).toBe(true);
    expect(f.driver.calls).toHaveLength(3);
    await f.transport.close();
  });

  it('discards and aborts an in-flight read on close; late data cannot restore READY', async () => {
    const f = fixture(); await f.ready();
    const result = deferred<Result<unknown>>();
    let rpc: JsonRpcRequest | undefined;
    f.driver.handler = (value) => { rpc = value; return result.promise; };
    const pending = f.transport.read(request());
    await Promise.resolve(); await Promise.resolve();
    await f.transport.close();
    expect(f.driver.calls.at(-1)?.signal.aborted).toBe(true);
    result.resolve(response(rpc!));
    expect(await pending).toEqual(failed('WORKER_UNAVAILABLE'));
    expect(f.transport.getState()).toBe('CLOSED');
    expect(f.traces.at(-1)?.success).toBe(false);
  });

  it('denies target, selector and block-tag changes for eth_call before exchange', async () => {
    const f = fixture(); await f.ready();
    for (const params of [
      [{ to: publisher, data: '0xaabbccdd' }, 'latest'],
      [{ to: target, data: '0xaabbccee' }, 'latest'],
      [{ to: target, data: '0xaabbccdd' }, 'pending'],
    ] satisfies JsonValue[][]) {
      expect(await f.transport.read(request({ method: 'eth_call', params, callsite: 'lab.call' })))
        .toEqual(failed('TARGET_DENIED'));
    }
    expect(f.driver.calls).toHaveLength(1);
    f.driver.handler = async (rpc) => response(rpc, '0x');
    expect(await f.transport.read(request({ method: 'eth_call',
      params: [{ to: target, data: '0xaabbccdd' }, 'latest'], callsite: 'lab.call' }))).toEqual(ok('0x'));
    await f.transport.close();
  });

  it('enforces a configured read-method subset after the internal chain probe', async () => {
    const f = fixture({ policy: { privacyRequired: true, allowedChains: ['1'],
      allowedMethods: ['eth_chainId'], allowDirectDebugControl: false, failClosed: true } });
    await f.ready();
    expect(await f.transport.read(request())).toEqual(failed('METHOD_DENIED'));
    expect(f.driver.calls).toHaveLength(1);
    expect(f.traces.at(-1)).toMatchObject({ route: 'blocked', success: false, errorCode: 'METHOD_DENIED' });
    await f.transport.close();
  });

  it('rejects unsupported methods and malformed parameters before any destination call', async () => {
    const f = fixture(); await f.ready();
    expect(await f.transport.read({ ...request(), method: 'eth_sendRawTransaction' } as unknown as ReadRequest))
      .toEqual(failed('INVALID_INPUT'));
    expect(await f.transport.read(request({ method: 'eth_call', params: [{ to: target, data: '0x' }, 'latest'] })))
      .toEqual(failed('INVALID_INPUT'));
    expect(f.driver.calls).toHaveLength(1);
    await f.transport.close();
  });

  it('keeps local params/results/raw exceptions out of all exported traces', async () => {
    const f = fixture(); await f.ready();
    f.driver.handler = async () => { throw new Error(`private ${target} ${hash}`); };
    expect(await f.transport.read(request({ method: 'eth_getBalance', params: [target, 'latest'], callsite: 'lab.balance' })))
      .toEqual(failed('UPSTREAM_UNAVAILABLE'));
    for (const event of f.traces) expect(rpcTraceSchema.safeParse(event).success).toBe(true);
    const exported = JSON.stringify(f.traces);
    expect(exported).not.toContain(target); expect(exported).not.toContain(hash);
    expect(exported).not.toContain('params'); expect(exported).not.toContain('result');
    expect(exported).not.toContain('private'); expect(exported).not.toContain('secret');
    await f.transport.close();
  });

  it('validates receipt identity/status/log data and accepts a pending null receipt', async () => {
    const f = fixture(); await f.ready();
    const query = request({ method: 'eth_getTransactionReceipt', params: [hash], callsite: 'lab.receipt' });
    f.driver.handler = async (rpc) => response(rpc, null);
    expect(await f.transport.read(query)).toEqual(ok(null));
    const receipt = { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: '0x1',
      from: publisher, to: target, logs: [{ address: target, topics: [hash], data: '0x' }] };
    f.driver.handler = async (rpc) => response(rpc, receipt);
    expect(await f.transport.read(query)).toEqual(ok(receipt));
    f.driver.handler = async (rpc) => response(rpc, { ...receipt, status: 'settled' });
    expect(await f.transport.read(query)).toEqual(failed('RPC_RESPONSE_INVALID'));
    f.driver.handler = async (rpc) => response(rpc, { ...receipt, transactionHash: `0x${'66'.repeat(32)}` });
    expect(await f.transport.read(query)).toEqual(failed('RPC_RESPONSE_INVALID'));
    await f.transport.close();
  });

  it.each([
    { maxAttempts: 0 }, { maxAttempts: 4 }, { requestTimeoutMs: -1 }, { validationTtlMs: Number.NaN },
    { approvedOrigins: ['https://rpc.example.com/read'] }, { trustedPublishers: [] },
    { policy: { privacyRequired: true, allowedChains: ['1'], allowedMethods: ['eth_blockNumber'],
      allowDirectDebugControl: false, failClosed: true } },
  ] satisfies Partial<TransportOptions>[])('fails invalid configuration closed: %j', async (overrides) => {
    const f = fixture(overrides);
    expect(await f.transport.initialize()).toEqual(failed('POLICY_DENIED'));
    expect(f.driver.initialized).toBe(0);
    expect(f.driver.calls).toHaveLength(0);
  });
});
