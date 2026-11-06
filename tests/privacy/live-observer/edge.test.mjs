// These checks use synthetic TEST-NET peers and loopback HTTP only. They do not
// verify Cloudflare deployment, live source identity, or an anonymizing worker.
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createObserverEdge, createTunnelOutputProjector } from './edge.mjs';

const RUN = 'run-12345678-1234-4123-8123-123456789abc';
const RPC = 'rpc-12345678-1234-4123-8123-123456789abc';
const READ = '/api/observer/read?endpointId=mn009_ethereum';
const DATA = JSON.stringify({ jsonrpc: '2.0', id: RPC, method: 'eth_chainId', params: [] });
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return server.address().port;
}

async function setup(options = {}) {
  const seen = [];
  const observerPort = await serve((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ method: request.method, path: request.url, headers: request.headers,
        rawHeaders: request.rawHeaders, body: Buffer.concat(chunks).toString() });
      if (options.handler) { options.handler(request, response); return; }
      response.writeHead(request.method === 'OPTIONS' ? 204 : 200, {
        'content-type': 'application/json', 'access-control-allow-methods': request.method === 'OPTIONS' ? 'POST' : 'GET',
        'access-control-allow-headers': 'content-type,x-monolith-run,x-monolith-case',
        'set-cookie': 'secret=never-forward', 'x-real-ip': '192.0.2.99', 'x-private-header': 'never-forward',
      });
      response.end(request.method === 'OPTIONS' ? undefined : '{"jsonrpc":"2.0","id":"safe","result":"0x1"}');
    });
  });
  const capabilityHost = `${randomBytes(32).toString('hex')}.invalid`;
  const edge = await createObserverEdge({ observerPort, capabilityHost, ...options.edge });
  cleanup.push(() => edge.close());
  return { edge, seen, capabilityHost };
}

function send(port, { method = 'POST', path = READ, headers = [], body = DATA } = {}) {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ hostname: '127.0.0.1', port, method, path, headers, agent: false }, (reply) => {
      const chunks = [];
      reply.on('data', (chunk) => chunks.push(chunk));
      reply.on('error', reject);
      reply.on('end', () => resolve({ status: reply.statusCode, headers: reply.headers,
        body: Buffer.concat(chunks).toString() }));
    });
    call.on('error', reject);
    call.end(body);
  });
}

function headers(capabilityHost, extra = []) {
  return ['Host', capabilityHost, 'CF-Connecting-IP', '192.0.2.10', 'Content-Type', 'application/json', ...extra];
}

