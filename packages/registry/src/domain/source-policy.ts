import { labelSchema, makeError, publicHttpsUrlSchema, timestampSchema, type Result } from '@monolith/shared';
import type { ContentHash, ImportPlan, RegistryRecord, SourceSnapshot } from '../ports/source-snapshot.js';

export const SOURCE_REPOSITORY = 'https://github.com/ethereum-lists/chains' as const;
export const APPROVED_LICENSE_SHA256 = '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685';
export const SOURCE_POLICY_VERSION = 'monolith-import-v1' as const;
const revisionPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const chainPathPattern = /^_data\/chains\/eip155-(0|[1-9][0-9]*)\.json$/;
const publicPaths = new Set(['/', '/rpc', '/rpc/', '/eth', '/eth/', '/evm', '/evm/', '/api', '/api/', '/jsonrpc', '/jsonrpc/', '/public', '/public/', '/v1', '/v1/', '/v2', '/v2/', '/v3', '/v3/']);
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Source admission only: this neither resolves DNS nor authorizes contacting an RPC. */
export function sourceUrlRejection(input: unknown): string | null {
  if (typeof input !== 'string') return 'NON_STRING_RPC';
  if (!publicHttpsUrlSchema.safeParse(input).success) return 'UNSAFE_HTTPS_URL';
  if (byteLength(input) > 128) return 'SDK_STRING_TOO_LONG';
  let decoded = input;
  for (let round = 0; round < 8; round++) {
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return 'INVALID_URL_ENCODING'; }
    if (next === decoded) break;
    decoded = next;
    if (round === 7) return 'EXCESSIVE_URL_ENCODING';
  }
  if (/[${}<>[\]\\\s\p{Cc}]/u.test(decoded) || /api[_-]?key|your[_-]|project[_-]?id|access[_-]?token|insert[_-]?key/i.test(decoded)) {
    return 'PLACEHOLDER_OR_KEY_MARKER';
  }
  // No credential-bearing query is echoed into a rejection report.
  if (decoded.includes('?')) return 'QUERY_REQUIRES_REVIEW';
  const url = new URL(input);
  if (/(?:^|\.)(?:test|invalid|onion|home|lan)$/.test(url.hostname)) return 'NON_PUBLIC_HOST';
  // Encoded spelling of an allowed path needs explicit review as well.
  if (!publicPaths.has(url.pathname)) return 'CUSTOM_PATH_REQUIRES_REVIEW';
  return null;
}

function verifySnapshot(snapshot: SourceSnapshot, hash: ContentHash): boolean {
  if (snapshot.schemaVersion !== 1 || snapshot.repository !== SOURCE_REPOSITORY || !revisionPattern.test(snapshot.revision)
    || !timestampSchema.safeParse(snapshot.retrievedAt).success || byteLength(snapshot.retrievedAt) > 128 || !hashPattern.test(snapshot.snapshotSha256)
    || !Array.isArray(snapshot.files) || snapshot.files.length < 3 || snapshot.files.length > 50_000) return false;
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of snapshot.files) {
    if (!file || typeof file.path !== 'string' || paths.has(file.path)
      || !['README.md', 'LICENSE'].includes(file.path) && !chainPathPattern.test(file.path)
      || typeof file.text !== 'string' || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0
      || file.byteLength > 2_000_000 || byteLength(file.text) !== file.byteLength
      || !hashPattern.test(file.sha256) || hash(file.text) !== file.sha256) return false;
    totalBytes += file.byteLength;
    if (totalBytes > 64_000_000) return false;
    paths.add(file.path);
  }
  const files = [...snapshot.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const expectedCatalog = JSON.stringify({ sourceSha: snapshot.revision, files: files.map((file) => ({ path: file.path, bytes: file.byteLength, sha256: file.sha256 })) }) + '\n';
  const license = files.find((file) => file.path === 'LICENSE');
  return paths.has('README.md') && !!license && !!snapshot.license
    && snapshot.catalog === expectedCatalog && hash(expectedCatalog) === snapshot.snapshotSha256
    && snapshot.license.url === `${SOURCE_REPOSITORY}/blob/${snapshot.revision}/LICENSE`
    && snapshot.license.sha256 === APPROVED_LICENSE_SHA256 && license.sha256 === APPROVED_LICENSE_SHA256
    && snapshot.license.text === license.text;
}

