// MN-009's temporary lab edge. Cloudflare is a trusted intermediary, not an
// anonymity claim. Its source header is accepted only on the private local hop.
import { timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { isIP } from 'node:net';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RUN = new RegExp(`^run-${UUID}$`, 'i');
const DIAGNOSTICS = new RegExp(`^/api/observer/runs/run-${UUID}$`, 'i');
const ENDPOINT = /^[A-Za-z0-9_-]{8,128}$/;
const CROSS_ZONE_WORKER = '2a06:98c0:3600::103';
const BODY_LIMIT = 16 * 1_024;
const RESPONSE_LIMIT = 64 * 1_024;

function values(rawHeaders, name) {
  const matches = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === name) matches.push(rawHeaders[i + 1] ?? '');
  }
  return matches;
}

function single(rawHeaders, name) {
  const found = values(rawHeaders, name);
  return found.length === 1 ? found[0] : undefined;
}

function normalizedIp(input) {
  if (typeof input !== 'string' || input !== input.trim() || input.includes('%') || isIP(input) === 0) return;
  if (isIP(input) === 4) return input;
  try { return new URL(`http://[${input}]/`).hostname.slice(1, -1); }
  catch { /* An unparseable source is never evidence. */ }
}

function source(rawHeaders) {
  // CF-Worker identifies Worker subrequests. CF-EW-Via is a loop marker, not
  // documented proof of a Worker subrequest. This temporary edge currently
  // rejects both; separate fixed counts permit diagnosis without raw values.
  const names = rawHeaders.filter((_entry, index) => index % 2 === 0).map((name) => name.toLowerCase());
  const supplied = values(rawHeaders, 'cf-connecting-ip');
  const peer = supplied.length === 1 ? normalizedIp(supplied[0]) : undefined;
  const markers = {
    workerHeader: names.includes('cf-worker'),
    workerLoop: values(rawHeaders, 'cdn-loop').some((value) => /workers/i.test(value)),
    workerSentinel: peer === CROSS_ZONE_WORKER,
    edgeLoopMarker: names.includes('cf-ew-via'),
  };
  if (Object.values(markers).some(Boolean)) return { reason: 'workerSource', markers };
  if (supplied.length === 0) return { reason: 'missingSource', markers };
  if (supplied.length !== 1) return { reason: 'duplicateSource', markers };
  if (!peer) return { reason: 'invalidSource', markers };
  return { peer, markers };
}

function routeFor(method, rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')
    || rawUrl.includes('\\') || rawUrl.length > 512) return;
  let url;
  try { url = new URL(rawUrl, 'http://127.0.0.1'); } catch { return; }
  if (url.hash || url.origin !== 'http://127.0.0.1') return;
  if (url.pathname === '/api/observer/read') {
    const ids = url.searchParams.getAll('endpointId');
    if (method === 'OPTIONS' && !url.search) return { path: url.pathname, preflight: 'POST' };
    if ((method !== 'POST' && method !== 'OPTIONS') || [...url.searchParams.keys()].length !== 1
      || ids.length !== 1 || !ENDPOINT.test(ids[0])) return;
    return { path: `${url.pathname}?endpointId=${ids[0]}`, preflight: method === 'OPTIONS' ? 'POST' : undefined };
  }
  if (DIAGNOSTICS.test(url.pathname) && !url.search && (method === 'GET' || method === 'OPTIONS')) {
    return { path: url.pathname, preflight: method === 'OPTIONS' ? 'GET' : undefined };
  }
  if (url.pathname === '/api/health' && !url.search && method === 'GET') return { path: url.pathname };
}

