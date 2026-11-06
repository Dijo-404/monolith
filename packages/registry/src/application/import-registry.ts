import { addressSchema, hex32Schema, sha256Schema, timestampSchema } from '@monolith/shared';
import type { EntityWriter, ImportJournal, JournalStore, StoredRecord } from '../ports/entity-writer.js';
import type { ImportPlan, RegistryRecord } from '../ports/source-snapshot.js';

export interface ImportOptions {
  maxNetworks: number;
  batchSize: number;
  lifetimeHours: number;
  refreshExpired: boolean;
}

export interface ImportManifest {
  schemaVersion: 1;
  importerVersion: 'monolith-import-v1';
  generatedAt: string;
  source: {
    repository: string;
    revision: string;
    snapshotSha256: string;
    retrievedAt: string;
    licenseUrl: string;
    licenseSha256: string;
  };
  publisher: string;
  storageEvidence: 'OBSERVED_LIVE' | 'SIMULATED' | 'UNTESTED';
  endpointValidation: 'UNTESTED';
  status: 'COMPLETE' | 'BLOCKED' | 'UNCERTAIN';
  reason: 'NONE' | 'INVALID_INPUT' | 'JOURNAL_MISMATCH' | 'JOURNAL_UNAVAILABLE'
    | 'LOOKUP_FAILED' | 'RECONCILIATION_REQUIRED' | 'EXPIRED_REFRESH_REQUIRED'
    | 'STORED_ENTITY_INVALID' | 'WRITE_OUTCOME_UNCERTAIN';
  selection: 'first-safe-endpoint-per-network';
  counts: ImportPlan['counts'] & {
    selectedNetworks: number;
    selectedRecords: number;
    written: number;
    reused: number;
    uncertain: number;
    remaining: number;
    transactions: number;
  };
  records: Array<StoredRecord & { outcome: 'written' | 'reused' }>;
  limits: string;
}

function validStored(stored: StoredRecord, recordId: string, publisher: string, block: bigint, nowISO: string): boolean {
  return stored.recordId === recordId && hex32Schema.safeParse(stored.entityKey).success
    && (stored.transactionHash === null || hex32Schema.safeParse(stored.transactionHash).success)
    && typeof stored.creator === 'string' && stored.creator.toLowerCase() === publisher.toLowerCase()
    && typeof stored.owner === 'string' && stored.owner.toLowerCase() === publisher.toLowerCase()
    && /^(0|[1-9][0-9]*)$/.test(stored.expiresAtBlock) && BigInt(stored.expiresAtBlock) > block
    && timestampSchema.safeParse(stored.contentExpiresAt).success
    && Date.parse(stored.contentExpiresAt) > Date.parse(nowISO);
}

function validJournal(value: ImportJournal, publisher: string, plan: ImportPlan, options: ImportOptions): boolean {
  if (value.schemaVersion !== 1 || value.publisher.toLowerCase() !== publisher.toLowerCase()
    || value.sourceRevision !== plan.snapshot.revision || value.snapshotSha256 !== plan.snapshot.snapshotSha256
    || value.lifetimeHours !== options.lifetimeHours || !value.items || typeof value.items !== 'object'
    || Array.isArray(value.items)) return false;
  return Object.entries(value.items).every(([id, item]) => sha256Schema.safeParse(id).success
    && item && (item.state === 'pending' || (item.state === 'confirmed'
      && item.stored && validStored(item.stored, id, publisher, -1n, '1970-01-01T00:00:00.000Z'))));
}

