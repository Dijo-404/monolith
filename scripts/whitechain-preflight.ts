import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Operator-only public reads. Never import this direct client into the browser or relayer.
const rpcUrl = 'https://rpc.testnet.whitechain.io';
const explorerUrl = 'https://explorer.testnet.whitechain.io';
const token = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const zeroAddressWord = '0'.repeat(64);
const maxBytes = 1_048_576;
const requestTimeoutMs = 8_000;
const totalTimeoutMs = 60_000;
const usage = 'pnpm exec tsx scripts/whitechain-preflight.ts --run | --self-test | --help';
type Evidence = 'OBSERVED_LIVE' | 'SIMULATED';
type ErrorCode = 'INVALID_INPUT' | 'TIMEOUT' | 'HTTP_ERROR' | 'NETWORK_ERROR'
  | 'RESPONSE_INVALID' | 'RESPONSE_TOO_LARGE' | 'RPC_ERROR' | 'CHAIN_MISMATCH'
  | 'TOKEN_CODE_MISSING' | 'IMPLEMENTATION_MISSING' | 'REQUEST_LIMIT';
class PreflightFailure extends Error {
  constructor(readonly code: ErrorCode, readonly httpStatus?: number) { super(code); }
}
function fail(code: ErrorCode): never { throw new PreflightFailure(code); }
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('RESPONSE_INVALID');
  return value as Record<string, unknown>;
}
function word(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('RESPONSE_INVALID');
  return value.toLowerCase();
}
function quantity(value: unknown): string {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) fail('RESPONSE_INVALID');
  return value.toLowerCase();
}
function codeSummary(value: unknown) {
  if (value === '0x') fail('TOKEN_CODE_MISSING');
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) fail('RESPONSE_INVALID');
  const bytes = Buffer.from(value.slice(2), 'hex');
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
function safeFailure(error: unknown) {
  return error instanceof PreflightFailure
    ? { code: error.code, ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }) }
    : { code: 'NETWORK_ERROR' as const };
}

/** One origin set, no redirects/retries/credentials, bounded streamed bytes and deadlines. */
function client(fetcher: typeof fetch, limits = { requestMs: requestTimeoutMs, totalMs: totalTimeoutMs }) {
  const started = performance.now();
  let requests = 0;
  async function json(url: string, body?: object): Promise<unknown> {
    const remaining = limits.totalMs - (performance.now() - started);
    if (remaining <= 0) fail('TIMEOUT');
    if (requests >= 12) fail('REQUEST_LIMIT');
    const id = ++requests;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new PreflightFailure('TIMEOUT')); },
        Math.min(limits.requestMs, remaining));
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    try {
      return await Promise.race([deadline, (async () => {
        response = await fetcher(url, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify({ jsonrpc: '2.0', id: `mn018-${id}`, ...body }) }),
          signal: controller.signal,
        });
        // An injected fetcher may resolve after abort. Never consume that late body.
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          fail('TIMEOUT');
        }
        if (response.redirected || (response.url && response.url !== new URL(url).href)) fail('RESPONSE_INVALID');
        if (!response.ok) throw new PreflightFailure('HTTP_ERROR', response.status);
        if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) fail('RESPONSE_INVALID');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          if (controller.signal.aborted) fail('TIMEOUT');
          const chunk = await reader.read();
          if (controller.signal.aborted) fail('TIMEOUT');
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) fail('RESPONSE_TOO_LARGE');
          chunks.push(chunk.value);
        }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { fail('RESPONSE_INVALID'); }
      })()]);
    } catch (error) {
      if (controller.signal.aborted) throw new PreflightFailure('TIMEOUT');
      if (error instanceof PreflightFailure) throw error;
      throw new PreflightFailure('NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
      else void response?.body?.cancel().catch(() => undefined);
    }
  }
  return {
    get requestCount() { return requests; },
    get: (address: string) => json(`${explorerUrl}/api/v2/smart-contracts/${address}`),
    async rpc(method: 'eth_chainId' | 'eth_blockNumber' | 'eth_getCode' | 'eth_getStorageAt' | 'eth_call', params: unknown[]) {
      const expectedId = `mn018-${requests + 1}`;
      const envelope = object(await json(rpcUrl, { method, params }));
      if (envelope['jsonrpc'] !== '2.0' || envelope['id'] !== expectedId
        || Object.hasOwn(envelope, 'result') === Object.hasOwn(envelope, 'error')
        || Object.keys(envelope).some((key) => !['jsonrpc', 'id', 'result', 'error'].includes(key))) fail('RESPONSE_INVALID');
      if (Object.hasOwn(envelope, 'error')) {
        const error = object(envelope['error']);
        if (!Number.isSafeInteger(error['code']) || typeof error['message'] !== 'string') fail('RESPONSE_INVALID');
        fail('RPC_ERROR'); // Never serialize provider message/data.
      }
      return envelope['result'];
    },
  };
}

