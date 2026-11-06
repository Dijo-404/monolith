import { addressSchema, chainIdSchema, timestampSchema } from '@monolith/shared';
import type { ContentHash } from '../ports/source-snapshot.js';
import type { PublisherPolicy, RegistryEntity } from '../ports/entity-reader.js';
import { APPROVED_LICENSE_SHA256 } from './source-policy.js';
import { validateEndpointOrigin } from './endpoint-policy.js';

const hashPattern = /^[a-f0-9]{64}$/;
const recordColumns = [
  'record_id', 'chain_id', 'chain_name', 'rpc_host', 'network_type', 'status',
  'source_url', 'source_commit', 'source_license', 'license_sha256', 'snapshot_sha256',
  'observed_at', 'measured_chain_id', 'importer_version',
] as const;

/** Operator policy is copied once; later mutation must not widen a running reader. */
export function validatePublisherPolicy(input: PublisherPolicy): PublisherPolicy {
  const fail = () => { throw new Error('Registry policy is invalid.'); };
  if (!input || !addressSchema.safeParse(input.creator).success || !addressSchema.safeParse(input.owner).success
    || !/^[a-f0-9]{40}$/.test(input.sourceRevision) || !hashPattern.test(input.snapshotSha256)
    || input.licenseSha256 !== APPROVED_LICENSE_SHA256 || !Array.isArray(input.allowedOrigins)
    || input.allowedOrigins.length < 1 || input.allowedOrigins.length > 64) fail();
  const allowedOrigins = [...input.allowedOrigins];
  if (new Set(allowedOrigins).size !== allowedOrigins.length || allowedOrigins.some((origin) => {
    try {
      return typeof origin !== 'string' || new URL(origin).origin !== origin
        || !validateEndpointOrigin(`${origin}/`, [origin]).ok;
    } catch { return true; }
  })) fail();
  return Object.freeze({
    creator: input.creator.toLowerCase(), owner: input.owner.toLowerCase(),
    sourceRevision: input.sourceRevision, snapshotSha256: input.snapshotSha256,
    licenseSha256: input.licenseSha256, allowedOrigins: Object.freeze(allowedOrigins),
  });
}

/** Matching a public schema or query predicate never authenticates a returned row. */
export function authenticRegistryEntity(entity: RegistryEntity, policy: PublisherPolicy, hash: ContentHash): boolean {
  try {
    if (!entity || !/^0x[a-fA-F0-9]{64}$/.test(entity.entityKey)
      || typeof entity.creator !== 'string' || entity.creator.toLowerCase() !== policy.creator
      || typeof entity.owner !== 'string' || entity.owner.toLowerCase() !== policy.owner
      || entity.readonly !== true || entity.permissionlessExtension !== false) return false;
    const record = entity.record;
    if (!record || Object.keys(record).length !== recordColumns.length
      || recordColumns.some((name) => typeof record[name] !== 'string'
        || new TextEncoder().encode(record[name]).byteLength > 128 || /[\p{Cc}\p{Cf}]/u.test(record[name]))) return false;
    if (!hashPattern.test(record.record_id) || !chainIdSchema.safeParse(record.chain_id).success
      || !record.chain_name.trim()
      || record.network_type !== 'evm' || record.status !== 'candidate' || record.measured_chain_id !== ''
      || record.importer_version !== 'monolith-import-v1' || record.source_commit !== policy.sourceRevision
      || record.snapshot_sha256 !== policy.snapshotSha256 || record.license_sha256 !== policy.licenseSha256
      || !timestampSchema.safeParse(record.observed_at).success
      || record.source_url !== `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/_data/chains/eip155-${record.chain_id}.json`
      || record.source_license !== `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/LICENSE`
      || !validateEndpointOrigin(record.rpc_host, policy.allowedOrigins).ok
      || new URL(record.rpc_host).href !== record.rpc_host) return false;
    // This exact order is the production importer's immutable record identity.
    const immutable = {
      chain_id: record.chain_id, chain_name: record.chain_name, rpc_host: record.rpc_host,
      network_type: record.network_type, status: record.status, source_url: record.source_url,
      source_commit: record.source_commit, source_license: record.source_license,
      license_sha256: record.license_sha256, snapshot_sha256: record.snapshot_sha256,
      measured_chain_id: record.measured_chain_id, importer_version: record.importer_version,
    };
    return hash(JSON.stringify(immutable)) === record.record_id;
  } catch { return false; }
}