function requestHeaders(request, peer, route) {
  const headers = { 'x-forwarded-for': peer };
  if (route.preflight) {
    const method = single(request.rawHeaders, 'access-control-request-method');
    const requested = values(request.rawHeaders, 'access-control-request-headers');
    if (method !== route.preflight || requested.length > 1
      || requested[0]?.length > 256 || requested[0]?.split(',').some((name) =>
        !['content-type', 'x-monolith-run', 'x-monolith-case'].includes(name.trim().toLowerCase()))) return;
    headers['access-control-request-method'] = method;
    if (requested[0]) headers['access-control-request-headers'] = requested[0];
    return headers;
  }
  if (request.method !== 'POST') return headers;
  const contentType = single(request.rawHeaders, 'content-type');
  const run = values(request.rawHeaders, 'x-monolith-run');
  const caseLabel = values(request.rawHeaders, 'x-monolith-case');
  if (contentType !== 'application/json' || run.length > 1 || caseLabel.length > 1
    || run[0] !== undefined && !RUN.test(run[0])
    || caseLabel[0] !== undefined && !['baseline', 'protected', 'outage'].includes(caseLabel[0])) return;
  headers['content-type'] = 'application/json';
  if (run[0]) headers['x-monolith-run'] = run[0];
  if (caseLabel[0]) headers['x-monolith-case'] = caseLabel[0];
  return headers;
}

function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }

