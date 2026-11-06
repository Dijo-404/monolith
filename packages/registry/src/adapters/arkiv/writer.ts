import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { eq, or } from '@arkiv-network/sdk/query';
import { http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { publicHttpsUrlSchema, timestampSchema } from '@monolith/shared';
import type { EntityWriter, StoredRecord } from '../../ports/entity-writer.js';
import type { RegistryRecord } from '../../ports/source-snapshot.js';
import { RegistrySource } from './schema.js';

export const ARKIV_CHAIN_ID = 7794095;
export const MAX_IMPORT_BATCH = 10;
export const IMPORT_BATCH_GAS_LIMIT = 16_000_000n;
export const IMPORT_GAS_PRICE_WEI = 1_000_000_000n;
const ARKIV_CONTRACT = '0x4400000000000000000000000000000000000044';
const RPC_URL = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
const PAGE_SIZE = 20;
const MAX_PAGES = 5;
const hex32 = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const columns = [
  'record_id', 'chain_id', 'chain_name', 'rpc_host', 'network_type', 'status',
  'source_url', 'source_commit', 'source_license', 'license_sha256', 'snapshot_sha256',
  'observed_at', 'measured_chain_id', 'importer_version',
] as const satisfies readonly (keyof RegistryRecord)[];

/** Narrow SDK seam: raw rows are validated before crossing into the importer. */
export interface ArkivWriterClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBalance(publisher: string): Promise<bigint>;
  queryRecordIds(ids: readonly string[], publisher: string, offset: number, limit: number): Promise<{
    entities: readonly unknown[];
    skipped: number;
    count: bigint;
  }>;
  readEntity(entityKey: string): Promise<unknown>;
  getReceipt(hash: string): Promise<{ status: string; from: string; to: string | null }>;
  executeBatch?: (records: readonly RegistryRecord[], lifetimeHours: number, contentExpiresAt: string) => Promise<{
    txHash: string;
    createdEntities: readonly string[];
  }>;
}

function fail(code: string): never { throw new Error(code); }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRecords(records: readonly RegistryRecord[]): RegistryRecord[] {
  if (records.length < 1 || records.length > MAX_IMPORT_BATCH) fail('INVALID_IMPORT_BATCH');
  const ids = new Set<string>();
  return records.map((input) => {
    if (!object(input) || Object.keys(input).length !== columns.length) fail('INVALID_IMPORT_RECORD');
    const copy = Object.fromEntries(columns.map((name) => [name, input[name]])) as unknown as RegistryRecord;
    if (columns.some((name) => typeof copy[name] !== 'string' ||
      new TextEncoder().encode(copy[name]).length > 128 || /[\p{Cc}\p{Cf}]/u.test(copy[name]))) {
      fail('INVALID_IMPORT_RECORD');
    }
    if (!sha256.test(copy.record_id) || ids.has(copy.record_id) ||
      !/^(?:0|[1-9][0-9]{0,77})$/.test(copy.chain_id) || !copy.chain_name.trim() ||
      copy.network_type !== 'evm' || copy.status !== 'candidate' || copy.measured_chain_id !== '' ||
      copy.importer_version !== 'monolith-import-v1' ||
      !/^[0-9a-f]{40}$/.test(copy.source_commit) ||
      copy.source_url !== `https://github.com/ethereum-lists/chains/blob/${copy.source_commit}/_data/chains/eip155-${copy.chain_id}.json` ||
      copy.source_license !== `https://github.com/ethereum-lists/chains/blob/${copy.source_commit}/LICENSE` ||
      !sha256.test(copy.license_sha256) || !sha256.test(copy.snapshot_sha256) ||
      !timestampSchema.safeParse(copy.observed_at).success ||
      !publicHttpsUrlSchema.safeParse(copy.rpc_host).success || new URL(copy.rpc_host).search) {
      fail('INVALID_IMPORT_RECORD');
    }
    ids.add(copy.record_id);
    return copy;
  });
}

