import type { HttpResult, ObserverRun } from '@monolith/shared';
import type { DiagnosticsStore } from '../domain/diagnostics.js';

export function getDiagnostics(store: DiagnosticsStore, runId: string): {
  statusCode: number; body: HttpResult<ObserverRun>;
} {
  const result = store.get(runId);
  return { statusCode: result.ok ? 200 : 410, body: { schemaVersion: 1, ...result } };
}