describe('MN009 authenticated source edge (SIMULATED loopback)', () => {
  it('reconstructs one source header and strips all caller forwarding, cookies and capabilities', async () => {
    const { edge, seen, capabilityHost } = await setup();
    const result = await send(edge.port, { headers: headers(capabilityHost, [
      'X-Forwarded-For', '203.0.113.60', 'X-Forwarded-For', '198.51.100.40',
      'Forwarded', 'for=203.0.113.60', 'X-Real-IP', '198.51.100.90', 'CF-Visitor', 'untrusted',
      'X-Forwarded-Host', 'forged.example', 'X-Monolith-Run', RUN, 'X-Monolith-Case', 'protected',
      'Cookie', 'session=private', 'Authorization', 'Bearer private', 'Origin', 'null',
    ]) });
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers['x-forwarded-for']).toBe('192.0.2.10');
    expect(seen[0].rawHeaders.filter((value) => value.toLowerCase() === 'x-forwarded-for')).toHaveLength(1);
    for (const name of ['forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-visitor', 'x-forwarded-host',
      'cookie', 'authorization', 'origin']) expect(seen[0].headers[name]).toBeUndefined();
    expect(seen[0].headers['x-monolith-run']).toBe(RUN);
    expect(seen[0].headers['x-monolith-case']).toBe('protected');
    expect(seen[0].body).toBe(DATA);
    expect(JSON.stringify(seen[0])).not.toContain(capabilityHost);
    expect(JSON.stringify(result)).not.toContain(capabilityHost);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.headers['x-real-ip']).toBeUndefined();
    expect(result.headers['x-private-header']).toBeUndefined();
    expect(result.headers['access-control-allow-credentials']).toBeUndefined();
    expect(edge.counters()).toEqual({ forwarded: 1, denied: 0, reasons: {
      unauthenticatedHost: 0, missingSource: 0, duplicateSource: 0,
      invalidSource: 0, workerSource: 0, routeOrHeader: 0, resource: 0,
    }, markers: { workerHeader: 0, workerLoop: 0, workerSentinel: 0, edgeLoopMarker: 0 } });
  });

  it.each([undefined, 'wrong.invalid', `${'f'.repeat(64)}.invalid`])('rejects missing/wrong private Host before forwarding (%s)', async (host) => {
    const { edge, seen } = await setup();
    const result = await send(edge.port, { headers: ['CF-Connecting-IP', '192.0.2.10', 'Content-Type', 'application/json',
      ...(host ? ['Host', host] : [])] });
    expect([400, 403]).toContain(result.status);
    expect(seen).toHaveLength(0);
  });

  it.each([
    [], ['CF-Connecting-IP', 'not-an-ip'], ['CF-Connecting-IP', '192.0.2.10, 198.51.100.20'],
    ['CF-Connecting-IP', '192.0.2.10', 'CF-Connecting-IP', '198.51.100.20'],
    ['CF-Connecting-IP', 'fe80::1%eth0'], ['CF-Connecting-IP', '2a06:98c0:3600::103'],
    ['CF-Connecting-IP', '2A06:98C0:3600:0:0:0:0:103'],
  ].map((entry) => [entry]))('rejects absent/ambiguous/malformed/Worker source %j', async (sourceHeaders) => {
    const { edge, seen, capabilityHost } = await setup();
    const result = await send(edge.port, { headers: ['Host', capabilityHost, 'Content-Type', 'application/json', ...sourceHeaders] });
    expect(result.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it.each([['CF-Worker', 'example.com'], ['CF-EW-Via', '15'], ['CDN-Loop', 'cloudflare; loops=1, workers']].map((entry) => [entry]))(
    'rejects Worker traversal marker %s', async (marker) => {
      const { edge, seen, capabilityHost } = await setup();
      const result = await send(edge.port, { headers: headers(capabilityHost, marker) });
      expect(result.status).toBe(403); expect(seen).toHaveLength(0);
      expect(edge.counters().reasons.workerSource).toBe(1);
    });

  it('accepts ordinary Cloudflare CDN loop marker and canonicalizes IPv6 before comparison', async () => {
    const { edge, seen, capabilityHost } = await setup();
    const result = await send(edge.port, { headers: ['Host', capabilityHost, 'CF-Connecting-IP', '2001:DB8:0:0:0:0:0:1',
      'CDN-Loop', 'cloudflare; loops=1', 'Content-Type', 'application/json'] });
    expect(result.status).toBe(200);
    expect(seen[0].headers['x-forwarded-for']).toBe('2001:db8::1');
  });

  it.each([
    { path: '/api/observer/read?endpointId=mn009_ethereum&url=https://evil.example' },
    { path: '/api/observer/read?endpointId=mn009_ethereum&endpointId=mn009_ethereum' },
    { path: '/api/observer/read?endpointId=short' },
    { path: '/api/observer/read?endpointId=mn009_ethereum', method: 'GET', body: '' },
    { path: '/api/observer/read?endpointId=mn009_ethereum', method: 'PUT' },
    { path: 'https://evil.example/api/observer/read?endpointId=mn009_ethereum' },
    { path: '//evil.example/api/health', method: 'GET', body: '' },
    { path: '/api/observer/runs/private-wallet-address', method: 'GET', body: '' },
    { path: '/api/health?proxy=evil', method: 'GET', body: '' },
    { path: '/arbitrary', method: 'GET', body: '' },
  ])('rejects unlisted method/path/query without forwarding %j', async (input) => {
    const { edge, seen, capabilityHost } = await setup();
    expect((await send(edge.port, { ...input, headers: headers(capabilityHost) })).status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['X-Monolith-Run', RUN, 'X-Monolith-Run', RUN],
    ['X-Monolith-Run', 'private-stable-id'], ['X-Monolith-Case', 'anon-route-proof'],
  ].map((entry) => [entry]))('rejects malformed or duplicated lab headers %j', async (extra) => {
    const { edge, seen, capabilityHost } = await setup();
    expect((await send(edge.port, { headers: headers(capabilityHost, extra) })).status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('forwards allowed null-origin CORS preflight without forwarding credentials or origin', async () => {
    const { edge, seen, capabilityHost } = await setup();
    const result = await send(edge.port, { method: 'OPTIONS', body: '', path: '/api/observer/read', headers: [
      'Host', capabilityHost, 'CF-Connecting-IP', '192.0.2.10', 'Origin', 'null',
      'Access-Control-Request-Method', 'POST', 'Access-Control-Request-Headers', 'content-type,x-monolith-run,x-monolith-case',
    ] });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe('*');
    expect(result.headers['access-control-allow-credentials']).toBeUndefined();
    expect(seen[0].headers['origin']).toBeUndefined();
  });

  it('rejects credentialed/arbitrary-header CORS preflight', async () => {
    const { edge, seen, capabilityHost } = await setup();
    const result = await send(edge.port, { method: 'OPTIONS', body: '', path: '/api/observer/read', headers: [
      'Host', capabilityHost, 'CF-Connecting-IP', '192.0.2.10',
      'Access-Control-Request-Method', 'POST', 'Access-Control-Request-Headers', 'authorization',
    ] });
    expect(result.status).toBe(403); expect(seen).toHaveLength(0);
  });

  it('allows only synthetic run diagnostics and fixed health GET', async () => {
    const { edge, seen, capabilityHost } = await setup();
    for (const path of [`/api/observer/runs/${RUN}`, '/api/health']) {
      expect((await send(edge.port, { method: 'GET', path, body: '', headers: headers(capabilityHost) })).status).toBe(200);
    }
    expect(seen).toHaveLength(2);
    expect(seen.every((entry) => entry.headers['x-monolith-run'] === undefined)).toBe(true);
  });

  it('bounds declared and streamed body bytes before calling observer', async () => {
    const { edge, seen, capabilityHost } = await setup({ edge: { maxBodyBytes: 8 } });
    expect((await send(edge.port, { headers: headers(capabilityHost, ['Content-Length', '9']), body: '123456789' })).status).toBe(413);
    expect((await send(edge.port, { headers: headers(capabilityHost), body: '123456789' })).status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('bounds response bytes and returns only fixed error text', async () => {
    const { edge, capabilityHost } = await setup({ edge: { maxResponseBytes: 8 }, handler: (_request, response) => {
      response.end('private-upstream-body');
    } });
    const result = await send(edge.port, { headers: headers(capabilityHost) });
    expect(result.status).toBe(502);
    expect(result.body).not.toContain('private-upstream-body');
    expect(result.body).toContain('POLICY_DENIED');
  });

  it('does not follow redirects or return their destination', async () => {
    const { edge, capabilityHost } = await setup({ handler: (_request, response) => {
      response.writeHead(302, { location: 'https://private.example/secret' }); response.end('private redirect');
    } });
    const result = await send(edge.port, { headers: headers(capabilityHost) });
    expect(result.status).toBe(502); expect(JSON.stringify(result)).not.toContain('private');
  });

  it('terminates a stalled observer within the bounded deadline', async () => {
    const { edge, capabilityHost } = await setup({ edge: { timeoutMs: 40 }, handler: () => {} });
    const started = Date.now();
    const result = await send(edge.port, { headers: headers(capabilityHost) });
    expect(result.status).toBe(504); expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('rejects configuration values with a fixed safe error', async () => {
    for (const input of [{}, { observerPort: 1, capabilityHost: 'secret.invalid' },
      { observerPort: 70_000, capabilityHost: `${'a'.repeat(64)}.invalid` }]) {
      await expect(createObserverEdge(input)).rejects.toThrow('Invalid temporary edge configuration.');
    }
  });

  it('reports only fixed denial categories and returns an independent counter snapshot', async () => {
    const { edge, seen, capabilityHost } = await setup();
    const cases = [
      { headers: headers('wrong.invalid'), reason: 'unauthenticatedHost' },
      { headers: ['Host', capabilityHost, 'Content-Type', 'application/json'], reason: 'missingSource' },
      { headers: headers(capabilityHost, ['CF-Connecting-IP', '198.51.100.20']), reason: 'duplicateSource' },
      { headers: ['Host', capabilityHost, 'CF-Connecting-IP', 'invalid-source', 'Content-Type', 'application/json'], reason: 'invalidSource' },
      { headers: headers(capabilityHost, ['CF-Worker', 'untrusted.example']), reason: 'workerSource' },
      { headers: headers(capabilityHost), path: '/arbitrary', reason: 'routeOrHeader' },
    ];
    for (const { reason, ...request } of cases) {
      expect((await send(edge.port, request)).status).toBe(403);
      expect(edge.counters().reasons[reason]).toBe(1);
    }
    expect(seen).toHaveLength(0);
    const snapshot = edge.counters();
    expect(snapshot.denied).toBe(cases.length);
    expect(Object.values(snapshot.reasons).reduce((total, count) => total + count, 0)).toBe(snapshot.denied);
    expect(JSON.stringify(snapshot)).not.toMatch(/invalid-source|untrusted\.example|192\.0\.2\.10|\.invalid/);
    snapshot.reasons.unauthenticatedHost = 999;
    expect(edge.counters().reasons.unauthenticatedHost).toBe(1);
    snapshot.markers.workerHeader = 999;
    expect(edge.counters().markers.workerHeader).toBe(1);
  });

  it('distinguishes EW-Via loop detection from actual Worker indicators without accepting either', async () => {
    const { edge, seen, capabilityHost } = await setup();
    const inputs = [
      { raw: headers(capabilityHost, ['CF-EW-Via', '15']), marker: 'edgeLoopMarker' },
      { raw: headers(capabilityHost, ['CF-Worker', 'untrusted.example']), marker: 'workerHeader' },
      { raw: headers(capabilityHost, ['CDN-Loop', 'cloudflare; workers']), marker: 'workerLoop' },
      { raw: ['Host', capabilityHost, 'CF-Connecting-IP', '2a06:98c0:3600::103', 'Content-Type', 'application/json'], marker: 'workerSentinel' },
    ];
    for (const { raw, marker } of inputs) {
      expect((await send(edge.port, { headers: raw })).status).toBe(403);
      expect(edge.counters().markers[marker]).toBe(1);
    }
    expect(edge.counters().markers).toEqual({ workerHeader: 1, workerLoop: 1, workerSentinel: 1, edgeLoopMarker: 1 });
    expect(edge.counters().reasons.workerSource).toBe(4);
    expect(seen).toHaveLength(0);
  });
});

describe('cloudflared output projection', () => {
  it('emits only one public origin from split raw output and discards settings/secrets', () => {
    const seen = [];
    const projector = createTunnelOutputProjector((origin) => seen.push(origin));
    projector.push('INFO settings map[http-host-header:SECRET.invalid]\nINFO | https://random-');
    projector.push(Buffer.from('run.trycloudflare.com |\nraw source=192.0.2.10 secret=private\n'));
    projector.push('https://another.trycloudflare.com\n'); projector.end();
    expect(seen).toEqual(['https://random-run.trycloudflare.com']);
  });

  it('rejects suffix-confusion/custom URLs and ignores oversized noise', () => {
    const seen = [];
    const projector = createTunnelOutputProjector((origin) => seen.push(origin));
    projector.push('https://evil.example\nhttps://fake.trycloudflare.com.evil.example\n');
    projector.push('x'.repeat(32_768));
    projector.push('\nhttps://accepted.trycloudflare.com\n'); projector.end();
    expect(seen).toEqual(['https://accepted.trycloudflare.com']);
  });
});
