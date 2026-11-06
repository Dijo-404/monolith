import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { asc, eq, gt } from '@arkiv-network/sdk/query';
import { key, SchemaMismatchError } from '@arkiv-network/sdk/schema';
import { http, type Address } from 'viem';
import { chainIdSchema, makeError, timestampSchema, type ChainId, type Result } from '@monolith/shared';
import type { EntityObservation, EntityReader, PublisherPolicy, RegistryEntity } from '../../ports/entity-reader.js';
import type { RegistryRecord } from '../../ports/source-snapshot.js';
import { RegistrySource } from './schema.js';

const ARKIV_CHAIN_ID = 7794095;
const RPC_URL = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
const PAGE_SIZE = 100;
const MAX_ROWS = 1000;
const MAX_PAGES = 10;
const MAX_BLOCK_SPAN = 128n;
const READ_TIMEOUT_MS = 20_000;
const hex32 = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const hash = /^[0-9a-f]{64}$/;
const columns = [
  'record_id', 'chain_id', 'chain_name', 'rpc_host', 'network_type', 'status',
  'source_url', 'source_commit', 'source_license', 'license_sha256', 'snapshot_sha256',
  'observed_at', 'measured_chain_id', 'importer_version',
] as const satisfies readonly (keyof RegistryRecord)[];

export interface ArkivReaderPage {
  entities: readonly unknown[];
  skipped: number;
  /** Count includes the cursor predicate: it is the remaining match count on this page. */
  count: bigint;
  blockNumber: bigint;
}

/** Infrastructure seam; callers cannot supply a destination URL or a signing client. */
export interface ArkivReaderClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  queryChainPage(input: {
    chainId: ChainId;
    policy: PublisherPolicy;
    afterKey?: string;
    limit: number;
  }): Promise<ArkivReaderPage>;
}

