import { describe, expect, it } from 'vitest';
import { createRegistryTransport } from '../../../apps/dashboard/src/composition/transport.ts';

// SIMULATED boundary scenarios. No network/worker/Arkiv observation is claimed.
const base = Date.parse('2030-01-01T00:00:00.000Z');
const publisher = { creator: `0x${'1'.repeat(40)}`, owner: `0x${'2'.repeat(40)}` };
const source = { revision: 'pinned-source', snapshotSha256: 'a'.repeat(64),
  licenseUrl: 'https://github.com/example/chains/blob/pinned-source/LICENSE',
  urlPrefix: 'https://github.com/example/chains/blob/pinned-source/eip155-' };
const policy = { trustedPublishers: [publisher], approvedOrigins: ['https://rpc.example.com'], source };
const ok = (value) => ({ ok: true, value });
const errors = {
  CHAIN_MISMATCH: ['The endpoint chain does not match.', false],
  REGISTRY_EXPIRED: ['The registry snapshot has expired.', false],
  REGISTRY_UNAVAILABLE: ['The registry is unavailable.', true],
  ENDPOINT_REJECTED: ['The endpoint was rejected.', false],
  UPSTREAM_TIMEOUT: ['The upstream request timed out.', true],
};
const fail = (code) => ({ ok: false, error: { code, message: errors[code][0], retryable: errors[code][1] } });
const request = () => ({ readId: 'synthetic_read_01', method: 'eth_blockNumber', params: [], callsite: 'registry.test.read' });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function manifest(chainId = '10', revision = 'registry_revision_01', offset = 0) {
  return { schemaVersion: 1, revision, generatedAt: new Date(base + offset).toISOString(),
    expiresAt: new Date(base + offset + 30_000).toISOString(), evidence: 'OBSERVED_LIVE', origin: 'arkiv-query',
    endpoints: [{ endpointId: 'synthetic_endpoint_01', chainId, chainName: 'Synthetic chain',
      rpcUrl: 'https://rpc.example.com/', publisher, entityKey: `0x${'b'.repeat(64)}`,
      expiresAt: new Date(base + 3600_000).toISOString(),
      source: { ...source, url: `${source.urlPrefix}${chainId}.json`, urlPrefix: undefined } }].map((endpoint) => {
      delete endpoint.source.urlPrefix;
      return endpoint;
    }) };
}

function harness(overrides = {}) {
  let time = base;
  const clock = { now: () => new Date(time).toISOString() };
  const events = [], traces = [], exchanges = [];
  const driver = { route: 'anon-nym', evidence: 'SIMULATED',
    async initialize() { events.push('initialize'); return ok(undefined); },
    async exchange(url, rpc, signal) {
      events.push(rpc.method); exchanges.push({ url, rpc, signal });
      return overrides.exchange ? overrides.exchange(url, rpc, signal)
        : ok({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'eth_chainId' ? '0xa' : '0x1234' });
    }, async close() { events.push('close'); } };
  const transportOptions = { driver, clock, traceSink: { emit: (trace) => traces.push(trace) },
    policy: { privacyRequired: true, allowedChains: ['10', '1'], allowedMethods: ['eth_chainId', 'eth_blockNumber'],
      allowDirectDebugControl: false, failClosed: true }, trustedPublishers: [publisher],
    approvedOrigins: policy.approvedOrigins, allowedCallsites: ['registry.test.read'],
    requestTimeoutMs: 1000,
  };
  let loaded = manifest();
  let loadFailure;
  const registry = { async load(chainId, signal) {
    events.push('load');
    if (overrides.load) return overrides.load(chainId, signal);
    return loadFailure ? fail(loadFailure) : ok(loaded);
  } };
  const session = createRegistryTransport({ transportOptions, registry, policy });
  return { session, exchanges, events, traces,
    setTime: (value) => { time = base + value; },
    setManifest: (value) => { loaded = value; },
    setFailure: (value) => { loadFailure = value; } };
}

