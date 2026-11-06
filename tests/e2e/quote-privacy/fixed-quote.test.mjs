// SIMULATED ABI/admission boundaries only; no network, worker or live quote.
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIXED_QUOTE_SCENARIO, admitFixedQuoteRead, createFixedQuoteRead,
  decodeFixedQuoteResponse, decodeFixedQuoteResult, encodeFixedQuoteCall,
} from '../../../apps/dashboard/src/features/quote/fixed-quote.ts';
import { inspectBrowserSource } from '../../privacy/egress/static.mjs';

const fixture = JSON.parse(await readFile(new URL('../../fixtures/quote-privacy/fixed-quote.json', import.meta.url), 'utf8'));
// Root tests have no direct shared dependency. These documented static failures
// independently assert public behavior; the source uses the shared public port.
const failures = {
  INVALID_INPUT: ['The input does not match the contract.', false],
  CHAIN_MISMATCH: ['The endpoint chain does not match.', false],
  METHOD_DENIED: ['The RPC method is not allowed.', false],
  TARGET_DENIED: ['The destination is not allowed.', false],
  POLICY_DENIED: ['The privacy policy denied the operation.', false],
  RPC_RESPONSE_INVALID: ['The RPC response is invalid.', false],
  RPC_ERROR: ['The RPC endpoint returned an error.', false],
};
const fail = (code) => ({ ok: false, error: { code, message: failures[code][0], retryable: failures[code][1] } });
const ok = (value) => ({ ok: true, value });
const READ_ID = 'simulated_quote_01';
const ENDPOINT_ID = 'simulated_endpoint_01';
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT32 = (1n << 32n) - 1n;
// Build adversarial return words independently of the production decoder.
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const output = (amount = 25_000_000n, sqrt = 1n << 96n, ticks = 2n, gas = 200_000n) =>
  `0x${[amount, sqrt, ticks, gas].map(word).join('')}`;
const request = () => ({
  readId: READ_ID, endpointId: ENDPOINT_ID, chainId: '10', method: 'eth_call',
  params: [{ to: fixture.scenario.quoter, data: fixture.calldata }, 'latest'],
  callsite: 'quote.fixed.exact-input',
});
const envelope = (result = fixture.result.encoded, id = 'quote-wire-1') => ({ jsonrpc: '2.0', id, result });
afterEach(() => vi.unstubAllGlobals());

