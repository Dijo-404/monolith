// SIMULATED protocol frames and loopback HTTP only; no provider or worker proof.
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createProxyObserverEdge, createSshTunnelOutputProjector, parseProxyV2 } from './proxy-edge.mjs';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function frame(ipv6 = false) {
  const bytes = Buffer.alloc(ipv6 ? 52 : 28);
  Buffer.from([13, 10, 13, 10, 0, 13, 10, 81, 85, 73, 84, 10]).copy(bytes);
  bytes[12] = 0x21; bytes[13] = ipv6 ? 0x21 : 0x11;
  bytes.writeUInt16BE(ipv6 ? 36 : 12, 14);
  if (ipv6) { bytes.writeUInt16BE(0x2001, 16); bytes.writeUInt16BE(0x0db8, 18); bytes[31] = 5; }
  else Buffer.from([192, 0, 2, 10, 198, 51, 100, 20]).copy(bytes, 16);
  bytes.writeUInt16BE(12345, bytes.length - 4); bytes.writeUInt16BE(443, bytes.length - 2);
  return bytes;
}
async function setup(options = {}) {
  const seen = [];
  const bodies = [];
  const observer = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push(request.headers); bodies.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => observer.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { observer.closeAllConnections(); await new Promise((resolve) => observer.close(resolve)); });
  const edge = await createProxyObserverEdge({ observerPort: observer.address().port,
    capabilityHost: `${randomBytes(32).toString('hex')}.invalid`, timeoutMs: 1000, ...options });
  cleanup.push(() => edge.close());
  return { edge, seen, bodies };
}
async function send(port, chunks) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const received = [];
    socket.on('data', (chunk) => received.push(chunk));
    socket.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); });
    socket.once('close', () => resolve(Buffer.concat(received).toString('utf8')));
    socket.once('connect', async () => {
      for (const chunk of chunks) {
        socket.write(chunk);
        await new Promise((resolve) => setImmediate(resolve));
      }
    });
  });
}
const health = (extra = '') => Buffer.from(`GET /api/health HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n${extra}\r\n`);
const RUN = 'run-11111111-1111-4111-8111-111111111111';
const DATA = '{"jsonrpc":"2.0","id":"rpc-22222222-2222-4222-8222-222222222222","method":"eth_chainId","params":[]}';
const post = (extra = '', body = DATA, path = '/api/observer/read?endpointId=mn009_ethereum') =>
  Buffer.from(`POST ${path} HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${extra}\r\n${body}`);