/** Deterministic candidate normalization; malformed source identity fails before writes. */
export function normalizeSourceSnapshot(snapshot: SourceSnapshot, hash: ContentHash): Result<ImportPlan> {
  try {
    if (!verifySnapshot(snapshot, hash)) return { ok: false, error: makeError('REGISTRY_UNTRUSTED') };
    const counts: ImportPlan['counts'] = { sourceNetworks: 0, sourceRpcEntries: 0, eligibleNetworks: 0, eligibleRecords: 0, rejected: 0, duplicates: 0, reasons: {} };
    const records: RegistryRecord[] = [];
    const ids = new Set<string>();
    const reject = (reason: string) => { counts.rejected++; counts.reasons[reason] = (counts.reasons[reason] ?? 0) + 1; };
    for (const file of [...snapshot.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
      const match = chainPathPattern.exec(file.path);
      if (!match) continue;
      const chainId = match[1];
      const source: unknown = JSON.parse(file.text);
      // Reject rounded JSON numbers, duplicate chain IDs and filename/content disagreement.
      const tokens = [...file.text.matchAll(/"chainId"\s*:\s*(0|[1-9][0-9]*)\s*[,}]/g)];
      if (!chainId || ids.has(chainId) || !isRecord(source) || !Number.isSafeInteger(source['chainId'])
        || source['chainId'] !== Number(chainId) || tokens.length !== 1 || tokens[0]?.[1] !== chainId
        || !Array.isArray(source['rpc']) || source['rpc'].length > 10_000
        || !labelSchema.safeParse(source['name']).success || typeof source['name'] !== 'string'
        || (source['status'] !== undefined && typeof source['status'] !== 'string')
        || (source['redFlags'] !== undefined && (!Array.isArray(source['redFlags']) || !source['redFlags'].every((flag) => typeof flag === 'string')))) {
        return { ok: false, error: makeError('INVALID_INPUT') };
      }
      ids.add(chainId);
      counts.sourceNetworks++;
      const excluded = source['status'] !== undefined && source['status'] !== 'active'
        || Array.isArray(source['redFlags']) && source['redFlags'].includes('reusedChainID');
      const seen = new Set<string>();
      let accepted = 0;
      for (const rpc of source['rpc']) {
        counts.sourceRpcEntries++;
        const reason = excluded ? 'INACTIVE_OR_REUSED_CHAIN' : byteLength(source['name']) > 128 ? 'SDK_STRING_TOO_LONG' : sourceUrlRejection(rpc);
        if (reason) { reject(reason); continue; }
        const rpcUrl = new URL(rpc as string).href;
        if (seen.has(rpcUrl)) { counts.duplicates++; counts.reasons['DUPLICATE_WITHIN_CHAIN'] = (counts.reasons['DUPLICATE_WITHIN_CHAIN'] ?? 0) + 1; continue; }
        const immutable = {
          chain_id: chainId, chain_name: source['name'], rpc_host: rpcUrl, network_type: 'evm' as const,
          status: 'candidate' as const, source_url: `${SOURCE_REPOSITORY}/blob/${snapshot.revision}/${file.path}`,
          source_commit: snapshot.revision, source_license: snapshot.license.url, license_sha256: snapshot.license.sha256,
          snapshot_sha256: snapshot.snapshotSha256, measured_chain_id: '' as const, importer_version: SOURCE_POLICY_VERSION,
        };
        if (Object.values(immutable).some((value) => byteLength(value) > 128)) { reject('SDK_STRING_TOO_LONG'); continue; }
        seen.add(rpcUrl);
        const recordId = hash(JSON.stringify(immutable));
        if (!hashPattern.test(recordId)) return { ok: false, error: makeError('INVALID_INPUT') };
        records.push({ record_id: recordId, ...immutable, observed_at: snapshot.retrievedAt });
        accepted++;
      }
      if (accepted) counts.eligibleNetworks++;
    }
    counts.eligibleRecords = records.length;
    return { ok: true, value: { snapshot, records, counts } };
  } catch {
    return { ok: false, error: makeError('INVALID_INPUT') };
  }
}
