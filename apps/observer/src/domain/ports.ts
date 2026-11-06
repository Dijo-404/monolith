import type { JsonRpcRequest, JsonRpcSuccess, Result } from '@monolith/shared';

export type CallRule = { to: string; selector: string; dataBytes: number };
export type ObserverEndpoint = {
  endpointId: string;
  chainId: string;
  rpcUrl: string;
  calls: readonly CallRule[];
};
export type SourcePolicy = {
  mode: 'unknown' | 'direct' | 'trusted-proxy';
  trustedProxies: readonly string[];
};
export type LabRun = { runId: string; baselineRpcId: string };
export type ObserverConfig = {
  endpoints: readonly ObserverEndpoint[];
  sourcePolicy: SourcePolicy;
  labRuns: readonly LabRun[];
};
export interface UpstreamReader {
  read(endpoint: ObserverEndpoint, request: JsonRpcRequest, signal?: AbortSignal): Promise<Result<JsonRpcSuccess>>;
}
