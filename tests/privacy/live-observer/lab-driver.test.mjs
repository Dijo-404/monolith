import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Resolve the declared public package entry, without adding a root dependency.
const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('packages/shared/package.json', root), 'utf8'));
const shared = fileURLToPath(new URL(`packages/shared/${manifest.exports['.'].import}`, root));
const server = await createServer({ configFile: false, appType: 'custom',
  server: { middlewareMode: true, watch: null }, resolve: { alias: { '@monolith/shared': shared } },
  plugins: [{ name: 'mn009-simulated-constructor',
    resolveId(id) { if (id === '@mn009/official-browser-harness') return '\0mn009-simulated-constructor'; },
    load(id) {
      if (id !== '\0mn009-simulated-constructor') return;
      return `export class AnonRpcWorker {
        #owner = 'SIMULATED-instance';
        constructor(init) { this.init = init; this.calls = []; this.ready = Promise.resolve('SIMULATED_READY');
          this.fetch = this.#fetch.bind(this); }
        async #fetch(input, init) { this.calls.push({ input, init, owner: this.#owner }); return new Response('{}'); }
        close() { this.closed = true; }
      }`;
    },
  }] });
const { captureLabConfiguration, createDirectLabDriver, createLabDriver, installLabHeaderBinding, SYNTHETIC_ADDRESS } =
  await server.ssrLoadModule(fileURLToPath(new URL('./lab-driver.ts', import.meta.url)));
afterAll(() => server.close());
afterEach(() => vi.unstubAllGlobals());

const configuration = () => ({
  target: 'https://observer.example.com/api/observer/read?endpointId=mn009_ethereum',
  runId: 'run-11111111-1111-4111-8111-111111111111',
  baselineRpcId: 'rpc-22222222-2222-4222-8222-222222222222',
  directControlRpcId: 'rpc-33333333-3333-4333-8333-333333333333',
});
const request = () => ({ jsonrpc: '2.0', id: 'core_id_1', method: 'eth_getBalance', params: [SYNTHETIC_ADDRESS, 'latest'] });
const signal = () => new AbortController().signal;
const fakeDriver = (options = {}) => {
  const calls = [];
  const base = {
    route: 'anon-nym', evidence: 'SIMULATED',
    initialize: async () => ({ ok: true, value: undefined }), close: async () => {},
    exchange: async (url, rpc) => {
      calls.push({ url, rpc });
      return { ok: true, value: { jsonrpc: '2.0', id: rpc.id, result: '0x0' } };
    }, ...options,
  };
  return { base, calls };
};

