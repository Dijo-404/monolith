// SIMULATED transport credentials and HTTP failures. Never contacts Rabdi.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRabdiEntityReader } from '../../src/adapters/arkiv/reader.js';
import type { PublisherPolicy } from '../../src/index.js';

const KEY = 'SIMULATED_SERVER_ONLY_KEY_123456';
const policy: PublisherPolicy = {
  creator: `0x${'1'.repeat(40)}`, owner: `0x${'1'.repeat(40)}`,
  sourceRevision: 'a'.repeat(40), snapshotSha256: 'b'.repeat(64),
  licenseSha256: '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
  allowedOrigins: ['https://mainnet.optimism.io'],
};
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected live network.'); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function httpFailure() {
  const calls: Array<{ url: string; key: string | null; method: string; redirect: string | null }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    const request = body as { id?: unknown; method?: string };
    calls.push({ url, key: headers.get('x-api-key'), method: request.method ?? 'OTHER',
      redirect: init?.redirect ?? (input instanceof Request ? input.redirect : null) });
    // Provider failures can echo sensitive material. The reader must project it away.
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
      error: { code: -32000, message: `SIMULATED provider echo ${KEY}` } }),
    { status: 401, headers: { 'content-type': 'application/json' } });
  };
  vi.stubGlobal('fetch', vi.fn(fetchMock));
  return calls;
}

test('explicit server authentication uses one private header on the fixed public URL; rejected keys never fall back', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const calls = httpFailure();
  const result = await createRabdiEntityReader({ policy, accessKey: KEY }).readChain('10');
  expect(calls).toEqual([{ url: 'https://rpc.rabdi.db-chain.testnet.arkiv.network/', key: KEY, method: 'eth_chainId', redirect: 'error' }]);
  expect(result).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
  expect(JSON.stringify(result)).not.toContain(KEY);
  expect(JSON.stringify(warning.mock.calls)).not.toContain(KEY);
  expect(calls.every((call) => !call.url.includes(KEY))).toBe(true);
});

test('public default does not acquire a credential from the surrounding process environment', async () => {
  vi.stubEnv('ARKIV_ACCESS_KEY', KEY);
  const calls = httpFailure();
  await createRabdiEntityReader({ policy }).readChain('10');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ url: 'https://rpc.rabdi.db-chain.testnet.arkiv.network/', key: null, method: 'eth_chainId' });
});

test.each(['', ' ', ' leading', 'trailing ', 'line\nbreak', 'line\rbreak', 'nul\0byte', 'nonascii-é', 'x'.repeat(513), null, 1])(
  'invalid explicit credentials fail before any request and never echo the input', (input) => {
    expect(() => createRabdiEntityReader({ policy, accessKey: input as string })).toThrow('Invalid server access key configuration.');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
