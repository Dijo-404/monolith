import {
  jsonRpcRequestSchema, jsonValueSchema, makeError, publicHttpsUrlSchema, resultSchema, rpcTraceSchema,
} from '@monolith/shared';
import type { JsonRpcRequest, Result, TraceSink } from '@monolith/shared';
import type { TransportDriver } from '../../ports/driver.js';
import { CONNECT, decodeWorkerMetadata } from './protocol.js';
import type { HostSettings, Network, WorkerMetadata } from './protocol.js';

export type BrowserDriverOptions = {
  /** An application-owned same-origin HTML asset which calls installBrowserHost(). */
  hostUrl: string;
  network: Network;
  bootstrapRpcUrl: string;
  approvedOrigins: readonly string[];
  traceSink: TraceSink;
  torGateways?: readonly string[];
};
export interface BrowserDriver extends TransportDriver {
  getMetadata(): WorkerMetadata | null;
}

/** The outer frame owns the SDK realm, including any work which outlives SDK close(). */
export function createBrowserDriver(options: BrowserDriverOptions): BrowserDriver {
  const settings: HostSettings = {
    network: options.network, bootstrapRpcUrl: options.bootstrapRpcUrl,
    approvedOrigins: [...options.approvedOrigins],
    ...(options.torGateways ? { torGateways: [...options.torGateways] } : {}),
  };
  const sink = options.traceSink;
  const hostUrl = options.hostUrl;
  let frame: HTMLIFrameElement | undefined;
  let port: MessagePort | undefined;
  let metadata: WorkerMetadata | null = null;
  let closed = false;
  let initialized = false;
  let boot: Promise<Result<void>> | undefined;
  let cancelLoad: (() => void) | undefined;
  let sequence = 0;
  const pending = new Map<number, { settle: (value: Result<unknown>) => void }>();
  const unavailable = (): Result<never> => ({ ok: false, error: makeError('WORKER_UNAVAILABLE') });
  const origins = new Set(settings.approvedOrigins);
  const route = settings.network === 'nym' ? 'anon-nym' : settings.network === 'tor' ? 'anon-tor' : 'passthrough';
  const allowedUrl = (url: string) => publicHttpsUrlSchema.safeParse(url).success && origins.has(new URL(url).origin);

  function dispose() {
    closed = true;
    initialized = false;
    metadata = null;
    cancelLoad?.();
    // Notify normal cleanup where possible, then destroy the complete browsing context.
    port?.postMessage({ kind: 'close' });
    frame?.remove();
    frame = undefined;
    port?.close();
    port = undefined;
    for (const call of [...pending.values()]) call.settle(unavailable());
    pending.clear();
  }

  function call(kind: 'initialize' | 'exchange', value: unknown, signal: AbortSignal): Promise<Result<unknown>> {
    if (closed || signal.aborted || !port) return Promise.resolve(unavailable());
    if (pending.size >= 128) return Promise.resolve({ ok: false, error: makeError('RATE_LIMITED') });
    const channel = port;
    const id = ++sequence;
    return new Promise((resolve) => {
      const finish = (result: Result<unknown>) => {
        if (!pending.delete(id)) return;
        signal.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = () => {
        channel.postMessage({ kind: 'abort', id });
        finish({ ok: false, error: makeError('UPSTREAM_TIMEOUT') });
        if (kind === 'initialize') dispose();
      };
      pending.set(id, { settle: finish });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      channel.postMessage({ kind, id, value });
    });
  }

  return {
    route,
    evidence: 'OBSERVED_LIVE',
    getMetadata: () => metadata ? { ...metadata } : null,
    initialize(signal) {
      if (closed || signal.aborted) return Promise.resolve(unavailable());
      if (initialized) return Promise.resolve({ ok: true, value: undefined });
      if (boot) return boot;
      boot = (async (): Promise<Result<void>> => {
        let url: URL;
        try {
          url = new URL(hostUrl, location.href);
          if (url.origin !== location.origin || url.username || url.password || url.search || url.hash
            || !['nym', 'tor', 'passthrough'].includes(settings.network)
            || !publicHttpsUrlSchema.safeParse(settings.bootstrapRpcUrl).success
            || origins.size === 0 || [...origins].some((origin) => !publicHttpsUrlSchema.safeParse(origin).success
              || new URL(origin).origin !== origin)) return { ok: false, error: makeError('POLICY_DENIED') };
        } catch { return { ok: false, error: makeError('POLICY_DENIED') }; }
        frame = document.createElement('iframe');
        frame.hidden = true;
        frame.title = 'Monolith disposable worker host';
        frame.src = url.href;
        const element = frame;
        const loaded = await new Promise<boolean>((resolve) => {
          const finish = (value: boolean) => {
            cancelLoad = undefined;
            signal.removeEventListener('abort', abort);
            element.onload = null;
            element.onerror = null;
            resolve(value);
          };
          const abort = () => { finish(false); dispose(); };
          cancelLoad = () => finish(false);
          element.onload = () => finish(true);
          element.onerror = () => finish(false);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) { abort(); return; }
          document.body.appendChild(element);
        });
        if (!loaded || closed || signal.aborted) { dispose(); return unavailable(); }
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (event: MessageEvent<unknown>) => {
          if (closed || event.data === null || typeof event.data !== 'object') return;
          const data = event.data as Record<string, unknown>;
          if (data['kind'] === 'trace') {
            const parsed = rpcTraceSchema.safeParse(data['trace']);
            // Only the host's fixed bootstrap diagnostics travel this channel.
            if (parsed.success && parsed.data.route === 'direct-bootstrap' && parsed.data.bootstrap
              && ['transport.bootstrap.hash', 'transport.bootstrap.resolvers'].includes(parsed.data.callsite)) {
              try { sink.emit(parsed.data); } catch { /* diagnostics cannot change routing */ }
            }
            return;
          }
          if (data['kind'] === 'result' && typeof data['id'] === 'number') {
            const parsed = resultSchema(jsonValueSchema).safeParse(data['result']);
            pending.get(data['id'])?.settle(parsed.success ? parsed.data : unavailable());
          }
        };
        port.start();
        element.contentWindow?.postMessage({ kind: CONNECT }, location.origin, [channel.port2]);
        const result = await call('initialize', settings, signal);
        if (!result.ok || closed || signal.aborted) { dispose(); return unavailable(); }
        const meta = decodeWorkerMetadata(result.value, settings.network);
        if (!meta) { dispose(); return unavailable(); }
        metadata = meta;
        initialized = true;
        return { ok: true, value: undefined };
      })();
      return boot;
    },
    async exchange(url: string, request: JsonRpcRequest, signal) {
      if (!initialized || closed) return unavailable();
      if (!allowedUrl(url) || !jsonRpcRequestSchema.safeParse(request).success) {
        return { ok: false, error: makeError('TARGET_DENIED') };
      }
      return call('exchange', { url, request }, signal);
    },
    async close() { dispose(); },
  };
}
