import {
  httpResultSchema, makeError, observerLabAllocationSchema, observerRunSchema, publicHttpsUrlSchema,
  type HttpResult, type ObserverLabAllocation, type Result,
} from '@monolith/shared';
import { createBrowserDriver } from '@monolith/transport/browser';
import { createRegistryClient } from './registry.js';
import { LIVE_REGISTRY_POLICY } from '../features/registry/live-policy.js';
import { createLiveLabController } from '../features/lab/live-controller.js';

type Parser<T> = { safeParse(input: unknown): { success: true; data: T } | { success: false } };

/** Public metadata only: this adapter never sends a JSON-RPC body. */
export async function requestLabMetadata<T>(options: {
  url: string;
  method: 'GET' | 'POST';
  schema: Parser<HttpResult<T>>;
  signal: AbortSignal;
  fetch?: typeof fetch;
}): Promise<Result<T>> {
  const fetchMetadata = options.fetch ?? globalThis.fetch;
  try {
    if (options.signal.aborted) return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
    const response = await fetchMetadata(options.url, {
      method: options.method, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json', ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(options.method === 'POST' ? { body: '{}' } : {}), signal: options.signal,
    });
    if (response.redirected || response.url && response.url !== options.url
      || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return { ok: false, error: makeError('UPSTREAM_UNAVAILABLE') };
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 64 * 1024)) {
      await response.body?.cancel();
      return { ok: false, error: makeError('INVALID_INPUT') };
    }
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, error: makeError('INVALID_INPUT') };
    const chunks: Uint8Array[] = [];
    let size = 0;
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
        size += part.value.byteLength;
        if (size > 64 * 1024) { await reader.cancel(); return { ok: false, error: makeError('INVALID_INPUT') }; }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const parsed = options.schema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (!parsed.success) return { ok: false, error: makeError('INVALID_INPUT') };
      if (!parsed.data.ok) return response.ok ? { ok: false, error: makeError('UPSTREAM_UNAVAILABLE') }
        : { ok: false, error: parsed.data.error };
      if (response.status !== (options.method === 'POST' ? 201 : 200)) return { ok: false, error: makeError('UPSTREAM_UNAVAILABLE') };
      return { ok: true, value: parsed.data.value };
    } finally {
      options.signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  } catch { return { ok: false, error: makeError(options.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE') }; }
}

/** The deployment supplies only the public observer origin; all trust pins are independent. */
export function createProductionLiveLab(observerUrl: string) {
  const observerOrigin = (() => {
    try {
      return publicHttpsUrlSchema.safeParse(observerUrl).success && new URL(observerUrl).origin === observerUrl
        ? observerUrl : null;
    } catch { return null; }
  })();
  const origin = observerOrigin ?? 'https://unconfigured.monolith.invalid';
  const clock = { now: () => new Date().toISOString() };
  const registry = createRegistryClient({ url: `${origin}/api/registry/chains`, policy: LIVE_REGISTRY_POLICY, clock });
  return createLiveLabController({
    enabled: observerOrigin !== null,
    observerOrigin: origin,
    createDriver: (traceSink) => createBrowserDriver({
      hostUrl: new URL('/assets/worker-host.html', location.href).href,
      network: 'nym', bootstrapRpcUrl: 'https://ethereum.publicnode.com', approvedOrigins: [origin], traceSink,
    }),
    allocate: (signal) => requestLabMetadata<ObserverLabAllocation>({
      url: `${origin}/api/observer/runs`, method: 'POST', schema: httpResultSchema(observerLabAllocationSchema), signal,
    }),
    registry,
    diagnostics: (allocation, signal) => {
      if (!observerLabAllocationSchema.safeParse(allocation).success) return Promise.resolve({
        ok: false, error: makeError('INVALID_INPUT'),
      });
      return requestLabMetadata({ url: `${origin}/api/observer/runs/${allocation.runId}`, method: 'GET',
        schema: httpResultSchema(observerRunSchema), signal });
    },
    directFetch: (...args) => globalThis.fetch(...args),
    clock, uuid: () => crypto.randomUUID(), elapsed: () => performance.now(),
  });
}
