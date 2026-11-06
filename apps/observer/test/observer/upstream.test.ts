import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, IncomingHttpHeaders } from 'node:http';
import type { RequestOptions } from 'node:https';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcRequest } from '@monolith/shared';
import { createUpstreamReader } from '../../src/adapters/upstream/https-reader.js';
import type { UpstreamReaderOptions } from '../../src/adapters/upstream/https-reader.js';
import { isPublicAddress } from '../../src/adapters/upstream/public-address.js';
import { resolveHost } from '../../src/adapters/upstream/dns-resolver.js';
import type { DnsResolver } from '../../src/adapters/upstream/dns-resolver.js';
import type { ObserverEndpoint } from '../../src/domain/ports.js';

// All connector exchanges and IP addresses here are synthetic offline fixtures.
const endpoint: ObserverEndpoint = {
  endpointId: 'test-endpoint', chainId: '1', rpcUrl: 'https://rpc.example.com/v1?network=eth', calls: [],
};
const rpc: JsonRpcRequest = { jsonrpc: '2.0', id: 'test-rpc', method: 'eth_chainId', params: [] };
const envelope = { jsonrpc: '2.0', id: 'test-rpc', result: '0x1' };
const publicAddresses = [{ address: '8.8.8.8', family: 4 }];

class SyntheticResponse extends PassThrough {
  statusCode = 200;
  headers: IncomingHttpHeaders = { 'content-type': 'application/json' };
  complete = false;
  finish(body: string | Buffer) {
    this.complete = true;
    this.end(body);
  }
}
class SyntheticRequest extends EventEmitter {
  body = '';
  destroyed = false;
  constructor(private readonly exchange: () => void) { super(); }
  end(body: string) {
    this.body = body;
    queueMicrotask(this.exchange);
  }
  destroy() { this.destroyed = true; return this; }
}

function connector(exchange: (response: SyntheticResponse, request: SyntheticRequest) => void = (response) => response.finish(JSON.stringify(envelope))) {
  const response = new SyntheticResponse();
  const captured: RequestOptions[] = [];
  let outgoing: SyntheticRequest | undefined;
  const request: NonNullable<UpstreamReaderOptions['request']> = (options, onResponse) => {
    captured.push(options);
    outgoing = new SyntheticRequest(() => {
      if (!outgoing) throw new Error('Missing synthetic request.');
      onResponse(response as unknown as IncomingMessage);
      exchange(response, outgoing);
    });
    return outgoing as unknown as ClientRequest;
  };
  const resolve = vi.fn(async () => publicAddresses);
  return { request, response, captured, resolve, outgoing: () => outgoing };
}

async function boundLookup(options: RequestOptions, all = false) {
  return await new Promise<{ address: unknown; family: unknown }>((resolve, reject) => {
    options.lookup?.('rpc.example.com', { all }, (error, address, family) => (
      error ? reject(error) : resolve({ address, family })
    ));
  });
}

function errorCode(result: Awaited<ReturnType<ReturnType<typeof createUpstreamReader>['read']>>) {
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.error.code;
}

describe('public destination IP policy', () => {
  it.each([
    '0.0.0.0', '10.2.3.4', '100.64.0.1', '100.127.255.254', '127.0.0.1',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.170', '192.0.2.1',
    '192.168.4.2', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1',
    'fc00::1', 'fe80::1', 'fe80::1%lo', 'ff02::1', '64:ff9b::808:808',
    '2001::1', '2001:db8::1', '2002:7f00:1::', '3ffe::1', '3fff::1', 'not-an-ip',
  ])('rejects %s', (address) => expect(isPublicAddress(address)).toBe(false));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2001:4860:4860::8888', '2606:4700:4700::1111'])(
    'permits globally routable %s', (address) => expect(isPublicAddress(address)).toBe(true),
  );
});