function abiSummary(value: unknown) {
  const source = object(value);
  const functions = Array.isArray(source['abi']) ? source['abi'].flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = object(item);
    if (entry['type'] !== 'function' || !Array.isArray(entry['inputs'])) return [];
    const inputs = entry['inputs'].map((input: unknown) => object(input)['type']);
    return [`${String(entry['name'])}(${inputs.join(',')})`];
  }) : [];
  const knownSignatures = [
    'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
    'permit(address,address,uint256,uint256,bytes)',
    'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
    'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
    'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
    'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
  ];
  return {
    isVerified: source['is_verified'] === true, isFullyVerified: source['is_fully_verified'] === true,
    sourceSha256: typeof source['source_code'] === 'string' ? sha256(source['source_code']) : null,
    declaredAuthorizationFunctions: knownSignatures.filter((signature) => functions.includes(signature)),
    // The explorer is a current offchain assertion; this is not historical bytecode/source equivalence proof.
    verificationSource: 'current-explorer-api' as const,
  };
}

export async function inspectWhitechain(fetcher: typeof fetch, evidence: Evidence) {
  const startedAt = new Date().toISOString();
  const http = client(fetcher);
  const observations: Record<string, unknown> = {};
  let stage = 'chain';
  const diagnostics: Array<{ stage: string; code: string; httpStatus?: number }> = [];
  const optional = async (name: string, operation: () => Promise<unknown>) => {
    try { observations[name] = await operation(); }
    catch (error) { diagnostics.push({ stage: name, ...safeFailure(error) }); }
  };
  try {
    const chain = quantity(await http.rpc('eth_chainId', []));
    observations['chainId'] = BigInt(chain).toString();
    if (BigInt(chain) !== 1874n) fail('CHAIN_MISMATCH');
    stage = 'block';
    const block = quantity(await http.rpc('eth_blockNumber', []));
    observations['blockNumber'] = BigInt(block).toString();
    observations['blockTag'] = block;
    stage = 'tokenCode';
    observations[stage] = codeSummary(await http.rpc('eth_getCode', [token, block]));
    stage = 'decimals';
    const decimals = BigInt(word(await http.rpc('eth_call', [{ to: token, data: '0x313ce567' }, block])));
    if (decimals > 255n) fail('RESPONSE_INVALID');
    observations[stage] = Number(decimals);
    await optional('domainSeparator', async () => word(await http.rpc('eth_call', [{ to: token, data: '0x3644e515' }, block])));
    await optional('syntheticZeroAddressNonce', async () => BigInt(word(await http.rpc('eth_call', [
      { to: token, data: `0x7ecebe00${zeroAddressWord}` }, block,
    ]))).toString());
    await optional('proxyExplorer', async () => abiSummary(await http.get(token)));
    stage = 'implementation';
    const slot = word(await http.rpc('eth_getStorageAt', [token, implementationSlot, block]));
    if (!/^0x0{24}[0-9a-f]{40}$/.test(slot) || BigInt(slot) === 0n) fail('IMPLEMENTATION_MISSING');
    const implementation = `0x${slot.slice(-40)}`;
    observations['implementationAddress'] = implementation;
    stage = 'implementationCode';
    observations[stage] = codeSummary(await http.rpc('eth_getCode', [implementation, block]));
    await optional('implementationExplorer', async () => abiSummary(await http.get(implementation)));
  } catch (error) { diagnostics.push({ stage, ...safeFailure(error) }); }
  return {
    schemaVersion: 1, sourceTask: 'MN-018', evidence, startedAt, completedAt: new Date().toISOString(),
    scope: 'operator-direct-public-read-only', rpcUrl, explorerUrl, token,
    requestCount: http.requestCount, observations, diagnostics,
    readiness: 'BLOCKED', routeChoice: 'UNSELECTED',
    gates: { protectedBrowserRead: 'UNTESTED', fundedSeparatedRoles: 'UNTESTED',
      signedNativeAuthorization: 'UNTESTED', sponsoredSettlement: 'UNTESTED', vaultMentorApproval: 'UNTESTED' },
    limits: 'ABI entries and getters are diagnostic only; they establish neither successful authorization nor its absence. '
      + 'Explorer verification is a current assertion, separate from pinned-block RPC code. No browser anonymity, funding, '
      + 'signature, settlement, deployment or sponsor eligibility is established. No direct browser fallback is enabled.',
  };
}

