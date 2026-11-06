import { jsonRpcRequestSchema, makeError, publicHttpsUrlSchema, validateRpcResponse } from '@monolith/shared';
import type { JsonRpcRequest, JsonValue, Result, RpcTrace } from '@monolith/shared';
import type { TransportDriver } from '@monolith/transport';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RPC = new RegExp(`^rpc-${UUID}$`);
const RUN = new RegExp(`^run-${UUID}$`);
export const SYNTHETIC_ADDRESS = `0x${'0'.repeat(40)}`;
export type Role = 'direct-baseline' | 'direct-control' | 'protected-probe' | 'protected-comparison';
export type LabConfiguration = { target: string; runId: string; baselineRpcId: string; directControlRpcId: string };
export type Issued = {
  rpcId: string; role: Role; method: string; issuedAt: string; completedAt: string;
  result: JsonValue | null; requestFingerprint: string; readId?: string; attempt?: number;
};
const denied = (): Result<never> => ({ ok: false, error: makeError('POLICY_DENIED') });

/** Fixed synthetic payloads only; the harness never accepts a wallet to inspect. */
export function permittedRead(request: JsonRpcRequest): boolean {
  return request.method === 'eth_chainId' && request.params.length === 0
    || request.method === 'eth_getBalance' && request.params.length === 2
      && request.params[0] === SYNTHETIC_ADDRESS && request.params[1] === 'latest';
}

export function captureLabConfiguration(input: LabConfiguration): Readonly<LabConfiguration> {
  if (!input || !publicHttpsUrlSchema.safeParse(input.target).success
    || !RUN.test(input.runId) || !RPC.test(input.baselineRpcId) || !RPC.test(input.directControlRpcId)
    || input.baselineRpcId === input.directControlRpcId) throw new Error('Invalid lab configuration.');
  const url = new URL(input.target);
  if (url.pathname !== '/api/observer/read' || url.search !== '?endpointId=mn009_ethereum'
    || url.hash || url.username || url.password) throw new Error('Invalid lab configuration.');
  return Object.freeze({ target: url.href, runId: input.runId,
    baselineRpcId: input.baselineRpcId, directControlRpcId: input.directControlRpcId });
}

/** Scoped SDK-method decoration in the disposable host, never a global fetch hook. */
export function installLabHeaderBinding(
  prototype: { fetch: typeof fetch }, input: LabConfiguration,
): () => void {
  const settings = captureLabConfiguration(input);
  const original = prototype.fetch;
  const decorated: typeof fetch = function (this: unknown, resource, options) {
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    const headers = new Headers(options?.headers);
    let body: JsonRpcRequest;
    try {
      const parsed = jsonRpcRequestSchema.safeParse(JSON.parse(typeof options?.body === 'string' ? options.body : 'null'));
      if (!parsed.success || !RPC.test(parsed.data.id) || !permittedRead(parsed.data)) throw new Error();
      body = parsed.data;
    } catch { return Promise.reject(new Error('Lab request denied.')); }
    if (url !== settings.target || options?.method !== 'POST'
      || headers.get('content-type') !== 'application/json'
      || [...headers.keys()].some((name) => name !== 'content-type')
      || !body) return Promise.reject(new Error('Lab request denied.'));
    headers.set('x-monolith-run', settings.runId);
    headers.set('x-monolith-case', 'protected');
    return original.call(this, resource, { ...options, headers });
  };
  prototype.fetch = decorated;
  return () => { if (prototype.fetch === decorated) prototype.fetch = original; };
}

