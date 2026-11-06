import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeError, type JsonRpcRequest, type JsonRpcSuccess, type Result } from '@monolith/shared';
import { buildServer, type ObserverServerOptions } from '../../src/composition/server.js';
import { normalizePeer, resolvePeer } from '../../src/adapters/http/peer.js';
import type { ObserverConfig, ObserverEndpoint } from '../../src/domain/ports.js';

const runId = 'run-11111111-1111-4111-8111-111111111111';
const baseline = 'rpc-11111111-1111-4111-8111-111111111111';
const comparison = 'rpc-22222222-2222-4222-8222-222222222222';
const target = '0x1111111111111111111111111111111111111111';
const endpoint: ObserverEndpoint = { endpointId: 'synthetic-mainnet', chainId: '1', rpcUrl: 'https://rpc.example.invalid/',
  calls: [{ to: target, selector: '0x18160ddd', dataBytes: 4 }] };
const request = (method = 'eth_chainId', params: unknown[] = [], id = baseline) => ({ jsonrpc: '2.0', id, method, params });
const url = '/api/observer/read?endpointId=synthetic-mainnet';
const servers: ReturnType<typeof buildServer>[] = [];

function setup(options: ObserverServerOptions = {}, mode: ObserverConfig['sourcePolicy']['mode'] = 'direct') {
  const read = vi.fn(async (_endpoint: ObserverEndpoint, rpc: JsonRpcRequest): Promise<Result<JsonRpcSuccess>> => ({
    ok: true, value: { jsonrpc: '2.0', id: rpc.id, result: '0x1' },
  }));
  const server = buildServer({
    config: { endpoints: [endpoint], sourcePolicy: { mode, trustedProxies: mode === 'trusted-proxy' ? ['127.0.0.1'] : [] },
      labRuns: [{ runId, baselineRpcId: baseline }] },
    upstream: { read }, ...options,
  });
  servers.push(server);
  return { server, read };
}

afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

