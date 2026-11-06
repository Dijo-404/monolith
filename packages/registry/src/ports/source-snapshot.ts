/** Immutable source bytes; adapters verify these against the named Git tree. */
export interface SourceSnapshot {
  schemaVersion: 1;
  repository: 'https://github.com/ethereum-lists/chains';
  revision: string;
  retrievedAt: string;
  snapshotSha256: string;
  catalog: string;
  license: { url: string; sha256: string; text: string };
  files: Array<{ path: string; sha256: string; byteLength: number; text: string }>;
}

/** Published discovery metadata is unprobed. Import success never verifies an RPC. */
export interface RegistryRecord {
  record_id: string;
  chain_id: string;
  chain_name: string;
  rpc_host: string;
  network_type: 'evm';
  status: 'candidate';
  source_url: string;
  source_commit: string;
  source_license: string;
  license_sha256: string;
  snapshot_sha256: string;
  observed_at: string;
  measured_chain_id: '';
  importer_version: 'monolith-import-v1';
}

export interface ImportPlan {
  snapshot: SourceSnapshot;
  records: RegistryRecord[];
  counts: {
    sourceNetworks: number;
    sourceRpcEntries: number;
    eligibleNetworks: number;
    eligibleRecords: number;
    rejected: number;
    duplicates: number;
    reasons: Record<string, number>;
  };
}

export type ContentHash = (text: string) => string;