/** Explicit direct comparison capability; cannot serve any other URL or payload. */
export function createDirectLabDriver(input: LabConfiguration): TransportDriver {
  const settings = captureLabConfiguration(input);
  const lifetime = new AbortController();
  let closed = false;
  return {
    route: 'direct-debug', evidence: 'OBSERVED_LIVE',
    async initialize(signal) { return closed || signal.aborted ? denied() : { ok: true, value: undefined }; },
    async exchange(url, request, signal) {
      if (closed || signal.aborted || url !== settings.target || !RPC.test(request.id)
        || !jsonRpcRequestSchema.safeParse(request).success || !permittedRead(request)) return denied();
      const bounded = AbortSignal.any([signal, lifetime.signal]);
      try {
        const response = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-monolith-run': settings.runId,
            // A label is deliberately unable to elect a source class.
            'x-monolith-case': request.id === settings.baselineRpcId ? 'baseline' : 'protected' },
          body: JSON.stringify(request), credentials: 'omit', redirect: 'error', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: bounded,
        });
        if (!response.ok || response.redirected || response.url !== settings.target
          || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
          void response.body?.cancel().catch(() => {});
          return { ok: false, error: makeError('UPSTREAM_UNAVAILABLE') };
        }
        if (!response.body) return { ok: false, error: makeError('RPC_RESPONSE_INVALID') };
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const abort = () => { void reader.cancel().catch(() => {}); };
        bounded.addEventListener('abort', abort, { once: true });
        try {
          for (;;) {
            const chunk = await reader.read();
            if (bounded.aborted) return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 512 * 1024) { abort(); return { ok: false, error: makeError('RPC_RESPONSE_INVALID') }; }
            chunks.push(chunk.value);
          }
          const body = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
          const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
          const envelope = validateRpcResponse(parsed, request.id);
          return envelope.ok ? { ok: true, value: envelope.value } : envelope;
        } finally { bounded.removeEventListener('abort', abort); reader.releaseLock(); }
      } catch { return { ok: false, error: makeError(bounded.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE') }; }
    },
    async close() { closed = true; lifetime.abort(); },
  };
}

export function createLabDriver(base: TransportDriver, input: LabConfiguration) {
  const settings = captureLabConfiguration(input);
  const inventory: Issued[] = [];
  let role: Role | undefined;
  let usedBaseline = false;
  let usedControl = false;
  let outstanding: Issued | undefined;
  const driver: TransportDriver = {
    route: base.route, evidence: base.evidence,
    initialize: (signal) => base.initialize(signal), close: () => base.close(),
    async exchange(url, request, signal) {
      if (!role || outstanding || url !== settings.target || !jsonRpcRequestSchema.safeParse(request).success
        || !permittedRead(request) || signal.aborted
        || (role.startsWith('protected-') !== (base.route === 'anon-nym' || base.route === 'anon-tor'))
        || role === 'direct-baseline' && usedBaseline || role === 'direct-control' && usedControl) return denied();
      const currentRole = role;
      const rpcId = role === 'direct-baseline' ? settings.baselineRpcId
        : role === 'direct-control' ? settings.directControlRpcId : `rpc-${crypto.randomUUID()}`;
      if (role === 'direct-baseline') usedBaseline = true;
      if (role === 'direct-control') usedControl = true;
      const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({
        method: request.method, params: request.params,
      })));
      const requestFingerprint = [...new Uint8Array(fingerprint)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const row: Issued = { rpcId, role: currentRole, method: request.method, issuedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), result: null, requestFingerprint };
      inventory.push(row);
      // Associate the completion with this exact exchange capability. There is
      // no search/join by method, timestamp, or whichever diagnostic looks useful.
      outstanding = row;
      try {
        const result = await base.exchange(url, { ...request, id: rpcId }, signal);
        if (!result.ok) return result;
        const envelope = validateRpcResponse(result.value, rpcId);
        if (!envelope.ok) return envelope;
        if (signal.aborted) return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
        row.result = envelope.value.result;
        return { ok: true, value: { ...envelope.value, id: request.id } };
      } finally { row.completedAt = new Date().toISOString(); }
    },
  };
  return {
    driver, inventory,
    async run<T>(nextRole: Role, operation: () => Promise<T>): Promise<T> {
      if (role) throw new Error('Concurrent lab operation denied.');
      role = nextRole;
      try { return await operation(); } finally { role = undefined; }
    },
    bindTrace(trace: RpcTrace): void {
      if (trace.bootstrap) return;
      const row = outstanding;
      const expectedCallsite = row?.role === 'protected-probe' ? 'transport.chain-probe'
        : row?.role === 'protected-comparison' ? 'mn009.protected' : 'mn009.direct';
      const expectedRead = row?.role === 'protected-probe' ? /^monolith_probe_[1-9]\d*$/
        : new RegExp(`^mn009_${UUID}$`);
      if (!row || trace.route !== base.route || trace.method !== row.method || trace.callsite !== expectedCallsite
        || trace.attempt !== 1 || !expectedRead.test(trace.readId)) return;
      row.readId = trace.readId;
      row.attempt = trace.attempt;
      outstanding = undefined;
    },
  };
}