describe('controlled HTTP observer (offline, synthetic upstream)', () => {
  it.each([
    ['eth_chainId', []], ['eth_blockNumber', []], ['eth_getBalance', [target, 'latest']],
    ['eth_call', [{ to: target, data: '0x18160ddd' }, 'safe']],
    ['eth_getTransactionReceipt', [`0x${'11'.repeat(32)}`]],
  ])('preserves a single %s envelope and ID', async (method, params) => {
    const { server, read } = setup();
    const response = await server.inject({ method: 'POST', url, payload: request(method, params) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ jsonrpc: '2.0', id: baseline, result: '0x1' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([
    request('eth_sendRawTransaction', ['0x12']), [request()], { jsonrpc: '2.0', method: 'eth_chainId', params: [] },
    { ...request(), params: [1] }, { ...request(), jsonrpc: '1.0' }, { ...request(), url: 'http://localhost' },
    request('eth_getBalance', [target, 'pending']),
    request('eth_call', [{ to: target, data: '0x18160ddd00' }, 'latest']),
    request('eth_call', [{ to: target, data: '0xa9059cbb' }, 'latest']),
    request('eth_call', [{ to: `0x${'22'.repeat(20)}`, data: '0x18160ddd' }, 'latest']),
  ])('rejects unsafe RPC or call policy before forwarding: %j', async (payload) => {
    const { server, read } = setup();
    const response = await server.inject({ method: 'POST', url, payload });
    expect([400, 403]).toContain(response.statusCode);
    expect(response.json()).toHaveProperty('error');
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['', '?endpointId=synthetic-mainnet&url=http://127.0.0.1',
    '?endpointId=synthetic-mainnet&endpointId=synthetic-mainnet', '?endpointId=https%3A%2F%2Fevil.invalid',
    '?endpointId=unknown-endpoint'])('rejects caller destination expansion: %s', async (query) => {
    const { server, read } = setup();
    const response = await server.inject({ method: 'POST', url: `/api/observer/read${query}`, payload: request() });
    expect([400, 403]).toContain(response.statusCode);
    expect(read).not.toHaveBeenCalled();
  });

  it('exposes only coarse synthetic diagnostics and ignores forged route/source headers in direct mode', async () => {
    const { server } = setup();
    const invoke = (id: string, peer: string, headers = {}) => server.inject({ method: 'POST', url,
      remoteAddress: peer, headers: { 'x-monolith-run': runId, ...headers }, payload: request('eth_getBalance', [target, 'latest'], id) });
    await invoke(baseline, '192.0.2.10');
    await invoke(comparison, '192.0.2.10', { 'x-forwarded-for': '192.0.2.11', 'x-monolith-route': 'anon-nym' });
    await invoke(comparison, '192.0.2.11');
    const response = await server.inject({ method: 'GET', url: `/api/observer/runs/${runId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().value.observations.map((entry: { sourceClass: string }) => entry.sourceClass))
      .toEqual(['baseline', 'baseline', 'different-from-baseline']);
    expect(response.json().value.observations[0].addressPresent).toBe(true);
    for (const secret of ['192.0.2.10', '192.0.2.11', target, 'params', 'result', 'anon-nym']) expect(response.body).not.toContain(secret);
  });

  it('does not infer a baseline from a protected-first case label or unknown topology', async () => {
    const { server } = setup({}, 'unknown');
    for (const id of [comparison, baseline, comparison]) await server.inject({ method: 'POST', url,
      headers: { 'x-monolith-run': runId, 'x-monolith-case': 'baseline' }, payload: request('eth_chainId', [], id) });
    const response = await server.inject({ method: 'GET', url: `/api/observer/runs/${runId}` });
    expect(response.json().value.observations.map((entry: { sourceClass: string }) => entry.sourceClass)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('trusts an overwritten single source only behind an explicitly configured edge', async () => {
    const { server } = setup({}, 'trusted-proxy');
    for (const [id, peer, forwarded] of [[baseline, '127.0.0.1', '192.0.2.10'],
      [comparison, '127.0.0.1', '192.0.2.11'], [comparison, '192.0.2.33', '192.0.2.11'],
      [comparison, '127.0.0.1', '192.0.2.10, 192.0.2.11']] as const) {
      await server.inject({ method: 'POST', url, remoteAddress: peer, headers: {
        'x-monolith-run': runId, 'x-forwarded-for': forwarded,
      }, payload: request('eth_chainId', [], id) });
    }
    const response = await server.inject({ method: 'GET', url: `/api/observer/runs/${runId}` });
    expect(response.json().value.observations.map((entry: { sourceClass: string }) => entry.sourceClass))
      .toEqual(['baseline', 'different-from-baseline', 'unknown', 'unknown']);
  });

  it('rejects private-text RPC IDs in opt-in diagnostics while preserving ordinary ID echo', async () => {
    const { server, read } = setup();
    const id = 'private-order-sensitive-sentinel';
    const denied = await server.inject({ method: 'POST', url, payload: request('eth_chainId', [], id), headers: { 'x-monolith-run': runId } });
    expect(denied.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect((await server.inject({ method: 'POST', url, payload: request('eth_chainId', [], id) })).json().id).toBe(id);
    const diagnostics = await server.inject({ method: 'GET', url: `/api/observer/runs/${runId}` });
    expect(diagnostics.body).not.toContain(id);
    expect(diagnostics.json().value.observations).toEqual([]);
  });

  it('expires diagnostics exactly five minutes after registration without renewal', async () => {
    let now = 1_800_000_000_000;
    const { server } = setup({ nowMs: () => now });
    now += 299_999;
    expect((await server.inject({ method: 'GET', url: `/api/observer/runs/${runId}` })).statusCode).toBe(200);
    now++;
    const response = await server.inject({ method: 'GET', url: `/api/observer/runs/${runId}` });
    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('EVIDENCE_EXPIRED');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('uses safe fixed error bodies for malformed JSON, oversize, unknown routes and upstream exceptions', async () => {
    const { server } = setup({ upstream: { read: async () => { throw new Error('private-upstream-sensitive-sentinel'); } } });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cases = [
      { method: 'POST' as const, url, payload: '{"private-sensitive-sentinel":', headers: { 'content-type': 'application/json' } },
      { method: 'POST' as const, url, payload: { private: 's'.repeat(17_000) } },
      { method: 'GET' as const, url: '/private-path-sensitive-sentinel' },
      { method: 'POST' as const, url, payload: request() },
    ];
    const responses = await Promise.all(cases.map((entry) => server.inject(entry)));
    expect(responses.map((response) => response.statusCode)).toEqual([400, 413, 404, 502]);
    for (const response of responses) expect(response.body).not.toContain('sensitive-sentinel');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('supports null-origin worker CORS with no credentials and denies unsupported preflight headers', async () => {
    const { server, read } = setup();
    const response = await server.inject({ method: 'OPTIONS', url, headers: { origin: 'null',
      'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-monolith-run' } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers).not.toHaveProperty('access-control-allow-credentials');
    expect((await server.inject({ method: 'OPTIONS', url, headers: { origin: 'null',
      'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/api/health' })).headers).not.toHaveProperty('access-control-allow-origin');
    expect(read).not.toHaveBeenCalled();
  });

  it('enforces a global request budget before upstream and recovers after its window', async () => {
    let now = 1_800_000_000_000;
    const { server, read } = setup({ requestsPerMinute: 1, nowMs: () => now });
    expect((await server.inject({ method: 'POST', url, payload: request() })).statusCode).toBe(200);
    expect((await server.inject({ method: 'POST', url, payload: request() })).statusCode).toBe(429);
    expect(read).toHaveBeenCalledTimes(1);
    now += 60_000;
    expect((await server.inject({ method: 'POST', url, payload: request() })).statusCode).toBe(200);
  });

  it('bounds concurrency before upstream and releases the slot after completion', async () => {
    let resolveRead: (value: Result<JsonRpcSuccess>) => void = () => {};
    const read = vi.fn(() => new Promise<Result<JsonRpcSuccess>>((resolve) => { resolveRead = resolve; }));
    const { server } = setup({ upstream: { read }, maxConcurrent: 1 });
    const pending = server.inject({ method: 'POST', url, payload: request() });
    void pending.then(() => {});
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect((await server.inject({ method: 'POST', url, payload: request() })).statusCode).toBe(429);
    resolveRead({ ok: false, error: makeError('UPSTREAM_TIMEOUT') });
    expect((await pending).statusCode).toBe(504);
  });
});

describe('peer normalization and proxy topology', () => {
  it('normalizes mapped IPv6 and compressed IPv6 without trusting headers', () => {
    expect(normalizePeer('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizePeer('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(normalizePeer('spoofed')).toBeUndefined();
    expect(normalizePeer('fe80::1%eth0')).toBeUndefined();
  });
  it.each([
    [], ['X-Forwarded-For', '192.0.2.1', 'X-Forwarded-For', '192.0.2.2'],
    ['Forwarded', 'for=192.0.2.1', 'X-Forwarded-For', '192.0.2.2'],
    ['X-Forwarded-For', 'invalid'], ['X-Forwarded-For', '192.0.2.1,192.0.2.2'],
  ].map((headers) => ({ headers })))('rejects missing/ambiguous edge context $headers', ({ headers }) => {
    expect(resolvePeer({ mode: 'trusted-proxy', trustedProxies: ['127.0.0.1'] }, '127.0.0.1', headers)).toBeUndefined();
  });
});
