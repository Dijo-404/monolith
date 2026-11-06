import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { makeError } from '@monolith/shared';
import type { ErrorCode, RegistryManifest, Result } from '@monolith/shared';
import { buildServer } from '../../src/composition/server.js';
import { registerRegistry } from '../../src/adapters/http/registry.js';

const NOW = '2030-01-01T00:00:00.000Z';
const snapshot: RegistryManifest = {
  schemaVersion: 1, revision: 'a'.repeat(40), generatedAt: NOW, expiresAt: '2030-01-01T00:00:30.000Z',
  evidence: 'SIMULATED', origin: 'arkiv-query', endpoints: [{
    endpointId: 'endpoint-synthetic-1', chainId: '1', chainName: 'Synthetic chain', rpcUrl: 'https://rpc.example.org/',
    publisher: { creator: `0x${'a'.repeat(40)}`, owner: `0x${'a'.repeat(40)}` }, entityKey: `0x${'b'.repeat(64)}`,
    expiresAt: '2030-01-01T01:00:00.000Z', source: {
      url: 'https://github.com/ethereum-lists/chains/blob/synthetic/chain.json', revision: 'a'.repeat(40),
      licenseUrl: 'https://github.com/ethereum-lists/chains/blob/synthetic/LICENSE', snapshotSha256: 'c'.repeat(64),
    },
  }],
};

