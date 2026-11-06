import { describe, expect, it, vi } from 'vitest';
import { rpcTraceSchema } from '@monolith/shared';
import type { RpcTrace } from '@monolith/shared';
import {
  BOOTSTRAP_SELECTORS, WORKER_SPECIFIERS, createBootstrapProvider, readJsonResponse,
} from '../src/adapters/browser/io.js';

const HASH = `0x${'a1'.repeat(32)}`;
const EMPTY_RESOLVERS = `0x${'0'.repeat(62)}20${'0'.repeat(64)}`;
const RPC = 'https://bootstrap.example.org/';
const clock = { now: () => '2030-01-01T00:00:00.000Z' };

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init, headers: { 'content-type': 'application/json', ...init.headers },
  });
}
function call(selector: string = BOOTSTRAP_SELECTORS.hash): { method: string; params: unknown } {
  return { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: selector }, 'latest'] };
}
function setup(response?: (id: string, selector: string) => Response | Promise<Response>) {
  const abort = new AbortController();
  const traces: RpcTrace[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { id: string; params: [{ data: string }] };
    return response ? response(body.id, body.params[0].data)
      : json({ jsonrpc: '2.0', id: body.id,
        result: body.params[0].data === BOOTSTRAP_SELECTORS.hash ? HASH : EMPTY_RESOLVERS });
  });
  const provider = createBootstrapProvider({ network: 'nym', rpcUrl: RPC, signal: abort.signal,
    clock, traceSink: { emit: (trace) => traces.push(trace) }, fetcher });
  return { abort, traces, fetcher, provider };
}

describe('bounded JSON response boundary', () => {
  it('decodes a valid streamed JSON response and accepts MIME parameters', async () => {
    const response = json({ result: 'hello' }, { headers: { 'content-type': 'Application/JSON; charset=UTF-8' } });
    expect(await readJsonResponse(response, new AbortController().signal)).toEqual({
      ok: true, value: { result: 'hello' },
    });
  });

  it.each([
    [429, 'RATE_LIMITED'], [301, 'UPSTREAM_UNAVAILABLE'], [401, 'UPSTREAM_UNAVAILABLE'],
    [500, 'UPSTREAM_UNAVAILABLE'], [503, 'UPSTREAM_UNAVAILABLE'],
  ])('sanitizes HTTP %i without reading its diagnostic body', async (status, code) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: status as number, headers: { 'content-type': 'application/json' },
    });
    const outcome = await readJsonResponse(response, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, error: { code } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['text/html', 'application/ld+json', 'text/plain', ''])('rejects MIME %s', async (contentType) => {
    const response = json({ result: 1 }, { headers: { 'content-type': contentType } });
    expect(await readJsonResponse(response, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'RPC_RESPONSE_INVALID' },
    });
  });

  it.each(['99999999999999999999999999999999999999', '-1', 'NaN', '5.5'])('rejects content-length %s', async (length) => {
    const response = json({ result: 1 }, { headers: { 'content-length': length } });
    expect(await readJsonResponse(response, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'RPC_RESPONSE_INVALID' },
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 17 * 1024 * 1024])(
    'rejects an invalid byte cap %s', async (limit) => {
      expect(await readJsonResponse(json({}), new AbortController().signal, limit)).toMatchObject({
        ok: false, error: { code: 'INVALID_INPUT' },
      });
    },
  );

  it('counts actual UTF-8 bytes across chunks rather than trusting a small header', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('"é'));
        controller.enqueue(new TextEncoder().encode('é"'));
      }, cancel,
    }), { headers: { 'content-type': 'application/json', 'content-length': '1' } });
    expect(await readJsonResponse(response, new AbortController().signal, 5)).toMatchObject({
      ok: false, error: { code: 'RPC_RESPONSE_INVALID' },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts an exactly bounded body', async () => {
    expect(await readJsonResponse(json('é'), new AbortController().signal, 4)).toEqual({ ok: true, value: 'é' });
  });

  it.each(['{"private":"unterminated', 'undefined', '[1,]', '1e999'])('sanitizes invalid JSON %s', async (body) => {
    const response = new Response(body, { headers: { 'content-type': 'application/json' } });
    const outcome = await readJsonResponse(response, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'RPC_RESPONSE_INVALID' } });
    expect(JSON.stringify(outcome)).not.toContain(body);
  });

  it('rejects invalid UTF-8 rather than substituting replacement characters', async () => {
    const response = new Response(new Uint8Array([34, 0xff, 34]), {
      headers: { 'content-type': 'application/json' },
    });
    expect(await readJsonResponse(response, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'RPC_RESPONSE_INVALID' },
    });
  });

  it('rejects excessive JSON nesting and node counts', async () => {
    for (const body of [`${'['.repeat(66)}0${']'.repeat(66)}`, JSON.stringify(Array(10_001).fill(0))]) {
      expect(await readJsonResponse(new Response(body, { headers: { 'content-type': 'application/json' } }),
        new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'RPC_RESPONSE_INVALID' } });
    }
  });

  it('rejects redirected responses', async () => {
    const response = json({ result: 1 });
    Object.defineProperty(response, 'redirected', { value: true });
    expect(await readJsonResponse(response, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' },
    });
  });

  it('aborts a stalled stream even if its cancellation promise never settles', async () => {
    const abort = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json' },
    });
    const outcome = readJsonResponse(response, abort.signal);
    abort.abort(new Error('private diagnostic'));
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not read a pre-aborted response', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await readJsonResponse(json({}), abort.signal)).toMatchObject({
      ok: false, error: { code: 'UPSTREAM_TIMEOUT' },
    });
  });

  it('returns a typed failure for a locked or consumed body', async () => {
    const consumed = json({ result: 1 });
    await consumed.text();
    const locked = json({ result: 1 });
    const reader = locked.body!.getReader();
    for (const response of [consumed, locked]) {
      expect(await readJsonResponse(response, new AbortController().signal)).toMatchObject({
        ok: false, error: { code: 'RPC_RESPONSE_INVALID' },
      });
    }
    await reader.cancel();
    reader.releaseLock();
  });

  it('sanitizes a stream read error', async () => {
    const response = new Response(new ReadableStream({
      start(controller) { controller.error(new Error('private diagnostic')); },
    }), { headers: { 'content-type': 'application/json' } });
    const outcome = await readJsonResponse(response, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'RPC_RESPONSE_INVALID' } });
    expect(JSON.stringify(outcome)).not.toContain('private');
  });
});

