import {
  addressSchema, chainIdSchema, identifierSchema, publicHttpsUrlSchema,
  makeError, type JsonRpcRequest, type Result,
} from '@monolith/shared';
import type { ObserverEndpoint } from './ports.js';

const blockTags = new Set(['latest', 'safe', 'finalized']);

export function endpointMap(endpoints: readonly ObserverEndpoint[]): ReadonlyMap<string, ObserverEndpoint> {
  const result = new Map<string, ObserverEndpoint>();
  if (endpoints.length > 64) throw new Error('Invalid observer configuration.');
  for (const endpoint of endpoints) {
    if (!identifierSchema.safeParse(endpoint.endpointId).success
      || !chainIdSchema.safeParse(endpoint.chainId).success
      || !publicHttpsUrlSchema.safeParse(endpoint.rpcUrl).success
      || result.has(endpoint.endpointId) || !Array.isArray(endpoint.calls) || endpoint.calls.length > 64
      || endpoint.calls.some((call) => !addressSchema.safeParse(call.to).success
        || !/^0x[0-9a-fA-F]{8}$/.test(call.selector)
        || !Number.isInteger(call.dataBytes) || call.dataBytes < 4 || call.dataBytes > 4096)) {
      throw new Error('Invalid observer configuration.');
    }
    // Capture operator configuration so later caller mutations cannot expand policy.
    result.set(endpoint.endpointId, Object.freeze({
      ...endpoint, calls: Object.freeze(endpoint.calls.map((call) => Object.freeze({ ...call }))),
    }));
  }
  return result;
}

export function checkReadPolicy(endpoint: ObserverEndpoint, request: JsonRpcRequest): Result<void> {
  if (request.method === 'eth_getBalance' || request.method === 'eth_call') {
    if (!blockTags.has(String(request.params[1]))) return { ok: false, error: makeError('POLICY_DENIED') };
  }
  if (request.method === 'eth_call') {
    // The shared request schema has already validated the call tuple and object.
    const call = request.params[0] as { to: string; data: string };
    const permitted = endpoint.calls.some((rule) => rule.to.toLowerCase() === call.to.toLowerCase()
      && rule.selector.toLowerCase() === call.data.slice(0, 10).toLowerCase()
      && rule.dataBytes === (call.data.length - 2) / 2);
    if (!permitted) return { ok: false, error: makeError('TARGET_DENIED') };
  }
  return { ok: true, value: undefined };
}

/** Presence only: balances contain the subject address; calls contain a target address. */
export function addressPresent(request: JsonRpcRequest): boolean {
  return request.method === 'eth_getBalance' || request.method === 'eth_call';
}
