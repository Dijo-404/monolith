import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { makeError } from '@monolith/shared';
import { createProxyListener } from './proxy-v2.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const READ = new RegExp(`^/api/observer/read\\?endpointId=lab_optimism&runId=(run-${UUID})$`);
const DIAGNOSTICS = new RegExp(`^/api/observer/runs/run-${UUID}$`);
const LIMITS = { maxConnections: 64, maxConcurrent: 16, requestsPerMinute: 240,
  prefixTimeoutMs: 3_000, headerTimeoutMs: 3_000, bodyTimeoutMs: 3_000, responseTimeoutMs: 12_000,
  lifetimeMs: 20_000, maxBodyBytes: 16 * 1024, maxResponseBytes: 512 * 1024 };
export type EdgeLimits = typeof LIMITS;

export function publicRoute(method: string | undefined, target: string | undefined) {
  if (!target || target.length > 256 || !['GET', 'POST', 'OPTIONS'].includes(method ?? '')) return null;
  if (target === '/api/health' && method === 'GET') return { kind: 'health', path: target } as const;
  if (target === '/api/registry/chains?chainId=10' && (method === 'GET' || method === 'OPTIONS')) return { kind: 'registry', path: target } as const;
  if (target === '/api/observer/runs' && (method === 'POST' || method === 'OPTIONS')) return { kind: 'allocation', path: target } as const;
  if (DIAGNOSTICS.test(target) && (method === 'GET' || method === 'OPTIONS')) return { kind: 'diagnostics', path: target } as const;
  const read = READ.exec(target);
  if (read && (method === 'POST' || method === 'OPTIONS')) return {
    kind: 'read', path: '/api/observer/read?endpointId=lab_optimism', runId: read[1]!,
  } as const;
  return null;
}

