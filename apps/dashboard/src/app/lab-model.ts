/**
 * Presentation model for the Leak Lab shell.
 *
 * Contract vocabulary comes from the frozen public shared package. Local fields describe
 * fixture animation and presentation only. MN-014 owns binding actual adapter output.
 */
import type { ErrorCode, EvidenceKind, ReadMethod, Route as TransportRoute, WorkerState } from '@monolith/shared';

export type { EvidenceKind, ReadMethod, WorkerState } from '@monolith/shared';
export type Route = Exclude<TransportRoute, 'direct-bootstrap'>;
export type LabErrorCode = Extract<ErrorCode,
  | 'WORKER_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'REGISTRY_EXPIRED'
  | 'UPSTREAM_UNAVAILABLE'>;

export const WORKER_STATES: readonly WorkerState[] = [
  'BOOTSTRAPPING',
  'READY',
  'DEGRADED',
  'BLOCKED',
  'CLOSED',
];

export type ScenarioId =
  | 'cold-start'
  | 'warm'
  | 'degraded'
  | 'worker-unavailable'
  | 'passthrough'
  | 'registry-expired'
  | 'observer-unavailable';

export type WorkerNetwork = 'Tor-JS' | 'Passthrough';

/** Which drawn lane a read travels on. `leak` is the bypassing widget's own path. */
export type Lane = 'anon' | 'direct' | 'leak' | 'passthrough';

/** What the controlled endpoint could attribute the request to. */
export type OriginSeen = 'your-network' | 'exit-relay' | 'nothing';

export type ReadKind = 'probe' | 'private' | 'unprotected' | 'direct-comparison' | 'leak';

export type ReadOutcome = 'in-flight' | 'arrived' | 'blocked' | 'failed';

export interface ReadRow {
  readonly id: string;
  readonly seq: number;
  readonly kind: ReadKind;
  readonly method: ReadMethod;
  readonly callsite: string;
  readonly route: Route;
  readonly lane: Lane;
  /** True when the read went around MonolithTransport (only the injected leak). */
  readonly bypass: boolean;
  /** Policy in force when the read was requested. */
  readonly privacyRequired: boolean;
  /** Wall-clock (performance.now) ms when the read was requested. */
  readonly requestedAt: number;
  /** Offset after `requestedAt` when the packet leaves the browser. */
  readonly startDelayMs: number;
  /** Fixture travel time; null when blocked before send. */
  readonly durationMs: number | null;
  readonly outcome: ReadOutcome;
  readonly evidence: EvidenceKind;
  readonly errorCode: LabErrorCode | null;
  readonly originSeen: OriginSeen;
  /** The endpoint can read the JSON-RPC payload on every route that reaches it. */
  readonly addressInPayload: boolean;
}

export interface WorkerView {
  readonly state: WorkerState;
  readonly network: WorkerNetwork;
  readonly specifier: string;
  /** Hops of the circuit reported ready, 0–3. */
  readonly hopsReady: number;
  readonly note: string | null;
}

export type RegistryStatus = 'fresh' | 'expired' | 'unavailable';
export type ChainProbe = 'not-run' | 'pending' | 'match' | 'rejected';

export interface EndpointCandidateView {
  readonly endpointId: string;
  readonly chainId: string;
  readonly chainName: string;
  readonly rpcOrigin: string;
  readonly publisher: { readonly creator: string; readonly owner: string };
  readonly entityKey: string;
  readonly schema: string;
  readonly source: {
    readonly repository: string;
    readonly revision: string;
    readonly license: string;
    readonly snapshotSha256: string;
  };
}

export interface RegistryView {
  readonly status: RegistryStatus;
  readonly origin: 'fixture';
  readonly revision: string;
  readonly generatedAt: number;
  readonly expiresAt: number;
  readonly endpoint: EndpointCandidateView;
  readonly chainProbe: ChainProbe;
}

export type ObserverStatus = 'available' | 'unavailable';

export type CheckStatus = 'pass' | 'fail' | 'not-run';

export interface CheckView {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly evidence: EvidenceKind;
}

export type FocusTarget = 'transport' | 'registry' | 'endpoint' | null;

/** The last read that reached the endpoint on each kind of route, kept across reruns. */
export interface ObservedRoutes {
  readonly direct: ReadRow | null;
  readonly anon: ReadRow | null;
}

/** What this session has demonstrated so far; drives the guided demo. Reset only by a new scenario. */
export interface Milestones {
  readonly baseline: boolean;
  readonly protectedRead: boolean;
  readonly leakCaught: boolean;
  readonly leakFixed: boolean;
  readonly failedClosed: boolean;
}

export interface LabState {
  /** Increments on every scenario load so stale timers cannot change the new run. */
  readonly epoch: number;
  readonly scenario: ScenarioId;
  readonly privateMode: boolean;
  readonly leakInjected: boolean;
  readonly confirmingDirect: boolean;
  readonly worker: WorkerView;
  readonly registry: RegistryView;
  readonly observer: ObserverStatus;
  readonly reads: readonly ReadRow[];
  readonly seq: number;
  readonly focus: FocusTarget;
  readonly observed: ObservedRoutes;
  readonly milestones: Milestones;
}

export type LabAction =
  | { readonly type: 'load-scenario'; readonly scenario: ScenarioId; readonly now: number }
  | { readonly type: 'new-run' }
  | { readonly type: 'set-private-mode'; readonly on: boolean }
  | { readonly type: 'set-leak'; readonly on: boolean; readonly now: number }
  | { readonly type: 'run-read'; readonly now: number }
  | { readonly type: 'ask-direct' }
  | { readonly type: 'cancel-direct' }
  | { readonly type: 'confirm-direct'; readonly now: number }
  | { readonly type: 'read-settled'; readonly epoch: number; readonly id: string; readonly now: number }
  | { readonly type: 'worker-hop'; readonly epoch: number }
  | { readonly type: 'retry-worker' }
  | { readonly type: 'simulate-outage' }
  | { readonly type: 'focus'; readonly target: FocusTarget };
