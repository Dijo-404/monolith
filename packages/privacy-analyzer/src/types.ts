import type {
  EvidenceKind, PrivacyReport, ReadMethod, Route, RpcTrace,
} from '@monolith/shared';

/** Runner-established binding. Never infer this from timestamps or matching methods. */
export interface ReadRef { readId: string; attempt: number }
export interface DeclaredRead {
  readId: string;
  endpointId: string;
  chainId: string;
  method: ReadMethod;
  callsiteAlias: string;
  scenarioAlias: string;
  privacyRequired: boolean;
}
/** Normalized measurements supplied by the collector, not claims authenticated by this package. */
export interface MeasuredAttempt {
  eventId: string;
  ref?: ReadRef;
  endpointId: string;
  chainId: string;
  method: ReadMethod;
  originAlias: string;
  callsiteAlias?: string;
  route: Route | 'unknown';
  sent: boolean;
  completed: boolean;
  durationMs: number;
  workerVerified: boolean;
  evidence: EvidenceKind;
}
export interface AnalyzerInput {
  schemaVersion: 1;
  runId: string;
  evidence: EvidenceKind;
  reads: readonly DeclaredRead[];
  traces: readonly RpcTrace[];
  attempts: readonly MeasuredAttempt[];
}
export interface LabelEntry { alias: string; label: string }
export interface OriginEntry { alias: string; origin: string }
/** Created only after the runner matches the exact specifier contract/selector/params allowlist. */
export interface BootstrapRule {
  readId: string;
  endpointId: string;
  chainId: string;
  method: 'eth_call';
  callsiteAlias: string;
  originAlias: string;
  label: string;
}
/** Trusted composition configuration, separate from untrusted run measurements. */
export interface AnalyzerScope {
  /** Fresh synthetic public ID; never a user/session identifier. Input runId is not exported. */
  reportRunId: string;
  application: string;
  origins: readonly OriginEntry[];
  callsites: readonly LabelEntry[];
  scenarios: readonly LabelEntry[];
  bootstrapRules: readonly BootstrapRule[];
  captureComplete: boolean;
}
export interface LatencySummary {
  endpointId: string;
  chainId: string;
  method: ReadMethod;
  route: Route | 'unknown';
  sampleCount: number;
  successfulSamples: number;
  p50Ms: number;
  p95Ms: number;
}
export interface PrivacyAnalysis {
  report: PrivacyReport;
  summary: {
    application: string;
    completionRate: number | null;
    functionalAcceptance: 'pass' | 'fail' | 'unresolved';
    latency: LatencySummary[];
  };
}
