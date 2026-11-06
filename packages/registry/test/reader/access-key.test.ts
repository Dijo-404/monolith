// SIMULATED transport credentials and HTTP failures. Never contacts Rabdi.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRabdiEntityReader } from '../../src/adapters/arkiv/reader.js';
import type { PublisherPolicy } from '../../src/index.js';

const KEY = 'SIMULATED_SERVER_ONLY_KEY_123456';
const RPC_URL = 'https://rpc.rabdi.db-chain.testnet.arkiv.network/';
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
    const request = new Request(input, init);
    const rpc = await request.json() as { id?: unknown; method?: string };
    calls.push({ url: request.url, key: request.headers.get('x-api-key'), method: rpc.method ?? 'OTHER',
      redirect: request.redirect });
    // Provider failures can echo sensitive material. The reader must project it away.
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id,
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
  expect(calls[0]).toEqual({ url: RPC_URL, key: null, method: 'eth_chainId', redirect: 'error' });
});

test.each([
  ['public', undefined], ['keyed', KEY],
] as const)('%s reader refuses redirect destinations without retries or fallback', async (_mode, accessKey) => {
  const destination = 'https://unapproved.example/rpc?SIMULATED_PRIVATE_REDIRECT_TOKEN';
  const attempts: Array<{ url: string; key: string | null }> = [];
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    attempts.push({ url: request.url, key: request.headers.get('x-api-key') });
    // SIMULATED Fetch handling of a provider's 307 response. The native Request
    // supplies its effective redirect mode; no network implementation is called.
    const redirect = new Response(null, { status: 307, headers: { location: destination } });
    if (request.redirect === 'follow') {
      attempts.push({ url: redirect.headers.get('location')!, key: request.headers.get('x-api-key') });
    }
    if (request.redirect === 'manual') return redirect;
    throw new TypeError(`SIMULATED redirect failure ${destination} ${KEY}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await createRabdiEntityReader({ policy,
    ...(accessKey === undefined ? {} : { accessKey }),
  }).readChain('10');
  expect(result).toEqual({ ok: false, error: {
    code: 'REGISTRY_UNAVAILABLE', message: 'The registry is unavailable.', retryable: true,
  } });
  expect(attempts).toEqual([{ url: RPC_URL, key: accessKey ?? null }]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  for (const output of [JSON.stringify(result), JSON.stringify(warning.mock.calls)]) {
    expect(output).not.toContain(destination);
    expect(output).not.toContain('SIMULATED_PRIVATE_REDIRECT_TOKEN');
    expect(output).not.toContain(KEY);
  }
});

test('public reader still completes a normal fixed-origin read with no credential', async () => {
  const requests: Request[] = [];
  const methods: string[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const rpc = await request.json() as { id: unknown; method: string };
    requests.push(request);
    methods.push(rpc.method);
    let result: unknown;
    if (rpc.method === 'eth_chainId') result = '0x76edaf';
    else if (rpc.method === 'eth_blockNumber') result = '0x64';
    else if (rpc.method === 'arkiv_query') result = { data: [], blockNumber: '0x64', count: '0x0' };
    else throw new Error('Unexpected SIMULATED RPC method.');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }));
  const result = await createRabdiEntityReader({ policy }).readChain('10');
  // Actual SDK decoding is exercised, but all provider responses here are SIMULATED.
  expect(result).toMatchObject({ ok: true, value: { chainId: '10', blockNumber: '100', entities: [] } });
  expect(methods).toEqual(['eth_chainId', 'eth_blockNumber', 'arkiv_query', 'eth_chainId', 'eth_blockNumber']);
  expect(requests.map((request) => ({ url: request.url, redirect: request.redirect,
    key: request.headers.get('x-api-key'), method: request.method,
  }))).toEqual(Array.from({ length: 5 }, () => ({ url: RPC_URL, redirect: 'error', key: null, method: 'POST' })));
});

test.each(['', ' ', ' leading', 'trailing ', 'line\nbreak', 'line\rbreak', 'nul\0byte', 'nonascii-é', 'x'.repeat(513), null, 1])(
  'invalid explicit credentials fail before any request and never echo the input', (input) => {
    expect(() => createRabdiEntityReader({ policy, accessKey: input as string })).toThrow('Invalid server access key configuration.');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
