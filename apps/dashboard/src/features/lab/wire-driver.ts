import {
  jsonRpcRequestSchema, makeError, validateRpcResponse,
  type JsonRpcRequest, type Result, type RpcTrace,
} from '@monolith/shared';
import type { TransportDriver } from '@monolith/transport';
import { LIVE_CHAIN, LIVE_OBSERVER_ENDPOINT, LIVE_RPC_URL } from '../registry/live-policy.js';
import { LIVE_CALLSITES, SYNTHETIC_ADDRESS, type LiveRole, type LiveWireRead } from './live-types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const denied = <T>(code: 'POLICY_DENIED' | 'WORKER_UNAVAILABLE' | 'RATE_LIMITED' = 'POLICY_DENIED'): Result<T> =>
  ({ ok: false, error: makeError(code) });

export function observerReadUrl(origin: string, runId: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || !UUID.test(runId.slice(4)) || !runId.startsWith('run-')) {
    throw new Error('Invalid live observer configuration.');
  }
  return `${origin}/api/observer/read?endpointId=${LIVE_OBSERVER_ENDPOINT}&runId=${runId}`;
}

export function permittedLiveRead(request: JsonRpcRequest): boolean {
  return request.method === 'eth_chainId' && request.params.length === 0
    || request.method === 'eth_getBalance' && request.params.length === 2
      && request.params[0] === SYNTHETIC_ADDRESS && request.params[1] === 'latest';
}

/** This capability owns the mapped run, while its controller owns the reusable real worker. */
export function createMappedLiveDriver(options: {
  base: TransportDriver;
  observerOrigin: string;
  runId: string;
  uuid: () => string;
  now: () => string;
  elapsed: () => number;
  context: () => { role: LiveRole; logicalReadId: string | null } | null;
  onRead: (read: LiveWireRead) => void;
}) {
  const target = observerReadUrl(options.observerOrigin, options.runId);
  const lifetime = new AbortController();
  let closed = false;
  let outstanding: LiveWireRead | null = null;
  let count = 0;
  const driver: TransportDriver = {
    route: options.base.route,
    evidence: options.base.evidence,
    initialize: (signal) => closed || signal.aborted ? Promise.resolve(denied('WORKER_UNAVAILABLE')) : options.base.initialize(signal),
    async exchange(url, request, signal) {
      const context = options.context();
      if (closed || signal.aborted) return denied('WORKER_UNAVAILABLE');
      if (count >= 64) return denied('RATE_LIMITED');
      if (!context || outstanding || url !== LIVE_RPC_URL || options.base.route !== 'anon-nym'
        || !jsonRpcRequestSchema.safeParse(request).success || !permittedLiveRead(request)
        || (context.role === 'probe') !== (request.method === 'eth_chainId')) return denied();
      const id = options.uuid();
      if (!UUID.test(id)) return denied();
      count++;
      const began = options.elapsed();
      const row: LiveWireRead = {
        rpcId: `rpc-${id}`, logicalReadId: context.logicalReadId ?? '', role: context.role,
        method: request.method as 'eth_chainId' | 'eth_getBalance', chainId: LIVE_CHAIN,
        endpointId: '', startedAt: options.now(), completedAt: null, durationMs: 0,
        success: false, result: null, trace: null,
        evidence: options.base.evidence,
      };
      outstanding = row;
      options.onRead({ ...row });
      const combined = AbortSignal.any([signal, lifetime.signal]);
      try {
        // No raw-URL fallback: the only delegated destination is the fixed observer map.
        const result = await options.base.exchange(target, { ...request, id: row.rpcId }, combined);
        if (combined.aborted || closed) return denied('WORKER_UNAVAILABLE');
        if (!result.ok) return result;
        const envelope = validateRpcResponse(result.value, row.rpcId);
        if (!envelope.ok) return envelope;
        if (typeof envelope.value.result !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(envelope.value.result)) {
          return { ok: false, error: makeError('RPC_RESPONSE_INVALID') };
        }
        row.success = true;
        row.result = envelope.value.result;
        return { ok: true, value: { ...envelope.value, id: request.id } };
      } finally {
        row.completedAt = options.now();
        row.durationMs = Math.max(0, options.elapsed() - began);
        options.onRead({ ...row });
      }
    },
    async close() { closed = true; lifetime.abort(); outstanding = null; },
  };
  return {
    driver,
    bindTrace(trace: RpcTrace) {
      const row = outstanding;
      if (!row || trace.bootstrap || trace.route !== 'anon-nym' || trace.method !== row.method
        || trace.chainId !== LIVE_CHAIN || trace.attempt !== 1 || trace.callsite !== LIVE_CALLSITES[row.role]
        || row.logicalReadId && row.logicalReadId !== trace.readId
        || row.role === 'probe' && !/^monolith_probe_[1-9]\d*$/.test(trace.readId)) return;
      row.logicalReadId = trace.readId;
      row.endpointId = trace.endpointId;
      row.trace = { ...trace };
      outstanding = null;
      options.onRead({ ...row });
    },
  };
}
