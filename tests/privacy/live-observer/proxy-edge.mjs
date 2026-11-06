// localhost.run's PROXYv2 stream is trusted only over the operator's pinned SSH
// connection into this loopback listener. HTTP forwarding headers never supply
// a source. The existing edge retains its HTTP policy and its Cloudflare guard.
import { createServer, isIP } from 'node:net';
import { createObserverEdge } from './edge.mjs';

const SIGNATURE = Buffer.from([13, 10, 13, 10, 0, 13, 10, 81, 85, 73, 84, 10]);
const SOURCES = new WeakMap();
const FORWARDING = new Set(['host', 'forwarded', 'x-forwarded-for', 'x-real-ip',
  'cf-connecting-ip', 'cf-worker', 'cf-ew-via', 'cdn-loop']);

/** Only a complete, bounded TCP PROXYv2 command can establish a source. */
export function parseProxyV2(bytes) {
  if (!Buffer.isBuffer(bytes)) return { status: 'rejected' };
  if (bytes.length < 16) return { status: 'pending' };
  if (!bytes.subarray(0, 12).equals(SIGNATURE) || bytes[12] !== 0x21) return { status: 'rejected' };
  const length = bytes.readUInt16BE(14);
  const family = bytes[13];
  const minimum = family === 0x11 ? 12 : family === 0x21 ? 36 : 0;
  if (minimum === 0 || length < minimum || length > 512) return { status: 'rejected' };
  if (bytes.length < 16 + length) return { status: 'pending' };
  const source = family === 0x11 ? [...bytes.subarray(16, 20)].join('.')
    : Array.from({ length: 8 }, (_entry, index) => bytes.readUInt16BE(16 + index * 2).toString(16)).join(':');
  const sourcePort = bytes.readUInt16BE(16 + (family === 0x11 ? 8 : 32));
  const targetPort = bytes.readUInt16BE(16 + (family === 0x11 ? 10 : 34));
  if (isIP(source) !== (family === 0x11 ? 4 : 6) || sourcePort === 0 || targetPort === 0) {
    return { status: 'rejected' };
  }
  return { status: 'accepted', source, bytes: 16 + length };
}

