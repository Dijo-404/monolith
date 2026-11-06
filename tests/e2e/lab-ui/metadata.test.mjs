// SIMULATED HTTP responses only. No observer, worker, registry or chain is contacted.
import { describe, expect, it, vi } from 'vitest';
import { createProductionLiveLab, requestLabMetadata } from '../../../apps/dashboard/src/composition/lab.ts';

const URL = 'https://observer.monolith.example.org/api/observer/runs';
const VALUE = { allocated: 'fixture' };
const ENVELOPE = { schemaVersion: 1, ok: true, value: VALUE };
// Adapter tests isolate HTTP boundaries. Production passes the public shared DTO parser.
const schema = { safeParse: vi.fn((input) => ({ success: true, data: input })) };
const json = (body = ENVELOPE, options = {}) => new Response(JSON.stringify(body), {
  status: 201, headers: { 'content-type': 'application/json' }, ...options,
});
const request = (fetch, options = {}) => requestLabMetadata({ url: URL, method: 'POST', schema,
  signal: new AbortController().signal, fetch, ...options });

describe('public metadata adapter boundaries', () => {
  it.each(['GET', 'POST'])('sends only ordinary public %s metadata with no credentials or RPC body', async (method) => {
    const fetch = vi.fn(async () => json(ENVELOPE, { status: method === 'POST' ? 201 : 200 }));
    expect(await request(fetch, { method })).toEqual({ ok: true, value: VALUE });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(URL);
    expect(init).toMatchObject({ method, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(init.headers).toEqual(method === 'POST' ? { accept: 'application/json', 'content-type': 'application/json' }
      : { accept: 'application/json' });
    expect(init.body).toBe(method === 'POST' ? '{}' : undefined);
    expect(JSON.stringify(init)).not.toMatch(/jsonrpc|authorization|cookie|x-monolith/i);
  });

  it.each(['status', 'redirected', 'different-url', 'html', 'declared-size', 'invalid-size', 'stream-size', 'invalid-json', 'invalid-utf8', 'schema'])(
    'fails closed on %s without retaining provider text', async (fault) => {
      const privateText = 'PRIVATE_PROVIDER_DIAGNOSTIC';
      let response = json();
      let parser = schema;
      if (fault === 'status') response = json(ENVELOPE, { status: 200 });
      if (fault === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
      if (fault === 'different-url') Object.defineProperty(response, 'url', { value: 'https://untrusted.example.org/' });
      if (fault === 'html') response = new Response(privateText, { headers: { 'content-type': 'text/html' } });
      if (fault === 'declared-size') response = json(ENVELOPE, { headers: { 'content-type': 'application/json', 'content-length': '65537' } });
      if (fault === 'invalid-size') response = json(ENVELOPE, { headers: { 'content-type': 'application/json', 'content-length': '-1' } });
      if (fault === 'stream-size') response = new Response(privateText.repeat(3000), { headers: { 'content-type': 'application/json' } });
      if (fault === 'invalid-json') response = new Response(privateText, { headers: { 'content-type': 'application/json' } });
      if (fault === 'invalid-utf8') response = new Response(new Uint8Array([0xff, 0xfe]), { headers: { 'content-type': 'application/json' } });
      if (fault === 'schema') parser = { safeParse: () => ({ success: false, error: privateText }) };
      const result = await request(async () => response, { schema: parser });
      expect(result).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).not.toContain(privateText);
    },
  );

  it('cancels an oversized streaming body before parsing or returning any data', async () => {
    const cancel = vi.fn();
    const parser = { safeParse: vi.fn() };
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel });
    const response = new Response(stream, { status: 201, headers: { 'content-type': 'application/json' } });
    expect(await request(async () => response, { schema: parser })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(cancel).toHaveBeenCalledOnce(); expect(parser.safeParse).not.toHaveBeenCalled();
  });

  it('aborts a stalled stream and releases its reader', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(body) { body.enqueue(new TextEncoder().encode('{')); }, cancel });
    const response = new Response(stream, { status: 201, headers: { 'content-type': 'application/json' } });
    const result = request(async () => response, { signal: controller.signal });
    await Promise.resolve(); controller.abort();
    expect(await result).toMatchObject({ ok: false, error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
  });

  it('never starts a fetch after cancellation and redacts a thrown provider error', async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn(async () => { throw new Error('PRIVATE_NETWORK_FAILURE'); });
    expect(await request(fetch, { signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(fetch).not.toHaveBeenCalled();
    const result = await request(fetch);
    expect(result).toMatchObject({ ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NETWORK_FAILURE');
  });

  it('cancels even when abort arrives between response headers and reader ownership', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const response = new Response(stream, { status: 201, headers: { 'content-type': 'application/json' } });
    const fetch = async () => { controller.abort(); return response; };
    expect(await request(fetch, { signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
  });

  it('propagates only parsed error results with a failing HTTP status', async () => {
    const error = { code: 'RATE_LIMITED', message: 'The request limit was reached.', retryable: true };
    expect(await request(async () => json({ schemaVersion: 1, ok: false, error }, { status: 429 }))).toEqual({ ok: false, error });
    expect(await request(async () => json({ schemaVersion: 1, ok: false, error }, { status: 200 }))).toMatchObject({
      ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' },
    });
  });
});

describe('production configuration boundary', () => {
  it.each(['http://127.0.0.1:3001', 'https://localhost', 'https://observer.example.org/path',
    'https://user:secret@observer.example.org', 'https://observer.example.org?key=secret', '']) (
    'refuses unsafe observer configuration before browser APIs or network: %s', async (origin) => {
      const controller = createProductionLiveLab(origin);
      await controller.run('private');
      expect(controller.getSnapshot()).toMatchObject({ phase: 'BLOCKED', error: 'POLICY_DENIED', reads: [] });
      expect(controller.getSnapshot().worker).toBe(null);
      await controller.close();
    },
  );
});
