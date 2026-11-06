import { afterEach, describe, expect, it, vi } from 'vitest';
import { admitRegistryManifest, createRegistryClient } from '../../../apps/dashboard/src/composition/registry.ts';

// All network/storage shapes in this file are SIMULATED adversarial test inputs.
const NOW = '2030-01-01T00:00:00.000Z';
const PUBLISHER = `0x${'1'.repeat(40)}`;
const FOREIGN = `0x${'2'.repeat(40)}`;
const CHAIN = '10';
const URL = 'https://registry.monolith.example/api/registry/chains';
const copy = (value) => structuredClone(value);
function policy() {
  return {
    trustedPublishers: [{ creator: PUBLISHER, owner: PUBLISHER }],
    approvedOrigins: ['https://rpc.monolith.example'],
    source: { revision: 'a'.repeat(40), snapshotSha256: 'b'.repeat(64),
      licenseUrl: `https://source.monolith.example/${'a'.repeat(40)}/LICENSE`,
      urlPrefix: `https://source.monolith.example/${'a'.repeat(40)}/_data/chains/eip155-` },
  };
}
function manifest() {
  const pins = policy();
  return {
    schemaVersion: 1, revision: 'registry_simulated_revision', generatedAt: NOW,
    expiresAt: '2030-01-01T00:00:30.000Z', evidence: 'OBSERVED_LIVE', origin: 'arkiv-query',
    endpoints: [{ endpointId: 'rpc_simulated_endpoint', chainId: CHAIN, chainName: 'Simulated public network',
      rpcUrl: 'https://rpc.monolith.example/', publisher: { creator: PUBLISHER, owner: PUBLISHER },
      entityKey: `0x${'c'.repeat(64)}`, expiresAt: '2030-01-01T01:00:00.000Z',
      source: { url: `${pins.source.urlPrefix}${CHAIN}.json`, revision: pins.source.revision,
        licenseUrl: pins.source.licenseUrl, snapshotSha256: pins.source.snapshotSha256 } }],
  };
}
const success = (value = manifest()) => ({ schemaVersion: 1, ok: true, value });
const response = (body = success(), status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const client = (options = {}) => createRegistryClient({ url: URL, policy: policy(), clock: { now: () => NOW },
  fetch: vi.fn(async () => response()), ...options });
const rejected = (result, code) => {
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(result)).not.toContain('synthetic private upstream detail');
};
const expiredError = { code: 'REGISTRY_EXPIRED', message: 'The registry snapshot has expired.', retryable: false };
const unavailableError = { code: 'REGISTRY_UNAVAILABLE', message: 'The registry is unavailable.', retryable: true };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('SIMULATED registry manifest trust admission', () => {
  it('admits independently pinned current public discovery and returns a detached parsed DTO', () => {
    const input = manifest();
    const result = admitRegistryManifest(input, CHAIN, policy(), NOW);
    expect(result).toEqual({ ok: true, value: input });
    input.endpoints[0].rpcUrl = 'https://foreign.monolith.example';
    expect(result.value.endpoints[0].rpcUrl).toBe('https://rpc.monolith.example/');
  });

  it.each([
    ['other creator', (m) => { m.endpoints[0].publisher.creator = FOREIGN; }, 'REGISTRY_UNTRUSTED'],
    ['other owner', (m) => { m.endpoints[0].publisher.owner = FOREIGN; }, 'REGISTRY_UNTRUSTED'],
    ['other creator and owner', (m) => { m.endpoints[0].publisher = { creator: FOREIGN, owner: FOREIGN }; }, 'REGISTRY_UNTRUSTED'],
    ['other source revision', (m) => { m.endpoints[0].source.revision = 'd'.repeat(40); }, 'REGISTRY_UNTRUSTED'],
    ['other catalog hash', (m) => { m.endpoints[0].source.snapshotSha256 = 'e'.repeat(64); }, 'REGISTRY_UNTRUSTED'],
    ['other license', (m) => { m.endpoints[0].source.licenseUrl = 'https://source.monolith.example/changed/LICENSE'; }, 'REGISTRY_UNTRUSTED'],
    ['other chain source', (m) => { m.endpoints[0].source.url = `${policy().source.urlPrefix}1.json`; }, 'REGISTRY_UNTRUSTED'],
    ['unapproved HTTPS origin', (m) => { m.endpoints[0].rpcUrl = 'https://foreign.monolith.example/'; }, 'TARGET_DENIED'],
    ['wrong chain', (m) => { m.endpoints[0].chainId = '1'; }, 'CHAIN_MISMATCH'],
    ['empty discovery', (m) => { m.endpoints = []; }, 'REGISTRY_UNTRUSTED'],
    ['simulated metadata', (m) => { m.evidence = 'SIMULATED'; }, 'REGISTRY_UNTRUSTED'],
    ['blocked metadata', (m) => { m.evidence = 'BLOCKED'; }, 'REGISTRY_UNTRUSTED'],
    ['fixture origin', (m) => { m.origin = 'fixture'; m.evidence = 'SIMULATED'; }, 'REGISTRY_UNTRUSTED'],
    ['unsigned cache origin', (m) => { m.origin = 'cache'; }, 'INVALID_INPUT'],
    ['extra raw field', (m) => { m.rawIp = 'synthetic-private-value'; }, 'INVALID_INPUT'],
    ['credential-bearing endpoint', (m) => { m.endpoints[0].rpcUrl = 'https://user:password@rpc.monolith.example/'; }, 'INVALID_INPUT'],
    ['private IPv4 literal', (m) => { m.endpoints[0].rpcUrl = 'https://127.0.0.1/'; }, 'INVALID_INPUT'],
    ['normalized numeric IP alias', (m) => { m.endpoints[0].rpcUrl = 'https://0x7f000001/'; }, 'INVALID_INPUT'],
    ['local hostname', (m) => { m.endpoints[0].rpcUrl = 'https://rpc.internal/'; }, 'INVALID_INPUT'],
    ['future generation', (m) => { m.generatedAt = '2030-01-01T00:00:01.000Z'; }, 'INVALID_INPUT'],
    ['excessive manifest lifetime', (m) => { m.expiresAt = '2030-01-01T00:00:30.001Z'; }, 'REGISTRY_EXPIRED'],
    ['manifest outlives endpoint', (m) => { m.endpoints[0].expiresAt = '2030-01-01T00:00:29.999Z'; }, 'REGISTRY_EXPIRED'],
    ['unknown version', (m) => { m.schemaVersion = 2; }, 'UNSUPPORTED_VERSION'],
  ])('rejects %s', (_name, mutate, code) => {
    const input = manifest(); mutate(input);
    rejected(admitRegistryManifest(input, CHAIN, policy(), NOW), code);
  });

  it('rejects one forged entry rather than silently selecting a valid member of its manifest', () => {
    const input = manifest();
    input.endpoints.push({ ...copy(input.endpoints[0]), endpointId: 'rpc_simulated_foreign', publisher: { creator: FOREIGN, owner: FOREIGN } });
    rejected(admitRegistryManifest(input, CHAIN, policy(), NOW), 'REGISTRY_UNTRUSTED');
  });

  it('does not mix creator and owner from two separately trusted publisher pairs', () => {
    const pins = policy(); pins.trustedPublishers.push({ creator: FOREIGN, owner: FOREIGN });
    const input = manifest(); input.endpoints[0].publisher.owner = FOREIGN;
    rejected(admitRegistryManifest(input, CHAIN, pins, NOW), 'REGISTRY_UNTRUSTED');
  });

  it('uses inclusive expiry and rechecks elapsed time on the same previously admitted DTO', () => {
    const input = manifest();
    expect(admitRegistryManifest(input, CHAIN, policy(), '2030-01-01T00:00:29.999Z').ok).toBe(true);
    rejected(admitRegistryManifest(input, CHAIN, policy(), '2030-01-01T00:00:30.000Z'), 'REGISTRY_EXPIRED');
  });

  it.each(['0xA', '01', '-1', '10&wallet=synthetic'])('rejects noncanonical public chain %s', (chainId) => {
    rejected(admitRegistryManifest(manifest(), chainId, policy(), NOW), 'INVALID_INPUT');
  });

  it.each([
    (p) => { p.trustedPublishers = []; },
    (p) => { p.approvedOrigins = []; },
    (p) => { p.approvedOrigins = ['https://rpc.monolith.example/path']; },
    (p) => { p.trustedPublishers[0].creator = 'invalid'; },
    (p) => { p.source.snapshotSha256 = 'invalid'; },
    (p) => { p.source.urlPrefix += '?private=synthetic'; },
    (p) => { p.maxManifestAgeMs = 0; },
    (p) => { p.maxManifestAgeMs = 300_001; },
  ])('fails closed on invalid independent configuration %#', (mutate) => {
    const pins = policy(); mutate(pins);
    rejected(admitRegistryManifest(manifest(), CHAIN, pins, NOW), 'POLICY_DENIED');
  });
});