describe('configured HTTPS upstream adapter', () => {
  it('pins the checked DNS address while retaining hostname, TLS and constructed headers', async () => {
    const network = connector();
    const result = await createUpstreamReader(network).read(endpoint, rpc);
    expect(result).toEqual({ ok: true, value: envelope });
    expect(network.resolve).toHaveBeenCalledExactlyOnceWith('rpc.example.com', expect.any(AbortSignal));
    expect(network.captured).toHaveLength(1);
    const settings = network.captured[0];
    expect(settings).toMatchObject({
      protocol: 'https:', hostname: 'rpc.example.com', port: 443, path: '/v1?network=eth',
      method: 'POST', agent: false, family: 4, servername: 'rpc.example.com', rejectUnauthorized: true,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'identity' },
    });
    expect(Object.keys(settings?.headers ?? {}).sort()).toEqual(['accept', 'accept-encoding', 'content-length', 'content-type']);
    expect(network.outgoing()?.body).toBe(JSON.stringify(rpc));
    if (!settings) throw new Error('Missing settings.');
    expect(await boundLookup(settings)).toEqual({ address: '8.8.8.8', family: 4 });
    expect(await boundLookup(settings, true)).toEqual({ address: publicAddresses, family: undefined });
    // Calling the bound resolver never performs the attacker's second DNS lookup.
    expect(network.resolve).toHaveBeenCalledTimes(1);
    await expect(new Promise((resolve, reject) => settings.lookup?.('another.example.com', {}, (error) => error ? reject(error) : resolve(null))))
      .rejects.toThrow('Destination lookup was rejected.');
  });

  it.each([
    'http://rpc.example.com', 'https://127.0.0.1', 'https://0x7f000001', 'https://localhost',
    'https://user:secret@rpc.example.com', 'https://rpc.example.com:8443', 'https://rpc.example.com/${KEY}',
  ])('rejects unsafe URL %s before DNS or forwarding', async (rpcUrl) => {
    const network = connector();
    expect(errorCode(await createUpstreamReader(network).read({ ...endpoint, rpcUrl }, rpc))).toBe('TARGET_DENIED');
    expect(network.resolve).not.toHaveBeenCalled();
    expect(network.captured).toHaveLength(0);
  });

  it.each([
    [], [{ address: '127.0.0.1', family: 4 }], [{ address: '10.0.0.1', family: 4 }],
    [{ address: 'fe80::1', family: 6 }], [...publicAddresses, { address: '192.168.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 6 }], [{ address: '::ffff:169.254.169.254', family: 6 }],
  ])('rejects empty/private/mixed/malformed DNS result %j before connection', async (...addresses) => {
    const network = connector();
    const resolve = async () => addresses;
    expect(errorCode(await createUpstreamReader({ ...network, resolve }).read(endpoint, rpc))).toBe('TARGET_DENIED');
    expect(network.captured).toHaveLength(0);
  });

  it('pins an approved IPv6 answer without permitting mapped fallback addresses', async () => {
    const network = connector();
    const address = { address: '2606:4700:4700::1111', family: 6 };
    const result = await createUpstreamReader({ ...network, resolve: async () => [address] }).read(endpoint, rpc);
    expect(result.ok).toBe(true);
    expect(network.captured[0]?.family).toBe(6);
    const settings = network.captured[0];
    if (!settings) throw new Error('Missing settings.');
    expect(await boundLookup(settings)).toEqual(address);
  });

  it.each([301, 302, 303, 307, 308])('rejects redirect %i and never connects to Location', async (status) => {
    const network = connector((response) => response.finish(''));
    network.response.statusCode = status;
    network.response.headers['location'] = 'http://169.254.169.254/latest/meta-data/';
    expect(errorCode(await createUpstreamReader(network).read(endpoint, rpc))).toBe('UPSTREAM_UNAVAILABLE');
    expect(network.captured).toHaveLength(1);
    expect(network.response.destroyed).toBe(true);
    expect(network.outgoing()?.destroyed).toBe(true);
  });

  it.each([
    { 'content-type': 'text/html' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    { 'content-type': 'application/json', 'content-length': '99999999' },
    { 'content-type': 'application/json', 'content-length': 'not-a-number' },
  ])('rejects invalid upstream metadata %j', async (headers) => {
    const network = connector();
    network.response.headers = headers;
    expect(errorCode(await createUpstreamReader(network).read(endpoint, rpc))).toBe('RPC_RESPONSE_INVALID');
    expect(network.outgoing()?.destroyed).toBe(true);
  });

  it('bounds a chunked response even when no content length is supplied', async () => {
    const network = connector((response) => {
      response.write(Buffer.alloc(40, 'x'));
      response.finish(Buffer.alloc(40, 'x'));
    });
    expect(errorCode(await createUpstreamReader({ ...network, maxResponseBytes: 64 }).read(endpoint, rpc))).toBe('RPC_RESPONSE_INVALID');
    expect(network.response.destroyed).toBe(true);
    expect(network.outgoing()?.destroyed).toBe(true);
  });

  it.each([
    '{bad-json', JSON.stringify({ ...envelope, id: 'different-id' }),
    JSON.stringify({ ...envelope, error: { code: -32000, message: 'synthetic-private-error' } }),
    JSON.stringify([{ ...envelope }]),
  ])('rejects malformed/mismatched response %s', async (body) => {
    const network = connector((response) => response.finish(body));
    expect(errorCode(await createUpstreamReader(network).read(endpoint, rpc))).toBe('RPC_RESPONSE_INVALID');
  });

  it('sanitizes correlated provider errors and ignores upstream headers', async () => {
    const network = connector((response) => response.finish(JSON.stringify({
      jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'synthetic-private-message', data: 'synthetic-private-data' },
    })));
    network.response.headers['set-cookie'] = ['private=synthetic'];
    const result = await createUpstreamReader(network).read(endpoint, rpc);
    expect(errorCode(result)).toBe('RPC_ERROR');
    expect(JSON.stringify(result)).not.toMatch(/synthetic-private|set-cookie|private=/);
  });

  it('rejects invalid UTF-8 instead of replacing bytes inside the returned result', async () => {
    const network = connector((response) => response.finish(Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":"test-rpc","result":"'), Buffer.from([0xff]), Buffer.from('"}'),
    ])));
    expect(errorCode(await createUpstreamReader(network).read(endpoint, rpc))).toBe('RPC_RESPONSE_INVALID');
  });

  it('rejects invalid requests before contacting a resolver', async () => {
    const network = connector();
    const input = { ...rpc, method: 'eth_sendRawTransaction' } as unknown as JsonRpcRequest;
    expect(errorCode(await createUpstreamReader(network).read(endpoint, input))).toBe('INVALID_INPUT');
    expect(network.resolve).not.toHaveBeenCalled();
  });

  it('includes an unresponsive DNS resolver in the total deadline and never connects after late DNS', async () => {
    const network = connector();
    let release: ((value: typeof publicAddresses) => void) | undefined;
    const resolve = () => new Promise<typeof publicAddresses>((done) => { release = done; });
    const result = await createUpstreamReader({ ...network, resolve, timeoutMs: 15 }).read(endpoint, rpc);
    expect(errorCode(result)).toBe('UPSTREAM_TIMEOUT');
    release?.(publicAddresses);
    await Promise.resolve();
    expect(network.captured).toHaveLength(0);
  });

  it('destroys an upstream connection whose response never completes', async () => {
    const network = connector(() => {});
    const result = await createUpstreamReader({ ...network, timeoutMs: 15 }).read(endpoint, rpc);
    expect(errorCode(result)).toBe('UPSTREAM_TIMEOUT');
    expect(network.outgoing()?.destroyed).toBe(true);
    expect(network.response.destroyed).toBe(true);
  });

  it('honors caller cancellation before DNS and during streaming', async () => {
    const early = new AbortController();
    early.abort();
    const unopened = connector();
    expect(errorCode(await createUpstreamReader(unopened).read(endpoint, rpc, early.signal))).toBe('UPSTREAM_UNAVAILABLE');
    expect(unopened.resolve).not.toHaveBeenCalled();
    const active = new AbortController();
    const opened = connector(() => active.abort());
    expect(errorCode(await createUpstreamReader(opened).read(endpoint, rpc, active.signal))).toBe('UPSTREAM_UNAVAILABLE');
    expect(opened.outgoing()?.destroyed).toBe(true);
    expect(opened.response.destroyed).toBe(true);
  });

  it('turns resolver and connection errors into fixed failures without provider details', async () => {
    const network = connector((response, request) => request.emit('error', new Error('synthetic-private-tls-error')));
    const result = await createUpstreamReader(network).read(endpoint, rpc);
    expect(errorCode(result)).toBe('UPSTREAM_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
    const dnsFailure = await createUpstreamReader({ resolve: async () => { throw new Error('synthetic-private-dns-error'); } }).read(endpoint, rpc);
    expect(errorCode(dnsFailure)).toBe('UPSTREAM_UNAVAILABLE');
    expect(JSON.stringify(dnsFailure)).not.toContain('synthetic-private');
  });
});


