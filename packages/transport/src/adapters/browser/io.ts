import { readSpecifier } from '@anon-rpc/harness-core';
import {
  isBoundedJson, makeError, publicHttpsUrlSchema, validateRpcResponse,
} from '@monolith/shared';
import type { Clock, ErrorCode, Result, RpcTrace, TraceSink } from '@monolith/shared';

export const WORKER_SPECIFIERS = Object.freeze({
  nym: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
  tor: '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e',
  passthrough: '0x4fd77be300f31c5fe6ab266d35d27750a3478d27',
});
export const BOOTSTRAP_SELECTORS = Object.freeze({
  hash: '0x3898587d',
  resolvers: '0x1c67ff29',
});

const DEFAULT_RESPONSE_BYTES = 512 * 1024;

function failed(code: ErrorCode): Result<never> {
  return { ok: false, error: makeError(code) };
}

/** Cancel without letting an uncooperative stream prolong a bounded operation. */
function cancelBody(response: Response): void {
  if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
}

/** No raw response bytes, JSON errors or upstream diagnostics escape this boundary. */
export async function readJsonResponse(
  response: Response, signal: AbortSignal, maxBytes = DEFAULT_RESPONSE_BYTES,
): Promise<Result<unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    cancelBody(response);
    return failed('INVALID_INPUT');
  }
  if (signal.aborted) {
    cancelBody(response);
    return failed('UPSTREAM_TIMEOUT');
  }
  if (response.redirected || response.type === 'opaqueredirect') {
    cancelBody(response);
    return failed('UPSTREAM_UNAVAILABLE');
  }
  if (response.status === 429) {
    cancelBody(response);
    return failed('RATE_LIMITED');
  }
  if (!response.ok) {
    cancelBody(response);
    return failed('UPSTREAM_UNAVAILABLE');
  }
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    cancelBody(response);
    return failed('RPC_RESPONSE_INVALID');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    cancelBody(response);
    return failed('RPC_RESPONSE_INVALID');
  }
  if (!response.body || response.body.locked || response.bodyUsed) return failed('RPC_RESPONSE_INVALID');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let resolveAbort: (() => void) | undefined;
  const aborted = new Promise<'aborted'>((resolve) => { resolveAbort = () => resolve('aborted'); });
  const onAbort = () => {
    resolveAbort?.();
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk === 'aborted' || signal.aborted) return failed('UPSTREAM_TIMEOUT');
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        void reader.cancel().catch(() => {});
        return failed('RPC_RESPONSE_INVALID');
      }
      chunks.push(chunk.value);
    }
    if (signal.aborted) return failed('UPSTREAM_TIMEOUT');
    const bytes = new Uint8Array(byteLength);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return isBoundedJson(parsed) ? { ok: true, value: parsed } : failed('RPC_RESPONSE_INVALID');
  } catch {
    void reader.cancel().catch(() => {});
    return failed(signal.aborted ? 'UPSTREAM_TIMEOUT' : 'RPC_RESPONSE_INVALID');
  } finally {
    signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* An aborted pending read can still be settling. */ }
  }
}

export type BootstrapOptions = {
  network: keyof typeof WORKER_SPECIFIERS;
  rpcUrl: string;
  signal: AbortSignal;
  traceSink: TraceSink;
  clock: Clock;
  fetcher?: typeof fetch;
};
export type BootstrapMetadata = { specifier: string; workerHash: string | null; bootstrapCalls: number };