describe('public registry HTTP boundary (SIMULATED)', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
  function build(query = vi.fn(async (): Promise<Result<RegistryManifest>> => ({ ok: true, value: snapshot })),
    options: Parameters<typeof buildServer>[0] = {}) {
    const server = buildServer({ nowMs: () => Date.parse(NOW), registry: { query }, ...options });
    servers.push(server);
    return { server, query };
  }

  it('mounts a disabled default as unavailable without an observer upstream', async () => {
    const server = buildServer(); servers.push(server);
    const response = await server.inject('/api/registry/chains?chainId=1');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ schemaVersion: 1, ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
  });

  it('returns one public snapshot to clients with different private and forwarding headers', async () => {
    const { server, query } = build();
    const responses = await Promise.all([
      server.inject({ url: '/api/registry/chains?chainId=1', headers: { cookie: 'private=first', authorization: 'first', 'x-forwarded-for': '127.0.0.1' } }),
      server.inject({ url: '/api/registry/chains?chainId=1', headers: { cookie: 'private=second', authorization: 'second', 'x-monolith-route': 'direct', 'x-forwarded-host': 'private.internal' } }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0]?.body).toBe(responses[1]?.body);
    expect(responses[0]?.json()).toEqual({ schemaVersion: 1, ok: true, value: snapshot });
    expect(responses[0]?.headers['cache-control']).toBe('no-store');
    expect(responses[0]?.headers['access-control-allow-origin']).toBe('*');
    expect(responses[0]?.headers['access-control-allow-credentials']).toBeUndefined();
    expect(query.mock.calls).toEqual([['1'], ['1']]);
  });

  it.each([
    '', '?chainId=', '?chainId=01', '?chainId=-1', '?chainId=0x1', '?chainId=1.0', '?chainId=1e3',
    '?chainId=1&chainId=1', '?chainId=1&wallet=private', '?wallet=private&chainId=1',
    '?chainId=1&session=private', '?chainId=1&url=https://private.internal', '?chainId=1&',
    '?%63hainId=1', '?chainId=%31', '?chainId=+1', '?chainId=1%00', '?chainId[]=1',
    `?chainId=${'1'.repeat(79)}`,
  ])('rejects noncanonical or private queries %s before querying storage', async (queryString) => {
    const { server, query } = build();
    const response = await server.inject(`/api/registry/chains${queryString}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ schemaVersion: 1, ok: false, error: makeError('INVALID_INPUT') });
    expect(query).not.toHaveBeenCalled();
    expect(response.body).not.toContain('private');
  });

  it.each(['0', '1', '9'.repeat(78)])('accepts a canonical public chain identifier %s', async (chainId) => {
    const query = vi.fn(async (): Promise<Result<RegistryManifest>> => ({ ok: true,
      value: { ...snapshot, endpoints: snapshot.endpoints.map((endpoint) => ({ ...endpoint, chainId })) } }));
    const { server } = build(query);
    expect((await server.inject(`/api/registry/chains?chainId=${chainId}`)).statusCode).toBe(200);
    expect(query).toHaveBeenCalledExactlyOnceWith(chainId);
  });

  it('rejects a structurally valid service snapshot containing another chain', async () => {
    const wrongChain = { ...snapshot.endpoints[0]!, chainId: '2', endpointId: 'endpoint-synthetic-2' };
    const query = vi.fn(async (): Promise<Result<RegistryManifest>> => ({ ok: true,
      value: { ...snapshot, endpoints: [wrongChain] } }));
    const { server } = build(query);
    const first = await server.inject('/api/registry/chains?chainId=1');
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ schemaVersion: 1, ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
    query.mockResolvedValueOnce({ ok: true, value: { ...snapshot, endpoints: [...snapshot.endpoints, wrongChain] } });
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(503);
    expect(query.mock.calls).toEqual([['1'], ['1']]);
  });

  it.each(['POST', 'PUT', 'DELETE', 'HEAD'] as const)('does not expose a registry %s operation', async (method) => {
    const { server, query } = build();
    expect((await server.inject({ method, url: '/api/registry/chains?chainId=1' })).statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['REGISTRY_UNAVAILABLE', 503], ['REGISTRY_UNTRUSTED', 403], ['REGISTRY_EXPIRED', 410],
    ['ENDPOINT_REJECTED', 403], ['TARGET_DENIED', 403], ['RATE_LIMITED', 429],
  ] as const)('projects fixed %s errors with HTTP %s', async (code, status) => {
    const query = vi.fn(async (): Promise<Result<RegistryManifest>> => ({
      ok: false, error: { code, message: 'private raw SDK https://private.internal?key=secret', retryable: false },
    }));
    const { server } = build(query);
    const response = await server.inject('/api/registry/chains?chainId=1');
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ schemaVersion: 1, ok: false, error: makeError(code) });
  });

  it('contains thrown SDK exceptions and unknown error codes', async () => {
    const query = vi.fn(async (): Promise<Result<RegistryManifest>> => { throw new Error('secret key / private IP'); });
    const { server } = build(query);
    const response = await server.inject('/api/registry/chains?chainId=1');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toMatch(/secret|private/);
    query.mockResolvedValueOnce({ ok: false, error: { code: 'ARBITRARY' as ErrorCode, message: 'secret', retryable: false } });
    expect((await server.inject('/api/registry/chains?chainId=1')).json()).toEqual({ schemaVersion: 1, ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
  });

  it('rejects extra private success fields and expired service output', async () => {
    const query = vi.fn(async (): Promise<Result<RegistryManifest>> => ({ ok: true, value: { ...snapshot, rawIP: 'private' } as RegistryManifest }));
    const { server } = build(query);
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(503);
    query.mockResolvedValueOnce({ ok: true, value: { ...snapshot, expiresAt: NOW } });
    const response = await server.inject('/api/registry/chains?chainId=1');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private');
  });

  it('does not use a prior successful snapshot after a service outage', async () => {
    const { server, query } = build();
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(200);
    query.mockResolvedValueOnce({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(503);
  });

  it('never adds a discovered endpoint to the deployment observer map', async () => {
    const upstream = { read: vi.fn() };
    const { server } = build(undefined, { upstream });
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(200);
    const response = await server.inject({ method: 'POST', url: '/api/observer/read?endpointId=endpoint-synthetic-1',
      payload: { jsonrpc: '2.0', id: 'synthetic', method: 'eth_chainId', params: [] } });
    expect(response.statusCode).toBe(403);
    expect(upstream.read).not.toHaveBeenCalled();
  });

  it('bounds the global request window without retaining client identities', async () => {
    let now = Date.parse(NOW);
    const { server, query } = build(undefined, { requestsPerMinute: 1, nowMs: () => now });
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(200);
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(429);
    now += 60_000;
    // The service still runs; its old timestamp is rejected at the HTTP boundary.
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(503);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps the concurrency slot after a timed out, unresponsive service', async () => {
    const query = vi.fn(() => new Promise<Result<RegistryManifest>>(() => {}));
    const server = Fastify({ logger: false }); servers.push(server);
    registerRegistry(server, { registry: { query }, nowMs: () => Date.parse(NOW), requestsPerMinute: 100, maxConcurrent: 1, timeoutMs: 5 });
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(503);
    expect((await server.inject('/api/registry/chains?chainId=1')).statusCode).toBe(429);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('supports only noncredentialed GET preflights', async () => {
    const { server, query } = build();
    const ok = await server.inject({ method: 'OPTIONS', url: '/api/registry/chains', headers: {
      origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': 'content-type',
    } });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    expect((await server.inject({ method: 'OPTIONS', url: '/api/registry/chains', headers: {
      'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization',
    } })).statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});