function assessRow(row: unknown, record: RegistryRecord, publisher: string, block: bigint, nowISO: string): StoredRecord | null {
  if (!object(row) || typeof row['$key'] !== 'string' || !hex32.test(row['$key']) ||
    typeof row['$creator'] !== 'string' || row['$creator'].toLowerCase() !== publisher.toLowerCase() ||
    typeof row['$owner'] !== 'string' || row['$owner'].toLowerCase() !== publisher.toLowerCase() ||
    typeof row['$expiresAt'] !== 'bigint' || row['$expiresAt'] < 0n) fail('UNTRUSTED_IMPORT_ENTITY');
  const flags = row['$creationFlags'];
  if (!object(flags) || flags['readonly'] !== true || flags['permissionlessExtension'] !== false ||
    flags['raw'] !== 1) fail('UNTRUSTED_IMPORT_ENTITY');

  for (const name of columns) {
    const attribute = row[name];
    if (!object(attribute) || attribute['type'] !== 'str' || typeof attribute['value'] !== 'string' ||
      new TextEncoder().encode(attribute['value']).length > 128 || /[\p{Cc}\p{Cf}]/u.test(attribute['value'])) {
      fail('UNTRUSTED_IMPORT_ENTITY');
    }
    if (name === 'observed_at') {
      // A later retrieval of identical immutable bytes does not make the old row a new fetch.
      if (!timestampSchema.safeParse(attribute['value']).success || Date.parse(attribute['value']) > Date.parse(nowISO)) {
        fail('UNTRUSTED_IMPORT_ENTITY');
      }
    } else if (attribute['value'] !== record[name]) fail('IMPORT_CONTENT_MISMATCH');
  }
  const deadline = row['content_expires_at'];
  if (!object(deadline) || deadline['type'] !== 'str' || typeof deadline['value'] !== 'string' ||
    !timestampSchema.safeParse(deadline['value']).success) fail('UNTRUSTED_IMPORT_ENTITY');
  // Only engine expiry establishes absence. A known live row with an expired ISO
  // deadline must block lookup, even without a journal, to prevent an active duplicate.
  if (row['$expiresAt'] <= block) return null;
  if (Date.parse(deadline['value']) <= Date.parse(nowISO)) fail('IMPORT_CONTENT_EXPIRED');
  return {
    recordId: record.record_id,
    entityKey: row['$key'],
    transactionHash: null,
    creator: row['$creator'],
    owner: row['$owner'],
    expiresAtBlock: String(row['$expiresAt']),
    contentExpiresAt: deadline['value'],
  };
}