/** No capability, raw source, payload or unsanitized process output is logged. */
export async function createObserverEdge({ observerPort, capabilityHost, port = 0,
  timeoutMs = 12_000, maxBodyBytes = BODY_LIMIT, maxResponseBytes = RESPONSE_LIMIT } = {}) {
  if (!integer(observerPort, 1, 65_535) || !integer(port, 0, 65_535)
    || !/^[a-f0-9]{64}\.invalid$/.test(capabilityHost ?? '')
    || !integer(timeoutMs, 20, 30_000) || !integer(maxBodyBytes, 1, BODY_LIMIT)
    || !integer(maxResponseBytes, 1, RESPONSE_LIMIT)) throw new Error('Invalid temporary edge configuration.');
  const expectedHost = Buffer.from(capabilityHost);
  const sockets = new Set();
  const active = new Set();
  // Fixed categories support deployment diagnosis without retaining any raw
  // source, request value, private capability or arbitrary exception text.
  const counters = { forwarded: 0, denied: 0, reasons: {
    unauthenticatedHost: 0, missingSource: 0, duplicateSource: 0,
    invalidSource: 0, workerSource: 0, routeOrHeader: 0, resource: 0,
  }, markers: { workerHeader: 0, workerLoop: 0, workerSentinel: 0, edgeLoopMarker: 0 } };
  let pendingRequests = 0;
  let closed = false;
  const server = createServer({ maxHeaderSize: 8_192, requestTimeout: timeoutMs,
    headersTimeout: Math.min(timeoutMs, 5_000), keepAliveTimeout: 1_000 }, (request, response) => {
    let upstream;
    let complete = false;
    let timer;
    const finish = (status, reason = 'resource') => {
      if (complete) return;
      complete = true;
      counters.denied++;
      counters.reasons[reason]++;
      clearTimeout(timer);
      upstream?.destroy();
      request.resume();
      if (!response.destroyed) {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
          'access-control-allow-origin': '*', 'connection': 'close' });
        response.end('{"schemaVersion":1,"ok":false,"error":{"code":"POLICY_DENIED","message":"Temporary observer edge rejected request.","retryable":false}}');
      }
    };
    timer = setTimeout(() => finish(504), timeoutMs);
    timer.unref();
    const host = single(request.rawHeaders, 'host');
    const suppliedHost = Buffer.from(host ?? '');
    const authenticated = suppliedHost.length === expectedHost.length && timingSafeEqual(suppliedHost, expectedHost);
    if (!authenticated) { finish(403, 'unauthenticatedHost'); return; }
    const resolved = source(request.rawHeaders);
    for (const name of Object.keys(counters.markers)) {
      if (resolved.markers[name]) counters.markers[name]++;
    }
    if (!resolved.peer) { finish(403, resolved.reason); return; }
    const peer = resolved.peer;
    const route = routeFor(request.method, request.url);
    const headers = peer && route ? requestHeaders(request, peer, route) : undefined;
    if (!route || !headers || values(request.rawHeaders, 'expect').length > 0) { finish(403, 'routeOrHeader'); return; }
    if (closed || pendingRequests >= 32) { finish(403); return; }
    pendingRequests++;
    response.once('close', () => { pendingRequests--; });
    const length = single(request.rawHeaders, 'content-length');
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) { finish(413); return; }
    const chunks = [];
    let bytes = 0;
    request.on('error', () => finish(400));
    request.on('aborted', () => finish(400));
    response.on('close', () => {
      clearTimeout(timer);
      if (!complete) { complete = true; upstream?.destroy(); }
    });
    request.on('data', (chunk) => {
      if (complete) return;
      bytes += chunk.length;
      if (bytes > maxBodyBytes || request.method !== 'POST' && bytes > 0) { finish(413); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (complete) return;
      upstream = httpRequest({ hostname: '127.0.0.1', port: observerPort, method: request.method,
        path: route.path, headers: { ...headers, ...(bytes ? { 'content-length': String(bytes) } : {}) },
        agent: false }, (reply) => {
        const returned = [];
        let returnedBytes = 0;
        if (!reply.statusCode || reply.statusCode < 200 || reply.statusCode >= 300 && reply.statusCode < 400) {
          reply.resume(); finish(502); return;
        }
        reply.on('error', () => finish(502));
        reply.on('aborted', () => finish(502));
        reply.on('data', (chunk) => {
          if (complete) return;
          returnedBytes += chunk.length;
          if (returnedBytes > maxResponseBytes) { finish(502); return; }
          returned.push(chunk);
        });
        reply.on('end', () => {
          if (complete) return;
          complete = true;
          clearTimeout(timer);
          const safeHeaders = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
          for (const name of ['content-type', 'access-control-allow-methods', 'access-control-allow-headers']) {
            if (typeof reply.headers[name] === 'string') safeHeaders[name] = reply.headers[name];
          }
          response.writeHead(reply.statusCode, safeHeaders);
          response.end(Buffer.concat(returned));
        });
      });
      active.add(upstream);
      upstream.once('close', () => active.delete(upstream));
      upstream.on('error', () => finish(502));
      counters.forwarded++;
      upstream.end(Buffer.concat(chunks));
    });
  });
  // Bound incomplete body senders as well as already forwarded observer calls.
  server.maxConnections = 64;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  // Parser failures can include raw data in their Error object; discard it.
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  await new Promise((resolve, reject) => {
    const error = () => { server.removeListener('listening', listening); reject(new Error('Temporary edge could not listen.')); };
    const listening = () => { server.removeListener('error', error); resolve(); };
    server.once('error', error); server.once('listening', listening);
    server.listen(port, '127.0.0.1');
  });
  return {
    server, port: server.address().port,
    counters: () => ({ ...counters, reasons: { ...counters.reasons }, markers: { ...counters.markers } }),
    async close() {
      closed = true;
      for (const call of active) call.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** Consume both child output streams here. Never save/print cloudflared lines. */
export function createTunnelOutputProjector(onOrigin) {
  if (typeof onOrigin !== 'function') throw new Error('Invalid tunnel output handler.');
  let pending = '';
  let emitted = false;
  const inspect = (line) => {
    if (emitted) return;
    const match = /https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.trycloudflare\.com(?=$|[\s|/])/i.exec(line);
    if (!match) return;
    emitted = true;
    onOrigin(`https://${match[1].toLowerCase()}.trycloudflare.com`);
  };
  return {
    push(chunk) {
      if (emitted || !(typeof chunk === 'string' || Buffer.isBuffer(chunk))) return;
      // A chunk can contain arbitrary raw logs. Only complete bounded lines are
      // considered; keep at most a possible hostname suffix across long lines.
      pending += chunk.toString();
      let next;
      while ((next = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, next);
        pending = pending.slice(next + 1);
        inspect(line.length > 8_192 ? line.slice(-8_192) : line);
      }
      if (pending.length > 8_192) pending = pending.slice(-8_192);
    },
    end() { inspect(pending); pending = ''; },
  };
}
