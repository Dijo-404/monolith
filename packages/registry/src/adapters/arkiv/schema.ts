import { defineSchema, str } from '@arkiv-network/sdk/schema';

/** Discovery metadata only. A schema tag never authenticates its publisher. */
export const RegistrySource = defineSchema('monolith.rpc.v1', {
  record_id: str().indexed(),
  chain_id: str().indexed(),
  chain_name: str(),
  rpc_host: str(),
  network_type: str().indexed(),
  status: str().indexed(),
  source_url: str(),
  source_commit: str().indexed(),
  source_license: str(),
  license_sha256: str(),
  snapshot_sha256: str().indexed(),
  observed_at: str(),
  measured_chain_id: str(),
  importer_version: str(),
  content_expires_at: str(),
});
