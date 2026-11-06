import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpResultSchema, observerLabAllocationSchema, type ObserverLabAllocation } from '@monolith/shared';
import { createLabRun } from '../../src/application/create-lab-run.js';
import { parsePublicLabRuns } from '../../src/composition/env.js';
import { buildServer, type ObserverServerOptions } from '../../src/composition/server.js';
import { DiagnosticsStore } from '../../src/domain/diagnostics.js';

const START = Date.parse('2030-01-01T00:00:00.000Z');
const TTL = 300_000;
const allocationUrl = '/api/observer/runs';
const endpointId = 'synthetic-ethereum';
const readUrl = `/api/observer/read?endpointId=${endpointId}`;
const uuid = (index: number) => `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const runId = (index: number) => `run-${uuid(index)}`;
const rpcId = (index: number) => `rpc-${uuid(index)}`;
const rpc = (id: string) => ({ jsonrpc: '2.0', id, method: 'eth_chainId', params: [] });
const servers: ReturnType<typeof buildServer>[] = [];

function setup(options: ObserverServerOptions = {}) {
  const read = vi.fn(async (_endpoint, request) => ({
    ok: true as const, value: { jsonrpc: '2.0' as const, id: request.id, result: '0x1' },
  }));
  const server = buildServer({
    config: { endpoints: [{ endpointId, chainId: '1', rpcUrl: 'https://rpc.example.invalid', calls: [] }],
      sourcePolicy: { mode: 'direct', trustedProxies: [] }, labRuns: [] },
    publicLabRuns: true, upstream: { read }, nowMs: () => START, ...options,
  });
  servers.push(server);
  return { server, read };
}

async function allocate(server: ReturnType<typeof buildServer>): Promise<ObserverLabAllocation> {
  const response = await server.inject({ method: 'POST', url: allocationUrl });
  expect(response.statusCode).toBe(201);
  const parsed = httpResultSchema(observerLabAllocationSchema).parse(response.json());
  if (!parsed.ok) throw new Error('Expected allocation fixture.');
  return parsed.value;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});

describe('default-disabled operator opt-in', () => {
  it('requires explicit true and never projects unrelated private configuration', () => {
    expect(parsePublicLabRuns({})).toBe(false);
    expect(parsePublicLabRuns({ MONOLITH_OBSERVER_PUBLIC_LAB_RUNS: 'false' })).toBe(false);
    expect(parsePublicLabRuns({ MONOLITH_OBSERVER_PUBLIC_LAB_RUNS: 'true', PRIVATE_SENTINEL: 'private-sentinel' })).toBe(true);
  });
  it.each(['', '1', 'TRUE', ' true', 'false ', 'private-sensitive-sentinel'])(
    'rejects noncanonical opt-in %j without echo', (value) => {
      expect(() => parsePublicLabRuns({ MONOLITH_OBSERVER_PUBLIC_LAB_RUNS: value })).toThrow('Observer configuration is invalid.');
    },
  );
  it('preserves 404, absent CORS and ordinary health/read defaults when disabled', async () => {
    const server = buildServer();
    servers.push(server);
    for (const method of ['POST', 'OPTIONS'] as const) {
      const response = await server.inject({ method, url: allocationUrl });
      expect(response.statusCode).toBe(404);
      expect(response.headers).not.toHaveProperty('access-control-allow-origin');
    }
    expect((await server.inject({ method: 'GET', url: '/api/health' })).json().value.status).toBe('scaffold');
    const denied = await server.inject({ method: 'POST', url: readUrl, payload: rpc(rpcId(1)) });
    expect(denied.statusCode).toBe(403);
  });
});

describe('public synthetic allocation HTTP surface (offline fixture upstream)', () => {
  it('generates fresh unpredictable IDs with exact five-minute expiry and no source/evidence claims', async () => {
    const { server, read } = setup();
    const first = await allocate(server);
    const secondResponse = await server.inject({ method: 'POST', url: allocationUrl, payload: {} });
    expect(secondResponse.statusCode).toBe(201);
    const second = observerLabAllocationSchema.parse(secondResponse.json().value);
    expect(first.runId).not.toBe(second.runId);
    expect(first.baselineRpcId).not.toBe(second.baselineRpcId);
    expect(first.expiresAt).toBe('2030-01-01T00:05:00.000Z');
    expect(Object.keys(first).sort()).toEqual(['baselineRpcId', 'expiresAt', 'runId', 'schemaVersion']);
    expect(secondResponse.headers['cache-control']).toBe('no-store');
    expect(secondResponse.headers['access-control-allow-origin']).toBe('*');
    expect(secondResponse.headers).not.toHaveProperty('access-control-allow-credentials');
    expect(secondResponse.headers).not.toHaveProperty('set-cookie');
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${first.runId}` })).json().value.observations).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { query: '?runId=private-sensitive-sentinel' }, { query: '?endpointId=private-sensitive-sentinel' },
    { query: '?unexpected=' }, { payload: { runId: 'private-sensitive-sentinel' } },
    { payload: { baselineRpcId: rpcId(1) } }, { payload: { rpcUrl: 'http://127.0.0.1/private-sensitive-sentinel' } },
    { payload: { sourceClass: 'different-from-baseline' } }, { payload: [] },
    { payload: 'null', headers: { 'content-type': 'application/json' } },
    { payload: 'private-sensitive-sentinel', headers: { 'content-type': 'text/plain' } },
    { headers: { authorization: 'Bearer private-sensitive-sentinel' } },
    { headers: { cookie: 'private-sensitive-sentinel' } },
    { headers: { 'x-monolith-run': runId(1) } }, { headers: { 'x-monolith-case': 'baseline' } },
    { headers: { 'x-monolith-route': 'anon-nym' } }, { headers: { 'x-monolith-source': 'private-sensitive-sentinel' } },
  ])('rejects all caller allocation inputs before allocating %#', async ({ query = '', ...input }) => {
    const { server, read } = setup();
    const response = await server.inject({ method: 'POST', url: `${allocationUrl}${query}`, ...input });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_INPUT');
    expect(response.body).not.toContain('private-sensitive-sentinel');
    expect(read).not.toHaveBeenCalled();
    // Rejected input did not consume a successful allocation or admit an RPC request.
    await allocate(server);
  });

  it('uses a small body cap, fixed parser errors and no request logging', async () => {
    const { server, read } = setup();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const [payload, expected] of [['{"private-sensitive-sentinel":', 400], [JSON.stringify({ extra: 'x'.repeat(128) }), 413]] as const) {
      const response = await server.inject({ method: 'POST', url: allocationUrl, payload,
        headers: { 'content-type': 'application/json' } });
      expect(response.statusCode).toBe(expected);
      expect(response.body).not.toContain('private-sensitive-sentinel');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(read).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('limits allocation preflight to content-type and never grants credentialed CORS', async () => {
    const { server } = setup();
    const allowed = await server.inject({ method: 'OPTIONS', url: allocationUrl, headers: { origin: 'null',
      'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-headers']).toBe('content-type');
    expect(allowed.headers['access-control-allow-origin']).toBe('*');
    expect(allowed.headers).not.toHaveProperty('access-control-allow-credentials');
    for (const header of ['x-monolith-run', 'authorization', 'cookie', 'x-forwarded-for']) {
      const response = await server.inject({ method: 'OPTIONS', url: allocationUrl, headers: { origin: 'null',
        'access-control-request-method': 'POST', 'access-control-request-headers': header } });
      expect(response.statusCode).toBe(403);
    }
    expect((await server.inject({ method: 'OPTIONS', url: `${allocationUrl}?runId=${runId(1)}`,
      headers: { 'access-control-request-method': 'POST' } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/api/health' })).headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('admits at most twelve concurrent allocations per minute without retaining peer-based rate state', async () => {
    let now = START;
    const { server, read } = setup({ nowMs: () => now });
    const responses = await Promise.all(Array.from({ length: 20 }, () => server.inject({ method: 'POST', url: allocationUrl })));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(12);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(8);
    expect(read).not.toHaveBeenCalled();
    now += 60_000;
    await allocate(server);
  });

  it('does not evict operator runs at capacity and frees expired capacity for fresh public runs', async () => {
    let now = START;
    const { server } = setup({ nowMs: () => now, config: {
      endpoints: [], sourcePolicy: { mode: 'unknown', trustedProxies: [] },
      labRuns: Array.from({ length: 128 }, (_, index) => ({ runId: runId(index), baselineRpcId: rpcId(index) })),
    } });
    const full = await server.inject({ method: 'POST', url: allocationUrl });
    expect(full.statusCode).toBe(429);
    expect(full.json().error.code).toBe('RATE_LIMITED');
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${runId(0)}` })).statusCode).toBe(200);
    now += TTL;
    await allocate(server);
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${runId(0)}` })).statusCode).toBe(410);
  });

  it('keeps visitor baselines isolated, ignores allocation source headers and never renews expiry', async () => {
    let now = START;
    const { server } = setup({ nowMs: () => now });
    const a = await allocate(server);
    const bResponse = await server.inject({ method: 'POST', url: allocationUrl,
      headers: { 'x-forwarded-for': '192.0.2.222', forwarded: 'for=192.0.2.111' } });
    expect(bResponse.statusCode).toBe(201);
    const b = observerLabAllocationSchema.parse(bResponse.json().value);
    const send = (run: ObserverLabAllocation, id: string, peer: string) => server.inject({ method: 'POST', url: readUrl,
      remoteAddress: peer, headers: { 'x-monolith-run': run.runId }, payload: rpc(id) });
    await send(a, a.baselineRpcId, '192.0.2.1');
    await send(b, a.baselineRpcId, '192.0.2.1');
    await send(b, b.baselineRpcId, '192.0.2.2');
    await send(a, rpcId(99), '192.0.2.1');
    const aState = await server.inject({ method: 'GET', url: `${allocationUrl}/${a.runId}` });
    const bState = await server.inject({ method: 'GET', url: `${allocationUrl}/${b.runId}` });
    expect(aState.json().value.observations.map((entry: { sourceClass: string }) => entry.sourceClass)).toEqual(['baseline', 'baseline']);
    expect(bState.json().value.observations.map((entry: { sourceClass: string }) => entry.sourceClass)).toEqual(['unknown', 'baseline']);
    for (const secret of ['192.0.2.1', '192.0.2.2', '192.0.2.222', '192.0.2.111']) {
      expect(aState.body + bState.body).not.toContain(secret);
    }
    now += TTL - 1;
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${a.runId}` })).json().value.expiresAt).toBe(a.expiresAt);
    now++;
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${a.runId}` })).statusCode).toBe(410);
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${b.runId}` })).statusCode).toBe(410);
  });

  it('does not revive an allocated run when its pending upstream read completes after expiry', async () => {
    let now = START;
    let finish: () => void = () => {};
    const started = vi.fn();
    const { server } = setup({ nowMs: () => now, upstream: { read: async (_endpoint, request) => {
      started();
      await new Promise<void>((resolve) => { finish = resolve; });
      return { ok: true, value: { jsonrpc: '2.0', id: request.id, result: '0x1' } };
    } } });
    const run = await allocate(server);
    const pending = server.inject({ method: 'POST', url: readUrl,
      remoteAddress: '192.0.2.123', headers: { 'x-monolith-run': run.runId }, payload: rpc(run.baselineRpcId) });
    void pending.then(() => {});
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    now += TTL;
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${run.runId}` })).statusCode).toBe(410);
    const fresh = await allocate(server);
    finish();
    expect((await pending).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${run.runId}` })).statusCode).toBe(410);
    expect((await server.inject({ method: 'GET', url: `${allocationUrl}/${fresh.runId}` })).json().value.observations).toEqual([]);
  });
});

describe('application admission and failure boundaries', () => {
  it('never retries a collision or replaces another registration', () => {
    const diagnostics = new DiagnosticsStore({ nowMs: () => START });
    diagnostics.register(runId(1), rpcId(1));
    const uuidSource = vi.fn(() => uuid(1));
    const result = createLabRun({ diagnostics, nowMs: () => START, uuid: uuidSource })();
    expect(result.statusCode).toBe(503);
    expect(uuidSource).toHaveBeenCalledTimes(2);
    expect(diagnostics.get(runId(1)).ok).toBe(true);
    diagnostics.clear();
  });
  it('redacts generator errors and counts failed attempts against the quota', () => {
    const diagnostics = new DiagnosticsStore({ nowMs: () => START });
    const allocate = createLabRun({ diagnostics, nowMs: () => START, allocationsPerMinute: 1,
      uuid: () => { throw new Error('private-sensitive-sentinel'); } });
    const failure = allocate();
    expect(failure.statusCode).toBe(503);
    expect(JSON.stringify(failure)).not.toContain('private-sensitive-sentinel');
    expect(allocate().statusCode).toBe(429);
    diagnostics.clear();
  });
});
