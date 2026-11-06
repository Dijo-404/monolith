/**
 * Pure validation for the MN-005 storage experiment. Passing this check authenticates a
 * candidate against the supplied publisher/provenance policy, not a usable RPC endpoint.
 * No DNS lookup, endpoint request or chain-ID verification takes place here.
 */
export type ExpectedSample = {
  publisher: string;
  runId: string;
  entityKey?: string;
  /** Arkiv 1.0.1 expiresAt is a block height, not a Unix timestamp. */
  currentBlock: bigint;
  nowISO: string;
  sourceCommit: string;
  sourceUrl: string;
  licenseUrl: string;
  snapshotSha256: string;
};

export type ValidatedSample = {
  entityKey: string;
  creator: string;
  owner: string;
  expiresAtBlock: string;
  chainId: string;
  chainName: string;
  rpcUrl: string;
  networkType: string;
  runId: string;
  status: 'candidate';
  evidence: 'SIMULATED';
  measuredChainId: '';
  observedAt: string;
  source: {
    url: string;
    commit: string;
    licenseUrl: string;
    snapshotSha256: string;
  };
};

export type TrustFailure =
  | 'INVALID_CONTEXT'
  | 'MALFORMED_ENTITY'
  | 'WRONG_ENTITY'
  | 'FOREIGN_CREATOR'
  | 'FOREIGN_OWNER'
  | 'EXPIRED_ENTITY'
  | 'WRONG_RUN'
  | 'UNSAFE_URL'
  | 'PROVENANCE_MISMATCH'
  | 'INVALID_CANDIDATE';

export type EntityAssessment =
  | { trusted: true; candidate: ValidatedSample }
  | { trusted: false; reason: TrustFailure };

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const keyPattern = /^0x[0-9a-fA-F]{64}$/;
const runPattern = /^[A-Za-z0-9_-]{8,128}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The SDK returns typed attribute values, never bare strings, in selected rows. */
function stringValue(row: Record<string, unknown>, name: string): string | undefined {
  const attribute = row[name];
  if (!record(attribute) || attribute.type !== 'str' || typeof attribute.value !== 'string') {
    return undefined;
  }
  const value = attribute.value;
  if (new TextEncoder().encode(value).length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }
  return value;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    return undefined;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  return new Date(time).toISOString() === normalized ? time : undefined;
}

/** Syntax-only public HTTPS policy. DNS and actual host authorization are later gates. */
function publicHttps(value: unknown): value is string {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f\\${}<>]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return false;
    const host = url.hostname;
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.endsWith('.')) return false;
    // URL canonicalization turns numeric/hex/octal IPv4 aliases into dotted IP literals.
    if (/^[0-9.]+$/.test(host) || !/[a-z]/.test(host.split('.').at(-1) ?? '')) return false;
    const labels = host.split('.');
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return false;
    return !/(?:^|\.)(?:localhost|local|internal|test|invalid|onion|home|lan)$/.test(host);
  } catch {
    return false;
  }
}

const fail = (reason: TrustFailure): EntityAssessment => ({ trusted: false, reason });

/**
 * Accepts a flat SDK select('*').from(RpcSource) row and explicit evaluation context.
 * Results contain a fixed safe projection; unrequested values cannot leak into reports.
 */
export function assessEntity(entity: unknown, expected: ExpectedSample): EntityAssessment {
  const now = timestamp(expected.nowISO);
  if (
    !addressPattern.test(expected.publisher) || !runPattern.test(expected.runId) ||
    typeof expected.currentBlock !== 'bigint' || expected.currentBlock < 0n || now === undefined ||
    !commitPattern.test(expected.sourceCommit) || !sha256Pattern.test(expected.snapshotSha256) ||
    !publicHttps(expected.sourceUrl) || !publicHttps(expected.licenseUrl) ||
    (expected.entityKey !== undefined && !keyPattern.test(expected.entityKey))
  ) return fail('INVALID_CONTEXT');

  if (!record(entity)) return fail('MALFORMED_ENTITY');
  const { $key: key, $creator: creator, $owner: owner, $expiresAt: expiresAt } = entity;
  if (
    typeof key !== 'string' || !keyPattern.test(key) ||
    typeof creator !== 'string' || !addressPattern.test(creator) ||
    typeof owner !== 'string' || !addressPattern.test(owner) ||
    typeof expiresAt !== 'bigint' || expiresAt < 0n
  ) return fail('MALFORMED_ENTITY');
  if (expected.entityKey !== undefined && key.toLowerCase() !== expected.entityKey.toLowerCase()) {
    return fail('WRONG_ENTITY');
  }
  if (creator.toLowerCase() !== expected.publisher.toLowerCase()) return fail('FOREIGN_CREATOR');
  if (owner.toLowerCase() !== expected.publisher.toLowerCase()) return fail('FOREIGN_OWNER');
  if (expiresAt <= expected.currentBlock) return fail('EXPIRED_ENTITY');

  const fields = {
    chainId: stringValue(entity, 'chain_id'),
    chainName: stringValue(entity, 'chain_name'),
    rpcUrl: stringValue(entity, 'rpc_host'),
    networkType: stringValue(entity, 'network_type'),
    status: stringValue(entity, 'status'),
    sourceUrl: stringValue(entity, 'source_url'),
    sourceCommit: stringValue(entity, 'source_commit'),
    licenseUrl: stringValue(entity, 'source_license'),
    snapshotSha256: stringValue(entity, 'snapshot_sha256'),
    observedAt: stringValue(entity, 'observed_at'),
    measuredChainId: stringValue(entity, 'measured_chain_id'),
    runId: stringValue(entity, 'run_id'),
    evidence: stringValue(entity, 'evidence'),
  };
  if (Object.values(fields).some((value) => value === undefined)) return fail('MALFORMED_ENTITY');
  if (fields.runId !== expected.runId) return fail('WRONG_RUN');
  if (!publicHttps(fields.rpcUrl) || !publicHttps(fields.sourceUrl) || !publicHttps(fields.licenseUrl)) {
    return fail('UNSAFE_URL');
  }
  if (
    fields.sourceCommit !== expected.sourceCommit || fields.sourceUrl !== expected.sourceUrl ||
    fields.licenseUrl !== expected.licenseUrl || fields.snapshotSha256 !== expected.snapshotSha256
  ) return fail('PROVENANCE_MISMATCH');
  const observed = timestamp(fields.observedAt);
  if (
    !/^(?:0|[1-9][0-9]{0,77})$/.test(fields.chainId ?? '') || !fields.chainName?.trim() ||
    !['ethereum', 'evm', 'evm-l2'].includes(fields.networkType ?? '') ||
    fields.status !== 'candidate' || fields.evidence !== 'SIMULATED' || fields.measuredChainId !== '' ||
    observed === undefined || observed > now
  ) return fail('INVALID_CANDIDATE');

  return {
    trusted: true,
    candidate: {
      entityKey: key,
      creator,
      owner,
      expiresAtBlock: expiresAt.toString(),
      chainId: fields.chainId as string,
      chainName: fields.chainName as string,
      rpcUrl: fields.rpcUrl,
      networkType: fields.networkType as string,
      runId: fields.runId as string,
      status: 'candidate',
      evidence: 'SIMULATED',
      measuredChainId: '',
      observedAt: fields.observedAt as string,
      source: {
        url: fields.sourceUrl,
        commit: fields.sourceCommit as string,
        licenseUrl: fields.licenseUrl,
        snapshotSha256: fields.snapshotSha256 as string,
      },
    },
  };
}
