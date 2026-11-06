// SIMULATED sources and upstreams over actual loopback sockets. No external RPC.
import { createConnection } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { test, expect, afterEach } from 'vitest';
import { makeError, type JsonRpcRequest, type ObserverLabAllocation } from '@monolith/shared';
import type { EntityReader, EntityObservation, EndpointAdmission } from '@monolith/registry';
import type { Result } from '@monolith/shared';
import { createFreshPublicRegistry, createPublicDemo, PUBLIC_REGISTRY_PINS } from '../../src/composition/public-demo.js';
import { parseProxyV2 } from '../../src/adapters/http/proxy-v2.js';
import { publicRoute } from '../../src/adapters/http/public-lab-edge.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const A = '192.0.2.10'; const B = '198.51.100.20';
function frame(source = A) {
  const bytes = Buffer.alloc(28); Buffer.from([13, 10, 13, 10, 0, 13, 10, 81, 85, 73, 84, 10]).copy(bytes);
  bytes[12] = 0x21; bytes[13] = 0x11; bytes.writeUInt16BE(12, 14);
  source.split('.').forEach((part, index) => { bytes[16 + index] = Number(part); });
  bytes[20] = 127; bytes[23] = 1; bytes.writeUInt16BE(50000, 24); bytes.writeUInt16BE(80, 26); return bytes;
}
async function wire(port: number, text: string, source = A, prefix: Buffer = frame(source)) {
  return new Promise<{ status: number; text: string; body: unknown }>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }); const chunks: Buffer[] = [];
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on('connect', () => socket.write(Buffer.concat([prefix, Buffer.from(text)])));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk)); socket.on('error', () => {});
    socket.once('close', () => { const output = Buffer.concat(chunks).toString();
      // Responses are deliberately connection-close; Node may encode the body as chunks.
      const raw = output.split('\r\n\r\n').slice(1).join('\r\n\r\n');
      const bodyText = /transfer-encoding: chunked/i.test(output.split('\r\n\r\n')[0] ?? '')
        ? raw.replace(/^[0-9a-f]+\r\n/i, '').replace(/\r\n0\r\n\r\n$/, '') : raw;
      let body: unknown = null; try { body = JSON.parse(bodyText); } catch { /* Closed denials may have no body. */ }
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(output)?.[1] ?? 0), text: output, body }); });
  });
}
function request(method: string, path: string, body = '', headers: string[] = []) {
  return `${method} ${path} HTTP/1.1\r\nHost: public.example.org\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${headers.map((line) => `${line}\r\n`).join('')}\r\n${body}`;
}
async function setup(options: Parameters<typeof createPublicDemo>[0] = {}) {
  const calls: JsonRpcRequest[] = [];
  const demo = await createPublicDemo({ registry: { query: async () => ({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') }) },
    upstream: { read: async (endpoint, input) => { expect(endpoint.rpcUrl).toBe('https://mainnet.optimism.io/');
      calls.push(structuredClone(input)); return { ok: true, value: { jsonrpc: '2.0', id: input.id, result: input.method === 'eth_chainId' ? '0xa' : '0x1' } }; } }, ...options });
  cleanup.push(demo.close); return { ...demo, calls };
}
async function allocate(port: number, source = A): Promise<ObserverLabAllocation> {
  const response = await wire(port, request('POST', '/api/observer/runs', '{}', ['Content-Type: application/json']), source);
  expect(response.status).toBe(201); return (response.body as { value: ObserverLabAllocation }).value;
}
const pathFor = (allocation: ObserverLabAllocation) => `/api/observer/read?endpointId=lab_optimism&runId=${allocation.runId}`;
const rpc = (id = `rpc-${randomUUID()}`, method = 'eth_getBalance') => JSON.stringify({ jsonrpc: '2.0', id, method,
  params: method === 'eth_getBalance' ? [`0x${'0'.repeat(40)}`, 'latest'] : [] });

test('canonical raw routes reject encoded, duplicate, extra, reordered or expanded parameters', () => {
  const run = `run-${randomUUID()}`;
  const read = `/api/observer/read?endpointId=lab_optimism&runId=${run}`;
  expect(publicRoute('POST', read)).toMatchObject({ kind: 'read', runId: run, path: '/api/observer/read?endpointId=lab_optimism' });
  for (const target of [read + '&runId=' + run, read.replace('lab_optimism', 'other_endpoint'),
    read.replace('runId=', 'run%49d='), read.replace('/read?', '/x/../read?'), read + '#fragment',
    `/api/observer/read?runId=${run}&endpointId=lab_optimism`, '/api/registry/chains?chainId=1',
    '/api/registry/chains?chainId=010', '/api/observer/runs?url=https://evil.example.org']) {
    expect(publicRoute('POST', target)).toBeNull();
  }
});

test('two visitor runs isolate baselines; forged forwarding/route fields cannot replace frame source', async () => {
  const demo = await setup(); const one = await allocate(demo.edgePort); const two = await allocate(demo.edgePort, B);
  const firstBody = rpc(one.baselineRpcId);
  expect((await wire(demo.edgePort, request('POST', pathFor(one), firstBody), A)).status).toBe(200);
  expect((await wire(demo.edgePort, request('POST', pathFor(one), rpc(), [
    `X-Forwarded-For: ${B}`, `X-Real-IP: ${B}`, `CF-Connecting-IP: ${B}`, 'X-Monolith-Case: protected',
  ]), A)).status).toBe(200);
  expect((await wire(demo.edgePort, request('POST', pathFor(two), rpc(two.baselineRpcId)), B)).status).toBe(200);
  expect((await wire(demo.edgePort, request('POST', pathFor(one), rpc(undefined, 'eth_chainId')), B)).status).toBe(200);
  expect((await wire(demo.edgePort, request('POST', pathFor(two), rpc()), A)).status).toBe(200);
  const read = async (allocation: ObserverLabAllocation) => {
    const response = await wire(demo.edgePort, request('GET', `/api/observer/runs/${allocation.runId}`));
    return (response.body as { value: { observations: Array<{ sourceClass: string }> } }).value.observations.map((row) => row.sourceClass);
  };
  expect(await read(one)).toEqual(['baseline', 'baseline', 'different-from-baseline']);
  expect(await read(two)).toEqual(['baseline', 'different-from-baseline']);
  expect(demo.calls[0]).toEqual(JSON.parse(firstBody));
  expect(demo.counters()).toMatchObject({ missingContentTypeFilled: 5, missingRunHeaderFilled: 5, conflictsDenied: 0 });
  expect(JSON.stringify(demo.counters())).not.toContain(A);
});

test.each(['run-conflict', 'run-duplicate', 'run-empty', 'type-conflict', 'type-duplicate', 'case-invented', 'authorization', 'cookie', 'application-extra'])(
  'denies %s before upstream and preserves registered empty run', async (fault) => {
    const demo = await setup(); const allocation = await allocate(demo.edgePort);
    const headers: Record<string, string[]> = {
      'run-conflict': [`X-Monolith-Run: run-${randomUUID()}`], 'run-duplicate': [`X-Monolith-Run: ${allocation.runId}`, `X-Monolith-Run: ${allocation.runId}`],
      'run-empty': ['X-Monolith-Run:'], 'type-conflict': ['Content-Type: text/plain'], 'type-duplicate': ['Content-Type: application/json', 'Content-Type: application/json'],
      'case-invented': ['X-Monolith-Case: anonymous'], authorization: ['Authorization: test-fixture'], cookie: ['Cookie: test=fixture'], 'application-extra': ['X-Monolith-Target: arbitrary'],
    };
    expect((await wire(demo.edgePort, request('POST', pathFor(allocation), rpc(), headers[fault]))).status).toBe(403);
    expect(demo.calls).toHaveLength(0);
  });

test('supplied matching metadata is retained without counting it as normalization', async () => {
  const demo = await setup(); const allocation = await allocate(demo.edgePort);
  expect((await wire(demo.edgePort, request('POST', pathFor(allocation), rpc(allocation.baselineRpcId),
    ['Content-Type: application/json', `X-Monolith-Run: ${allocation.runId}`]))).status).toBe(200);
  expect(demo.counters()).toMatchObject({ missingContentTypeFilled: 0, missingRunHeaderFilled: 0 });
});

test('unknown and expired registrations cannot reach upstream', async () => {
  let now = Date.now(); const demo = await setup({ nowMs: () => now }); const allocation = await allocate(demo.edgePort);
  const unknown = { ...allocation, runId: `run-${randomUUID()}` };
  expect((await wire(demo.edgePort, request('POST', pathFor(unknown), rpc()))).status).toBe(400);
  now += 300_000;
  expect((await wire(demo.edgePort, request('POST', pathFor(allocation), rpc()))).status).toBe(400);
  expect(demo.calls).toHaveLength(0);
});

test('allocation cannot receive run fields, credentials, query or excessive bodies', async () => {
  const demo = await setup();
  for (const [path, body, headers] of [
    ['/api/observer/runs?runId=chosen', '{}', []], ['/api/observer/runs', '{}', ['X-Monolith-Case: protected']],
    ['/api/observer/runs', '{}', ['Cookie: fixture=yes']], ['/api/observer/runs', ' '.repeat(129), []],
  ] as Array<[string, string, string[]]>) expect((await wire(demo.edgePort, request('POST', path, body, headers))).status).toBeGreaterThanOrEqual(400);
  expect(demo.calls).toHaveLength(0);
});

test('worker read preflight and public metadata stay on the bounded same-origin surface', async () => {
  const demo = await setup(); const allocation = await allocate(demo.edgePort);
  const preflight = await wire(demo.edgePort, request('OPTIONS', pathFor(allocation), '', ['Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: content-type']));
  expect(preflight.status).toBe(204); expect(preflight.text).toContain('access-control-allow-origin: *');
  expect((await wire(demo.edgePort, request('GET', '/api/registry/chains?chainId=10'))).status).toBe(503);
  for (const path of ['/api/registry/chains?chainId=1', '/admin', '/api/observer/read?endpointId=lab_optimism']) expect((await wire(demo.edgePort, request('GET', path))).status).toBe(403);
});

test.each(['plain-http', 'local-command', 'wrong-family', 'zero-port', 'duplicate-host', 'duplicate-length', 'cl-te', 'expect', 'upgrade', 'write-method'])(
  'rejects %s framing/transport before any upstream call', async (fault) => {
    const demo = await setup(); const allocation = await allocate(demo.edgePort);
    const prefix = frame(); let text = request('POST', pathFor(allocation), rpc());
    if (fault === 'plain-http') prefix.fill(0);
    if (fault === 'local-command') prefix[12] = 0x20;
    if (fault === 'wrong-family') prefix[13] = 0x12;
    if (fault === 'zero-port') prefix.writeUInt16BE(0, 24);
    if (fault === 'duplicate-host') text = text.replace('Connection: close', 'Host: second.example.org\r\nConnection: close');
    if (fault === 'duplicate-length') text = text.replace('Connection: close', 'Content-Length: 1\r\nConnection: close');
    if (fault === 'cl-te') text = text.replace('Connection: close', 'Transfer-Encoding: chunked\r\nConnection: close');
    if (fault === 'expect') text = text.replace('Connection: close', 'Expect: 100-continue\r\nConnection: close');
    if (fault === 'upgrade') text = text.replace('Connection: close', 'Connection: Upgrade\r\nUpgrade: websocket');
    if (fault === 'write-method') text = request('POST', pathFor(allocation), JSON.stringify({ jsonrpc: '2.0', id: `rpc-${randomUUID()}`, method: 'eth_sendRawTransaction', params: ['0x00'] }));
    const response = await wire(demo.edgePort, text, A, fault === 'plain-http' ? Buffer.alloc(0) : prefix);
    expect(response.status === 0 || response.status >= 400).toBe(true); expect(demo.calls).toHaveLength(0);
  });

test('one PROXY connection cannot pipeline a second API operation', async () => {
  const demo = await setup();
  const response = await wire(demo.edgePort, request('GET', '/api/health') + request('POST', '/api/observer/runs', '{}', ['Content-Type: application/json']));
  expect(response.text.match(/HTTP\/1\.1/g)?.length ?? 0).toBeLessThanOrEqual(1);
  expect(demo.counters().forwarded).toBeLessThanOrEqual(1);
});

test('global admission includes metadata and resets without storing caller identities', async () => {
  let now = Date.now(); const demo = await setup({ nowMs: () => now, edgeLimits: { requestsPerMinute: 2 } });
  expect((await wire(demo.edgePort, request('GET', '/api/health'))).status).toBe(200);
  expect((await wire(demo.edgePort, request('GET', '/api/registry/chains?chainId=10'))).status).toBe(503);
  expect((await wire(demo.edgePort, request('POST', '/api/observer/runs'))).status).toBe(429);
  now += 60_000; expect((await wire(demo.edgePort, request('GET', '/api/health'))).status).toBe(200);
});

test('absolute incomplete-prefix/header/body deadlines clean up sockets', async () => {
  const demo = await setup({ edgeLimits: { prefixTimeoutMs: 30, headerTimeoutMs: 30, bodyTimeoutMs: 30 } });
  expect((await wire(demo.edgePort, '', A, frame().subarray(0, 10))).status).toBe(0);
  expect((await wire(demo.edgePort, 'GET /api/health HTTP/1.1\r\nHost:')).status).toBe(0);
  const allocation = await allocate(demo.edgePort);
  await wire(demo.edgePort, `POST ${pathFor(allocation)} HTTP/1.1\r\nHost: public.example.org\r\nContent-Length: 50\r\n\r\n{`);
  expect(demo.calls).toHaveLength(0);
  await demo.close(); expect(demo.counters()).toMatchObject({ pendingUpstreams: 0, concurrent: 0 });
});

test('binary parser accepts bounded IPv6/TLV and refuses LOCAL, datagram and invalid sizes', () => {
  expect(parseProxyV2(frame()).status).toBe('accepted');
  for (let length = 0; length < 28; length++) expect(parseProxyV2(frame().subarray(0, length)).status).toBe('pending');
  const six = Buffer.alloc(55); frame().subarray(0, 16).copy(six); six[13] = 0x21; six.writeUInt16BE(39, 14);
  six[16] = 0x20; six[17] = 1; six[31] = 1; six.writeUInt16BE(50000, 48); six.writeUInt16BE(80, 50);
  expect(parseProxyV2(six)).toMatchObject({ status: 'accepted', bytes: 55 });
  for (const [offset, value] of [[12, 0x20], [13, 0x12], [13, 0x31]]) { const invalid = frame(); invalid[offset!] = value!; expect(parseProxyV2(invalid).status).toBe('rejected'); }
  const excessive = frame(); excessive.writeUInt16BE(513, 14); expect(parseProxyV2(excessive).status).toBe('rejected');
});

function registryObservation(now: number, expiresAt: number): EntityObservation {
  const pins = PUBLIC_REGISTRY_PINS;
  const immutable = { chain_id: '10', chain_name: 'OP Mainnet', rpc_host: 'https://mainnet.optimism.io/',
    network_type: 'evm', status: 'candidate', source_url: `https://github.com/ethereum-lists/chains/blob/${pins.sourceRevision}/_data/chains/eip155-10.json`,
    source_commit: pins.sourceRevision, source_license: `https://github.com/ethereum-lists/chains/blob/${pins.sourceRevision}/LICENSE`,
    license_sha256: pins.licenseSha256, snapshot_sha256: pins.snapshotSha256, measured_chain_id: '', importer_version: 'monolith-import-v1' } as const;
  return { chainId: '10', blockNumber: '1000', observedAt: new Date(now).toISOString(), evidence: 'SIMULATED', entities: [{
    entityKey: `0x${'a'.repeat(64)}`, creator: pins.creator, owner: pins.owner, expiresAtBlock: '2000', readonly: true,
    permissionlessExtension: false, contentExpiresAt: new Date(expiresAt).toISOString(),
    record: { ...immutable, record_id: createHash('sha256').update(JSON.stringify(immutable)).digest('hex'),
      observed_at: new Date(now - 1000).toISOString() },
  }] };
}

test('separate public GETs twenty seconds apart receive fresh windows clamped to the real entity deadline', async () => {
  const began = Date.parse('2030-01-01T00:00:00.000Z'); let now = began; let reads = 0; let admissions = 0;
  const registry = createFreshPublicRegistry({ nowMs: () => now,
    reader: { readChain: async () => { reads++; return { ok: true, value: registryObservation(now, began + 120_000) }; } },
    admission: { check: async () => { admissions++; return { ok: true, value: undefined }; } },
  });
  const demo = await setup({ registry, nowMs: () => now });
  const metadata = async () => {
    const response = await wire(demo.edgePort, request('GET', '/api/registry/chains?chainId=10'));
    expect(response.status).toBe(200);
    return (response.body as { value: { generatedAt: string; expiresAt: string; revision: string } }).value;
  };
  const first = await metadata(); expect(Date.parse(first.expiresAt)).toBe(began + 30_000);
  now += 20_000;
  const second = await metadata(); expect(second.revision).toBe(first.revision);
  expect(Date.parse(second.generatedAt)).toBe(now); expect(Date.parse(second.expiresAt)).toBe(now + 30_000);
  now = began + 110_000;
  const last = await metadata(); expect(Date.parse(last.expiresAt)).toBe(began + 120_000);
  expect(reads).toBe(3); expect(admissions).toBe(3); expect(demo.calls).toHaveLength(0);
});

test.each(['reader', 'admission'] as const)('fresh query factories retain the shared sixteen slots after an unresponsive %s times out', async (stage) => {
  const now = Date.now(); let operations = 0; let settle: () => void = () => {};
  const waitingRead = new Promise<Result<EntityObservation>>((resolve) => { if (stage === 'reader') settle = () => resolve({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') }); });
  const waitingAdmission = new Promise<Result<void>>((resolve) => { if (stage === 'admission') settle = () => resolve({ ok: true, value: undefined }); });
  const reader: EntityReader = { readChain: async () => {
    if (stage === 'reader') { operations++; return waitingRead; }
    return { ok: true, value: registryObservation(now, now + 120_000) };
  } };
  const admission: EndpointAdmission = { check: async () => {
    if (stage === 'admission') { operations++; return waitingAdmission; }
    return { ok: true, value: undefined };
  } };
  const registry = createFreshPublicRegistry({ reader, admission, queryTimeoutMs: 30, nowMs: () => now });
  const demo = await setup({ registry, nowMs: () => now });
  const fetchMetadata = () => wire(demo.edgePort, request('GET', '/api/registry/chains?chainId=10'));
  const first = await Promise.all(Array.from({ length: 16 }, fetchMetadata));
  expect(first.every((response) => response.status === 503)).toBe(true); expect(operations).toBe(16);
  expect((await fetchMetadata()).status).toBe(429); expect(operations).toBe(16);
  settle(); await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await fetchMetadata()).status).not.toBe(429); expect(operations).toBe(17);
});
