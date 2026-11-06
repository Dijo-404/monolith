import type {
  Clock, JsonRpcRequest, Result, RoutePolicy, TraceSink,
} from '@monolith/shared';

/** Only adapters touch worker, HTTP and browser APIs. No driver may downgrade routes. */
export interface TransportDriver {
  readonly route: 'anon-tor' | 'anon-nym' | 'passthrough' | 'direct-debug';
  readonly evidence: 'OBSERVED_LIVE' | 'SIMULATED';
  initialize(signal: AbortSignal): Promise<Result<void>>;
  exchange(url: string, request: JsonRpcRequest, signal: AbortSignal): Promise<Result<unknown>>;
  close(): Promise<void>;
}

export type AllowedCall = {
  target: string;
  selector: string;
  blockTags: readonly string[];
};

export type TransportOptions = {
  policy: RoutePolicy;
  driver: TransportDriver;
  clock: Clock;
  traceSink: TraceSink;
  trustedPublishers: ReadonlyArray<{ creator: string; owner: string }>;
  approvedOrigins: readonly string[];
  allowedCallsites: readonly string[];
  allowedCalls?: readonly AllowedCall[];
  maxAttempts?: number;
  requestTimeoutMs?: number;
  initializationTimeoutMs?: number;
  validationTtlMs?: number;
};