describe('registry to protected transport composition (SIMULATED)', () => {
  it('initializes before fetching short-lived metadata and probes before useful reads', async () => {
    const h = harness();
    const selected = await h.session.select('10');
    expect(selected.ok).toBe(true);
    expect(h.events).toEqual(['initialize', 'load', 'eth_chainId']);
    expect(await h.session.read(request())).toEqual(ok('0x1234'));
    expect(h.exchanges.map(({ url }) => url)).toEqual(['https://rpc.example.com/', 'https://rpc.example.com/']);
    expect(h.traces.map((trace) => [trace.method, trace.route, trace.bootstrap])).toEqual([
      ['eth_chainId', 'anon-nym', false], ['eth_blockNumber', 'anon-nym', false],
    ]);
    expect(h.traces.every((trace) => trace.evidence === 'SIMULATED')).toBe(true);
    await h.session.close();
  });

  it('lets no read leave before selection', async () => {
    const h = harness();
    expect((await h.session.read(request())).ok).toBe(false);
    expect(h.exchanges).toHaveLength(0);
  });

  it('wrong chain response rejects the candidate before an ordinary read', async () => {
    const h = harness({ exchange: async (_url, rpc) => ok({ jsonrpc: '2.0', id: rpc.id, result: '0x1' }) });
    expect(await h.session.select('10')).toEqual(fail('CHAIN_MISMATCH'));
    expect((await h.session.read(request())).ok).toBe(false);
    expect(h.exchanges.map(({ rpc }) => rpc.method)).toEqual(['eth_chainId']);
  });

  it.each([
    ['forged creator', (m) => { m.endpoints[0].publisher = { ...publisher, creator: `0x${'f'.repeat(40)}` }; }],
    ['forged owner', (m) => { m.endpoints[0].publisher = { ...publisher, owner: `0x${'f'.repeat(40)}` }; }],
    ['forged provenance', (m) => { m.endpoints[0].source.snapshotSha256 = '0'.repeat(64); }],
    ['unapproved origin', (m) => { m.endpoints[0].rpcUrl = 'https://foreign.example.com/'; }],
    ['wrong chain metadata', (m) => { m.endpoints[0].chainId = '1'; }],
    ['fixture fallback', (m) => { m.origin = 'fixture'; m.evidence = 'SIMULATED'; }],
    ['expired snapshot', (m) => { m.generatedAt = new Date(base - 30_000).toISOString(); m.expiresAt = new Date(base).toISOString(); }],
  ])('%s is rejected before any endpoint probe/read', async (_name, mutate) => {
    const h = harness(); const value = manifest(); mutate(value); h.setManifest(value);
    expect((await h.session.select('10')).ok).toBe(false);
    expect((await h.session.read(request())).ok).toBe(false);
    expect(h.exchanges).toHaveLength(0);
  });

  it('caps actual transport readiness at manifest expiry even when endpoint deadline is hours away', async () => {
    const h = harness(); await h.session.select('10'); h.setTime(30_000);
    expect(await h.session.read(request())).toEqual(fail('REGISTRY_EXPIRED'));
    expect(h.session.getSelection()).toBeNull(); expect(h.session.getState()).toBe('BLOCKED');
    expect(h.exchanges).toHaveLength(1);
  });

  it('expiry while probing cannot install a fresh-looking selection', async () => {
    const h = harness({ exchange: async (_url, rpc) => {
      h.setTime(30_000); return ok({ jsonrpc: '2.0', id: rpc.id, result: '0xa' });
    } });
    expect(await h.session.select('10')).toEqual(fail('REGISTRY_EXPIRED'));
    expect(h.session.getSelection()).toBeNull();
  });

  it('expiry during a useful read rejects a late success', async () => {
    const h = harness({ exchange: async (_url, rpc) => {
      if (rpc.method === 'eth_blockNumber') h.setTime(30_000);
      return ok({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'eth_chainId' ? '0xa' : '0x42' });
    } });
    await h.session.select('10');
    expect(await h.session.read(request())).toEqual(fail('REGISTRY_EXPIRED'));
    expect(h.session.getSelection()).toBeNull();
  });

  it('cannot retry after manifest expiry and never makes a direct fallback', async () => {
    const h = harness({ exchange: async (_url, rpc) => {
      if (rpc.method === 'eth_blockNumber') { h.setTime(30_000); return fail('UPSTREAM_TIMEOUT'); }
      return ok({ jsonrpc: '2.0', id: rpc.id, result: '0xa' });
    } });
    await h.session.select('10');
    expect((await h.session.read(request())).ok).toBe(false);
    expect(h.exchanges.map(({ rpc }) => rpc.method)).toEqual(['eth_chainId', 'eth_blockNumber']);
    expect(h.traces.every((trace) => ['anon-nym', 'blocked'].includes(trace.route))).toBe(true);
  });

  it('refresh outage revokes a prior successful selection, with no old manifest fallback', async () => {
    const h = harness(); await h.session.select('10'); h.setFailure('REGISTRY_UNAVAILABLE');
    expect(await h.session.select('10')).toEqual(fail('REGISTRY_UNAVAILABLE'));
    expect(h.session.getSelection()).toBeNull();
    expect((await h.session.read(request())).ok).toBe(false);
    expect(h.exchanges).toHaveLength(1);
  });

  it('new selection supersedes an outstanding metadata query and aborts its signal', async () => {
    const first = deferred(); let calls = 0, firstSignal;
    const h = harness({ load: async (_chain, signal) => {
      calls++; if (calls === 1) { firstSignal = signal; return first.promise; }
      return ok(manifest('10', 'registry_revision_02'));
    } });
    const previous = h.session.select('10');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // Wait for the bounded transport initialization continuation to reach the registry port.
    while (!firstSignal) await Promise.resolve();
    const latest = await h.session.select('10');
    first.resolve(ok(manifest()));
    expect((await previous).ok).toBe(false);
    expect(firstSignal.aborted).toBe(true); expect(latest.ok).toBe(true);
    expect(h.session.getSelection().manifest.revision).toBe('registry_revision_02');
    expect(h.exchanges).toHaveLength(1);
  });

  it('a new manifest revision forces a fresh probe even with unchanged endpoint and deadline', async () => {
    const h = harness(); await h.session.select('10');
    h.setManifest(manifest('10', 'registry_revision_02'));
    expect((await h.session.select('10')).ok).toBe(true);
    expect(h.exchanges).toHaveLength(2);
  });

  it('new selection suppresses an old in-flight read result', async () => {
    const pending = deferred(); let reading;
    const h = harness({ exchange: async (_url, rpc) => {
      if (rpc.method === 'eth_blockNumber') { reading = rpc; return pending.promise; }
      return ok({ jsonrpc: '2.0', id: rpc.id, result: '0xa' });
    } });
    await h.session.select('10'); const oldRead = h.session.read(request());
    while (!reading) await Promise.resolve();
    h.setFailure('REGISTRY_UNAVAILABLE'); await h.session.select('10');
    pending.resolve(ok({ jsonrpc: '2.0', id: reading.id, result: '0x42' }));
    expect(await oldRead).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.session.getSelection()).toBeNull();
  });

  it.each([true, false])('does not retry an obsolete read after refresh (success=%s)', async (refreshSuccess) => {
    const pending = deferred(); let reading;
    const h = harness({ exchange: async (_url, rpc) => {
      if (rpc.method === 'eth_blockNumber') { reading = rpc; return pending.promise; }
      return ok({ jsonrpc: '2.0', id: rpc.id, result: '0xa' });
    } });
    await h.session.select('10'); const oldRead = h.session.read(request());
    while (!reading) await Promise.resolve();
    if (refreshSuccess) h.setManifest(manifest('10', 'registry_revision_02'));
    else h.setFailure('REGISTRY_UNAVAILABLE');
    await h.session.select('10'); pending.resolve(fail('UPSTREAM_TIMEOUT'));
    expect(await oldRead).toEqual(fail('ENDPOINT_REJECTED'));
    expect(h.exchanges.filter(({ rpc }) => rpc.method === 'eth_blockNumber')).toHaveLength(1);
  });

  it('bounds accumulated endpoint validation capabilities for long-lived sessions', async () => {
    const h = harness();
    for (let count = 0; count < 128; count++) expect((await h.session.select('10')).ok).toBe(true);
    expect((await h.session.select('10')).error.code).toBe('RATE_LIMITED');
    expect(h.session.getSelection()).toBeNull();
    expect(h.exchanges).toHaveLength(128);
    expect((await h.session.read(request())).ok).toBe(false);
    await h.session.close();
  });

  it('close during probe cancels the request and repeated close is safe', async () => {
    const pending = deferred(); let probing;
    const h = harness({ exchange: async (_url, rpc, signal) => { probing = { rpc, signal }; return pending.promise; } });
    const selecting = h.session.select('10'); while (!probing) await Promise.resolve();
    await h.session.close(); await h.session.close();
    expect(probing.signal.aborted).toBe(true);
    pending.resolve(ok({ jsonrpc: '2.0', id: probing.rpc.id, result: '0xa' }));
    expect((await selecting).ok).toBe(false); expect(h.session.getState()).toBe('CLOSED');
    expect(h.session.getSelection()).toBeNull();
    expect((await h.session.select('10')).ok).toBe(false);
    expect(h.events.filter((event) => event === 'close')).toHaveLength(1);
  });

  it('returns copied selection data and never accepts widget-selected endpoint/chain', async () => {
    const h = harness(); const value = await h.session.select('10');
    value.value.endpoint.rpcUrl = 'https://foreign.example.com';
    h.session.getSelection().manifest.endpoints[0].rpcUrl = 'https://foreign.example.com';
    expect(h.session.getSelection().endpoint.rpcUrl).toBe('https://rpc.example.com/');
    expect((await h.session.read({ ...request(), endpointId: 'foreign_endpoint', chainId: '1' })).ok).toBe(false);
    expect(h.exchanges).toHaveLength(1);
    expect(await h.session.read(request())).toEqual(ok('0x1234'));
  });
});