/** Injected clients are infrastructure, not evidence supplied by a remote caller. */
export function createArkivEntityWriter(options: {
  publisher: string;
  client: ArkivWriterClient;
  now?: () => string;
  evidence?: 'OBSERVED_LIVE' | 'SIMULATED';
}): EntityWriter {
  if (!address.test(options.publisher)) fail('INVALID_IMPORT_PUBLISHER');
  const publisher = options.publisher;
  const client = options.client;
  const now = options.now ?? (() => new Date().toISOString());
  const evidence = options.evidence ?? 'SIMULATED';
  let reservedFees = 0n;

  async function chainPin(): Promise<void> {
    if (await client.getChainId() !== ARKIV_CHAIN_ID) fail('ARKIV_CHAIN_MISMATCH');
  }

  async function currentBlock(): Promise<bigint> {
    await chainPin();
    const block = await client.getBlockNumber();
    if (typeof block !== 'bigint' || block < 0n) fail('INVALID_ARKIV_BLOCK');
    return block;
  }

  async function lookup(inputs: readonly RegistryRecord[]): Promise<StoredRecord[]> {
    const records = validateRecords(inputs);
    const requestedAt = now();
    if (!timestampSchema.safeParse(requestedAt).success ||
      records.some((record) => Date.parse(record.observed_at) > Date.parse(requestedAt))) fail('INVALID_IMPORT_CLOCK');
    await chainPin();
    const ids = records.map((record) => record.record_id);
    const rows: unknown[] = [];
    let offset = 0;
    let total: bigint | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.queryRecordIds(ids, publisher, offset, PAGE_SIZE);
      if (!Array.isArray(result.entities) || !Number.isSafeInteger(result.skipped) || result.skipped < 0 ||
        typeof result.count !== 'bigint' || result.count < 0n || result.count > BigInt(records.length)) {
        fail('AMBIGUOUS_IMPORT_QUERY');
      }
      if (total !== undefined && total !== result.count) fail('UNSTABLE_IMPORT_QUERY');
      total = result.count;
      const visited = result.entities.length + result.skipped;
      if (visited > PAGE_SIZE) fail('INVALID_IMPORT_QUERY');
      // Skipped matching rows are evidence of malformed/unknown data, not proof of absence.
      if (result.skipped !== 0) fail('INCOMPLETE_IMPORT_QUERY');
      rows.push(...result.entities);
      offset += visited;
      if (BigInt(offset) === total) break;
      if (visited === 0 || BigInt(offset) > total || page === MAX_PAGES - 1) fail('INCOMPLETE_IMPORT_QUERY');
    }
    if (BigInt(rows.length) !== total) fail('INCOMPLETE_IMPORT_QUERY');
    const block = await currentBlock();
    const nowISO = now();
    if (!timestampSchema.safeParse(nowISO).success) fail('INVALID_IMPORT_CLOCK');
    const found = new Set<string>();
    return rows.map((row) => {
      if (!object(row)) fail('UNTRUSTED_IMPORT_ENTITY');
      const recordId = row['record_id'];
      if (!object(recordId) || typeof recordId['value'] !== 'string') fail('UNTRUSTED_IMPORT_ENTITY');
      const record = records.find((candidate) => candidate.record_id === recordId['value']);
      if (!record || found.has(record.record_id)) fail('AMBIGUOUS_IMPORT_QUERY');
      found.add(record.record_id);
      return assessRow(row, record, publisher, block, nowISO);
    }).filter((stored): stored is StoredRecord => stored !== null);
  }

  async function writeBatch(inputs: readonly RegistryRecord[], lifetimeHours: number): Promise<StoredRecord[]> {
    const records = validateRecords(inputs);
    if (!Number.isSafeInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 72) fail('INVALID_IMPORT_LIFETIME');
    if (!client.executeBatch) fail('IMPORT_SIGNER_REQUIRED');
    const nowISO = now();
    if (!timestampSchema.safeParse(nowISO).success ||
      records.some((record) => Date.parse(record.observed_at) > Date.parse(nowISO))) fail('INVALID_IMPORT_CLOCK');
    await chainPin();
    const maxBatchFee = IMPORT_BATCH_GAS_LIMIT * IMPORT_GAS_PRICE_WEI;
    if (reservedFees + maxBatchFee > 1_000_000_000_000_000_000n) fail('IMPORT_FEE_BUDGET_EXCEEDED');
    if (await client.getBalance(publisher) < maxBatchFee) fail('IMPORT_PUBLISHER_UNFUNDED');
    // Reserve even when broadcasting fails: an uncertain write may still have consumed gas.
    reservedFees += maxBatchFee;
    const contentExpiresAt = new Date(Date.parse(nowISO) + lifetimeHours * 3_600_000).toISOString();
    const result = await client.executeBatch(records, lifetimeHours, contentExpiresAt);
    if (!hex32.test(result.txHash) || result.createdEntities.length !== records.length ||
      result.createdEntities.some((key) => !hex32.test(key)) ||
      new Set(result.createdEntities.map((key) => key.toLowerCase())).size !== records.length) {
      fail('INVALID_IMPORT_WRITE_RESULT');
    }
    const receipt = await client.getReceipt(result.txHash);
    if (receipt.status !== 'success' || receipt.from.toLowerCase() !== publisher.toLowerCase() ||
      receipt.to?.toLowerCase() !== ARKIV_CONTRACT) fail('INVALID_IMPORT_RECEIPT');
    const rows: unknown[] = [];
    for (const key of result.createdEntities) rows.push(await client.readEntity(key));
    const block = await currentBlock();
    const observedNow = now();
    if (!timestampSchema.safeParse(observedNow).success) fail('INVALID_IMPORT_CLOCK');
    return rows.map((row, index) => {
      const record = records[index];
      if (!record || !object(row) || row['$key'] !== result.createdEntities[index]) fail('IMPORT_CREATED_KEY_MISMATCH');
      const stored = assessRow(row, record, publisher, block, observedNow);
      if (!stored || stored.contentExpiresAt !== contentExpiresAt) fail('IMPORT_CREATED_EXPIRY_MISMATCH');
      return { ...stored, transactionHash: result.txHash };
    });
  }

  return Object.freeze({
    publisher,
    evidence,
    currentBlock: () => currentBlock().catch(() => fail('ARKIV_BLOCK_UNAVAILABLE')),
    lookup: (records: readonly RegistryRecord[]) => lookup(records).catch(() => fail('ARKIV_LOOKUP_FAILED')),
    writeBatch: (records: readonly RegistryRecord[], lifetimeHours: number) =>
      writeBatch(records, lifetimeHours).catch(() => fail('ARKIV_WRITE_UNCERTAIN')),
  });
}