describe('per-read production DNS resolver lifecycle', () => {
  function pendingResolver() {
    const pending = new Set<(reason: Error) => void>();
    const pendingQuery = vi.fn(() => new Promise<string[]>((_resolve, reject) => { pending.add(reject); }));
    const resolver: DnsResolver = {
      resolve4: pendingQuery,
      resolve6: pendingQuery,
      cancel: vi.fn(() => {
        for (const reject of pending) reject(Object.assign(new Error('Synthetic cancelled DNS.'), { code: 'ECANCELLED' }));
        pending.clear();
      }),
    };
    return { resolver, pending, pendingQuery };
  }

  it('cancels both real-resolver query ports at the total deadline before any connection', async () => {
    const network = connector();
    const dns = pendingResolver();
    const resolverFactory = vi.fn(() => dns.resolver);
    const result = await createUpstreamReader({ request: network.request, resolverFactory, timeoutMs: 15 }).read(endpoint, rpc);
    expect(errorCode(result)).toBe('UPSTREAM_TIMEOUT');
    expect(resolverFactory).toHaveBeenCalledTimes(1);
    expect(dns.pendingQuery).toHaveBeenCalledTimes(2);
    expect(dns.resolver.cancel).toHaveBeenCalledTimes(1);
    expect(dns.pending.size).toBe(0);
    expect(network.captured).toHaveLength(0);
  });

  it('cancels outstanding A and AAAA queries on caller abort', async () => {
    const network = connector();
    const dns = pendingResolver();
    const controller = new AbortController();
    const result = createUpstreamReader({ request: network.request, resolverFactory: () => dns.resolver })
      .read(endpoint, rpc, controller.signal);
    controller.abort();
    expect(errorCode(await result)).toBe('UPSTREAM_UNAVAILABLE');
    expect(dns.resolver.cancel).toHaveBeenCalledTimes(1);
    expect(dns.pending.size).toBe(0);
    expect(network.captured).toHaveLength(0);
  });

  it.each([4, 6] as const)('allows ENODATA for missing family %i after checking both families', async (missing) => {
    const network = connector();
    const absent = () => Promise.reject(Object.assign(new Error('Synthetic absent family.'), { code: 'ENODATA' }));
    const resolver = {
      resolve4: vi.fn(missing === 4 ? absent : async () => ['8.8.8.8']),
      resolve6: vi.fn(missing === 6 ? absent : async () => ['2606:4700:4700::1111']),
      cancel: vi.fn(),
    };
    const result = await createUpstreamReader({ request: network.request, resolverFactory: () => resolver }).read(endpoint, rpc);
    expect(result.ok).toBe(true);
    expect(resolver.resolve4).toHaveBeenCalledExactlyOnceWith('rpc.example.com');
    expect(resolver.resolve6).toHaveBeenCalledExactlyOnceWith('rpc.example.com');
    expect(resolver.cancel).not.toHaveBeenCalled();
    expect(network.captured[0]?.family).toBe(missing === 4 ? 6 : 4);
  });

  it.each(['ETIMEOUT', 'ENOTFOUND', 'EREFUSED', 'ESERVFAIL', 'ECANCELLED'])('fails closed on %s rather than accepting an unchecked family', async (code) => {
    const network = connector();
    const resolver = {
      resolve4: async () => ['8.8.8.8'],
      resolve6: async () => { throw Object.assign(new Error('Synthetic DNS failure.'), { code }); },
      cancel: vi.fn(),
    };
    const result = await createUpstreamReader({ request: network.request, resolverFactory: () => resolver }).read(endpoint, rpc);
    expect(errorCode(result)).toBe('UPSTREAM_UNAVAILABLE');
    expect(resolver.cancel).toHaveBeenCalledTimes(1);
    expect(network.captured).toHaveLength(0);
  });

  it('checks private AAAA answers even when A answers are public', async () => {
    const network = connector();
    const result = await createUpstreamReader({
      request: network.request,
      resolverFactory: () => ({ resolve4: async () => ['8.8.8.8'], resolve6: async () => ['::1'], cancel: vi.fn() }),
    }).read(endpoint, rpc);
    expect(errorCode(result)).toBe('TARGET_DENIED');
    expect(network.captured).toHaveLength(0);
  });

  it('removes the cancellation listener after successful resolution', async () => {
    const controller = new AbortController();
    const resolver = {
      resolve4: async () => ['8.8.8.8'],
      resolve6: async () => ['2606:4700:4700::1111'],
      cancel: vi.fn(),
    };
    expect(await resolveHost('rpc.example.com', controller.signal, () => resolver)).toEqual([
      { address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 },
    ]);
    controller.abort();
    expect(resolver.cancel).not.toHaveBeenCalled();
  });

  it('allocates a separate resolver per read and never cancels another completed read', async () => {
    const network = connector();
    const first = { resolve4: async () => ['8.8.8.8'], resolve6: async () => [], cancel: vi.fn() };
    const dns = pendingResolver();
    const factory = vi.fn<() => DnsResolver>().mockReturnValueOnce(first).mockReturnValueOnce(dns.resolver);
    const reader = createUpstreamReader({ request: network.request, resolverFactory: factory, timeoutMs: 15 });
    expect((await reader.read(endpoint, rpc)).ok).toBe(true);
    expect(errorCode(await reader.read(endpoint, rpc))).toBe('UPSTREAM_TIMEOUT');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(first.cancel).not.toHaveBeenCalled();
    expect(dns.resolver.cancel).toHaveBeenCalledTimes(1);
  });
});
