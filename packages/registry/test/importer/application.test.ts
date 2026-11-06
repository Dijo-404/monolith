import { describe, expect, it } from 'vitest';
import { importRegistry, type ImportOptions } from '../../src/application/import-registry.js';
import type { EntityWriter, ImportJournal, JournalStore, StoredRecord } from '../../src/ports/entity-writer.js';
import type { ImportPlan } from '../../src/ports/source-snapshot.js';

const publisher = `0x${'12'.repeat(20)}`;
const now = '2026-11-06T13:00:00.000Z';
const id = (number: number) => number.toString(16).padStart(64, '0');
const options: ImportOptions = { maxNetworks: 100, batchSize: 2, lifetimeHours: 24, refreshExpired: false };
function plan(length = 5): ImportPlan {
  return {
    snapshot: {
      schemaVersion: 1, repository: 'https://github.com/ethereum-lists/chains', revision: 'a'.repeat(40),
      retrievedAt: now, snapshotSha256: 'b'.repeat(64), catalog: '{}\n',
      license: { url: 'https://github.com/ethereum-lists/chains/blob/license/LICENSE', sha256: 'c'.repeat(64), text: 'MIT' },
      files: [],
    },
    records: Array.from({ length }, (_, n) => ({
      record_id: id(n + 1), chain_id: String(n + 1), chain_name: `Chain ${n + 1}`,
      rpc_host: 'https://rpc.example.org/', network_type: 'evm', status: 'candidate',
      source_url: 'https://github.com/ethereum-lists/chains', source_commit: 'a'.repeat(40),
      source_license: 'https://github.com/ethereum-lists/chains/blob/license/LICENSE',
      license_sha256: 'c'.repeat(64), snapshot_sha256: 'b'.repeat(64), observed_at: now,
      measured_chain_id: '', importer_version: 'monolith-import-v1',
    })),
    counts: { sourceNetworks: length, sourceRpcEntries: length, eligibleNetworks: length,
      eligibleRecords: length, rejected: 0, duplicates: 0, reasons: {} },
  };
}

function rig() {
  let saved: ImportJournal | null = null;
  const persisted = new Map<string, StoredRecord>();
  const batches: string[][] = [];
  let lookups = 0;
  let failBatch = 0;
  let saveFails = false;
  const journal: JournalStore = {
    load: async () => saved === null ? null : structuredClone(saved),
    save: async (value) => {
      if (saveFails) throw new Error('private-provider-data');
      saved = structuredClone(value);
    },
  };
  const writer: EntityWriter = {
    publisher, evidence: 'SIMULATED', currentBlock: async () => 100n,
    lookup: async (records) => { lookups++; return records.flatMap((r) => persisted.has(r.record_id) ? [persisted.get(r.record_id)!] : []); },
    writeBatch: async (records) => {
      batches.push(records.map((record) => record.record_id));
      // The entire batch must be reserved durably before the first side effect.
      expect(records.every((record) => saved?.items[record.record_id]?.state === 'pending')).toBe(true);
      if (batches.length === failBatch) throw new Error('private-provider-data');
      return records.map((record) => {
        const stored: StoredRecord = {
          recordId: record.record_id, entityKey: `0x${record.record_id}`,
          transactionHash: `0x${id(1_000 + batches.length)}`, creator: publisher, owner: publisher,
          expiresAtBlock: '1000', contentExpiresAt: '2026-11-07T13:00:00.000Z',
        };
        persisted.set(record.record_id, stored);
        return stored;
      });
    },
  };
  return {
    writer, journal, persisted, batches,
    saved: () => saved, setSaved: (value: ImportJournal | null) => { saved = value; },
    lookups: () => lookups, fail: (batch: number) => { failBatch = batch; },
    failSave: () => { saveFails = true; },
  };
}

