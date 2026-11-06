import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../src/composition/server.js';

describe('observer scaffold', () => {
  const servers: ReturnType<typeof buildServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('reports scaffold health without claiming integration readiness', async () => {
    const server = buildServer();
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      ok: true,
      value: { service: 'observer', status: 'scaffold' },
    });
  });

  it.each(['/api/checkout/submit', '/unknown'])(
    'does not expose an unimplemented route at %s',
    async (url) => {
      const server = buildServer();
      servers.push(server);

      const response = await server.inject({
        method: 'POST',
        url,
        payload: { jsonrpc: '2.0', id: 'synthetic', method: 'eth_chainId', params: [] },
      });

      expect(response.statusCode).toBe(404);
    },
  );

  it('denies forwarding when no operator endpoints are configured', async () => {
    const server = buildServer();
    servers.push(server);
    const response = await server.inject({ method: 'POST', url: '/api/observer/read?endpointId=unconfigured',
      payload: { jsonrpc: '2.0', id: 'synthetic', method: 'eth_chainId', params: [] } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ jsonrpc: '2.0', id: 'synthetic', error: { code: -32000 } });
  });
});