describe('fixed public Uniswap v3 quote ABI (SIMULATED)', () => {
  it('pins the independently checked 164-byte tuple encoding and explicit scenario', () => {
    expect(fixture.evidence).toBe('SIMULATED');
    expect(FIXED_QUOTE_SCENARIO).toEqual(fixture.scenario);
    expect(encodeFixedQuoteCall()).toEqual({ to: fixture.scenario.quoter, data: fixture.calldata });
    expect((fixture.calldata.length - 2) / 2).toBe(164);
    // A static tuple has no dynamic offset, and V2 amountIn precedes fee.
    expect(fixture.calldata.slice(10, 74)).toBe('0000000000000000000000004200000000000000000000000000000000000006');
    expect(fixture.calldata.slice(138, 202)).toBe('000000000000000000000000000000000000000000000000002386f26fc10000');
    expect(fixture.calldata.slice(202, 266)).toBe('00000000000000000000000000000000000000000000000000000000000001f4');
  });

  it('creates a public shared-contract read with no caller URL, signature or execution-block assertion', () => {
    const created = createFixedQuoteRead(READ_ID, ENDPOINT_ID);
    expect(created).toEqual(ok(request()));
    expect(admitFixedQuoteRead(created.value)).toEqual(created);
    expect(Object.keys(created.value).sort()).toEqual(['callsite', 'chainId', 'endpointId', 'method', 'params', 'readId']);
  });

  it.each([
    ['', ENDPOINT_ID], ['short', ENDPOINT_ID], ['x'.repeat(129), ENDPOINT_ID],
    [READ_ID, 'https://rpc.example.org/'], [READ_ID, 'bad endpoint'], [READ_ID, 'x'.repeat(129)],
  ])('rejects malformed opaque identifiers %j/%j', (readId, endpointId) => {
    expect(createFixedQuoteRead(readId, endpointId)).toEqual(fail('INVALID_INPUT'));
  });

  it('returns fresh request data rather than a mutable shared operation', () => {
    const first = createFixedQuoteRead(READ_ID, ENDPOINT_ID);
    first.value.params[0].data = '0xaaaaaaaa';
    first.value.params[0].to = `0x${'1'.repeat(40)}`;
    expect(createFixedQuoteRead(READ_ID, ENDPOINT_ID)).toEqual(ok(request()));
    expect(encodeFixedQuoteCall()).toEqual({ to: fixture.scenario.quoter, data: fixture.calldata });
  });

  it('decodes the invented four-word vector to exact JSON-safe decimal strings', () => {
    expect((fixture.result.encoded.length - 2) / 2).toBe(128);
    expect(decodeFixedQuoteResult(fixture.result.encoded)).toEqual(ok(fixture.result.decoded));
    expect(JSON.parse(JSON.stringify(decodeFixedQuoteResult(fixture.result.encoded)))).toEqual(ok(fixture.result.decoded));
  });

  it('preserves full uint256/uint32 precision and permits zero initialized ticks', () => {
    const decoded = decodeFixedQuoteResult(output(MAX_UINT256, MAX_SQRT_RATIO - 1n, MAX_UINT32, MAX_UINT256));
    expect(decoded).toEqual(ok({ amountOut: MAX_UINT256.toString(), sqrtPriceX96After: (MAX_SQRT_RATIO - 1n).toString(),
      initializedTicksCrossed: MAX_UINT32.toString(), gasEstimate: MAX_UINT256.toString() }));
    expect(decodeFixedQuoteResult(output(1n, MIN_SQRT_RATIO, 0n, 1n))).toEqual(ok({
      amountOut: '1', sqrtPriceX96After: MIN_SQRT_RATIO.toString(), initializedTicksCrossed: '0', gasEstimate: '1',
    }));
  });

  it.each([
    ['missing', undefined], ['null', null], ['number', 25000000], ['object', {}], ['array', []],
    ['empty', '0x'], ['no prefix', fixture.result.encoded.slice(2)],
    ['capitalized prefix', `0X${fixture.result.encoded.slice(2)}`],
    ['truncated byte', fixture.result.encoded.slice(0, -2)],
    ['odd nibble', fixture.result.encoded.slice(0, -1)],
    ['trailing byte', `${fixture.result.encoded}00`],
    ['trailing word', `${fixture.result.encoded}${'0'.repeat(64)}`],
    ['leading whitespace', ` ${fixture.result.encoded}`],
    ['trailing newline', `${fixture.result.encoded}\n`],
    ['nonhex', `${fixture.result.encoded.slice(0, -1)}g`],
    ['oversized', `0x${'00'.repeat(4096)}`],
    ['zero amount', output(0n)], ['zero price', output(1n, 0n)], ['zero gas', output(1n, MIN_SQRT_RATIO, 0n, 0n)],
    ['below TickMath minimum', output(1n, MIN_SQRT_RATIO - 1n)],
    ['exclusive TickMath maximum', output(1n, MAX_SQRT_RATIO)],
    ['dirty uint160 padding', output(1n, (1n << 160n) | MIN_SQRT_RATIO)],
    ['dirty uint32 padding', output(1n, MIN_SQRT_RATIO, 1n << 32n)],
  ])('rejects %s output without exporting raw input', (_name, input) => {
    expect(decodeFixedQuoteResult(input)).toEqual(fail('RPC_RESPONSE_INVALID'));
  });
});

