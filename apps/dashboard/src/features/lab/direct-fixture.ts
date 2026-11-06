import { makeError, validateRpcResponse, type Result, type RpcTrace } from '@monolith/shared';
import { LIVE_CHAIN } from '../registry/live-policy.js';
import { observerReadUrl } from './wire-driver.js';
import { LIVE_CALLSITES, SYNTHETIC_ADDRESS, type LiveAllocation, type LiveWireRead } from './live-types.js';

export type DirectFixtureSend = typeof fetch;

/** Explicit, isolated negative-control capability. Ordinary reads never call this. */
export async function sendDirectFixture(options: {
  consent: boolean;
  role: 'direct-control' | 'leak';
  evidence: 'OBSERVED_LIVE' | 'SIMULATED';
  observerOrigin: string;
  allocation: LiveAllocation;
  endpointId: string;
  uuid: () => string;
  now: () => string;
  elapsed: () => number;
  send: DirectFixtureSend;
  signal: AbortSignal;
  onRead: (row: LiveWireRead) => void;
}): Promise<Result<LiveWireRead>> {
  if (!options.consent || options.signal.aborted) return { ok: false, error: makeError('POLICY_DENIED') };
  const id = options.uuid();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    return { ok: false, error: makeError('INVALID_INPUT') };
  }
  const url = observerReadUrl(options.observerOrigin, options.allocation.runId);
  const row: LiveWireRead = {
    rpcId: options.role === 'direct-control' ? options.allocation.baselineRpcId : `rpc-${id}`,
    logicalReadId: `direct_${id}`, role: options.role, method: 'eth_getBalance', chainId: LIVE_CHAIN,
    endpointId: options.endpointId, startedAt: options.now(), completedAt: null, durationMs: 0,
    success: false, result: null, trace: null, evidence: options.evidence,
  };
  const began = options.elapsed();
  options.onRead({ ...row });
  try {
    const response = await options.send(url, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json' }, signal: options.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: row.rpcId, method: 'eth_getBalance', params: [SYNTHETIC_ADDRESS, 'latest'] }),
    });
    if (!response.ok || response.redirected || response.url && response.url !== url
      || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
      await response.body?.cancel();
      return { ok: false, error: makeError('UPSTREAM_UNAVAILABLE') };
    }
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, error: makeError('RPC_RESPONSE_INVALID') };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    options.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (options.signal.aborted) {
        await reader.cancel();
        return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
      }
      for (;;) {
        const part = await reader.read();
        if (options.signal.aborted) return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 512 * 1024) { await reader.cancel(); return { ok: false, error: makeError('RPC_RESPONSE_INVALID') }; }
        chunks.push(part.value);
      }
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const part of chunks) { data.set(part, offset); offset += part.byteLength; }
      const parsed = validateRpcResponse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)), row.rpcId);
      if (!parsed.ok) return parsed;
      if (typeof parsed.value.result !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(parsed.value.result)) {
        return { ok: false, error: makeError('RPC_RESPONSE_INVALID') };
      }
      row.success = true;
      row.result = parsed.value.result;
      return { ok: true, value: row };
    } finally {
      options.signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  } catch { return { ok: false, error: makeError(options.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE') }; }
  finally {
    row.completedAt = options.now();
    row.durationMs = Math.max(0, options.elapsed() - began);
    if (options.role === 'direct-control') {
      const trace: RpcTrace = {
        schemaVersion: 1, readId: row.logicalReadId, attempt: 1, endpointId: row.endpointId,
        chainId: row.chainId, method: row.method, callsite: LIVE_CALLSITES[row.role], route: 'direct-debug',
        durationMs: row.durationMs, success: row.success, bootstrap: false, evidence: options.evidence,
        payloadVisibility: 'rpc-endpoint-can-read',
        ...(row.success ? {} : { errorCode: 'UPSTREAM_UNAVAILABLE' as const }),
      };
      row.trace = trace;
    }
    options.onRead({ ...row });
  }
}
