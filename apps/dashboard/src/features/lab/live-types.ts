import type { ErrorCode, EvidenceKind, JsonValue, ObserverLabAllocation, ObserverRun, PrivacyReport, RegistryManifest, RpcTrace, WorkerState } from '@monolith/shared';
import type { WorkerMetadata } from '@monolith/transport/browser';
import type { PrivacyAnalysis } from '@monolith/privacy-analyzer';
import type { RegistrySelection } from '../../composition/transport.js';

export type LiveMode = 'private' | 'compare' | 'leak' | 'repair';
export type LiveRole = 'probe' | 'private' | 'direct-control' | 'leak' | 'repair';
export type LivePhase = 'IDLE' | 'WARMING' | 'ALLOCATING' | 'REGISTRY' | 'SELECTING'
  | 'READING' | 'VERIFYING' | 'READY' | 'BLOCKED' | 'CLOSED';
export type LiveAllocation = ObserverLabAllocation;

export type LiveWireRead = {
  rpcId: string;
  logicalReadId: string;
  role: LiveRole;
  method: 'eth_chainId' | 'eth_getBalance';
  chainId: string;
  endpointId: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  success: boolean;
  result: JsonValue | null;
  trace: RpcTrace | null;
  evidence: EvidenceKind;
};
export type Correlation = {
  exactInventory: boolean;
  unmatchedObservations: number;
  sourceComparison: 'not-run' | 'confirmed' | 'inconclusive';
  codes: string[];
  diagnostics: ObserverRun | null;
  analysis: PrivacyAnalysis | null;
  widgetPrivacy: 'not-run' | 'fail' | 'pass';
};
export type LiveSnapshot = {
  version: number;
  phase: LivePhase;
  mode: LiveMode;
  busy: boolean;
  workerState: WorkerState;
  worker: WorkerMetadata | null;
  allocation: LiveAllocation | null;
  selection: RegistrySelection | null;
  manifest: RegistryManifest | null;
  reads: readonly LiveWireRead[];
  traces: readonly RpcTrace[];
  correlation: Correlation | null;
  error: ErrorCode | null;
  observedAt: string | null;
  previousLeakReport: PrivacyReport | null;
  milestones: { privateRead: boolean; comparison: boolean; leak: boolean; repair: boolean };
};

export const SYNTHETIC_ADDRESS = `0x${'0'.repeat(40)}`;
export const LIVE_CALLSITES = {
  probe: 'transport.chain-probe', private: 'lab.balance',
  'direct-control': 'lab.direct', leak: 'lab.widget', repair: 'lab.widget',
} as const;