describe('MN009 synthetic lab capability and wire correlation', () => {
  it('decorates the actual constructor-installed instance fetch while preserving ready, this and close', async () => {
    const origin = 'http://127.0.0.1:4328';
    vi.stubGlobal('location', { origin });
    vi.stubGlobal('window', { parent: { location: { origin }, mn009HostConfiguration: configuration() } });
    const { AnonRpcWorker } = await server.ssrLoadModule(fileURLToPath(new URL('./harness.ts', import.meta.url)));
    const instance = new AnonRpcWorker({ evidence: 'SIMULATED' });
    await expect(instance.ready).resolves.toBe('SIMULATED_READY');
    expect(Object.hasOwn(instance, 'fetch')).toBe(true);
    const rpc = { ...request(), id: configuration().baselineRpcId };
    await instance.fetch(configuration().target, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc), credentials: 'omit', redirect: 'error' });
    expect(instance.calls).toHaveLength(1);
    expect(instance.calls[0].owner).toBe('SIMULATED-instance');
    expect(instance.calls[0].init.headers.get('x-monolith-run')).toBe(configuration().runId);
    instance.close();
    expect(instance.closed).toBe(true);
  });
  it('captures immutable exact endpoint/run configuration', () => {
    const input = configuration();
    const captured = captureLabConfiguration(input);
    input.target = 'https://attacker.example/';
    expect(captured.target).toBe(configuration().target);
    expect(Object.isFrozen(captured)).toBe(true);
  });
  it.each([
    { target: 'http://observer.example.com/api/observer/read?endpointId=mn009_ethereum' },
    { target: 'https://observer.example.com/other?endpointId=mn009_ethereum' },
    { target: 'https://observer.example.com/api/observer/read?endpointId=mn009_ethereum&url=x' },
    { runId: 'run-private-user' }, { baselineRpcId: 'rpc-sequence-1' },
    { directControlRpcId: 'rpc-sequence-2' },
    { directControlRpcId: 'rpc-22222222-2222-4222-8222-222222222222' },
  ])('rejects invalid capability %j', (change) => {
    expect(() => captureLabConfiguration({ ...configuration(), ...change })).toThrow('Invalid lab configuration.');
  });
  it('preserves original SDK this, body and options while adding only scoped run headers', async () => {
    const marker = {};
    const calls = [];
    const original = function (...args) { calls.push({ receiver: this, args }); return Promise.resolve(new Response('{}')); };
    const prototype = { fetch: original };
    const restore = installLabHeaderBinding(prototype, configuration());
    const rpc = { ...request(), id: configuration().baselineRpcId };
    await prototype.fetch.call(marker, configuration().target, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc), redirect: 'error', credentials: 'omit', signal: signal() });
    expect(calls).toHaveLength(1);
    expect(calls[0].receiver).toBe(marker);
    const init = calls[0].args[1];
    expect(init.body).toBe(JSON.stringify(rpc));
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect([...init.headers.entries()]).toEqual([
      ['content-type', 'application/json'], ['x-monolith-case', 'protected'], ['x-monolith-run', configuration().runId],
    ]);
    restore();
    expect(prototype.fetch).toBe(original);
  });
  it.each([
    { url: 'https://attacker.example.com/api/observer/read?endpointId=mn009_ethereum' },
    { headers: { 'content-type': 'application/json', authorization: 'private' } },
    { rpc: { ...request(), id: 'core_id_1' } },
    { rpc: { ...request(), id: configuration().baselineRpcId, method: 'eth_getBalance', params: ['0x1111111111111111111111111111111111111111', 'latest'] } },
  ])('rejects a host capability escape before SDK fetch %j', async (change) => {
    let calls = 0;
    const prototype = { fetch: () => { calls++; return Promise.resolve(new Response('{}')); } };
    installLabHeaderBinding(prototype, configuration());
    await expect(prototype.fetch(change.url ?? configuration().target, { method: 'POST',
      headers: change.headers ?? { 'content-type': 'application/json' },
      body: JSON.stringify(change.rpc ?? { ...request(), id: configuration().baselineRpcId }),
    })).rejects.toThrow('Lab request denied.');
    expect(calls).toBe(0);
  });
  it('records exact fresh wire ID and restores only a strictly matching envelope', async () => {
    const { base, calls } = fakeDriver();
    const lab = createLabDriver(base, configuration());
    const result = await lab.run('protected-comparison', () => lab.driver.exchange(configuration().target, request(), signal()));
    expect(result).toEqual({ ok: true, value: { jsonrpc: '2.0', id: 'core_id_1', result: '0x0' } });
    expect(calls[0].rpc.id).toMatch(/^rpc-[0-9a-f-]{36}$/);
    expect(calls[0].rpc.id).not.toBe(request().id);
    expect(lab.inventory[0].requestFingerprint).toBe('28b70527485da666aefed1d98fe8d088b2bc0878b0ef2637c49d6733d9f1df03');
    expect(lab.inventory[0].result).toBe('0x0');
    expect(JSON.stringify(lab.inventory)).not.toContain(SYNTHETIC_ADDRESS);
    const readId = 'mn009_11111111-1111-4111-8111-111111111111';
    lab.bindTrace({ bootstrap: false, method: 'eth_getBalance', readId, attempt: 1,
      route: 'anon-nym', callsite: 'mn009.protected' });
    expect(lab.inventory[0].readId).toBe(readId);
  });
  it('rejects mismatched wire IDs instead of translating a convenient response', async () => {
    const { base } = fakeDriver({ exchange: async () => ({ ok: true,
      value: { jsonrpc: '2.0', id: 'forged', result: '0x0' } }) });
    const lab = createLabDriver(base, configuration());
    const result = await lab.run('protected-comparison', () => lab.driver.exchange(configuration().target, request(), signal()));
    expect(result.ok).toBe(false);
    expect(lab.inventory[0].result).toBe(null);
  });
  it('denies requests without an enumerated operation role and direct/protected route mixups', async () => {
    const { base, calls } = fakeDriver();
    const lab = createLabDriver(base, configuration());
    expect((await lab.driver.exchange(configuration().target, request(), signal())).ok).toBe(false);
    expect((await lab.run('direct-control', () => lab.driver.exchange(configuration().target, request(), signal()))).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('reserves each operator direct wire ID exactly once', async () => {
    const { base, calls } = fakeDriver({ route: 'direct-debug' });
    const lab = createLabDriver(base, configuration());
    expect((await lab.run('direct-baseline', () => lab.driver.exchange(configuration().target, request(), signal()))).ok).toBe(true);
    lab.bindTrace({ bootstrap: false, method: 'eth_getBalance', readId: 'mn009_11111111-1111-4111-8111-111111111111',
      attempt: 1, route: 'direct-debug', callsite: 'mn009.direct' });
    expect((await lab.run('direct-baseline', () => lab.driver.exchange(configuration().target, request(), signal()))).ok).toBe(false);
    await lab.run('direct-control', () => lab.driver.exchange(configuration().target, request(), signal()));
    lab.bindTrace({ bootstrap: false, method: 'eth_getBalance', readId: 'mn009_22222222-2222-4222-8222-222222222222',
      attempt: 1, route: 'direct-debug', callsite: 'mn009.direct' });
    await lab.run('direct-control', () => lab.driver.exchange(configuration().target, request(), signal()));
    expect(calls[0].rpc.id).toBe(configuration().baselineRpcId);
    expect(calls[1].rpc.id).toBe(configuration().directControlRpcId);
    expect(new Set(calls.map(({ rpc }) => rpc.id)).size).toBe(2);
  });
  it('keeps the exact outstanding exchange until its matching trace is bound', async () => {
    const { base, calls } = fakeDriver();
    const lab = createLabDriver(base, configuration());
    const exchange = () => lab.driver.exchange(configuration().target, request(), signal());
    await lab.run('protected-comparison', exchange);
    const trace = { bootstrap: false, method: 'eth_getBalance',
      readId: 'mn009_11111111-1111-4111-8111-111111111111', attempt: 1,
      route: 'anon-nym', callsite: 'mn009.protected' };
    for (const change of [{ route: 'direct-debug' }, { callsite: 'transport.chain-probe' }, { method: 'eth_chainId' },
      { attempt: 2 }, { readId: 'private-wallet' }]) {
      lab.bindTrace({ ...trace, ...change });
      expect((await lab.run('protected-comparison', exchange)).ok).toBe(false);
      expect(lab.inventory[0].readId).toBeUndefined();
    }
    lab.bindTrace(trace);
    expect(lab.inventory[0].readId).toBe(trace.readId);
    expect((await lab.run('protected-comparison', exchange)).ok).toBe(true);
    // A replayed prior trace cannot bind the next exchange under another role.
    lab.bindTrace({ ...trace, callsite: 'transport.chain-probe', readId: 'monolith_probe_1' });
    expect(lab.inventory[1].readId).toBeUndefined();
    expect(calls).toHaveLength(2);
  });
  it('rejects concurrent role scopes and clears the scope after failure', async () => {
    const lab = createLabDriver(fakeDriver().base, configuration());
    let release;
    const held = lab.run('protected-probe', () => new Promise((resolve) => { release = resolve; }));
    await expect(lab.run('protected-comparison', async () => {})).rejects.toThrow('Concurrent lab operation denied.');
    release();
    await held;
    await expect(lab.run('protected-probe', async () => { throw new Error('synthetic'); })).rejects.toThrow('synthetic');
    expect(await lab.run('protected-probe', async () => 'reset')).toBe('reset');
  });
});

describe('MN009 explicit direct comparison boundary (SIMULATED fetch)', () => {
  const wireRequest = () => ({ ...request(), id: configuration().baselineRpcId });
  const response = (body, options = {}) => {
    const value = new Response(body, { headers: { 'content-type': 'application/json' }, ...options });
    Object.defineProperty(value, 'url', { value: configuration().target });
    return value;
  };
  it('sends only the operator run headers to the immutable observer and correlates its response', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (...args) => {
      calls.push(args);
      return response(JSON.stringify({ jsonrpc: '2.0', id: wireRequest().id, result: '0x0' }));
    });
    const driver = createDirectLabDriver(configuration());
    expect((await driver.initialize(signal())).ok).toBe(true);
    expect(await driver.exchange(configuration().target, wireRequest(), signal())).toEqual({ ok: true,
      value: { jsonrpc: '2.0', id: wireRequest().id, result: '0x0' } });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(configuration().target);
    expect(calls[0][1].headers).toEqual({ 'content-type': 'application/json',
      'x-monolith-run': configuration().runId, 'x-monolith-case': 'baseline' });
    expect(calls[0][1].credentials).toBe('omit');
    expect(calls[0][1].redirect).toBe('error');
  });
  it.each([
    { target: 'https://attacker.example.com/' },
    { rpc: { ...wireRequest(), id: 'unregistered_id' } },
    { rpc: { ...wireRequest(), params: ['0x1111111111111111111111111111111111111111', 'latest'] } },
    { rpc: { ...wireRequest(), method: 'eth_sendRawTransaction', params: ['0x00'] } },
  ])('rejects non-synthetic input before ordinary fetch %j', async (change) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const driver = createDirectLabDriver(configuration());
    expect((await driver.exchange(change.target ?? configuration().target, change.rpc ?? wireRequest(), signal())).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a mismatched envelope and sanitizes its provider error', async () => {
    vi.stubGlobal('fetch', async () => response(JSON.stringify({ jsonrpc: '2.0', id: 'different', result: '0x0' })));
    const driver = createDirectLabDriver(configuration());
    expect((await driver.exchange(configuration().target, wireRequest(), signal())).ok).toBe(false);
    vi.stubGlobal('fetch', async () => response(JSON.stringify({ jsonrpc: '2.0', id: wireRequest().id,
      error: { code: -32000, message: 'private upstream payload' } })));
    const error = await driver.exchange(configuration().target, wireRequest(), signal());
    expect(error.ok).toBe(false);
    expect(JSON.stringify(error)).not.toContain('private');
  });
  it('rejects redirected responses without authorizing a new target', async () => {
    vi.stubGlobal('fetch', async () => {
      const value = response('{}');
      Object.defineProperty(value, 'redirected', { value: true });
      return value;
    });
    const driver = createDirectLabDriver(configuration());
    expect((await driver.exchange(configuration().target, wireRequest(), signal())).ok).toBe(false);
  });
  it('cancels over-budget response bytes and never parses them', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', async () => response(body));
    const driver = createDirectLabDriver(configuration());
    expect((await driver.exchange(configuration().target, wireRequest(), signal())).ok).toBe(false);
    expect(cancelled).toBe(true);
  });
  it('closing cancels an outstanding direct request and forbids future fetches', async () => {
    let seen;
    const started = new Promise((resolve) => { seen = resolve; });
    const fetcher = vi.fn(async (_url, init) => {
      seen();
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('private cancellation detail')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const driver = createDirectLabDriver(configuration());
    const pending = driver.exchange(configuration().target, wireRequest(), signal());
    await started;
    await driver.close();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private');
    expect((await driver.exchange(configuration().target, wireRequest(), signal())).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
