import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { makeError, type JsonRpcSuccess, type Result } from '@monolith/shared';
import { buildServer } from '../../src/composition/server.js';
import type { UpstreamReader } from '../../src/domain/ports.js';

const servers: ReturnType<typeof buildServer>[] = [];
async function listen(upstream: UpstreamReader) {
  const server = buildServer({ config: {
    endpoints: [{ endpointId: 'synthetic-runtime', chainId: '1', rpcUrl: 'https://rpc.example.invalid', calls: [] }],
    sourcePolicy: { mode: 'unknown', trustedProxies: [] }, labRuns: [],
  }, upstream });
  servers.push(server);
  return { server, url: `${await server.listen({ host: '127.0.0.1', port: 0 })}/api/observer/read?endpointId=synthetic-runtime` };
}
const body = JSON.stringify({ jsonrpc: '2.0', id: 'runtime-synthetic', method: 'eth_chainId', params: [] });
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

it('normal completed POST bodies keep upstream work usable over actual HTTP', async () => {
  const { url } = await listen({ read: async (_endpoint, rpc, signal) => {
    await delay(15);
    expect(signal?.aborted).toBe(false);
    return { ok: true, value: { jsonrpc: '2.0', id: rpc.id, result: '0x1' } };
  } });
  for (let index = 0; index < 2; index++) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'runtime-synthetic', result: '0x1' });
  }
});

it.each(['client disconnect', 'server shutdown'])('%s cancels active work over actual HTTP', async (action) => {
  let observedAbort = false;
  let started = false;
  const { server, url } = await listen({ read: async (_endpoint, _rpc, signal) => {
    started = true;
    return await new Promise<Result<JsonRpcSuccess>>((resolve) => {
      const abort = () => { observedAbort = true; resolve({ ok: false, error: makeError('UPSTREAM_UNAVAILABLE') }); };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  } });
  const outgoing = httpRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => response.resume());
  outgoing.on('error', () => {});
  outgoing.end(body);
  await vi.waitFor(() => expect(started).toBe(true));
  await delay(15);
  expect(observedAbort).toBe(false);
  if (action === 'client disconnect') outgoing.destroy();
  else await server.close();
  await vi.waitFor(() => expect(observedAbort).toBe(true));
});