/** Fixed public Rabdi composition; omitting the key constructs no wallet/signing client. */
export function createRabdiEntityWriter(options: { publisher: string; privateKey?: string }): EntityWriter {
  if (!address.test(options.publisher)) fail('INVALID_IMPORT_PUBLISHER');
  const chain = rabdi({ accessKey: '' });
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL, { timeout: 15_000, retryCount: 0, fetchOptions: { redirect: 'error' } }),
    pollingInterval: 2_000,
  });
  const services: ArkivWriterClient = {
    getChainId: () => publicClient.getChainId(),
    getBlockNumber: () => publicClient.getBlockNumber({ cacheTime: 0 }),
    getBalance: (publisher) => publicClient.getBalance({ address: publisher as Address }),
    queryRecordIds: async (ids, publisher, offset, limit) => {
      const result = await publicClient.select('*').from(RegistrySource, { onMismatch: 'throw' })
        .where(or(...ids.map((id) => eq('record_id', id))))
        .createdBy(publisher as Address).ownedBy(publisher as Address)
        .limit(limit).offset(offset).withCount().fetch();
      return { entities: result.entities, skipped: result.skipped, count: result.count };
    },
    readEntity: (key) => publicClient.getEntity(key as Hex, RegistrySource),
    getReceipt: async (hash) => {
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });
      return { status: receipt.status, from: receipt.from, to: receipt.to };
    },
  };
  if (options.privateKey !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) fail('INVALID_IMPORT_SIGNER');
    const account = (() => {
      try { return privateKeyToAccount(options.privateKey as Hex); }
      catch { return fail('INVALID_IMPORT_SIGNER'); }
    })();
    if (account.address.toLowerCase() !== options.publisher.toLowerCase()) fail('IMPORT_SIGNER_MISMATCH');
    const wallet = createWalletClient({
      chain, account, transport: http(RPC_URL, { timeout: 15_000, retryCount: 0, fetchOptions: { redirect: 'error' } }), pollingInterval: 2_000,
    });
    services.executeBatch = async (records, lifetimeHours, contentExpiresAt) => wallet.executeBatch({
      creates: records.map((record) => ({
        schema: RegistrySource,
        values: { ...record, content_expires_at: contentExpiresAt },
        expiration: ExpirationTime.fromHours(lifetimeHours),
        flags: { readonly: true },
      })),
    }, { gas: IMPORT_BATCH_GAS_LIMIT, gasPrice: IMPORT_GAS_PRICE_WEI });
  }
  return createArkivEntityWriter({ publisher: options.publisher, client: services, evidence: 'OBSERVED_LIVE' });
}