function mode(args: string[]) {
  if (args.length === 0) return '--help';
  if (args.length !== 1 || !['--run', '--self-test', '--help'].includes(args[0]!)) fail('INVALID_INPUT');
  return args[0]!;
}

/** Deterministic boundary checks, entirely in memory. No mock becomes live evidence. */
async function selfTest() {
  let passed = 0;
  const implementation = `0x${'12'.repeat(20)}`;
  const wordOf = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
  type Mutate = (request: Record<string, unknown>, envelope: Record<string, unknown>) => unknown;
  const fake = (mutate?: Mutate, calls: string[] = []): typeof fetch => async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    if (init?.method === 'GET') return Response.json({ is_verified: true, is_fully_verified: true,
      source_code: 'SIMULATED', abi: [{ type: 'function', name: 'permit', inputs:
        ['address', 'address', 'uint256', 'uint256', 'bytes'].map((type) => ({ type })) }] });
    assert.equal(String(url), rpcUrl);
    const request = object(JSON.parse(String(init?.body)));
    const params = request['params'] as unknown[];
    let result: unknown;
    switch (request['method']) {
      case 'eth_chainId': result = '0x752'; break;
      case 'eth_blockNumber': result = '0x123'; break;
      case 'eth_getCode': result = '0x6000'; assert.equal(params[1], '0x123'); break;
      case 'eth_getStorageAt': result = `0x${'0'.repeat(24)}${implementation.slice(2)}`; assert.equal(params[2], '0x123'); break;
      case 'eth_call': result = (params[0] as { data: string }).data === '0x313ce567' ? wordOf(6) : wordOf(0);
        assert.equal(params[1], '0x123'); break;
      default: throw new Error('Unapproved method');
    }
    const envelope = { jsonrpc: '2.0', id: request['id'], result };
    const response = Response.json(mutate ? mutate(request, envelope) : envelope);
    // Native fetch normalizes a bare HTTPS origin to a URL ending in '/'.
    Object.defineProperty(response, 'url', { value: new URL(String(url)).href });
    return response;
  };
  const baseline = await inspectWhitechain(fake(), 'SIMULATED');
  assert.equal(baseline.evidence, 'SIMULATED'); assert.equal(baseline.requestCount, 10);
  assert.deepEqual(baseline.diagnostics, []); assert.equal(baseline.observations['decimals'], 6);
  assert.equal(baseline.readiness, 'BLOCKED'); assert.equal(baseline.routeChoice, 'UNSELECTED');
  assert.ok(Object.values(baseline.gates).every((gate) => gate === 'UNTESTED')); passed++;
  for (const args of [['--unknown'], ['--run', '--run'], ['--rpc-url', 'https://private.invalid'], ['--run', '--help']]) {
    assert.throws(() => mode(args), (error: unknown) => error instanceof PreflightFailure && error.code === 'INVALID_INPUT'); passed++;
  }
  assert.equal(mode([]), '--help'); assert.equal(mode(['--help']), '--help'); passed++;
  const rejects = async (mutate: Mutate, code: string, requests = 1) => {
    const result = await inspectWhitechain(fake(mutate), 'SIMULATED');
    assert.equal(result.diagnostics[0]?.code, code); assert.equal(result.requestCount, requests);
    assert.equal(result.readiness, 'BLOCKED'); passed++;
  };
  await rejects((_request, envelope) => ({ ...envelope, id: 'wrong' }), 'RESPONSE_INVALID');
  await rejects((_request, envelope) => ({ ...envelope, id: 1 }), 'RESPONSE_INVALID');
  await rejects((_request, envelope) => ({ ...envelope, jsonrpc: '1.0' }), 'RESPONSE_INVALID');
  await rejects((_request, envelope) => ({ jsonrpc: '2.0', id: envelope['id'] }), 'RESPONSE_INVALID');
  await rejects((_request, envelope) => [envelope], 'RESPONSE_INVALID');
  await rejects((_request, envelope) => ({ ...envelope, extra: 'PRIVATE_MARKER' }), 'RESPONSE_INVALID');
  await rejects((_request, envelope) => ({ ...envelope, error: { code: -1, message: 'PRIVATE_MARKER' } }), 'RESPONSE_INVALID');
  await rejects((_request, envelope) => ({ jsonrpc: '2.0', id: envelope['id'], error: { code: -1, message: 'PRIVATE_MARKER', data: 'PRIVATE_MARKER' } }), 'RPC_ERROR');
  await rejects((_request, envelope) => ({ ...envelope, result: '0x1' }), 'CHAIN_MISMATCH');
  await rejects((_request, envelope) => ({ ...envelope, result: '0x0752' }), 'RESPONSE_INVALID');
  await rejects((request, envelope) => request['method'] === 'eth_getCode' ? { ...envelope, result: '0x' } : envelope, 'TOKEN_CODE_MISSING', 3);
  await rejects((request, envelope) => request['method'] === 'eth_getCode' ? { ...envelope, result: '0xabc' } : envelope, 'RESPONSE_INVALID', 3);
  await rejects((request, envelope) => request['method'] === 'eth_call' ? { ...envelope, result: '0x06' } : envelope, 'RESPONSE_INVALID', 4);
  await rejects((request, envelope) => request['method'] === 'eth_call' ? { ...envelope, result: wordOf(256) } : envelope, 'RESPONSE_INVALID', 4);
  for (const slot of [wordOf(0), `0x1${'0'.repeat(63)}`]) {
    await rejects((request, envelope) => request['method'] === 'eth_getStorageAt' ? { ...envelope, result: slot } : envelope,
      'IMPLEMENTATION_MISSING', 8);
  }
  const inconclusive = await inspectWhitechain(fake((request, envelope) => request['method'] === 'eth_call'
    && (request['params'] as Array<{ data: string }>)[0]?.data !== '0x313ce567'
    ? { jsonrpc: '2.0', id: envelope['id'], error: { code: -32000, message: 'PRIVATE_MARKER' } } : envelope), 'SIMULATED');
  assert.equal(inconclusive.diagnostics.length, 2); assert.equal(inconclusive.gates.signedNativeAuthorization, 'UNTESTED');
  assert.ok(!JSON.stringify(inconclusive).includes('PRIVATE_MARKER')); passed++;
  const httpCases: Array<[typeof fetch, string]> = [
    [async () => new Response('PRIVATE_MARKER', { status: 403 }), 'HTTP_ERROR'],
    [async () => new Response('PRIVATE_MARKER', { status: 302, headers: { location: 'https://private.invalid' } }), 'HTTP_ERROR'],
    [async () => new Response('PRIVATE_MARKER'), 'RESPONSE_INVALID'],
    [async () => new Response('{', { headers: { 'content-type': 'application/json' } }), 'RESPONSE_INVALID'],
    [async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }), 'RESPONSE_INVALID'],
    [async () => { throw new Error('PRIVATE_MARKER'); }, 'NETWORK_ERROR'],
    [async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(maxBytes)); controller.enqueue(new Uint8Array(1)); controller.close();
    } }), { headers: { 'content-type': 'application/json' } }), 'RESPONSE_TOO_LARGE'],
  ];
  for (const [fetcher, code] of httpCases) {
    const result = await inspectWhitechain(fetcher, 'SIMULATED');
    assert.equal(result.diagnostics[0]?.code, code); assert.equal(result.requestCount, 1);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_MARKER')); passed++;
  }
  await assert.rejects(client(async () => new Promise<Response>(() => undefined), { requestMs: 5, totalMs: 10 })
    .rpc('eth_chainId', []), (error: unknown) => error instanceof PreflightFailure && error.code === 'TIMEOUT'); passed++;
  let lateCancelled = 0;
  const lateBody = new Response(new ReadableStream({ cancel() { lateCancelled++; } }),
    { headers: { 'content-type': 'application/json' } });
  const lateFetch: typeof fetch = async () => new Promise<Response>((resolve) => setTimeout(() => resolve(lateBody), 15));
  await assert.rejects(client(lateFetch, { requestMs: 5, totalMs: 10 }).rpc('eth_chainId', []),
    (error: unknown) => error instanceof PreflightFailure && error.code === 'TIMEOUT');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lateCancelled, 1); passed++;
  let stalledCancelled = 0;
  const stalledFetch: typeof fetch = async () => new Response(new ReadableStream({ cancel() { stalledCancelled++; } }),
    { headers: { 'content-type': 'application/json' } });
  await assert.rejects(client(stalledFetch, { requestMs: 5, totalMs: 10 }).rpc('eth_chainId', []),
    (error: unknown) => error instanceof PreflightFailure && error.code === 'TIMEOUT');
  assert.equal(stalledCancelled, 1); passed++;
  console.log(JSON.stringify({ evidence: 'SIMULATED', status: 'PASS', checks: passed, externalNetworkCalls: 0 }));
}

async function main() {
  const selected = mode(process.argv.slice(2));
  if (selected === '--help') { console.log(usage); return; }
  if (selected === '--self-test') { await selfTest(); return; }
  console.log(JSON.stringify(await inspectWhitechain(fetch, 'OBSERVED_LIVE'), null, 2));
  // This preflight deliberately cannot approve funding, protected reads, signing or settlement.
  process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'BLOCKED', ...safeFailure(error) })); process.exitCode = 1; });
}
