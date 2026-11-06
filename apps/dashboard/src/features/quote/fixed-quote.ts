import { makeError, parseContract, readRequestSchema, validateRpcResponse } from '@monolith/shared';
import type { ReadRequest, Result } from '@monolith/shared';

/** Documented configuration only. Pool availability and a live quote remain untested. */
export const FIXED_QUOTE_SCENARIO = Object.freeze({
  chainId: '10',
  quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  tokenIn: '0x4200000000000000000000000000000000000006',
  tokenOut: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  amountIn: '10000000000000000',
  fee: 500,
  sqrtPriceLimitX96: '0',
  blockTag: 'latest',
  selector: '0xc6a5026a',
  callsite: 'quote.fixed.exact-input',
} as const);

// IQuoterV2's tuple is static: tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96.
// This deliberately encodes one fixed operation, without a general ABI or provider API.
export function encodeFixedQuoteCall(): { to: string; data: string } {
  const scenario = FIXED_QUOTE_SCENARIO;
  const addressWord = (address: string) => address.slice(2).toLowerCase().padStart(64, '0');
  const uintWord = (value: string | number) => BigInt(value).toString(16).padStart(64, '0');
  return {
    to: scenario.quoter,
    data: scenario.selector + [
      addressWord(scenario.tokenIn), addressWord(scenario.tokenOut),
      uintWord(scenario.amountIn), uintWord(scenario.fee), uintWord(scenario.sqrtPriceLimitX96),
    ].join(''),
  };
}

/** The endpoint ID must come from a separately admitted transport selection. */
export function createFixedQuoteRead(readId: string, endpointId: string): Result<ReadRequest> {
  return admitFixedQuoteRead({
    readId, endpointId, chainId: FIXED_QUOTE_SCENARIO.chainId,
    method: 'eth_call', params: [encodeFixedQuoteCall(), FIXED_QUOTE_SCENARIO.blockTag],
    callsite: FIXED_QUOTE_SCENARIO.callsite,
  });
}

/** Pure request admission, not registry, endpoint, worker or routing authorization. */
export function admitFixedQuoteRead(input: unknown): Result<ReadRequest> {
  const parsed = parseContract(readRequestSchema, input);
  if (!parsed.ok) return parsed;
  const request = parsed.value;
  if (request.chainId !== FIXED_QUOTE_SCENARIO.chainId) {
    return { ok: false, error: makeError('CHAIN_MISMATCH') };
  }
  if (request.method !== 'eth_call') return { ok: false, error: makeError('METHOD_DENIED') };
  const [call, blockTag] = request.params;
  if (request.callsite !== FIXED_QUOTE_SCENARIO.callsite || blockTag !== FIXED_QUOTE_SCENARIO.blockTag) {
    return { ok: false, error: makeError('POLICY_DENIED') };
  }
  const fixed = encodeFixedQuoteCall();
  if (!call || typeof call !== 'object' || Array.isArray(call)
    || typeof call['to'] !== 'string' || typeof call['data'] !== 'string'
    || call['to'].toLowerCase() !== fixed.to.toLowerCase()
    || call['data'].toLowerCase() !== fixed.data) {
    return { ok: false, error: makeError('TARGET_DENIED') };
  }
  // Shared JSON validation does not clone nested values. Return the canonical
  // operation without retaining or re-reading caller-owned properties.
  return { ok: true, value: {
    ...request, params: [fixed, FIXED_QUOTE_SCENARIO.blockTag],
  } };
}

export type FixedQuoteResult = {
  amountOut: string;
  sqrtPriceX96After: string;
  initializedTicksCrossed: string;
  gasEstimate: string;
};

// Uniswap v3 TickMath's valid sqrt-price domain; these are integer bounds, not a price sample.
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/** Decode exactly four ABI words. Values remain lossless, JSON-safe decimal strings. */
export function decodeFixedQuoteResult(input: unknown): Result<FixedQuoteResult> {
  const invalid = (): Result<FixedQuoteResult> => ({ ok: false, error: makeError('RPC_RESPONSE_INVALID') });
  if (typeof input !== 'string' || input.length !== 258 || !/^0x[0-9a-fA-F]{256}$/.test(input)) {
    return invalid();
  }
  const word = (index: number) => BigInt(`0x${input.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
  const amountOut = word(0);
  const sqrtPriceX96After = word(1);
  const initializedTicksCrossed = word(2);
  const gasEstimate = word(3);
  if (amountOut === 0n || gasEstimate === 0n || sqrtPriceX96After >= (1n << 160n)
    || initializedTicksCrossed >= (1n << 32n)
    || sqrtPriceX96After < MIN_SQRT_RATIO || sqrtPriceX96After >= MAX_SQRT_RATIO) {
    return invalid();
  }
  return { ok: true, value: {
    amountOut: amountOut.toString(), sqrtPriceX96After: sqrtPriceX96After.toString(),
    initializedTicksCrossed: initializedTicksCrossed.toString(), gasEstimate: gasEstimate.toString(),
  } };
}

/** Correlate and sanitize the JSON-RPC envelope before method-specific decoding. */
export function decodeFixedQuoteResponse(input: unknown, expectedId: string): Result<FixedQuoteResult> {
  const envelope = validateRpcResponse(input, expectedId);
  return envelope.ok ? decodeFixedQuoteResult(envelope.value.result) : envelope;
}