export async function createProxyObserverEdge({ observerPort, capabilityHost, timeoutMs = 12_000, labRunId } = {}) {
  if (labRunId !== undefined && !/^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(labRunId)) {
    throw new Error('Invalid fixed lab run.');
  }
  const edge = await createObserverEdge({ observerPort, capabilityHost, timeoutMs });
  const sockets = new Set();
  const counts = { connections: 0, acceptedProxy: 0, rejectedProxy: 0, sourceRequests: 0,
    missingContentTypeFilled: 0, missingRunHeaderFilled: 0, labHeaderConflictsDenied: 0 };
  const requestShapes = [];
  // The private bridge reuses the existing HTTP allowlist/limits with one
  // replacement source. This cf-connecting-ip is an INTERNAL compatibility
  // slot, not a claim that Cloudflare supplied the source for this provider.
  edge.server.prependListener('request', (request) => {
    const source = SOURCES.get(request.socket);
    if (!source) return;
    const headerValues = (name) => {
      const found = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        if (request.rawHeaders[index].toLowerCase() === name) found.push(request.rawHeaders[index + 1]);
      }
      return found;
    };
    if (requestShapes.length < 16) {
      const values = (name) => request.rawHeaders.filter((_entry, index) => index % 2 === 0
        && request.rawHeaders[index].toLowerCase() === name).length;
      requestShapes.push({ method: ['GET', 'POST', 'OPTIONS'].includes(request.method) ? request.method : 'OTHER',
        route: request.url === '/api/health' ? 'health' : request.url === '/api/observer/read?endpointId=mn009_ethereum'
          ? 'read' : request.url.startsWith('/api/observer/runs/') ? 'diagnostics' : 'other',
        contentTypeCount: values('content-type'), jsonContentType: request.headers['content-type'] === 'application/json',
        runHeaderCount: values('x-monolith-run'), caseHeaderCount: values('x-monolith-case'),
        expectHeaderCount: values('expect') });
    }
    // This optional, single-run lab composition restores diagnostic metadata
    // omitted by the installed worker stack. It never supplies source evidence,
    // chooses a baseline, supplies a route label, or changes the actual body.
    const fixedLabRead = labRunId !== undefined && request.method === 'POST'
      && request.url === '/api/observer/read?endpointId=mn009_ethereum';
    const types = fixedLabRead ? headerValues('content-type') : [];
    const runs = fixedLabRead ? headerValues('x-monolith-run') : [];
    if (fixedLabRead && (types.length > 1 || runs.length > 1
      || types.length === 1 && types[0] !== 'application/json'
      || runs.length === 1 && runs[0] !== labRunId)) {
      counts.labHeaderConflictsDenied++;
      // Leave no authenticated private-hop envelope for the unchanged HTTP edge.
      request.rawHeaders = [];
      return;
    }
    const retained = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (!FORWARDING.has(request.rawHeaders[index].toLowerCase())) {
        retained.push(request.rawHeaders[index], request.rawHeaders[index + 1]);
      }
    }
    request.rawHeaders = [...retained, 'Host', capabilityHost, 'CF-Connecting-IP', source];
    if (fixedLabRead) {
      if (types.length === 0) { request.rawHeaders.push('Content-Type', 'application/json'); counts.missingContentTypeFilled++; }
      if (runs.length === 0) { request.rawHeaders.push('X-Monolith-Run', labRunId); counts.missingRunHeaderFilled++; }
    }
    counts.sourceRequests++;
  });
  const listener = createServer((socket) => {
    counts.connections++;
    sockets.add(socket);
    let prefix = Buffer.alloc(0);
    let finished = false;
    const reject = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      counts.rejectedProxy++;
      socket.destroy();
    };
    const timer = setTimeout(reject, Math.min(timeoutMs, 5_000));
    timer.unref();
    const onData = (chunk) => {
      prefix = Buffer.concat([prefix, chunk]);
      const result = parseProxyV2(prefix);
      if (result.status === 'pending') {
        if (prefix.length > 528) reject();
        return;
      }
      if (result.status !== 'accepted') { reject(); return; }
      finished = true;
      clearTimeout(timer);
      socket.off('data', onData);
      counts.acceptedProxy++;
      SOURCES.set(socket, result.source);
      socket.pause();
      edge.server.emit('connection', socket);
      const remaining = prefix.subarray(result.bytes);
      prefix = Buffer.alloc(0);
      if (remaining.length) socket.unshift(remaining);
      socket.resume();
    };
    socket.on('data', onData);
    socket.on('error', () => {});
    socket.once('close', () => {
      clearTimeout(timer);
      SOURCES.delete(socket);
      sockets.delete(socket);
    });
  });
  listener.maxConnections = 64;
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: listener.address().port,
    privateHttpPort: edge.port,
    counters: () => ({ ...counts, requestShapes: requestShapes.map((entry) => ({ ...entry })), http: edge.counters() }),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => listener.close(resolve));
      await edge.close();
    },
  };
}

/** Only the provider's accepted registration event may select a public URL. */
export function createSshTunnelOutputProjector(onOrigin) {
  let pending = '';
  let emitted = false;
  return {
    push(chunk) {
      if (emitted || !(typeof chunk === 'string' || Buffer.isBuffer(chunk))) return;
      pending += chunk.toString();
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.length > 16_384) continue;
        try {
          const event = JSON.parse(line);
          const match = /^localhost\/([a-z0-9]{8,63}\.lhr\.life)$/.exec(event.id ?? '');
          if (event.type !== 'v1.tcpip_forward.register.accepted' || !match) continue;
          emitted = true;
          onOrigin(`https://${match[1]}`);
        } catch { /* Raw provider output is never exported or logged. */ }
      }
      if (pending.length > 16_384) pending = pending.slice(-16_384);
    },
    end() { pending = ''; },
  };
}