describe('PROXYv2 source bridge (SIMULATED)', () => {
  it.each([false, true])('accepts complete TCP frames for IPv6=%s and leaves trailing HTTP bytes intact', (ipv6) => {
    const bytes = frame(ipv6);
    const result = parseProxyV2(Buffer.concat([bytes, health()]));
    expect(result.status).toBe('accepted'); expect(result.bytes).toBe(bytes.length);
    expect(result.source).toBe(ipv6 ? '2001:db8:0:0:0:0:0:5' : '192.0.2.10');
    for (let offset = 0; offset < bytes.length; offset++) {
      expect(parseProxyV2(bytes.subarray(0, offset)).status).toBe('pending');
    }
  });
  it.each([
    ['bad signature', (bytes) => { bytes[0] = 0; }],
    ['LOCAL command', (bytes) => { bytes[12] = 0x20; }],
    ['wrong version', (bytes) => { bytes[12] = 0x11; }],
    ['UDP transport', (bytes) => { bytes[13] = 0x12; }],
    ['UNIX family', (bytes) => { bytes[13] = 0x31; }],
    ['short address block', (bytes) => { bytes.writeUInt16BE(11, 14); }],
    ['excessive address block', (bytes) => { bytes.writeUInt16BE(513, 14); }],
    ['zero source port', (bytes) => { bytes.writeUInt16BE(0, 24); }],
    ['zero target port', (bytes) => { bytes.writeUInt16BE(0, 26); }],
  ])('rejects %s', (_label, mutate) => {
    const bytes = frame(); mutate(bytes); expect(parseProxyV2(bytes)).toEqual({ status: 'rejected' });
  });
  it('does not accept an ordinary HTTP or textual PROXY prefix', () => {
    expect(parseProxyV2(health()).status).toBe('rejected');
    expect(parseProxyV2(Buffer.from('PROXY TCP4 192.0.2.1 192.0.2.2 123 443\r\n')).status).toBe('rejected');
  });
  it('uses the connection frame despite duplicate and forged forwarding/Worker headers', async () => {
    const { edge, seen } = await setup();
    const forged = health('X-Forwarded-For: 203.0.113.1\r\nX-Forwarded-For: 203.0.113.2\r\n'
      + 'Forwarded: for=203.0.113.3\r\nX-Real-IP: 203.0.113.4\r\nCF-Connecting-IP: 203.0.113.5\r\n'
      + 'CF-Worker: forged.example\r\nCF-EW-Via: 15\r\nCDN-Loop: workers\r\n');
    const result = await send(edge.port, [frame().subarray(0, 7), frame().subarray(7), forged]);
    expect(result).toContain('200 OK'); expect(seen).toHaveLength(1);
    expect(seen[0]['x-forwarded-for']).toBe('192.0.2.10');
    for (const key of ['forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-worker', 'cf-ew-via', 'cdn-loop']) {
      expect(seen[0][key]).toBeUndefined();
    }
    expect(edge.counters()).toMatchObject({ acceptedProxy: 1, rejectedProxy: 0, sourceRequests: 1 });
  });
  it('does not trust source headers on a request without a provider frame', async () => {
    const { edge, seen } = await setup();
    await send(edge.port, [health('CF-Connecting-IP: 203.0.113.9\r\n')]);
    expect(seen).toHaveLength(0); expect(edge.counters().rejectedProxy).toBe(1);
    const internal = await send(edge.privateHttpPort, [health('CF-Connecting-IP: 203.0.113.9\r\n')]);
    expect(internal).toContain('403'); expect(seen).toHaveLength(0);
  });
  it('retains the existing read-only HTTP path and header policy after connection authentication', async () => {
    const { edge, seen } = await setup();
    const request = Buffer.from('POST /arbitrary?url=https://private.example HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    expect(await send(edge.port, [frame(), request])).toContain('403'); expect(seen).toHaveLength(0);
  });
  it('fills only missing fixed-run diagnostics while preserving body and independent connection source', async () => {
    const { edge, seen, bodies } = await setup({ labRunId: RUN });
    expect(await send(edge.port, [frame(), post()])).toContain('200');
    expect(seen[0]['content-type']).toBe('application/json');
    expect(seen[0]['x-monolith-run']).toBe(RUN);
    expect(seen[0]['x-monolith-case']).toBeUndefined();
    expect(seen[0]['x-forwarded-for']).toBe('192.0.2.10');
    expect(bodies).toEqual([DATA]);
    expect(edge.counters()).toMatchObject({ missingContentTypeFilled: 1, missingRunHeaderFilled: 1 });
  });
  it.each([
    `X-Monolith-Run: ${RUN}\r\nX-Monolith-Run: ${RUN}\r\n`,
    'X-Monolith-Run: run-33333333-3333-4333-8333-333333333333\r\n',
    'Content-Type: text/plain\r\n',
    'Content-Type: application/json\r\nContent-Type: application/json\r\n',
  ])('denies duplicate/conflicting supplied lab metadata without replacing it (%s)', async (extra) => {
    const { edge, seen } = await setup({ labRunId: RUN });
    expect(await send(edge.port, [frame(), post(extra)])).toContain('403');
    expect(seen).toHaveLength(0); expect(edge.counters().labHeaderConflictsDenied).toBe(1);
    expect(edge.counters().missingRunHeaderFilled).toBe(0);
  });
  it('never supplies a case label or upgrades an invented one', async () => {
    const { edge, seen } = await setup({ labRunId: RUN });
    expect(await send(edge.port, [frame(), post('X-Monolith-Case: invented-protected-proof\r\n')])).toContain('403');
    expect(seen).toHaveLength(0);
  });
  it('does not conceal extra public calls from the observer diagnostic inventory', async () => {
    const { edge, seen, bodies } = await setup({ labRunId: RUN });
    const unexpected = DATA.replace('222222222222', '444444444444');
    await send(edge.port, [frame(), post()]); await send(edge.port, [frame(), post('', unexpected)]);
    expect(seen).toHaveLength(2); expect(bodies).toEqual([DATA, unexpected]);
    expect(seen.every((headers) => headers['x-monolith-run'] === RUN)).toBe(true);
  });
  it('does not normalize unrelated routes or ordinary non-lab configuration', async () => {
    const { edge, seen } = await setup();
    expect(await send(edge.port, [frame(), post()])).toContain('403'); expect(seen).toHaveLength(0);
  });
  it('selects only a bounded accepted registration event, never marketing URLs', () => {
    const origins = [];
    const projector = createSshTunnelOutputProjector((origin) => origins.push(origin));
    projector.push('https://admin.localhost.run/\nhttps://forged123456.lhr.life\n');
    projector.push(JSON.stringify({ type: 'error', id: 'localhost/forged123456.lhr.life' }) + '\n');
    const accepted = JSON.stringify({ type: 'v1.tcpip_forward.register.accepted', id: 'localhost/0123456789abcd.lhr.life' }) + '\n';
    projector.push(accepted.slice(0, 30)); projector.push(accepted.slice(30));
    projector.push(accepted.replace('0123456789abcd', 'abcd0123456789'));
    expect(origins).toEqual(['https://0123456789abcd.lhr.life']);
    projector.end();
  });
});