/** Two narrowly enumerated, disclosed mainnet specifier reads; never an app RPC provider. */
export function createBootstrapProvider(options: BootstrapOptions) {
  const specifier = WORKER_SPECIFIERS[options.network];
  const rpcUrl = options.rpcUrl;
  const signal = options.signal;
  const traceSink = options.traceSink;
  const clock = options.clock;
  const fetcher = options.fetcher ?? fetch;
  const evidence = options.fetcher ? 'SIMULATED' : 'OBSERVED_LIVE';
  const configured = typeof specifier === 'string' && publicHttpsUrlSchema.safeParse(rpcUrl).success;
  const requested = new Set<string>();
  const captured = new Map<string, string>();
  let workerHash: string | null = null;

  function nowMs(): number {
    try { return Date.parse(clock.now()); } catch { return Number.NaN; }
  }

  function metadata(): BootstrapMetadata {
    return { specifier, workerHash, bootstrapCalls: requested.size };
  }

  async function request(args: { method: string; params?: unknown }): Promise<string> {
    let selector: string;
    try {
      const params = args.params;
      const tx: unknown = Array.isArray(params) ? params[0] : undefined;
      if (!configured || signal.aborted || args.method !== 'eth_call'
        || Object.keys(args).sort().join(',') !== 'method,params'
        || !Array.isArray(params) || params.length !== 2 || params[1] !== 'latest'
        || !tx || typeof tx !== 'object' || Array.isArray(tx)
        || Object.keys(tx).sort().join(',') !== 'data,to'
        || !('to' in tx) || typeof tx.to !== 'string' || tx.to.toLowerCase() !== specifier.toLowerCase()
        || !('data' in tx) || typeof tx.data !== 'string'
        || (tx.data !== BOOTSTRAP_SELECTORS.hash && tx.data !== BOOTSTRAP_SELECTORS.resolvers)
        || requested.has(tx.data) || requested.size >= 2) {
        throw new Error('bootstrap policy denied');
      }
      selector = tx.data;
    } catch {
      throw new Error('bootstrap policy denied');
    }

    requested.add(selector);
    const kind = selector === BOOTSTRAP_SELECTORS.hash ? 'hash' : 'resolvers';
    const id = `monolith_bootstrap_${kind}`;
    const started = nowMs();
    let errorCode: ErrorCode | undefined;
    let success = false;
    try {
      let rejectAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error('bootstrap unavailable'));
      });
      const onAbort = () => rejectAbort?.();
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      const fetching = Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('bootstrap unavailable');
        return fetcher(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'eth_call',
            params: [{ to: specifier, data: selector }, 'latest'] }),
          signal,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
      });
      // A misbehaving adapter cannot extend the lifecycle by ignoring abort.
      void fetching.then((response) => { if (signal.aborted) cancelBody(response); }, () => {});
      let response: Response;
      try { response = await Promise.race([fetching, aborted]); }
      finally { signal.removeEventListener('abort', onAbort); }
      if (response.url && response.url !== new URL(rpcUrl).href) {
        cancelBody(response);
        errorCode = 'UPSTREAM_UNAVAILABLE';
        throw new Error('bootstrap unavailable');
      }
      const body = await readJsonResponse(response, signal, 64 * 1024);
      if (!body.ok) {
        errorCode = body.error.code;
        throw new Error('bootstrap unavailable');
      }
      const envelope = validateRpcResponse(body.value, id);
      if (!envelope.ok) {
        errorCode = envelope.error.code;
        throw new Error('bootstrap unavailable');
      }
      const result = envelope.value.result;
      if (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(result)
        || (kind === 'hash' && !/^0x[0-9a-fA-F]{64}$/.test(result))) {
        errorCode = 'RPC_RESPONSE_INVALID';
        throw new Error('bootstrap unavailable');
      }
      captured.set(selector, result);
      if (kind === 'hash') workerHash = result.toLowerCase();
      if (captured.size === 2) {
        // Decode the actual captured replies using the SDK's public ABI decoder.
        // This is metadata, not a public harness integrity getter or a new lookup.
        errorCode = 'RPC_RESPONSE_INVALID';
        await readSpecifier({ request: async ({ params }) => {
          const cached = params as [{ data: string }, string];
          return captured.get(cached[0].data);
        } }, specifier);
        errorCode = undefined;
      }
      if (signal.aborted) {
        errorCode = 'UPSTREAM_TIMEOUT';
        throw new Error('bootstrap unavailable');
      }
      success = true;
      return result;
    } catch {
      errorCode ??= signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
      throw new Error('bootstrap unavailable');
    } finally {
      const finished = nowMs();
      const durationMs = Number.isFinite(started) && Number.isFinite(finished)
        ? Math.max(0, finished - started) : 0;
      const trace: RpcTrace = {
        schemaVersion: 1,
        readId: `bootstrap_${kind}`,
        attempt: 1,
        endpointId: 'bootstrap_mainnet',
        chainId: '1',
        method: 'eth_call',
        callsite: `transport.bootstrap.${kind}`,
        route: 'direct-bootstrap',
        durationMs,
        success,
        bootstrap: true,
        evidence: success ? evidence : 'BLOCKED',
        payloadVisibility: 'rpc-endpoint-can-read',
        ...(!success ? { errorCode: errorCode ?? 'UPSTREAM_UNAVAILABLE' } : {}),
      };
      try { traceSink.emit(trace); } catch { /* Diagnostics cannot enable a fallback or leak an exception. */ }
    }
  }

  return { request, metadata };
}
