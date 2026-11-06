import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderController } from '../../../apps/dashboard/src/features/providers/controller.ts';

// SIMULATED application-boundary tests only. No network, worker, Arkiv write/query,
// provider availability, quote or privacy evidence is observed by this harness.
// Its fabricated OBSERVED_LIVE manifest flag exercises production admission;
// that input flag is not a claim about this test or either fictional provider.
const BASE = Date.parse('2030-01-01T00:00:00.000Z');
const PUBLISHER = `0x${'1'.repeat(40)}`;
const FOREIGN = `0x${'2'.repeat(40)}`;
const ok = (value) => ({ ok: true, value });
const errors = {
  INVALID_INPUT: ['The input does not match the contract.', false],
  TARGET_DENIED: ['The destination is not allowed.', false],
  ENDPOINT_REJECTED: ['The endpoint was rejected.', false],
  CHAIN_MISMATCH: ['The endpoint chain does not match.', false],
  REGISTRY_UNTRUSTED: ['The registry publisher or provenance is untrusted.', false],
  REGISTRY_EXPIRED: ['The registry snapshot has expired.', false],
  REGISTRY_UNAVAILABLE: ['The registry is unavailable.', true],
  WORKER_UNAVAILABLE: ['The anonymity worker is unavailable.', true],
  UPSTREAM_UNAVAILABLE: ['The upstream is unavailable.', true],
  UPSTREAM_TIMEOUT: ['The upstream request timed out.', true],
  RATE_LIMITED: ['The request limit was reached.', true],
  RPC_RESPONSE_INVALID: ['The RPC response is invalid.', false],
};
const fail = (code) => ({ ok: false, error: { code, message: errors[code][0], retryable: errors[code][1] } });
const copy = (value) => structuredClone(value);
const bindings = () => [
  { endpointId: 'synthetic_provider_a', rpcUrl: 'https://a.rpc.example.com/', observerEndpointId: 'synthetic_observer_a' },
  { endpointId: 'synthetic_provider_b', rpcUrl: 'https://b.rpc.example.com/', observerEndpointId: 'synthetic_observer_b' },
];
const policy = () => ({
  trustedPublishers: [{ creator: PUBLISHER, owner: PUBLISHER }],
  approvedOrigins: ['https://a.rpc.example.com', 'https://b.rpc.example.com'],
  source: { revision: 'a'.repeat(40), snapshotSha256: 'b'.repeat(64),
    licenseUrl: `https://source.example.com/${'a'.repeat(40)}/LICENSE`,
    urlPrefix: `https://source.example.com/${'a'.repeat(40)}/_data/chains/eip155-` },
});
function manifest() {
  const pins = policy();
  return { schemaVersion: 1, revision: 'synthetic_registry_revision',
    generatedAt: new Date(Date.now()).toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(),
    origin: 'arkiv-query', evidence: 'OBSERVED_LIVE', endpoints: bindings().map((binding, index) => ({
      endpointId: binding.endpointId, chainId: '10', chainName: 'Synthetic public network',
      rpcUrl: binding.rpcUrl, publisher: { creator: PUBLISHER, owner: PUBLISHER },
      entityKey: `0x${String(index + 3).repeat(64)}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      source: { url: `${pins.source.urlPrefix}10.json`, revision: pins.source.revision,
        snapshotSha256: pins.source.snapshotSha256, licenseUrl: pins.source.licenseUrl },
    })) };
}
const request = (readId = 'synthetic_useful_read') => ({ readId, method: 'eth_blockNumber', params: [], callsite: 'providers.test.useful' });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const controllers = [];
async function until(predicate) {
  for (let step = 0; step < 80; step++) { if (predicate()) return; await Promise.resolve(); }
  throw new Error('Synthetic port was not reached.');
}
function harness(overrides = {}) {
  const channels = [], events = [], sends = [], loads = [];
  const pins = policy(), routes = bindings();
  let currentEpoch = 1;
  let loaded = manifest();
  const options = {
    chainId: '10', bindings: routes, policy: pins, clock: { now: () => new Date(Date.now()).toISOString() },
    workerEpoch: () => currentEpoch,
    registry: { async load(chainId, signal) {
      loads.push({ chainId, signal }); events.push('load');
      return overrides.load ? overrides.load(chainId, signal) : ok(loaded);
    } },
    createTransport(binding) {
      const channel = { binding, state: 'BOOTSTRAPPING', closes: 0, probes: [], reads: [] };
      channels.push(channel);
      const transport = {
        async initialize() {
          events.push(`initialize:${binding.endpointId}`);
          const result = overrides.initialize ? await overrides.initialize(channel) : ok(undefined);
          if (result.ok && channel.state !== 'CLOSED') channel.state = 'READY';
          return result;
        },
        async validateEndpoint(candidate) {
          events.push(`probe:${binding.endpointId}`); channel.probes.push(copy(candidate));
          sends.push({ kind: 'probe', binding, candidate: copy(candidate) });
          return overrides.validate ? overrides.validate(channel, candidate) : ok(copy(candidate));
        },
        async read(input) {
          events.push(`read:${binding.endpointId}`); channel.reads.push(copy(input));
          sends.push({ kind: 'read', binding, request: copy(input) });
          return overrides.read ? overrides.read(channel, input) : ok('0x1234');
        },
        getState: () => channel.state,
        close() {
          channel.closes++; channel.state = 'CLOSED'; events.push(`close:${binding.endpointId}`);
          return overrides.close?.(channel);
        },
      };
      return transport;
    },
    operationTimeoutMs: 1000,
    ...overrides.options,
  };
  const controller = createProviderController(options);
  controllers.push(controller);
  return { controller, channels, events, sends, loads, pins, routes, options,
    replaceWorker: () => { currentEpoch++; }, setManifest: (value) => { loaded = value; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(BASE); });
afterEach(() => { for (const controller of controllers.splice(0)) controller.close(); vi.useRealTimers(); });

describe('SIMULATED explicit provider admission and routing authority', () => {
  it('blocks reads before choice and performs initialization, fresh admission and a probe before useful reads', async () => {
    const h = harness();
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.channels).toHaveLength(0);
    const selected = await h.controller.select('synthetic_provider_a');
    expect(selected).toMatchObject({ ok: true, value: { endpointId: 'synthetic_provider_a', chainId: '10',
      observerEndpointId: 'synthetic_observer_a', expiresAt: '2030-01-01T00:00:30.000Z' } });
    expect(h.events).toEqual(['initialize:synthetic_provider_a', 'load', 'probe:synthetic_provider_a']);
    expect(await h.controller.read(request())).toEqual(ok('0x1234'));
    expect(h.sends.map((send) => send.kind)).toEqual(['probe', 'read']);
    expect(h.sends[1].request.endpointId).toBe(h.channels[0].probes[0].endpointId);
  });

  it('reloads and re-probes on every explicit choice, with distinct lifecycle capability IDs', async () => {
    const h = harness();
    await h.controller.select('synthetic_provider_a');
    const firstId = h.channels[0].probes[0].endpointId;
    await h.controller.select('synthetic_provider_a');
    await h.controller.select('synthetic_provider_b');
    expect(h.loads).toHaveLength(3);
    expect(h.channels.every((channel) => channel.probes.length === 1)).toBe(true);
    expect(new Set(h.channels.map((channel) => channel.probes[0].endpointId)).size).toBe(3);
    expect(h.channels[1].probes[0].endpointId).not.toBe(firstId);
    expect(h.channels[0].closes).toBe(1);
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_b');
  });

  it('blocks after provider A fails and requires an explicit B choice before useful traffic resumes', async () => {
    const h = harness({ read: async (channel) => channel.binding.endpointId.endsWith('_a') ? fail('UPSTREAM_UNAVAILABLE') : ok('0x99') });
    await h.controller.select('synthetic_provider_a');
    expect(await h.controller.read(request())).toEqual(fail('UPSTREAM_UNAVAILABLE'));
    expect(h.controller.getSelection()).toBeNull();
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.channels).toHaveLength(1);
    expect((await h.controller.select('synthetic_provider_b')).ok).toBe(true);
    expect(await h.controller.read(request())).toEqual(ok('0x99'));
    expect(h.channels[1].probes).toHaveLength(1);
  });

  it.each([
    ['forged creator', (m) => { m.endpoints[0].publisher.creator = FOREIGN; }, 'REGISTRY_UNTRUSTED'],
    ['forged provenance', (m) => { m.endpoints[0].source.snapshotSha256 = 'c'.repeat(64); }, 'REGISTRY_UNTRUSTED'],
    ['wrong chain', (m) => { m.endpoints[0].chainId = '1'; }, 'CHAIN_MISMATCH'],
    ['unsafe endpoint', (m) => { m.endpoints[0].rpcUrl = 'https://127.0.0.1/'; }, 'INVALID_INPUT'],
    ['different URL on an approved origin', (m) => { m.endpoints[0].rpcUrl += 'other'; }, 'TARGET_DENIED'],
    ['expired manifest', (m) => { m.generatedAt = new Date(BASE - 30_000).toISOString(); m.expiresAt = new Date(BASE).toISOString(); }, 'REGISTRY_EXPIRED'],
    ['untrusted fallback', (m) => { m.origin = 'fixture'; m.evidence = 'SIMULATED'; }, 'REGISTRY_UNTRUSTED'],
  ])('rejects %s before any chain probe or useful read', async (_name, mutate, code) => {
    const h = harness(); const input = manifest(); mutate(input); h.setManifest(input);
    expect(await h.controller.select('synthetic_provider_a')).toEqual(fail(code));
    expect(h.sends).toHaveLength(0);
    expect(h.controller.getSelection()).toBeNull();
  });

  it('does not admit a channel whose protected probe reports the wrong chain', async () => {
    const h = harness({ validate: async () => fail('CHAIN_MISMATCH') });
    expect(await h.controller.select('synthetic_provider_a')).toEqual(fail('CHAIN_MISMATCH'));
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.channels[0].reads).toHaveLength(0);
  });

  it('rejects a probe that substitutes the admitted endpoint capability', async () => {
    const h = harness({ validate: async (_channel, candidate) => ok({ ...candidate, rpcUrl: 'https://b.rpc.example.com/' }) });
    expect(await h.controller.select('synthetic_provider_a')).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.controller.getSelection()).toBeNull();
  });

  it.each(['endpointId', 'chainId', 'rpcUrl', 'observerEndpointId'])('prevents widgets from supplying %s authority', async (key) => {
    const h = harness(); await h.controller.select('synthetic_provider_a');
    expect(await h.controller.read({ ...request(), [key]: 'synthetic_override' })).toEqual(fail('INVALID_INPUT'));
    expect(h.channels[0].reads).toHaveLength(0);
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_a');
  });

  it('captures operator pins and returns detached summaries rather than mutable routing authority', async () => {
    const h = harness();
    h.routes[0].rpcUrl = 'https://foreign.example.com/';
    h.pins.trustedPublishers[0].creator = FOREIGN;
    h.pins.approvedOrigins.length = 0;
    const result = await h.controller.select('synthetic_provider_a');
    expect(result.ok).toBe(true);
    result.value.endpointId = 'synthetic_provider_b';
    result.value.expiresAt = '2100-01-01T00:00:00.000Z';
    const summary = h.controller.getSelection(); summary.observerEndpointId = 'synthetic_wrong_observer';
    expect(h.controller.getSelection()).toMatchObject({ endpointId: 'synthetic_provider_a', observerEndpointId: 'synthetic_observer_a',
      expiresAt: '2030-01-01T00:00:30.000Z' });
    expect(h.channels[0].binding.rpcUrl).toBe('https://a.rpc.example.com/');
  });

  it('captures nested useful-read parameters before the caller can mutate them', async () => {
    const h = harness(); await h.controller.select('synthetic_provider_a');
    const input = { ...request(), method: 'eth_call', params: [{ to: `0x${'3'.repeat(40)}`, data: '0x12345678' }, 'latest'] };
    const pending = h.controller.read(input);
    input.params[0].to = `0x${'4'.repeat(40)}`;
    input.params[0].data = '0x87654321';
    expect((await pending).ok).toBe(true);
    expect(h.channels[0].reads[0].params[0]).toEqual({ to: `0x${'3'.repeat(40)}`, data: '0x12345678' });
  });

  it.each([
    (value) => { value.bindings[1].rpcUrl = 'https://a.rpc.example.com/alias'; },
    (value) => { value.bindings[1].observerEndpointId = value.bindings[0].observerEndpointId; },
    (value) => { value.bindings[1].endpointId = value.bindings[0].endpointId; },
    (value) => { value.bindings.push({ ...value.bindings[0] }); },
    (value) => { value.operationTimeoutMs = 60_001; },
  ])('rejects unsafe or unbounded configuration before opening a channel %#', (mutate) => {
    const h = harness(); const value = { ...h.options, bindings: bindings(), policy: policy() }; mutate(value);
    expect(() => createProviderController(value)).toThrow('Invalid provider configuration.');
    expect(h.channels).toHaveLength(0);
  });
});

describe('SIMULATED cancellation, expiry and bounded work', () => {
  it.each(['initialize', 'load', 'validate'])('switching cancels an old pending %s and suppresses its late success', async (stage) => {
    const pending = deferred(); let entered = false;
    const overrides = { [stage]: async (...args) => {
      if (!entered) { entered = true; return pending.promise; }
      return stage === 'initialize' ? ok(undefined) : stage === 'load' ? ok(manifest()) : ok(copy(args[1]));
    } };
    const h = harness(overrides);
    const previous = h.controller.select('synthetic_provider_a'); await until(() => entered);
    expect((await h.controller.select('synthetic_provider_b')).ok).toBe(true);
    expect(await previous).toEqual(fail('ENDPOINT_REJECTED'));
    if (h.loads[0] && stage !== 'initialize') expect(h.loads[0].signal.aborted).toBe(true);
    pending.resolve(stage === 'initialize' ? ok(undefined) : stage === 'load' ? ok(manifest()) : ok(h.channels[0].probes[0]));
    await Promise.resolve(); await Promise.resolve();
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_b');
    expect(h.channels[0].reads).toHaveLength(0);
    expect(h.channels[0].closes).toBe(1);
  });

  it('switching rejects an already dispatched old read while preserving its attempt inventory', async () => {
    const pending = deferred(); const h = harness({ read: async (channel) => channel.binding.endpointId.endsWith('_a') ? pending.promise : ok('0x99') });
    await h.controller.select('synthetic_provider_a'); const oldRead = h.controller.read(request());
    await until(() => h.channels[0].reads.length === 1);
    await h.controller.select('synthetic_provider_b');
    expect(await oldRead).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.sends.filter((send) => send.kind === 'read')).toHaveLength(1);
    pending.resolve(ok('0x1234')); await Promise.resolve(); await Promise.resolve();
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_b');
    expect(await h.controller.read(request('synthetic_after_switch'))).toEqual(ok('0x99'));
  });

  it('worker replacement before a send invalidates readiness and permits no further old-channel reads', async () => {
    const h = harness(); await h.controller.select('synthetic_provider_a'); h.replaceWorker();
    expect(await h.controller.read(request())).toEqual(fail('WORKER_UNAVAILABLE'));
    expect(h.controller.getSelection()).toBeNull(); expect(h.channels[0].reads).toHaveLength(0);
  });

  it('a transport becoming BLOCKED during a pending read rejects its late result without an epoch change', async () => {
    const pending = deferred(); const h = harness({ read: async () => pending.promise });
    await h.controller.select('synthetic_provider_a'); const oldRead = h.controller.read(request());
    await until(() => h.channels[0].reads.length === 1); h.channels[0].state = 'BLOCKED';
    pending.resolve(ok('0x99'));
    expect(await oldRead).toEqual(fail('WORKER_UNAVAILABLE'));
    expect(h.controller.getSelection()).toBeNull();
    expect(h.channels[0].closes).toBe(1);
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.channels[0].reads).toHaveLength(1);
  });

  it.each(['invalidateWorker', 'close'])('%s rejects pending work promptly and prevents late results reviving selection', async (action) => {
    const pending = deferred(); const h = harness({ read: async () => pending.promise });
    await h.controller.select('synthetic_provider_a'); const oldRead = h.controller.read(request());
    await until(() => h.channels[0].reads.length === 1); h.controller[action]();
    expect(await oldRead).toEqual(fail('WORKER_UNAVAILABLE'));
    pending.resolve(ok('0x99')); await Promise.resolve(); await Promise.resolve();
    expect(h.controller.getSelection()).toBeNull(); expect(h.channels[0].closes).toBe(1);
  });

  it('inclusive metadata expiry aborts a pending read and does not extend to the endpoint record deadline', async () => {
    const pending = deferred(); const h = harness({ read: async () => pending.promise, options: { operationTimeoutMs: 60_000 } });
    await h.controller.select('synthetic_provider_a'); const oldRead = h.controller.read(request());
    await until(() => h.channels[0].reads.length === 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await oldRead).toEqual(fail('REGISTRY_EXPIRED'));
    expect(h.controller.getSelection()).toBeNull();
    pending.resolve(ok('0x99')); await Promise.resolve();
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.channels[0].reads).toHaveLength(1);
  });

  it('expiry during an abort-ignoring protected probe cannot install a fresh-looking selection', async () => {
    const pending = deferred(); const h = harness({ validate: async () => pending.promise, options: { operationTimeoutMs: 60_000 } });
    const oldSelect = h.controller.select('synthetic_provider_a'); await until(() => h.channels[0]?.probes.length === 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await oldSelect).toEqual(fail('REGISTRY_EXPIRED'));
    pending.resolve(ok(h.channels[0].probes[0])); await Promise.resolve();
    expect(h.controller.getSelection()).toBeNull();
  });

  it('retains raw abort-ignoring work in four bounded slots until a raw promise actually settles', async () => {
    const holds = Array.from({ length: 4 }, deferred); let count = 0;
    const h = harness({ initialize: async () => count < 4 ? holds[count++].promise : ok(undefined) });
    for (let index = 0; index < 4; index++) {
      const selected = h.controller.select('synthetic_provider_a');
      await until(() => count === index + 1); await vi.advanceTimersByTimeAsync(1000);
      expect(await selected).toEqual(fail('UPSTREAM_TIMEOUT'));
    }
    expect(await h.controller.select('synthetic_provider_b')).toEqual(fail('RATE_LIMITED'));
    expect(h.channels).toHaveLength(4);
    holds[0].resolve(ok(undefined)); await until(() => h.channels[0].state === 'CLOSED');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    h.setManifest(manifest());
    expect((await h.controller.select('synthetic_provider_b')).ok).toBe(true);
    expect(h.channels).toHaveLength(5);
    for (const hold of holds.slice(1)) hold.resolve(ok(undefined));
  });

  it('allows at most two simultaneous useful reads without sending a third', async () => {
    const hold = deferred(); const h = harness({ read: async () => hold.promise });
    await h.controller.select('synthetic_provider_a');
    const first = h.controller.read(request('synthetic_read_first'));
    const second = h.controller.read(request('synthetic_read_second'));
    expect(await h.controller.read(request('synthetic_read_third'))).toEqual(fail('RATE_LIMITED'));
    await until(() => h.channels[0].reads.length === 2);
    hold.resolve(ok('0x99')); expect(await first).toEqual(ok('0x99')); expect(await second).toEqual(ok('0x99'));
    expect(h.channels[0].reads).toHaveLength(2);
  });

  it('retains abort-ignoring close promises in the four-channel bound until cleanup settles', async () => {
    const cleanup = Array.from({ length: 4 }, deferred); let closures = 0;
    const h = harness({ close: () => cleanup[closures++]?.promise });
    for (let index = 0; index < 4; index++) {
      expect((await h.controller.select('synthetic_provider_a')).ok).toBe(true);
    }
    // Four channels exist: three are closing, the current one becomes the fourth
    // pending cleanup when this explicit choice revokes it.
    expect(await h.controller.select('synthetic_provider_b')).toEqual(fail('RATE_LIMITED'));
    expect(h.channels).toHaveLength(4); expect(closures).toBe(4);
    cleanup[0].resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect((await h.controller.select('synthetic_provider_b')).ok).toBe(true);
    expect(h.channels).toHaveLength(5);
    for (const hold of cleanup.slice(1)) hold.resolve();
  });

  it('factory-triggered worker invalidation cannot revive the outer selection or dispatch a probe', async () => {
    const h = harness(); const factory = h.options.createTransport;
    h.options.createTransport = (binding) => { h.controller.invalidateWorker(); return factory(binding); };
    expect(await h.controller.select('synthetic_provider_a')).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.controller.getSelection()).toBeNull(); expect(h.sends).toHaveLength(0);
    expect(h.channels[0].closes).toBe(1);
  });

  it('a reentrant factory choice wins without allowing the superseded outer choice to send', async () => {
    const h = harness(); const factory = h.options.createTransport;
    let nested;
    h.options.createTransport = (binding) => {
      if (binding.endpointId.endsWith('_a')) nested = h.controller.select('synthetic_provider_b');
      return factory(binding);
    };
    expect(await h.controller.select('synthetic_provider_a')).toEqual(fail('ENDPOINT_REJECTED'));
    expect((await nested).ok).toBe(true);
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_b');
    expect(h.sends.every((send) => send.binding.endpointId === 'synthetic_provider_b')).toBe(true);
    expect(h.channels.find((channel) => channel.binding.endpointId.endsWith('_a')).closes).toBe(1);
  });

  it('reserves construction slots before invoking a reentrant transport factory', async () => {
    const h = harness(); const factory = h.options.createTransport; const nested = [];
    h.options.createTransport = (binding) => {
      nested.push(h.controller.select('synthetic_provider_a'));
      return factory(binding);
    };
    const outer = await h.controller.select('synthetic_provider_a');
    const results = await Promise.all(nested);
    expect(outer.ok).toBe(false); expect(results.some((result) => result.error?.code === 'RATE_LIMITED')).toBe(true);
    expect(h.channels).toHaveLength(4); expect(h.sends).toHaveLength(0);
    expect(h.controller.getSelection()).toBeNull();
  });

  it('a close callback choosing B cannot let the older outer choice restore A afterward', async () => {
    let h, nested; let reenter = true;
    h = harness({ close: () => {
      if (reenter) { reenter = false; nested = h.controller.select('synthetic_provider_b'); }
    } });
    await h.controller.select('synthetic_provider_a');
    expect(await h.controller.select('synthetic_provider_a')).toEqual(fail('ENDPOINT_REJECTED'));
    expect((await nested).ok).toBe(true);
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_b');
    expect(h.channels).toHaveLength(2);
    expect(h.channels[0].probes).toHaveLength(1);
    expect(h.channels[1].probes).toHaveLength(1);
  });

  it('caps explicit choices at 128 and revokes the prior choice when that budget is exhausted', async () => {
    const h = harness();
    for (let choice = 0; choice < 128; choice++) expect((await h.controller.select('synthetic_provider_a')).ok).toBe(true);
    expect(await h.controller.select('synthetic_provider_b')).toEqual(fail('RATE_LIMITED'));
    expect(h.controller.getSelection()).toBeNull(); expect(h.channels).toHaveLength(128);
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
  });

  it.each([
    ['thrown exception', async () => { throw new Error('synthetic private upstream detail'); }, 'UPSTREAM_UNAVAILABLE'],
    ['provider error text', async () => ({ ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'synthetic private upstream detail', retryable: true } }), 'UPSTREAM_UNAVAILABLE'],
    ['invalid JSON result', async () => ok({ value: undefined }), 'RPC_RESPONSE_INVALID'],
  ])('sanitizes %s and blocks further useful reads', async (_name, read, code) => {
    const h = harness({ read }); await h.controller.select('synthetic_provider_a');
    const result = await h.controller.read(request());
    expect(result).toEqual(fail(code));
    expect(JSON.stringify(result)).not.toContain('synthetic private upstream detail');
    expect(h.controller.getSelection()).toBeNull(); expect(h.channels[0].closes).toBe(1);
  });
});

describe('SIMULATED bounded public diagnostics', () => {
  it('samples exactly two approved providers sequentially without selecting either or reusing a useful channel', async () => {
    const h = harness(); await h.controller.select('synthetic_provider_a');
    const result = await h.controller.diagnose();
    expect(result.ok).toBe(true); expect(result.value.map((entry) => entry.endpointId)).toEqual(bindings().map((entry) => entry.endpointId));
    expect(result.value.every((entry) => entry.result.ok && entry.result.value.tip === '0x1234')).toBe(true);
    expect(result.value.every((entry) => entry.checkedAt === '2030-01-01T00:00:00.000Z')).toBe(true);
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_a');
    expect(h.channels[0].reads).toHaveLength(0);
    expect(h.channels[1].closes).toBe(1); expect(h.channels[2].closes).toBe(1);
    expect(h.events.indexOf('close:synthetic_provider_a')).toBeLessThan(h.events.indexOf('initialize:synthetic_provider_b'));
    expect(h.channels.slice(1).every((channel) => channel.probes.length === 1 && channel.reads.length === 1)).toBe(true);
    expect(h.channels.slice(1).map((channel) => channel.reads[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'eth_blockNumber', params: [], callsite: 'providers.diagnostics.tip' }),
    ]));
  });

  it('keeps an unavailable provider as a failed diagnostic sample, without automatically selecting its working peer', async () => {
    const h = harness({ read: async (channel) => channel.binding.endpointId.endsWith('_a') ? fail('UPSTREAM_UNAVAILABLE') : ok('0x99') });
    const result = await h.controller.diagnose();
    expect(result.value[0].result).toEqual(fail('UPSTREAM_UNAVAILABLE'));
    expect(result.value[1].result).toEqual(ok({ chainMatch: true, tip: '0x99' }));
    expect(h.controller.getSelection()).toBeNull();
    expect(await h.controller.read(request())).toEqual(fail('ENDPOINT_REJECTED'));
  });

  it.each(['0x00', '0X1', '-1', '0x', 123, `0x1${'0'.repeat(64)}`])('rejects malformed public tip %s', async (tip) => {
    const h = harness({ read: async () => ok(tip) });
    const result = await h.controller.diagnose();
    expect(result.value.every((entry) => entry.result.error.code === 'RPC_RESPONSE_INVALID')).toBe(true);
    expect(h.controller.getSelection()).toBeNull();
  });

  it('rejects overlapping diagnostics and stops a pending run on explicit provider choice', async () => {
    const pending = deferred(); let entered = false;
    const h = harness({ read: async () => { entered = true; return pending.promise; } });
    const previous = h.controller.diagnose(); await until(() => entered);
    expect(await h.controller.diagnose()).toEqual(fail('RATE_LIMITED'));
    expect((await h.controller.select('synthetic_provider_b')).ok).toBe(true);
    expect(await previous).toEqual(fail('ENDPOINT_REJECTED'));
    pending.resolve(ok('0x99')); await Promise.resolve();
    expect(h.channels).toHaveLength(2);
    expect(h.controller.getSelection().endpointId).toBe('synthetic_provider_b');
  });

  it('stops a diagnostic run when its worker epoch changes during first-channel cleanup', async () => {
    let h;
    h = harness({ close: (channel) => { if (channel.binding.endpointId.endsWith('_a')) h.replaceWorker(); } });
    expect(await h.controller.diagnose()).toEqual(fail('WORKER_UNAVAILABLE'));
    expect(h.channels).toHaveLength(1);
    expect(h.channels[0].reads).toHaveLength(1);
    expect(h.controller.getSelection()).toBeNull();
  });

  it('caps lifetime diagnostics at eight runs and never starts background samples', async () => {
    const h = harness(); expect(h.channels).toHaveLength(0);
    for (let run = 0; run < 8; run++) expect((await h.controller.diagnose()).ok).toBe(true);
    expect(await h.controller.diagnose()).toEqual(fail('RATE_LIMITED'));
    expect(h.channels).toHaveLength(16);
    expect(h.sends).toHaveLength(32);
    expect(h.controller.getSelection()).toBeNull();
  });
});