/** Bounded serial import. No SDK, network, clock, filesystem, or signing dependencies. */
export async function importRegistry(
  plan: ImportPlan,
  writer: EntityWriter,
  journalStore: JournalStore,
  options: ImportOptions,
  nowISO: string,
): Promise<ImportManifest> {
  const selected: RegistryRecord[] = [];
  const chains = new Set<string>();
  for (const record of plan.records) {
    if (chains.size >= options.maxNetworks) break;
    if (!chains.has(record.chain_id)) {
      chains.add(record.chain_id);
      selected.push(record);
    }
  }
  const manifest: ImportManifest = {
    schemaVersion: 1, importerVersion: 'monolith-import-v1', generatedAt: nowISO,
    source: {
      repository: plan.snapshot.repository, revision: plan.snapshot.revision,
      snapshotSha256: plan.snapshot.snapshotSha256, retrievedAt: plan.snapshot.retrievedAt,
      licenseUrl: plan.snapshot.license.url, licenseSha256: plan.snapshot.license.sha256,
    },
    publisher: writer.publisher, storageEvidence: 'UNTESTED', endpointValidation: 'UNTESTED',
    status: 'BLOCKED', reason: 'INVALID_INPUT', selection: 'first-safe-endpoint-per-network',
    counts: {
      ...plan.counts, reasons: { ...plan.counts.reasons }, selectedNetworks: chains.size,
      selectedRecords: selected.length, written: 0, reused: 0, uncertain: 0,
      remaining: selected.length, transactions: 0,
    },
    records: [],
    limits: 'Licensed source metadata only. Candidate endpoints are unprobed; storage is not permission to contact them. Block expiry is not an ISO timestamp. Counts describe this bounded selection.',
  };
  const stop = (reason: ImportManifest['reason'], uncertain = manifest.counts.uncertain): ImportManifest => {
    manifest.reason = reason;
    manifest.status = uncertain > 0 ? 'UNCERTAIN' : 'BLOCKED';
    manifest.counts.uncertain = uncertain;
    return manifest;
  };
  if (!timestampSchema.safeParse(nowISO).success || !addressSchema.safeParse(writer.publisher).success
    || !Number.isInteger(options.maxNetworks) || options.maxNetworks < 1 || options.maxNetworks > 1_000
    || !Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10
    || !Number.isInteger(options.lifetimeHours) || options.lifetimeHours < 1 || options.lifetimeHours > 72
    || typeof options.refreshExpired !== 'boolean' || selected.length === 0
    || selected.some((record) => !sha256Schema.safeParse(record.record_id).success)
    || new Set(selected.map((record) => record.record_id)).size !== selected.length) return manifest;

  let journal: ImportJournal;
  try {
    const existing = await journalStore.load();
    if (existing && !validJournal(existing, writer.publisher, plan, options)) return stop('JOURNAL_MISMATCH');
    journal = existing ?? {
      schemaVersion: 1, publisher: writer.publisher, sourceRevision: plan.snapshot.revision,
      snapshotSha256: plan.snapshot.snapshotSha256, lifetimeHours: options.lifetimeHours, items: {},
    };
  } catch { return stop('JOURNAL_UNAVAILABLE'); }
  manifest.counts.uncertain = Object.values(journal.items).filter((item) => item.state === 'pending').length;

  // A reduced rerun must not bypass an unresolved reservation outside its new selection.
  const selectedIds = new Set(selected.map((record) => record.record_id));
  if (Object.entries(journal.items).some(([id, item]) => item.state === 'pending' && !selectedIds.has(id))) {
    return stop('RECONCILIATION_REQUIRED');
  }
  const transactions = new Set<string>();
  for (let offset = 0; offset < selected.length; offset += options.batchSize) {
    const batch = selected.slice(offset, offset + options.batchSize);
    let block: bigint;
    let existing: StoredRecord[];
    try {
      block = await writer.currentBlock();
      existing = await writer.lookup(batch);
      // Recheck after lookup, which may have observed multiple chain blocks.
      block = await writer.currentBlock();
    } catch { return stop('LOOKUP_FAILED'); }
    if (typeof block !== 'bigint' || block < 0n) return stop('LOOKUP_FAILED');
    const found = new Map<string, StoredRecord>();
    for (const stored of existing) {
      if (!batch.some((record) => record.record_id === stored.recordId) || found.has(stored.recordId)
        || !validStored(stored, stored.recordId, writer.publisher, block, nowISO)) return stop('STORED_ENTITY_INVALID');
      found.set(stored.recordId, stored);
    }
    const toWrite: RegistryRecord[] = [];
    for (const record of batch) {
      const stored = found.get(record.record_id);
      const previous = journal.items[record.record_id];
      if (stored) {
        if (previous?.state === 'pending') manifest.counts.uncertain--;
        journal.items[record.record_id] = { state: 'confirmed', stored };
        manifest.records.push({ ...stored, outcome: 'reused' });
        manifest.counts.reused++;
        manifest.counts.remaining--;
        manifest.storageEvidence = writer.evidence;
      } else if (previous?.state === 'pending') {
        return stop('RECONCILIATION_REQUIRED');
      } else if (previous?.state === 'confirmed') {
        const old = previous.stored;
        if (!/^(0|[1-9][0-9]*)$/.test(old.expiresAtBlock)) return stop('STORED_ENTITY_INVALID');
        // Do not create a second matching engine row while its prior block life remains.
        // An expired wall-clock deadline alone permits no refresh before engine expiry.
        if (BigInt(old.expiresAtBlock) > block) {
          return stop('STORED_ENTITY_INVALID');
        }
        if (!options.refreshExpired) return stop('EXPIRED_REFRESH_REQUIRED');
        toWrite.push(record);
      } else {
        toWrite.push(record);
      }
    }
    try {
      for (const record of toWrite) journal.items[record.record_id] = { state: 'pending' };
      await journalStore.save(journal);
    } catch { return stop('JOURNAL_UNAVAILABLE'); }
    if (toWrite.length === 0) continue;

    let written: StoredRecord[];
    try { written = await writer.writeBatch(toWrite, options.lifetimeHours); }
    catch { return stop('WRITE_OUTCOME_UNCERTAIN', manifest.counts.uncertain + toWrite.length); }
    const ids = new Set<string>();
    if (written.length !== toWrite.length || written.some((stored) => {
      const invalid = ids.has(stored.recordId) || !toWrite.some((record) => record.record_id === stored.recordId)
        || !validStored(stored, stored.recordId, writer.publisher, block, nowISO) || stored.transactionHash === null;
      ids.add(stored.recordId);
      return invalid;
    })) return stop('WRITE_OUTCOME_UNCERTAIN', manifest.counts.uncertain + toWrite.length);
    for (const stored of written) {
      journal.items[stored.recordId] = { state: 'confirmed', stored };
      manifest.records.push({ ...stored, outcome: 'written' });
      manifest.counts.written++;
      manifest.counts.remaining--;
      transactions.add(stored.transactionHash as string);
    }
    manifest.storageEvidence = writer.evidence;
    manifest.counts.transactions = transactions.size;
    try { await journalStore.save(journal); }
    catch { return stop('JOURNAL_UNAVAILABLE'); }
  }
  manifest.status = 'COMPLETE';
  manifest.reason = 'NONE';
  return manifest;
}
