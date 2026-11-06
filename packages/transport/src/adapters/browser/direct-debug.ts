import { jsonRpcRequestSchema, makeError, publicHttpsUrlSchema } from '@monolith/shared';
import type { TransportDriver } from '../../ports/driver.js';
import { readJsonResponse } from './io.js';

/** Explicit negative control. Construct only with its own non-required privacy policy. */
export function createDirectDebugDriver(options: { enabled: true; approvedOrigins: readonly string[] }): TransportDriver {
  const enabled = options.enabled === true;
  const origins = new Set(options.approvedOrigins);
  const lifetime = new AbortController();
  let closed = false;
  return {
    route: 'direct-debug', evidence: 'OBSERVED_LIVE',
    async initialize(signal) {
      return !enabled || closed || signal.aborted
        ? { ok: false, error: makeError('POLICY_DENIED') } : { ok: true, value: undefined };
    },
    async exchange(url, request, signal) {
      if (!enabled || closed || signal.aborted || !publicHttpsUrlSchema.safeParse(url).success
        || !origins.has(new URL(url).origin) || !jsonRpcRequestSchema.safeParse(request).success) {
        return { ok: false, error: makeError('POLICY_DENIED') };
      }
      const requestSignal = AbortSignal.any([signal, lifetime.signal]);
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request), credentials: 'omit', redirect: 'error', signal: requestSignal });
        if (closed || signal.aborted) return { ok: false, error: makeError('UPSTREAM_TIMEOUT') };
        if (response.redirected || (response.url && response.url !== new URL(url).href)) {
          return { ok: false, error: makeError('TARGET_DENIED') };
        }
        return await readJsonResponse(response, requestSignal);
      } catch { return { ok: false, error: makeError(requestSignal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE') }; }
    },
    async close() { closed = true; lifetime.abort(); },
  };
}