describe('SIMULATED public HTTP registry client', () => {
  it('sends only canonical public chain data without credentials, referrer, redirect or cache reuse', async () => {
    const fetcher = vi.fn(async () => response());
    const result = await client({ fetch: fetcher }).load(CHAIN);
    expect(result.ok).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${URL}?chainId=10`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
      cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' } });
    expect(Object.keys(init.headers)).toEqual(['accept']);
    expect('body' in init).toBe(false);
  });

  it('accepts a relative same-origin API URL, including loopback development', async () => {
    vi.stubGlobal('location', new globalThis.URL('http://127.0.0.1:4321/lab'));
    const fetcher = vi.fn(async () => response());
    expect((await client({ url: '/api/registry/chains', fetch: fetcher }).load(CHAIN)).ok).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:4321/api/registry/chains?chainId=10');
  });

  it.each([
    'http://registry.monolith.example/api/registry/chains',
    'https://user:secret@registry.monolith.example/api/registry/chains',
    'https://registry.monolith.example/api/registry/chains?wallet=synthetic',
    'https://registry.monolith.example/api/registry/chains#fragment',
    'https://registry.monolith.example/other/path',
    'https://127.0.0.1/api/registry/chains',
    'https://registry.internal/api/registry/chains',
    '//registry.monolith.example/api/registry/chains',
  ])('rejects prohibited API URL before network: %s', async (url) => {
    const fetcher = vi.fn();
    rejected(await client({ url, fetch: fetcher }).load(CHAIN), 'POLICY_DENIED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('captures original pins even when the caller mutates its source, hosts and publishers', async () => {
    const pins = policy();
    const fetcher = vi.fn(async () => response());
    const reader = client({ policy: pins, fetch: fetcher });
    pins.trustedPublishers[0].owner = FOREIGN;
    pins.approvedOrigins[0] = 'https://foreign.monolith.example';
    pins.source.snapshotSha256 = 'e'.repeat(64);
    expect((await reader.load(CHAIN)).ok).toBe(true);
    const forged = manifest(); forged.endpoints[0].publisher.owner = FOREIGN;
    fetcher.mockResolvedValueOnce(response(success(forged)));
    rejected(await reader.load(CHAIN), 'REGISTRY_UNTRUSTED');
  });

  it('does not reuse an earlier success after actual HTTP unavailability', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('synthetic private upstream detail'));
    const reader = client({ fetch: fetcher });
    expect((await reader.load(CHAIN)).ok).toBe(true);
    rejected(await reader.load(CHAIN), 'REGISTRY_UNAVAILABLE');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [success(), 503, 'REGISTRY_UNAVAILABLE'],
    [{ schemaVersion: 1, ok: false, error: expiredError }, 200, 'REGISTRY_UNAVAILABLE'],
    [{ schemaVersion: 1, ok: false, error: expiredError }, 503, 'REGISTRY_EXPIRED'],
    [{ schemaVersion: 2, ok: true, value: manifest() }, 200, 'UNSUPPORTED_VERSION'],
    [{ ...success(), rawIp: 'synthetic-private-value' }, 200, 'INVALID_INPUT'],
    [{ schemaVersion: 1, ok: false, error: { ...unavailableError, message: 'synthetic raw provider detail' } }, 503, 'INVALID_INPUT'],
  ])('enforces HTTP result coherence and strict contracts %#', async (body, status, code) => {
    rejected(await client({ fetch: async () => response(body, status) }).load(CHAIN), code);
  });

  it('preserves unsupported nested manifest version', async () => {
    const input = manifest(); input.schemaVersion = 2;
    rejected(await client({ fetch: async () => response(success(input)) }).load(CHAIN), 'UNSUPPORTED_VERSION');
  });

  it.each([
    () => response(success(), 302),
    () => response(success(), 200, { 'content-type': 'text/html' }),
    () => new Response('{invalid json', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([255, 254]), { headers: { 'content-type': 'application/json' } }),
    () => { const r = response(); Object.defineProperty(r, 'redirected', { value: true }); return r; },
    () => { const r = response(); Object.defineProperty(r, 'url', { value: 'https://foreign.monolith.example/api/registry/chains?chainId=10' }); return r; },
  ])('rejects redirect, MIME, UTF-8 or JSON violations %#', async (factory) => {
    rejected(await client({ fetch: async () => factory() }).load(CHAIN), 'REGISTRY_UNAVAILABLE');
  });

  it('rejects oversized declared and streaming bodies, cancelling the stream', async () => {
    rejected(await client({ maxResponseBytes: 32, fetch: async () => response(success(), 200, { 'content-length': '10000' }) }).load(CHAIN), 'REGISTRY_UNAVAILABLE');
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(33)); }, cancel() { cancelled = true; } });
    rejected(await client({ maxResponseBytes: 32, fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) }).load(CHAIN), 'REGISTRY_UNAVAILABLE');
    expect(cancelled).toBe(true);
  });

  it('bounds a stalled response stream and aborts it', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const pending = client({ timeoutMs: 10, fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) }).load(CHAIN);
    await vi.advanceTimersByTimeAsync(11);
    rejected(await pending, 'UPSTREAM_TIMEOUT');
    expect(cancelled).toBe(true);
  });

  it('retains slots for abort-ignoring fetches so repeated timeouts cannot create unbounded work', async () => {
    vi.useFakeTimers();
    const release = [];
    const fetcher = vi.fn(() => new Promise((resolve) => release.push(resolve)));
    const reader = client({ fetch: fetcher, timeoutMs: 10 });
    const pending = Array.from({ length: 8 }, () => reader.load(CHAIN));
    await vi.advanceTimersByTimeAsync(11);
    for (const result of await Promise.all(pending)) rejected(result, 'UPSTREAM_TIMEOUT');
    rejected(await reader.load(CHAIN), 'RATE_LIMITED');
    expect(fetcher).toHaveBeenCalledTimes(8);
    for (const resolve of release) resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockResolvedValueOnce(response());
    expect((await reader.load(CHAIN)).ok).toBe(true);
  });

  it('propagates cancellation without making a request when already aborted', async () => {
    const fetcher = vi.fn();
    const controller = new AbortController(); controller.abort();
    rejected(await client({ fetch: fetcher }).load(CHAIN, controller.signal), 'REGISTRY_UNAVAILABLE');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds caller-cancelled work even when fetch ignores the signal', async () => {
    const controller = new AbortController();
    let release;
    const fetcher = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const pending = client({ fetch: fetcher }).load(CHAIN, controller.signal);
    controller.abort();
    rejected(await pending, 'REGISTRY_UNAVAILABLE');
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    release(response());
  });

  it('rechecks the clock after response delivery instead of accepting an expired in-flight manifest', async () => {
    const clock = { now: () => '2030-01-01T00:00:30.000Z' };
    rejected(await client({ clock }).load(CHAIN), 'REGISTRY_EXPIRED');
  });
});
