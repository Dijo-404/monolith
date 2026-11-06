import type { RpcTrace } from '@monolith/shared';
import type {
  AnalyzerInput, AnalyzerScope, BootstrapRule, DeclaredRead, LabelEntry, MeasuredAttempt, OriginEntry,
} from '../src/types.js';

export type MutableInput = Omit<AnalyzerInput, 'reads' | 'traces' | 'attempts'> & {
  reads: DeclaredRead[];
  traces: RpcTrace[];
  attempts: MeasuredAttempt[];
};
export type MutableScope = Omit<AnalyzerScope, 'origins' | 'callsites' | 'scenarios' | 'bootstrapRules'> & {
  origins: OriginEntry[];
  callsites: LabelEntry[];
  scenarios: LabelEntry[];
  bootstrapRules: BootstrapRule[];
};

export function read(overrides: Partial<DeclaredRead> = {}): DeclaredRead {
  return {
    readId: 'private-read-seed-001', endpointId: 'private-endpoint-001', chainId: '1',
    method: 'eth_chainId', callsiteAlias: 'balance-widget', scenarioAlias: 'read-scenario',
    privacyRequired: true, ...overrides,
  };
}
export function trace(overrides: Partial<RpcTrace> = {}): RpcTrace {
  return {
    schemaVersion: 1, readId: 'private-read-seed-001', attempt: 1,
    endpointId: 'private-endpoint-001', chainId: '1', method: 'eth_chainId',
    callsite: 'balance-widget', route: 'anon-nym', durationMs: 25, success: true,
    bootstrap: false, evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read',
    ...overrides,
  };
}
export function attempt(overrides: Partial<MeasuredAttempt> = {}): MeasuredAttempt {
  return {
    eventId: 'private-event-seed-001', ref: { readId: 'private-read-seed-001', attempt: 1 },
    endpointId: 'private-endpoint-001', chainId: '1', method: 'eth_chainId',
    originAlias: 'rpc-primary', callsiteAlias: 'balance-widget', route: 'anon-nym',
    sent: true, completed: true, durationMs: 25, workerVerified: true,
    evidence: 'SIMULATED', ...overrides,
  };
}
export function fixture(): { input: MutableInput; scope: MutableScope } {
  return {
    input: {
      schemaVersion: 1, runId: 'private-run-seed-001', evidence: 'SIMULATED',
      reads: [read()], traces: [trace()], attempts: [attempt()],
    },
    scope: {
      reportRunId: 'public-run-fixture-001', application: 'leak-lab',
      origins: [{ alias: 'rpc-primary', origin: 'https://rpc.example.com' }],
      callsites: [
        { alias: 'balance-widget', label: 'lab.balance' },
        { alias: 'worker-bootstrap', label: 'worker.bootstrap' },
      ],
      scenarios: [{ alias: 'read-scenario', label: 'read' }],
      bootstrapRules: [], captureComplete: true,
    },
  };
}
