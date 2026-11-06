import {
  makeError, observerLabRunIdSchema, observerLabRpcIdSchema,
  type HttpResult, type ObserverLabAllocation,
} from '@monolith/shared';
import type { DiagnosticsStore } from '../domain/diagnostics.js';

/** Synchronous admission keeps quota checks and the bounded store reservation atomic. */
export function createLabRun(options: {
  diagnostics: Pick<DiagnosticsStore, 'register' | 'get'>;
  nowMs: () => number;
  uuid: () => string;
  allocationsPerMinute?: number;
}) {
  const limit = options.allocationsPerMinute ?? 12;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60) throw new Error('Invalid lab allocation configuration.');
  let windowStarted = options.nowMs();
  let allocated = 0;
  return (): { statusCode: number; body: HttpResult<ObserverLabAllocation> } => {
    const now = options.nowMs();
    if (now - windowStarted >= 60_000 || now < windowStarted) { windowStarted = now; allocated = 0; }
    if (allocated >= limit) return { statusCode: 429, body: { schemaVersion: 1, ok: false, error: makeError('RATE_LIMITED') } };
    // Failed admissions also consume budget; never retry RNG or replace an existing run.
    allocated++;
    try {
      const runId = `run-${options.uuid()}`;
      const baselineRpcId = `rpc-${options.uuid()}`;
      if (!observerLabRunIdSchema.safeParse(runId).success || !observerLabRpcIdSchema.safeParse(baselineRpcId).success) {
        return { statusCode: 503, body: { schemaVersion: 1, ok: false, error: makeError('UPSTREAM_UNAVAILABLE') } };
      }
      const registered = options.diagnostics.register(runId, baselineRpcId);
      if (!registered.ok) return {
        statusCode: registered.error.code === 'RATE_LIMITED' ? 429 : 503,
        body: { schemaVersion: 1, ok: false, error: registered.error.code === 'RATE_LIMITED'
          ? registered.error : makeError('UPSTREAM_UNAVAILABLE') },
      };
      const stored = options.diagnostics.get(runId);
      if (!stored.ok) return { statusCode: 503, body: { schemaVersion: 1, ok: false, error: makeError('UPSTREAM_UNAVAILABLE') } };
      return { statusCode: 201, body: { schemaVersion: 1, ok: true,
        value: { schemaVersion: 1, runId, baselineRpcId, expiresAt: stored.value.expiresAt } } };
    } catch {
      return { statusCode: 503, body: { schemaVersion: 1, ok: false, error: makeError('UPSTREAM_UNAVAILABLE') } };
    }
  };
}
