import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { jsonRpcRequestSchema, makeError, publicHttpsUrlSchema } from '@monolith/shared';
import type { Result, TraceSink } from '@monolith/shared';
import { createBootstrapProvider, readJsonResponse } from './io.js';
import { CONNECT } from './protocol.js';
import type { HostSettings, WorkerMetadata } from './protocol.js';

/** Call once from an application-owned host HTML/module asset. Never from the top-level page. */
export function installBrowserHost(): () => void {
  if (window.parent === window) throw new Error('Worker host requires an iframe.');
  let connected = false;
  let worker: AnonRpcWorker | undefined;
  let port: MessagePort | undefined;
  let closed = false;
  let settings: HostSettings | undefined;
  const lifetime = new AbortController();
  const calls = new Map<number, AbortController>();
  const close = () => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    for (const controller of calls.values()) controller.abort();
    calls.clear();
    worker?.close();
    port?.close();
    window.removeEventListener('message', connect);
    window.removeEventListener('pagehide', close);
  };
  const unavailable = (): Result<never> => ({ ok: false, error: makeError('WORKER_UNAVAILABLE') });
  const clock = { now: () => new Date().toISOString() };

  async function initialize(value: unknown): Promise<Result<WorkerMetadata>> {
    if (worker || closed || !value || typeof value !== 'object') return unavailable();
    const input = value as HostSettings;
    if (!['nym', 'tor', 'passthrough'].includes(input.network)
      || !publicHttpsUrlSchema.safeParse(input.bootstrapRpcUrl).success
      || !Array.isArray(input.approvedOrigins) || input.approvedOrigins.length === 0
      || input.approvedOrigins.some((origin) => typeof origin !== 'string'
        || !publicHttpsUrlSchema.safeParse(origin).success || new URL(origin).origin !== origin)
      || (input.torGateways !== undefined && (!Array.isArray(input.torGateways)
        || input.torGateways.length > 8 || input.torGateways.some((gateway) => typeof gateway !== 'string'
          || gateway.length > 512 || /\s/.test(gateway))))) return unavailable();
    settings = structuredClone(input);
    const traceSink: TraceSink = { emit: (trace) => port?.postMessage({ kind: 'trace', trace }) };
    const provider = createBootstrapProvider({ network: input.network, rpcUrl: input.bootstrapRpcUrl,
      signal: lifetime.signal, traceSink, clock });
    // mix-fetch 3.0.0 ignores RequestInit.redirect. Its zero redirect budget is
    // the enforced guard: the initial request may run, no Location is followed.
    const config = input.network === 'nym' ? { maxRedirects: 0 }
      : input.network === 'tor' && input.torGateways ? { gateways: input.torGateways } : undefined;
    worker = new AnonRpcWorker({ address: provider.metadata().specifier,
      preExisting: { rpcProvider: provider }, ...(config ? { config } : {}) });
    const currentWorker = worker;
    // Claim logs synchronously before any boot await. Raw arguments are discarded.
    void (async () => {
      try { while (!lifetime.signal.aborted) await currentWorker.acceptLog({ signal: lifetime.signal }); }
      catch { /* disposal/fatal failure */ }
    })();
    try {
      await currentWorker.ready;
      if (closed || lifetime.signal.aborted) return unavailable();
      const captured = provider.metadata();
      if (!captured.workerHash || captured.bootstrapCalls !== 2) return unavailable();
      return { ok: true, value: { ...captured, workerHash: captured.workerHash,
        network: input.network, harnessVersion: '0.4.0', observedAt: clock.now(),
        privacyLabel: input.network === 'passthrough' ? 'NOT_ANONYMIZED' : 'ANONYMIZING_WORKER',
        verification: 'harness-ready-after-specifier-lookup', bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP' } };
    } catch { return unavailable(); }
  }

  async function exchange(value: unknown, signal: AbortSignal): Promise<Result<unknown>> {
    if (closed || !worker || !settings || !value || typeof value !== 'object') return unavailable();
    const input = value as Record<string, unknown>;
    const url = input['url'];
    const parsed = jsonRpcRequestSchema.safeParse(input['request']);
    if (typeof url !== 'string' || !publicHttpsUrlSchema.safeParse(url).success || !parsed.success
      || !settings.approvedOrigins.includes(new URL(url).origin)) {
      return { ok: false, error: makeError('TARGET_DENIED') };
    }
    try {
      const response = await worker.fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data),
        credentials: 'omit', redirect: 'error', signal,
      });
      if (closed || signal.aborted) return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
      if (response.redirected || (response.url && response.url !== new URL(url).href)) {
        return { ok: false, error: makeError('TARGET_DENIED') };
      }
      return await readJsonResponse(response, signal);
    } catch { return { ok: false, error: makeError(signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE') }; }
  }

  function connect(event: MessageEvent<unknown>) {
    if (connected || closed || event.source !== window.parent || event.origin !== location.origin
      || !event.data || typeof event.data !== 'object' || !('kind' in event.data)
      || event.data.kind !== CONNECT || !event.ports[0]) return;
    connected = true;
    port = event.ports[0];
    port.onmessage = async (message: MessageEvent<unknown>) => {
      if (closed || !message.data || typeof message.data !== 'object') return;
      const data = message.data as Record<string, unknown>;
      if (data['kind'] === 'close') { close(); return; }
      const id = data['id'];
      if (!Number.isSafeInteger(id) || typeof id !== 'number') return;
      if (data['kind'] === 'abort') { calls.get(id)?.abort(); return; }
      if (data['kind'] !== 'initialize' && data['kind'] !== 'exchange') return;
      if (calls.has(id)) return;
      const controller = new AbortController();
      calls.set(id, controller);
      let result: Result<unknown>;
      try {
        result = data['kind'] === 'initialize' ? await initialize(data['value'])
          : await exchange(data['value'], controller.signal);
      } catch { result = unavailable(); }
      calls.delete(id);
      if (!closed && !controller.signal.aborted) port?.postMessage({ kind: 'result', id, result });
    };
    port.start();
  }
  window.addEventListener('message', connect);
  window.addEventListener('pagehide', close);
  return close;
}
