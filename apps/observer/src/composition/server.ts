import Fastify from 'fastify';

/** Foundation only: no RPC forwarding, registry access, or signing routes. */
export function buildServer() {
  const server = Fastify({
    logger: false,
    trustProxy: false,
    requestIdHeader: false,
    bodyLimit: 16 * 1024,
  });

  server.get('/api/health', () => ({
    schemaVersion: 1,
    ok: true,
    value: { service: 'observer', status: 'scaffold' },
  }));

  return server;
}