/** Private backend port and source policy are operator-owned; callers never choose them. */
export async function createPublicLabEdge(options: { observerPort: number; nowMs?: () => number; limits?: Partial<EdgeLimits> }) {
  if (!Number.isInteger(options.observerPort) || options.observerPort < 1 || options.observerPort > 65535) throw new Error('Invalid public edge configuration.');
  const limits = { ...LIMITS, ...options.limits };
  if (Object.keys(limits).some((key) => !Object.hasOwn(LIMITS, key))
    || Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1 || value > 1024 * 1024)) throw new Error('Invalid public edge limits.');
  const nowMs = options.nowMs ?? Date.now;
  const pending = new Set<ReturnType<typeof httpRequest>>();
  let windowStart = nowMs(); let admitted = 0; let concurrent = 0; let closing = false;
  const counts = { requests: 0, denied: 0, forwarded: 0, missingContentTypeFilled: 0, missingRunHeaderFilled: 0, conflictsDenied: 0 };
  const deny = (response: ServerResponse, status: number) => {
    counts.denied++;
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
      'access-control-allow-origin': '*', connection: 'close' });
    response.end(JSON.stringify({ schemaVersion: 1, ok: false, error: makeError(status === 429 ? 'RATE_LIMITED' : 'POLICY_DENIED') }));
  };
  const values = (request: IncomingMessage, name: string) => request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === name ? [request.rawHeaders[index + 1]!] : []);
  const http = createServer({ maxHeaderSize: 8 * 1024, insecureHTTPParser: false, requireHostHeader: true }, (request, response) => {
    counts.requests++;
    const source = proxy.begin(request.socket);
    const now = nowMs();
    if (now < windowStart || now - windowStart >= 60_000) { windowStart = now; admitted = 0; }
    if (!source || closing || !Number.isFinite(now)) { deny(response, 403); return; }
    if (admitted >= limits.requestsPerMinute || concurrent >= limits.maxConcurrent) { deny(response, 429); return; }
    admitted++; concurrent++;
    let released = false;
    const release = () => { if (!released) { released = true; concurrent--; } };
    response.once('close', release); response.once('finish', release);
    const route = publicRoute(request.method, request.url);
    const types = values(request, 'content-type'); const runs = values(request, 'x-monolith-run');
    const cases = values(request, 'x-monolith-case'); const lengths = values(request, 'content-length');
    if (!route || request.httpVersion !== '1.1' || values(request, 'host').length !== 1
      || request.rawHeaders.length > 64 || lengths.length > 1 || types.length > 1 || runs.length > 1 || cases.length > 1
      || values(request, 'transfer-encoding').length || values(request, 'expect').length
      || values(request, 'authorization').length || values(request, 'cookie').length
      || request.rawHeaders.some((name, index) => index % 2 === 0 && name.toLowerCase().startsWith('x-monolith-')
        && !['x-monolith-run', 'x-monolith-case'].includes(name.toLowerCase()))
      || route.kind !== 'read' && (runs.length > 0 || cases.length > 0)
      || cases.length === 1 && !['baseline', 'protected', 'outage'].includes(cases[0]!)) { deny(response, 403); return; }
    if (route.kind === 'read' && request.method === 'POST' && (types.length === 1 && types[0] !== 'application/json'
      || runs.length === 1 && runs[0] !== route.runId)) { counts.conflictsDenied++; deny(response, 403); return; }
    const declared = lengths[0];
    const bodyLimit = route.kind === 'allocation' ? 128 : limits.maxBodyBytes;
    if (declared !== undefined && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > bodyLimit)
      || request.method !== 'POST' && declared !== undefined && declared !== '0') { deny(response, 413); return; }
    const chunks: Buffer[] = []; let size = 0; let failed = false;
    const bodyTimer = setTimeout(() => { failed = true; deny(response, 408); request.destroy(); }, limits.bodyTimeoutMs);
    bodyTimer.unref();
    const finishBody = () => clearTimeout(bodyTimer);
    request.once('aborted', () => { failed = true; finishBody(); });
    request.once('error', () => { failed = true; finishBody(); });
    response.once('close', finishBody);
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (failed) return;
      if (size > bodyLimit || request.method !== 'POST') { failed = true; deny(response, 413); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.once('end', () => {
      finishBody(); if (failed || response.destroyed) return;
      const body = Buffer.concat(chunks);
      const headers: Record<string, string> = { host: `127.0.0.1:${options.observerPort}`, connection: 'close',
        'x-forwarded-for': source, 'content-length': String(body.length) };
      for (const name of ['content-type', 'access-control-request-method', 'access-control-request-headers']) {
        const entries = values(request, name);
        if (entries.length > 1) { deny(response, 403); return; }
        if (entries[0] !== undefined) headers[name] = entries[0];
      }
      if (route.kind === 'read' && request.method === 'POST') {
        if (!types.length) { headers['content-type'] = 'application/json'; counts.missingContentTypeFilled++; }
        if (!runs.length) counts.missingRunHeaderFilled++;
        headers['x-monolith-run'] = route.runId;
        if (cases[0] !== undefined) headers['x-monolith-case'] = cases[0];
      }
      const upstream = httpRequest({ host: '127.0.0.1', port: options.observerPort, method: request.method,
        path: route.path, headers, agent: false }, (reply) => {
        const output: Buffer[] = []; let bytes = 0;
        reply.on('data', (chunk: Buffer) => { bytes += chunk.length;
          if (bytes > limits.maxResponseBytes) { reply.destroy(); upstream.destroy(); deny(response, 502); }
          else output.push(chunk);
        });
        reply.once('error', () => deny(response, 502));
        reply.once('end', () => {
          if (response.destroyed || response.writableEnded) return;
          const retained: Record<string, string> = { connection: 'close', 'cache-control': 'no-store' };
          for (const name of ['content-type', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']) {
            const value = reply.headers[name]; if (typeof value === 'string') retained[name] = value;
          }
          response.writeHead(reply.statusCode ?? 502, retained); response.end(Buffer.concat(output));
        });
      });
      pending.add(upstream); counts.forwarded++;
      const timer = setTimeout(() => { upstream.destroy(); deny(response, 504); }, limits.responseTimeoutMs); timer.unref();
      upstream.once('close', () => { clearTimeout(timer); pending.delete(upstream); });
      upstream.once('error', () => deny(response, 502));
      response.once('close', () => { if (!response.writableFinished) upstream.destroy(); });
      upstream.end(body);
    });
  });
  // Inspect every raw field within the byte bound; do not silently truncate duplicates.
  http.maxHeadersCount = 0;
  http.on('clientError', (_error, socket) => socket.destroy());
  http.on('checkContinue', (_request, response) => deny(response, 403));
  http.on('checkExpectation', (_request, response) => deny(response, 403));
  http.on('connect', (_request, socket) => socket.destroy());
  http.on('upgrade', (_request, socket) => socket.destroy());
  const proxy = await createProxyListener(http, limits);
  return { port: proxy.port,
    counters: () => ({ ...counts, concurrent, pendingUpstreams: pending.size, ...proxy.counters() }),
    async close() { if (closing) return; closing = true; for (const operation of pending) operation.destroy(); await proxy.close(); },
  };
}
