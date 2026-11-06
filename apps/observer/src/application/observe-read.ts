import {
  jsonRpcIdSchema, jsonRpcRequestSchema, makeError,
  type ErrorCode, type JsonRpcResponse,
} from '@monolith/shared';
import { addressPresent, checkReadPolicy } from '../domain/observer-policy.js';
import { type DiagnosticsStore, type ObservationTicket } from '../domain/diagnostics.js';
import type { ObserverEndpoint, UpstreamReader } from '../domain/ports.js';

export type ReadReply = { statusCode: number; body: JsonRpcResponse };

export function rpcFailure(id: string | null, code: ErrorCode, statusCode: number, rpcCode = -32000): ReadReply {
  return { statusCode, body: { jsonrpc: '2.0', id, error: { code: rpcCode, message: makeError(code).message } } };
}

export function requestId(input: unknown): string | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = (input as Record<string, unknown>)['id'];
  return jsonRpcIdSchema.safeParse(id).success ? id as string : null;
}

export function createObserveRead(options: {
  endpoints: ReadonlyMap<string, ObserverEndpoint>;
  upstream: UpstreamReader;
  diagnostics: DiagnosticsStore;
  nowMs: () => number;
}) {
  return async (endpointId: string, input: unknown, context: {
    runId?: string; peer?: string; signal?: AbortSignal;
  }): Promise<ReadReply> => {
    const id = requestId(input);
    const parsed = jsonRpcRequestSchema.safeParse(input);
    if (!parsed.success) return rpcFailure(id, 'INVALID_INPUT', 400, -32600);
    const endpoint = options.endpoints.get(endpointId);
    if (!endpoint) return rpcFailure(id, 'TARGET_DENIED', 403);
    const policy = checkReadPolicy(endpoint, parsed.data);
    if (!policy.ok) return rpcFailure(id, policy.error.code, 403);
    let ticket: ObservationTicket | undefined;
    if (context.runId !== undefined) {
      const reservation = options.diagnostics.reserve(context.runId, parsed.data.id, parsed.data.method,
        addressPresent(parsed.data), context.peer);
      if (!reservation.ok) return rpcFailure(id, reservation.error.code,
        reservation.error.code === 'RATE_LIMITED' ? 429 : 400);
      ticket = reservation.value;
    }
    const started = options.nowMs();
    let success = false;
    try {
      const result = await options.upstream.read(endpoint, parsed.data, context.signal);
      if (context.signal?.aborted) return rpcFailure(id, 'UPSTREAM_TIMEOUT', 504);
      if (!result.ok) return rpcFailure(id, result.error.code, result.error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502);
      success = true;
      return { statusCode: 200, body: result.value };
    } catch {
      return rpcFailure(id, 'UPSTREAM_UNAVAILABLE', 502);
    } finally {
      if (ticket) options.diagnostics.complete(ticket, Math.max(0, options.nowMs() - started), success);
    }
  };
}
