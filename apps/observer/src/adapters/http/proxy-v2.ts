import { createServer, isIP, type Socket } from 'node:net';
import type { Server as HttpServer } from 'node:http';

const SIGNATURE = Buffer.from([13, 10, 13, 10, 0, 13, 10, 81, 85, 73, 84, 10]);
type Prefix = { status: 'pending' | 'rejected' } | { status: 'accepted'; source: string; bytes: number };

/** A trusted TCP connection supplies exactly one bounded binary source envelope. */
export function parseProxyV2(bytes: Buffer): Prefix {
  if (bytes.length < 16) return { status: 'pending' };
  if (!bytes.subarray(0, 12).equals(SIGNATURE) || bytes[12] !== 0x21) return { status: 'rejected' };
  const length = bytes.readUInt16BE(14);
  const family = bytes[13];
  const minimum = family === 0x11 ? 12 : family === 0x21 ? 36 : 0;
  if (!minimum || length < minimum || length > 512) return { status: 'rejected' };
  if (bytes.length < 16 + length) return { status: 'pending' };
  const source = family === 0x11 ? [...bytes.subarray(16, 20)].join('.')
    : Array.from({ length: 8 }, (_, index) => bytes.readUInt16BE(16 + index * 2).toString(16)).join(':');
  const offset = family === 0x11 ? 24 : 48;
  if (isIP(source) !== (family === 0x11 ? 4 : 6) || !bytes.readUInt16BE(offset) || !bytes.readUInt16BE(offset + 2)) {
    return { status: 'rejected' };
  }
  return { status: 'accepted', source, bytes: 16 + length };
}

export async function createProxyListener(http: HttpServer, options: {
  maxConnections: number; prefixTimeoutMs: number; headerTimeoutMs: number; lifetimeMs: number;
}) {
  const sources = new WeakMap<Socket, string>();
  const headerTimers = new WeakMap<Socket, ReturnType<typeof setTimeout>>();
  const used = new WeakSet<Socket>();
  const sockets = new Set<Socket>();
  const counts = { connections: 0, acceptedProxy: 0, rejectedProxy: 0, droppedConnections: 0 };
  const listener = createServer((socket) => {
    counts.connections++;
    if (sockets.size >= options.maxConnections) { counts.droppedConnections++; socket.destroy(); return; }
    sockets.add(socket);
    let prefix = Buffer.alloc(0);
    let finished = false;
    const reject = () => { if (!finished) { finished = true; counts.rejectedProxy++; } socket.destroy(); };
    const prefixTimer = setTimeout(reject, options.prefixTimeoutMs);
    const lifetime = setTimeout(() => socket.destroy(), options.lifetimeMs);
    prefixTimer.unref(); lifetime.unref();
    const onData = (chunk: Buffer) => {
      if (prefix.length + chunk.length > 64 * 1024) { reject(); return; }
      prefix = Buffer.concat([prefix, chunk]);
      const result = parseProxyV2(prefix);
      if (result.status === 'pending') { if (prefix.length > 528) reject(); return; }
      if (result.status !== 'accepted') { reject(); return; }
      finished = true; clearTimeout(prefixTimer); socket.off('data', onData);
      counts.acceptedProxy++; sources.set(socket, result.source);
      const headerTimer = setTimeout(() => socket.destroy(), options.headerTimeoutMs);
      headerTimer.unref(); headerTimers.set(socket, headerTimer);
      socket.pause(); http.emit('connection', socket);
      const remaining = prefix.subarray(result.bytes); prefix = Buffer.alloc(0);
      if (remaining.length) socket.unshift(remaining);
      socket.resume();
    };
    socket.on('data', onData);
    socket.on('error', () => {});
    socket.once('close', () => {
      clearTimeout(prefixTimer); clearTimeout(lifetime); clearTimeout(headerTimers.get(socket));
      sources.delete(socket); headerTimers.delete(socket); sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Public edge could not bind.');
  return {
    port: address.port,
    begin(socket: Socket) {
      const source = sources.get(socket);
      if (!source || used.has(socket)) return undefined;
      used.add(socket); clearTimeout(headerTimers.get(socket)); headerTimers.delete(socket);
      return source;
    },
    counters: () => ({ ...counts, activeConnections: sockets.size }),
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => listener.close(() => resolve())); },
  };
}