class UntrustedEntity extends Error {}
function untrusted(): never { throw new UntrustedEntity(); }
function object(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
function stringColumn(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (!object(value) || value['type'] !== 'str' || typeof value['value'] !== 'string'
    || new TextEncoder().encode(value['value']).length > 128 || /[\p{Cc}\p{Cf}]/u.test(value['value'])) untrusted();
  return value['value'];
}

function normalize(row: unknown, chainId: ChainId, policy: PublisherPolicy): RegistryEntity {
  if (!object(row) || typeof row['$key'] !== 'string' || !hex32.test(row['$key'])
    || typeof row['$creator'] !== 'string' || !address.test(row['$creator'])
    || row['$creator'].toLowerCase() !== policy.creator.toLowerCase()
    || typeof row['$owner'] !== 'string' || !address.test(row['$owner'])
    || row['$owner'].toLowerCase() !== policy.owner.toLowerCase()
    || typeof row['$expiresAt'] !== 'bigint' || row['$expiresAt'] <= 0n) untrusted();
  const flags = row['$creationFlags'];
  if (!object(flags) || flags['readonly'] !== true || flags['permissionlessExtension'] !== false || flags['raw'] !== 1) untrusted();
  const record = Object.fromEntries(columns.map((name) => [name, stringColumn(row, name)])) as unknown as RegistryRecord;
  const contentExpiresAt = stringColumn(row, 'content_expires_at');
  if (!hash.test(record.record_id) || record.chain_id !== chainId || !record.chain_name.trim()
    || record.network_type !== 'evm' || record.status !== 'candidate' || record.measured_chain_id !== ''
    || record.importer_version !== 'monolith-import-v1'
    || record.source_commit !== policy.sourceRevision || record.snapshot_sha256 !== policy.snapshotSha256
    || record.license_sha256 !== policy.licenseSha256
    || !timestampSchema.safeParse(record.observed_at).success || !timestampSchema.safeParse(contentExpiresAt).success) untrusted();
  return {
    entityKey: row['$key'].toLowerCase(), creator: row['$creator'], owner: row['$owner'],
    expiresAtBlock: String(row['$expiresAt']), readonly: true, permissionlessExtension: false,
    record, contentExpiresAt,
  };
}

/** A fresh bounded scan, never a stale-success cache. Different pages are separate block observations. */
export function createArkivEntityReader(options: {
  client: ArkivReaderClient;
  policy: PublisherPolicy;
  now?: () => string;
  evidence?: 'OBSERVED_LIVE' | 'SIMULATED';
}): EntityReader {
  const policy = structuredClone(options.policy);
  if (!address.test(policy.creator) || !address.test(policy.owner) || !/^[0-9a-f]{40}$/.test(policy.sourceRevision)
    || !hash.test(policy.snapshotSha256) || !hash.test(policy.licenseSha256)
    || options.evidence !== undefined && !['OBSERVED_LIVE', 'SIMULATED'].includes(options.evidence)) {
    throw new Error('Invalid registry reader configuration.');
  }
  const now = options.now ?? (() => new Date().toISOString());
  const evidence = options.evidence ?? 'SIMULATED';
  const client = options.client;

  return Object.freeze({
    async readChain(chainId: ChainId): Promise<Result<EntityObservation>> {
      if (!chainIdSchema.safeParse(chainId).success) return { ok: false, error: makeError('INVALID_INPUT') };
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ensureActive = () => { if (!active) throw new Error('Registry read expired.'); };
      const operation = async (): Promise<Result<EntityObservation>> => {
        const startedAt = now();
        if (!timestampSchema.safeParse(startedAt).success) untrusted();
        if (await client.getChainId() !== ARKIV_CHAIN_ID) untrusted();
        ensureActive();
        const firstBlock = await client.getBlockNumber();
        ensureActive();
        if (typeof firstBlock !== 'bigint' || firstBlock < 0n) untrusted();
        let lastBlock = firstBlock;
        let total: bigint | undefined;
        let afterKey: string | undefined;
        const entities: RegistryEntity[] = [];
        const ids = new Set<string>();
        for (let page = 0; page < MAX_PAGES; page++) {
          const response = await client.queryChainPage({ chainId, policy: structuredClone(policy), limit: PAGE_SIZE,
            ...(afterKey === undefined ? {} : { afterKey }) });
          ensureActive();
          if (!object(response) || !Array.isArray(response.entities) || response.entities.length > PAGE_SIZE
            || response.skipped !== 0 || typeof response.count !== 'bigint' || response.count < 0n
            || response.count > BigInt(MAX_ROWS) || typeof response.blockNumber !== 'bigint'
            || response.blockNumber < lastBlock || response.blockNumber - firstBlock > MAX_BLOCK_SPAN) untrusted();
          lastBlock = response.blockNumber;
          if (total === undefined) total = response.count;
          if (response.count + BigInt(entities.length) !== total || BigInt(response.entities.length) > response.count
            || response.entities.length < PAGE_SIZE && BigInt(response.entities.length) !== response.count) untrusted();
          for (const row of response.entities) {
            const entity = normalize(row, chainId, policy);
            if (afterKey !== undefined && entity.entityKey <= afterKey || ids.has(entity.record.record_id)) untrusted();
            ids.add(entity.record.record_id);
            afterKey = entity.entityKey;
            entities.push(entity);
          }
          if (BigInt(entities.length) === total) break;
          if (response.entities.length === 0 || page === MAX_PAGES - 1) untrusted();
        }
        if (BigInt(entities.length) !== total) untrusted();
        if (await client.getChainId() !== ARKIV_CHAIN_ID) untrusted();
        ensureActive();
        const blockNumber = await client.getBlockNumber();
        ensureActive();
        const observedAt = now();
        if (typeof blockNumber !== 'bigint' || blockNumber < lastBlock || blockNumber - firstBlock > MAX_BLOCK_SPAN
          || !timestampSchema.safeParse(observedAt).success || Date.parse(observedAt) < Date.parse(startedAt)
          || Date.parse(observedAt) - Date.parse(startedAt) > READ_TIMEOUT_MS) untrusted();
        return { ok: true, value: { chainId, blockNumber: String(blockNumber), observedAt, evidence, entities } };
      };
      const expired = new Promise<Result<EntityObservation>>((resolve) => {
        timer = setTimeout(() => {
          active = false;
          resolve({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
        }, READ_TIMEOUT_MS);
      });
      try {
        return await Promise.race([operation().catch((error: unknown): Result<EntityObservation> => ({
          ok: false, error: makeError(error instanceof UntrustedEntity || error instanceof SchemaMismatchError
            ? 'REGISTRY_UNTRUSTED' : 'REGISTRY_UNAVAILABLE'),
        })), expired]);
      } finally {
        active = false;
        clearTimeout(timer);
      }
    },
  });
}

/** Fixed public read-only Rabdi client. This module constructs no account, wallet or signer. */
export function createRabdiEntityReader(options: { policy: PublisherPolicy }): EntityReader {
  const publicClient = createPublicClient({
    chain: rabdi({ accessKey: '' }),
    transport: http(RPC_URL, { timeout: 5_000, retryCount: 0 }),
  });
  const client: ArkivReaderClient = {
    getChainId: () => publicClient.getChainId(),
    getBlockNumber: () => publicClient.getBlockNumber({ cacheTime: 0 }),
    async queryChainPage({ chainId, policy, afterKey, limit }) {
      let query = publicClient.select('*').from(RegistrySource, { onMismatch: 'throw' })
        .where(eq('chain_id', chainId), eq('source_commit', policy.sourceRevision), eq('snapshot_sha256', policy.snapshotSha256))
        .createdBy(policy.creator as Address).ownedBy(policy.owner as Address).orderBy(asc('$key')).limit(limit);
      // importer_version is deliberately not indexed in the production schema;
      // normalize() checks it instead of inventing an unsupported query predicate.
      if (afterKey !== undefined) query = query.where(gt('$key', key(afterKey as `0x${string}`)));
      const result = await query.withCount().fetch();
      return { entities: result.entities, skipped: result.skipped, count: result.count, blockNumber: result.blockNumber };
    },
  };
  return createArkivEntityReader({ policy: options.policy, client, evidence: 'OBSERVED_LIVE' });
}