describe('narrow, separately disclosed bootstrap provider', () => {
  it('performs exactly the two fixed reads with no credentials, redirects or private traces', async () => {
    const { provider, fetcher, traces } = setup();
    expect(provider.metadata()).toEqual({ specifier: WORKER_SPECIFIERS.nym, workerHash: null, bootstrapCalls: 0 });
    expect(await provider.request(call())).toBe(HASH);
    expect(await provider.request(call(BOOTSTRAP_SELECTORS.resolvers))).toBe(EMPTY_RESOLVERS);
    expect(provider.metadata()).toEqual({ specifier: WORKER_SPECIFIERS.nym, workerHash: HASH, bootstrapCalls: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe(RPC);
      expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
      expect(options?.headers).toEqual({ 'content-type': 'application/json' });
    }
    expect(traces).toHaveLength(2);
    for (const trace of traces) {
      expect(rpcTraceSchema.safeParse(trace).success).toBe(true);
      expect(trace).toMatchObject({ route: 'direct-bootstrap', bootstrap: true, success: true, evidence: 'SIMULATED' });
      expect(JSON.stringify(trace)).not.toContain(WORKER_SPECIFIERS.nym);
      expect(trace).not.toHaveProperty('params');
      expect(trace).not.toHaveProperty('result');
    }
  });

  it.each([
    { method: 'eth_getBalance', params: [WORKER_SPECIFIERS.nym, 'latest'] },
    { method: 'eth_chainId', params: [] },
    { method: 'eth_sendRawTransaction', params: ['0xdeadbeef'] },
    { method: 'eth_call' },
    { method: 'eth_call', params: null },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.tor, data: BOOTSTRAP_SELECTORS.hash }, 'latest'] },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: '0x70a08231' }, 'latest'] },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: `${BOOTSTRAP_SELECTORS.hash}00` }, 'latest'] },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: BOOTSTRAP_SELECTORS.hash, value: '0x0' }, 'latest'] },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: BOOTSTRAP_SELECTORS.hash }, 'pending'] },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: BOOTSTRAP_SELECTORS.hash }, 'latest', 'extra'] },
    { method: 'eth_call', params: [{ to: WORKER_SPECIFIERS.nym, data: BOOTSTRAP_SELECTORS.hash }, 'latest'], secret: 'private' },
  ])('denies out-of-capability lookup %# before fetch', async (request) => {
    const { provider, fetcher, traces } = setup();
    await expect(provider.request(request)).rejects.toThrow('bootstrap policy denied');
    expect(fetcher).not.toHaveBeenCalled();
    expect(traces).toHaveLength(0);
    expect(provider.metadata().bootstrapCalls).toBe(0);
  });

  it('accepts checksum-insensitive specifier address but sends only its pinned spelling', async () => {
    const { provider, fetcher } = setup();
    await provider.request({ method: 'eth_call',
      params: [{ to: WORKER_SPECIFIERS.nym.toLowerCase(), data: BOOTSTRAP_SELECTORS.hash }, 'latest'] });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).params[0].to).toBe(WORKER_SPECIFIERS.nym);
  });

  it('reserves a lookup before awaiting to deny concurrent duplicate and retry calls', async () => {
    let resolve!: (value: Response) => void;
    const { provider, fetcher } = setup(() => new Promise((res) => { resolve = res; }));
    const first = provider.request(call());
    await expect(provider.request(call())).rejects.toThrow('bootstrap policy denied');
    await Promise.resolve();
    resolve(json({ jsonrpc: '2.0', id: 'monolith_bootstrap_hash', result: HASH }));
    expect(await first).toBe(HASH);
    await expect(provider.request(call())).rejects.toThrow('bootstrap policy denied');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['http://bootstrap.example.org', 'https://user:secret@bootstrap.example.org',
    'https://localhost', 'https://127.0.0.1', 'https://2130706433', 'https://bootstrap.example.org:444'])(
    'denies unsafe bootstrap URL %s', async (rpcUrl) => {
      const fetcher = vi.fn<typeof fetch>();
      const provider = createBootstrapProvider({ network: 'nym', rpcUrl,
        signal: new AbortController().signal, clock, traceSink: { emit() {} }, fetcher });
      await expect(provider.request(call())).rejects.toThrow('bootstrap policy denied');
      expect(fetcher).not.toHaveBeenCalled();
    });

  it.each([
    { jsonrpc: '2.0', id: 'wrong', result: HASH },
    { jsonrpc: '2.0', id: null, error: { code: -1, message: 'private error' } },
    { jsonrpc: '2.0', id: 'monolith_bootstrap_hash', result: HASH, extra: 'private' },
    { jsonrpc: '2.0', id: 'monolith_bootstrap_hash', result: HASH, error: { code: -1, message: 'private' } },
    { jsonrpc: '2.0', id: 'monolith_bootstrap_hash', result: '0x12' },
    { jsonrpc: '2.0', id: 'monolith_bootstrap_hash', result: `0x${'00'.repeat(33)}` },
    { jsonrpc: '2.0', id: 'monolith_bootstrap_hash', result: { private: 'payload' } },
  ])('rejects malformed, mismatched or wrong-size bootstrap reply %#', async (body) => {
    const { provider, traces } = setup(() => json(body));
    await expect(provider.request(call())).rejects.toThrow(/^bootstrap unavailable$/);
    expect(traces[0]).toMatchObject({ success: false, evidence: 'BLOCKED', errorCode: 'RPC_RESPONSE_INVALID' });
    expect(JSON.stringify(traces)).not.toContain('private');
    expect(provider.metadata().workerHash).toBeNull();
  });

  it('sanitizes a correlated upstream RPC error', async () => {
    const { provider, traces } = setup((id) => json({ jsonrpc: '2.0', id,
      error: { code: -32000, message: 'private token or IP' } }));
    await expect(provider.request(call())).rejects.toThrow(/^bootstrap unavailable$/);
    expect(traces[0]?.errorCode).toBe('RPC_ERROR');
    expect(JSON.stringify(traces)).not.toContain('private');
  });

  it('rejects invalid resolver ABI before returning it to the official harness', async () => {
    const { provider, traces } = setup((id, selector) => json({ jsonrpc: '2.0', id,
      result: selector === BOOTSTRAP_SELECTORS.hash ? HASH : '0x00' }));
    await provider.request(call());
    await expect(provider.request(call(BOOTSTRAP_SELECTORS.resolvers))).rejects.toThrow(/^bootstrap unavailable$/);
    expect(traces[1]).toMatchObject({ success: false, errorCode: 'RPC_RESPONSE_INVALID' });
  });

  it('rejects a different final bootstrap URL even if no redirect flag is supplied', async () => {
    const { provider, traces } = setup((id) => {
      const response = json({ jsonrpc: '2.0', id, result: HASH });
      Object.defineProperty(response, 'url', { value: 'https://other.example.org/' });
      return response;
    });
    await expect(provider.request(call())).rejects.toThrow(/^bootstrap unavailable$/);
    expect(traces[0]?.errorCode).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('aborts a fetch that ignores its signal and never exposes the abort reason', async () => {
    const { provider, abort, traces } = setup(() => new Promise<Response>(() => {}));
    const pending = provider.request(call());
    await Promise.resolve();
    abort.abort(new Error('private reason'));
    await expect(pending).rejects.toThrow(/^bootstrap unavailable$/);
    expect(traces[0]).toMatchObject({ success: false, errorCode: 'UPSTREAM_TIMEOUT' });
    expect(JSON.stringify(traces)).not.toContain('private');
  });

  it('rejects pre-aborted lookup before network work', async () => {
    const { provider, abort, fetcher } = setup();
    abort.abort();
    await expect(provider.request(call())).rejects.toThrow(/^bootstrap policy denied$/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ignores a throwing diagnostics sink without leaking its error', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as { id: string };
      return json({ jsonrpc: '2.0', id: body.id, result: HASH });
    });
    const provider = createBootstrapProvider({ network: 'nym', rpcUrl: RPC,
      signal: new AbortController().signal, clock,
      traceSink: { emit() { throw new Error('private sink'); } }, fetcher });
    expect(await provider.request(call())).toBe(HASH);
  });
});