describe('fixed quote request admission (SIMULATED)', () => {
  it.each([
    ['wrong chain', (r) => { r.chainId = '1'; }, 'CHAIN_MISMATCH'],
    ['other valid method', (r) => { r.method = 'eth_blockNumber'; r.params = []; }, 'METHOD_DENIED'],
    ['other target', (r) => { r.params[0].to = `0x${'1'.repeat(40)}`; }, 'TARGET_DENIED'],
    ['selector substitution', (r) => { r.params[0].data = `0xdeadbeef${fixture.calldata.slice(10)}`; }, 'TARGET_DENIED'],
    ['changed token', (r) => { r.params[0].data = `${fixture.calldata.slice(0, 73)}7${fixture.calldata.slice(74)}`; }, 'TARGET_DENIED'],
    ['changed amount', (r) => { r.params[0].data = `${fixture.calldata.slice(0, 201)}1${fixture.calldata.slice(202)}`; }, 'TARGET_DENIED'],
    ['changed fee', (r) => { r.params[0].data = `${fixture.calldata.slice(0, 265)}5${fixture.calldata.slice(266)}`; }, 'TARGET_DENIED'],
    ['changed price limit', (r) => { r.params[0].data = `${fixture.calldata.slice(0, -1)}1`; }, 'TARGET_DENIED'],
    ['trailing calldata word', (r) => { r.params[0].data += '0'.repeat(64); }, 'TARGET_DENIED'],
    ['other valid block tag', (r) => { r.params[1] = 'safe'; }, 'POLICY_DENIED'],
    ['specific block quantity', (r) => { r.params[1] = '0x1234'; }, 'POLICY_DENIED'],
    ['other callsite', (r) => { r.callsite = 'quote.unreviewed'; }, 'POLICY_DENIED'],
    ['extra request URL', (r) => { r.url = 'https://rpc.example.org/'; }, 'INVALID_INPUT'],
    ['extra transaction sender', (r) => { r.params[0].from = `0x${'2'.repeat(40)}`; }, 'INVALID_INPUT'],
    ['extra transaction value', (r) => { r.params[0].value = '0x1'; }, 'INVALID_INPUT'],
    ['extra parameter', (r) => { r.params.push({}); }, 'INVALID_INPUT'],
    ['notification-shaped request', (r) => { delete r.readId; }, 'INVALID_INPUT'],
    ['write method', (r) => { r.method = 'eth_sendRawTransaction'; r.params = ['0x01']; }, 'INVALID_INPUT'],
    ['invalid block tag', (r) => { r.params[1] = 'newest'; }, 'INVALID_INPUT'],
    ['malformed chain identifier', (r) => { r.chainId = '010'; }, 'INVALID_INPUT'],
  ])('denies %s', (_name, change, code) => {
    const candidate = request(); change(candidate);
    expect(admitFixedQuoteRead(candidate)).toEqual(fail(code));
  });

  it.each([null, undefined, [], '0x', 10, {}, [request()]])('rejects non-read input %j', (input) => {
    expect(admitFixedQuoteRead(input)).toEqual(fail('INVALID_INPUT'));
  });

  it('returns a parsed copy so later caller mutation cannot change an admitted read', () => {
    const candidate = request(); const admitted = admitFixedQuoteRead(candidate);
    candidate.params[0].data = '0xaaaaaaaa'; candidate.params[1] = 'pending';
    expect(admitted).toEqual(ok(request()));
  });

  it('canonicalizes equivalent uppercase address and calldata bytes', () => {
    const candidate = request();
    candidate.params[0].to = `0x${candidate.params[0].to.slice(2).toUpperCase()}`;
    candidate.params[0].data = `0x${candidate.params[0].data.slice(2).toUpperCase()}`;
    expect(admitFixedQuoteRead(candidate)).toEqual(ok(request()));
  });

  it('never returns accessor-substituted bytes after successful admission', () => {
    let successes = 0;
    // The boundary accepts unknown local values, not only deserialized JSON.
    // Vary when an accessor changes without depending on validator read counts.
    for (let threshold = 1; threshold <= 16; threshold++) {
      const candidate = request(); let reads = 0;
      Object.defineProperty(candidate.params[0], 'data', {
        enumerable: true,
        get: () => ++reads <= threshold ? fixture.calldata : '0xaaaaaaaa',
      });
      const admitted = admitFixedQuoteRead(candidate);
      if (admitted.ok) {
        successes++;
        expect(admitted).toEqual(ok(request()));
      }
    }
    expect(successes).toBeGreaterThan(0);
  });
});

describe('quote RPC envelope and network-free boundary (SIMULATED)', () => {
  it('requires a correlated success envelope before method-specific decoding', () => {
    expect(decodeFixedQuoteResponse(envelope(), 'quote-wire-1')).toEqual(ok(fixture.result.decoded));
    expect(decodeFixedQuoteResponse(envelope(), 'quote-wire-2')).toEqual(fail('RPC_RESPONSE_INVALID'));
    expect(decodeFixedQuoteResponse(envelope('0x'), 'quote-wire-1')).toEqual(fail('RPC_RESPONSE_INVALID'));
  });

  it.each([
    { jsonrpc: '2.0', id: 'quote-wire-1', result: fixture.result.encoded, extra: 'private provider payload' },
    { jsonrpc: '1.0', id: 'quote-wire-1', result: fixture.result.encoded },
    { jsonrpc: '2.0', id: null, result: fixture.result.encoded },
    { jsonrpc: '2.0', id: 'quote-wire-1', result: fixture.result.encoded, error: { code: -1, message: 'private provider payload' } },
    [envelope()], null,
  ])('rejects malformed envelope without copying provider data', (input) => {
    expect(decodeFixedQuoteResponse(input, 'quote-wire-1')).toEqual(fail('RPC_RESPONSE_INVALID'));
  });

  it('sanitizes a correlated RPC error and rejects an uncorrelated null error ID', () => {
    const error = { jsonrpc: '2.0', id: 'quote-wire-1', error: { code: -32000, message: 'private provider payload', data: 'private payload' } };
    expect(decodeFixedQuoteResponse(error, 'quote-wire-1')).toEqual(fail('RPC_ERROR'));
    expect(decodeFixedQuoteResponse({ ...error, id: null }, 'quote-wire-1')).toEqual(fail('RPC_RESPONSE_INVALID'));
  });

  it('performs encoding, admission and decoding without contacting any destination', async () => {
    const network = vi.fn(() => { throw Error('A pure quote helper must never send traffic.'); });
    vi.stubGlobal('fetch', network);
    expect(createFixedQuoteRead(READ_ID, ENDPOINT_ID)).toEqual(ok(request()));
    expect(admitFixedQuoteRead(request())).toEqual(ok(request()));
    expect(decodeFixedQuoteResponse(envelope(), 'quote-wire-1')).toEqual(ok(fixture.result.decoded));
    expect(network).not.toHaveBeenCalled();
    const source = await readFile(new URL('../../../apps/dashboard/src/features/quote/fixed-quote.ts', import.meta.url), 'utf8');
    expect(inspectBrowserSource(source, 'apps/dashboard/src/features/quote/fixed-quote.ts')).toEqual([]);
  });
});
