import { defineSchema, str } from '@arkiv-network/sdk/schema';

/** Isolated MN-005 sample schema; a matching tag never authenticates a publisher. */
export const RpcSource = defineSchema('monolith.rpc.v1', {
  chain_id: str().indexed(),
  chain_name: str(),
  rpc_host: str(),
  network_type: str().indexed(),
  status: str().indexed(),
  source_url: str(),
  source_commit: str(),
  source_license: str(),
  snapshot_sha256: str(),
  observed_at: str(),
  measured_chain_id: str(),
  run_id: str().indexed(),
  evidence: str(),
});