describe('bounded import application (SIMULATED)', () => {
  it('writes five actual fake outcomes in bounded batches and counts transactions separately', async () => {
    const r = rig();
    const result = await importRegistry(plan(), r.writer, r.journal, options, now);
    expect(result.status).toBe('COMPLETE');
    expect(r.batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(result.counts).toMatchObject({ written: 5, reused: 0, remaining: 0, transactions: 3 });
    expect(result.storageEvidence).toBe('SIMULATED');
    expect(result.endpointValidation).toBe('UNTESTED');
  });

  it('same snapshot rerun verifies entities and makes zero new writes', async () => {
    const r = rig();
    await importRegistry(plan(), r.writer, r.journal, options, now);
    const again = await importRegistry(plan(), r.writer, r.journal, options, now);
    expect(again.status).toBe('COMPLETE');
    expect(again.counts).toMatchObject({ written: 0, reused: 5, transactions: 0 });
    expect(r.batches).toHaveLength(3);
    expect(r.lookups()).toBe(6);
  });

  it('selects one endpoint per network and honestly records the bounded subset', async () => {
    const r = rig();
    const input = plan();
    input.records.splice(1, 0, { ...input.records[0]!, record_id: id(99) });
    input.counts.eligibleRecords++;
    input.counts.sourceRpcEntries++;
    const result = await importRegistry(input, r.writer, r.journal, { ...options, maxNetworks: 3 }, now);
    expect(result.counts).toMatchObject({ eligibleRecords: 6, selectedRecords: 3, selectedNetworks: 3, written: 3 });
    expect(r.batches.flat()).not.toContain(id(99));
  });

  it('uncertain submission stops with accurate earlier success and durable reservations', async () => {
    const r = rig(); r.fail(2);
    const result = await importRegistry(plan(), r.writer, r.journal, options, now);
    expect(result.status).toBe('UNCERTAIN');
    expect(result.counts).toMatchObject({ written: 2, uncertain: 2, remaining: 3, transactions: 1 });
    expect(r.saved()?.items[id(3)]).toEqual({ state: 'pending' });
    expect(JSON.stringify(result)).not.toContain('private-provider-data');
  });

  it('an empty query cannot authorize retrying a pending write', async () => {
    const r = rig(); r.fail(1);
    await importRegistry(plan(), r.writer, r.journal, options, now);
    r.fail(0);
    const result = await importRegistry(plan(), r.writer, r.journal, options, now);
    expect(result.reason).toBe('RECONCILIATION_REQUIRED');
    expect(r.batches).toHaveLength(1);
  });

  it('counts earlier unresolved reservations as well as a newly uncertain batch', async () => {
    const r = rig();
    await importRegistry(plan(3), r.writer, r.journal, options, now);
    const saved = r.saved()!;
    delete saved.items[id(1)]; delete saved.items[id(2)];
    saved.items[id(3)] = { state: 'pending' };
    r.setSaved(saved); r.persisted.clear(); r.fail(3);
    const result = await importRegistry(plan(3), r.writer, r.journal, options, now);
    expect(result.status).toBe('UNCERTAIN');
    expect(result.counts.uncertain).toBe(3);
    expect(r.batches).toHaveLength(3);
  });

  it('reconciles pending records only by independently validated existing entities', async () => {
    const r = rig();
    const first = await importRegistry(plan(2), r.writer, r.journal, options, now);
    expect(first.status).toBe('COMPLETE');
    const saved = r.saved()!;
    saved.items[id(1)] = { state: 'pending' };
    saved.items[id(2)] = { state: 'pending' };
    r.setSaved(saved);
    const result = await importRegistry(plan(2), r.writer, r.journal, options, now);
    expect(result.counts).toMatchObject({ written: 0, reused: 2, uncertain: 0 });
    expect(r.batches).toHaveLength(1);
  });

  it('cannot hide a pending record by reducing selection', async () => {
    const r = rig(); r.fail(2);
    await importRegistry(plan(), r.writer, r.journal, options, now);
    const result = await importRegistry(plan(), r.writer, r.journal, { ...options, maxNetworks: 1 }, now);
    expect(result.reason).toBe('RECONCILIATION_REQUIRED');
    expect(r.batches).toHaveLength(2);
  });

  it.each(['publisher', 'sourceRevision', 'snapshotSha256', 'lifetimeHours'] as const)('rejects journal scope mismatch in %s', async (field) => {
    const r = rig();
    await importRegistry(plan(1), r.writer, r.journal, options, now);
    const saved = r.saved()!;
    if (field === 'lifetimeHours') saved[field] = 48;
    else saved[field] = 'changed';
    r.setSaved(saved);
    const result = await importRegistry(plan(1), r.writer, r.journal, options, now);
    expect(result.reason).toBe('JOURNAL_MISMATCH');
    expect(r.batches).toHaveLength(1);
  });

  it('refuses any write if the reservation cannot be saved', async () => {
    const r = rig(); r.failSave();
    const result = await importRegistry(plan(), r.writer, r.journal, options, now);
    expect(result.reason).toBe('JOURNAL_UNAVAILABLE');
    expect(r.batches).toHaveLength(0);
  });

  it.each(['creator', 'owner', 'entityKey', 'expiresAtBlock'] as const)('rejects invalid stored %s before write', async (field) => {
    const r = rig();
    await importRegistry(plan(1), r.writer, r.journal, options, now);
    const stored = r.persisted.get(id(1))!;
    stored[field] = field === 'expiresAtBlock' ? '100' : 'invalid';
    const result = await importRegistry(plan(1), r.writer, r.journal, options, now);
    expect(result.reason).toBe('STORED_ENTITY_INVALID');
    expect(r.batches).toHaveLength(1);
  });

  it('a missing unexpired confirmation cannot be silently replaced', async () => {
    const r = rig();
    await importRegistry(plan(1), r.writer, r.journal, options, now);
    r.persisted.clear();
    const result = await importRegistry(plan(1), r.writer, r.journal, options, now);
    expect(result.reason).toBe('STORED_ENTITY_INVALID');
    expect(r.batches).toHaveLength(1);
  });

  it('requires explicit refresh after a known confirmed expiry', async () => {
    const r = rig();
    await importRegistry(plan(1), r.writer, r.journal, options, now);
    r.persisted.clear();
    const saved = r.saved()!;
    const item = saved.items[id(1)]!;
    if (item.state === 'confirmed') item.stored.expiresAtBlock = '99';
    r.setSaved(saved);
    expect((await importRegistry(plan(1), r.writer, r.journal, options, now)).reason).toBe('EXPIRED_REFRESH_REQUIRED');
    const refreshed = await importRegistry(plan(1), r.writer, r.journal, { ...options, refreshExpired: true }, now);
    expect(refreshed.counts.written).toBe(1);
    expect(r.batches).toHaveLength(2);
  });

  it('cannot refresh an ISO-expired row until its old engine block life ends', async () => {
    const r = rig();
    await importRegistry(plan(1), r.writer, r.journal, options, now);
    r.persisted.clear();
    const saved = r.saved()!;
    const item = saved.items[id(1)]!;
    if (item.state === 'confirmed') item.stored.contentExpiresAt = '2026-11-06T12:00:00.000Z';
    r.setSaved(saved);
    const result = await importRegistry(plan(1), r.writer, r.journal, { ...options, refreshExpired: true }, now);
    expect(result.reason).toBe('STORED_ENTITY_INVALID');
    expect(r.batches).toHaveLength(1);
  });

  it('rejects duplicate active rows instead of silently choosing one', async () => {
    const r = rig();
    await importRegistry(plan(1), r.writer, r.journal, options, now);
    r.writer.lookup = async () => [r.persisted.get(id(1))!, r.persisted.get(id(1))!];
    expect((await importRegistry(plan(1), r.writer, r.journal, options, now)).reason).toBe('STORED_ENTITY_INVALID');
    expect(r.batches).toHaveLength(1);
  });

  it('rejects invalid limits before network or journal writes', async () => {
    const r = rig();
    const result = await importRegistry(plan(), r.writer, r.journal, { ...options, batchSize: 11 }, now);
    expect(result.reason).toBe('INVALID_INPUT');
    expect(r.lookups()).toBe(0);
    expect(r.saved()).toBeNull();
  });

  it('retains source retrieval time and keeps all RPC chain validation untested', async () => {
    const r = rig();
    const result = await importRegistry(plan(1), r.writer, r.journal, options, '2026-11-06T14:00:00.000Z');
    expect(result.source.retrievedAt).toBe(now);
    expect(result.generatedAt).not.toBe(now);
    expect(result.endpointValidation).toBe('UNTESTED');
    expect(result.records).toHaveLength(1);
  });
});
