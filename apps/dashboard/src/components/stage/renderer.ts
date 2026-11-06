/** Shared presentation types retained for the dashboard's existing callers. */
export type StageWorkerState = 'BOOTSTRAPPING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'CLOSED';

export interface StageScene {
  readonly workerState: StageWorkerState;
  readonly hopsReady: number;
  readonly passthrough: boolean;
  readonly privateMode: boolean;
  readonly leakInjected: boolean;
  readonly observerUp: boolean;
}

export interface StageFlight {
  readonly id: string;
  readonly lane: 'anon' | 'direct' | 'leak' | 'passthrough';
  /** Caller-owned wall-clock event time; the explorer does not play it back. */
  readonly start: number;
  /** Caller-owned duration; null for a read blocked before send. */
  readonly durationMs: number | null;
}

export interface StageInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
