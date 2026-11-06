import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makeError, type Result } from '@monolith/shared';
import { createQueryRegistry, validatePublisherPolicy } from '../../src/index.js';
import type { EntityObservation, EntityReader, PublisherPolicy, RegistryEntity } from '../../src/index.js';

// All invented rows, clocks, addresses and RPC domains in this file are SIMULATED.
const NOW = '2030-01-01T00:00:00.000Z';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const policy: PublisherPolicy = {
  creator: `0x${'a'.repeat(40)}`, owner: `0x${'a'.repeat(40)}`,
  sourceRevision: 'b'.repeat(40), snapshotSha256: 'c'.repeat(64),
  licenseSha256: '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
  allowedOrigins: ['https://rpc.example.com'],
};

function entity(): RegistryEntity {
  const immutable = {
    chain_id: '1', chain_name: 'Synthetic Ethereum', rpc_host: 'https://rpc.example.com/',
    network_type: 'evm' as const, status: 'candidate' as const,
    source_url: `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/_data/chains/eip155-1.json`,
    source_commit: policy.sourceRevision,
    source_license: `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/LICENSE`,
    license_sha256: policy.licenseSha256, snapshot_sha256: policy.snapshotSha256,
    measured_chain_id: '' as const, importer_version: 'monolith-import-v1' as const,
  };
  return { entityKey: `0x${'d'.repeat(64)}`, creator: policy.creator, owner: policy.owner,
    expiresAtBlock: '200', readonly: true, permissionlessExtension: false,
    contentExpiresAt: '2030-01-01T01:00:00.000Z',
    record: { record_id: hash(JSON.stringify(immutable)), ...immutable, observed_at: '2029-12-31T23:59:00.000Z' },
  };
}

function harness(options: { now?: () => string; timeoutMs?: number; inputPolicy?: PublisherPolicy } = {}) {
  const row = entity();
  const observation: EntityObservation = { chainId: '1', blockNumber: '100', observedAt: NOW, evidence: 'SIMULATED', entities: [row] };
  const read = vi.fn(async (): Promise<Result<EntityObservation>> => ({ ok: true, value: structuredClone(observation) }));
  const admit = vi.fn(async (): Promise<Result<void>> => ({ ok: true, value: undefined }));
  const query = createQueryRegistry({ reader: { readChain: read }, policy: options.inputPolicy ?? policy,
    hash, admission: { check: admit }, now: options.now ?? (() => NOW),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  return { row, observation, read, admit, query };
}

describe('SIMULATED production import authentication and public projection', () => {
  it('emits the exact frozen DTO, no raw adapter fields and no endpoint probe', async () => {
    const h = harness();
    const result = await h.query.query('1');
    expect(result).toMatchObject({ ok: true, value: { schemaVersion: 1, evidence: 'SIMULATED', origin: 'arkiv-query',
      generatedAt: NOW, expiresAt: '2030-01-01T00:00:30.000Z', endpoints: [{ chainId: '1', rpcUrl: h.row.record.rpc_host }] } });
    expect(h.read).toHaveBeenCalledWith('1');
    expect(h.admit).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(result);
    for (const field of ['expiresAtBlock', 'content_expires_at', 'readonly', 'permissionlessExtension', 'record_id', 'measured_chain_id']) {
      expect(serialized).not.toContain(field);
    }
  });

  it.each([
    ['foreign creator', (row: RegistryEntity) => { row.creator = `0x${'e'.repeat(40)}`; }],
    ['foreign owner', (row: RegistryEntity) => { row.owner = `0x${'e'.repeat(40)}`; }],
    ['missing creator', (row: RegistryEntity) => { Reflect.deleteProperty(row, 'creator'); }],
    ['malformed key', (row: RegistryEntity) => { row.entityKey = 'unsafe key'; }],
    ['mutable row', (row: RegistryEntity) => { row.readonly = false; }],
    ['extendible row', (row: RegistryEntity) => { row.permissionlessExtension = true; }],
    ['modified content', (row: RegistryEntity) => { row.record.chain_name = 'modified'; }],
    ['forged record hash', (row: RegistryEntity) => { row.record.record_id = 'f'.repeat(64); }],
    ['unapproved revision', (row: RegistryEntity) => { row.record.source_commit = 'f'.repeat(40); }],
    ['wrong catalog', (row: RegistryEntity) => { row.record.snapshot_sha256 = 'f'.repeat(64); }],
    ['wrong license hash', (row: RegistryEntity) => { row.record.license_sha256 = 'f'.repeat(64); }],
    ['wrong license URL', (row: RegistryEntity) => { row.record.source_license = 'https://example.com/'; }],
    ['wrong source URL', (row: RegistryEntity) => { row.record.source_url = 'https://example.com/'; }],
    ['preflight row', (row: RegistryEntity) => { Reflect.set(row.record, 'importer_version', 'simulated-preflight'); }],
    ['purported verified endpoint', (row: RegistryEntity) => { Reflect.set(row.record, 'status', 'verified'); }],
    ['invented measured chain', (row: RegistryEntity) => { Reflect.set(row.record, 'measured_chain_id', '1'); }],
    ['wrong chain', (row: RegistryEntity) => { row.record.chain_id = '2'; }],
    ['hidden extra column', (row: RegistryEntity) => { Reflect.set(row.record, 'payload', 'do not publish'); }],
    ['unsafe Unicode', (row: RegistryEntity) => { row.record.chain_name = 'name\u202e'; }],
    ['overlong string', (row: RegistryEntity) => { row.record.chain_name = 'a'.repeat(129); }],
    ['UTF8 storage overflow', (row: RegistryEntity) => { row.record.chain_name = 'é'.repeat(65); }],
    ['non-string field', (row: RegistryEntity) => { Reflect.set(row.record, 'chain_name', 42); }],
    ['credential URL', (row: RegistryEntity) => { row.record.rpc_host = 'https://secret@rpc.example.com/'; }],
    ['IP literal', (row: RegistryEntity) => { row.record.rpc_host = 'https://127.0.0.1/'; }],
    ['numeric IP', (row: RegistryEntity) => { row.record.rpc_host = 'https://2130706433/'; }],
    ['URL query', (row: RegistryEntity) => { row.record.rpc_host = 'https://rpc.example.com/?key=secret'; }],
    ['disallowed origin', (row: RegistryEntity) => { row.record.rpc_host = 'https://foreign.example.com/'; }],
    ['unsafe redirect-looking custom path', (row: RegistryEntity) => { row.record.rpc_host = 'https://rpc.example.com/redirect'; }],
  ])('rejects %s before any DNS side effect', async (_name, mutate) => {
    const h = harness();
    mutate(h.row);
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
    expect(h.admit).not.toHaveBeenCalled();
  });

  it('validates all rows before resolving even the first valid endpoint', async () => {
    const h = harness();
    h.observation.entities = [h.row, { ...entity(), creator: `0x${'e'.repeat(40)}` }];
    expect(await h.query.query('1')).toMatchObject({ ok: false });
    expect(h.admit).not.toHaveBeenCalled();
  });

  it('preserves licensed source whitespace in an authenticated record identity', async () => {
    const h = harness();
    h.row.record.chain_name = 'Monsoon ';
    const r = h.row.record;
    r.record_id = hash(JSON.stringify({ chain_id: r.chain_id, chain_name: r.chain_name, rpc_host: r.rpc_host,
      network_type: r.network_type, status: r.status, source_url: r.source_url, source_commit: r.source_commit,
      source_license: r.source_license, license_sha256: r.license_sha256, snapshot_sha256: r.snapshot_sha256,
      measured_chain_id: r.measured_chain_id, importer_version: r.importer_version }));
    expect(await h.query.query('1')).toMatchObject({ ok: true, value: { endpoints: [{ chainName: 'Monsoon ' }] } });
  });

  it.each(['invalid', '01', '-1', '1.0', '1&wallet=secret'])('rejects invalid chain %s before storage', async (chain) => {
    const h = harness();
    expect(await h.query.query(chain)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(h.read).not.toHaveBeenCalled();
  });
});

describe('SIMULATED independent expiry clocks and query observations', () => {
  it.each(['100', '99'])('rejects engine expiry at/below observed block: %s', async (expiresAtBlock) => {
    const h = harness(); h.row.expiresAtBlock = expiresAtBlock;
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_EXPIRED' } });
    expect(h.admit).not.toHaveBeenCalled();
  });
  it.each([NOW, '2029-12-31T23:59:59.000Z'])('rejects publisher deadline %s despite live engine expiry', async (expiry) => {
    const h = harness(); h.row.contentExpiresAt = expiry;
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_EXPIRED' } });
  });
  it.each(['2030-01-01T01:00:01.000Z', 'malformed'])('rejects invalid/future source observation %s', async (observed) => {
    const h = harness(); h.row.record.observed_at = observed;
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });
  it('never interprets a block height as Unix time', async () => {
    const h = harness(); h.row.contentExpiresAt = '200';
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });
  it.each(['2029-12-31T23:59:59.000Z', '2030-01-01T00:00:01.000Z'])('rejects stale/future query observation %s', async (time) => {
    const h = harness(); h.observation.observedAt = time;
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });
  it('bounds manifest lifetime by the earliest endpoint deadline', async () => {
    const h = harness(); h.row.contentExpiresAt = '2030-01-01T00:00:03.000Z';
    expect(await h.query.query('1')).toMatchObject({ ok: true, value: { expiresAt: h.row.contentExpiresAt } });
  });
  it('rechecks deadline after DNS rather than exporting evidence that expired during admission', async () => {
    let time = NOW;
    const h = harness({ now: () => time }); h.row.contentExpiresAt = '2030-01-01T00:00:01.000Z';
    h.admit.mockImplementation(async () => { time = h.row.contentExpiresAt; return { ok: true, value: undefined }; });
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_EXPIRED' } });
  });
});

describe('SIMULATED outage, revalidation and generation lifecycle', () => {
  it('requeries every client while retaining identical shared generation data', async () => {
    const h = harness();
    const results = await Promise.all([h.query.query('1'), h.query.query('1')]);
    expect(results[0]).toEqual(results[1]);
    expect(h.read).toHaveBeenCalledTimes(2); expect(h.admit).toHaveBeenCalledTimes(2);
  });
  it('cannot use remembered generation metadata after a storage outage', async () => {
    const h = harness(); expect(await h.query.query('1')).toMatchObject({ ok: true });
    h.read.mockResolvedValue({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
    expect(h.admit).toHaveBeenCalledTimes(1);
  });
  it('rechecks DNS after an earlier admission and blocks a rebinding/private result', async () => {
    const h = harness(); expect(await h.query.query('1')).toMatchObject({ ok: true });
    h.admit.mockResolvedValue({ ok: false, error: makeError('ENDPOINT_REJECTED') });
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'ENDPOINT_REJECTED' } });
    expect(h.admit).toHaveBeenCalledTimes(2);
  });
  it('rejects duplicate keys and content identities instead of overwriting', async () => {
    const h = harness(); h.observation.entities = [h.row, structuredClone(h.row)];
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });
  it('rejects empty current data instead of replaying an earlier success', async () => {
    const h = harness(); expect(await h.query.query('1')).toMatchObject({ ok: true });
    h.observation.entities = [];
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
  });
  it('sanitizes thrown private upstream details', async () => {
    const h = harness(); h.read.mockRejectedValue(new Error('raw provider key: never publish'));
    expect(JSON.stringify(await h.query.query('1'))).not.toContain('never publish');
  });
  it('bounds hung readers, and a late result cannot continue into DNS', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ timeoutMs: 20 });
      let release: ((value: Result<EntityObservation>) => void) | undefined;
      h.read.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      const pending = h.query.query('1');
      await vi.advanceTimersByTimeAsync(20);
      expect(await pending).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
      release?.({ ok: true, value: h.observation }); await Promise.resolve();
      expect(h.admit).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('copies the operator policy so later mutation cannot authorize a new origin', async () => {
    const input = structuredClone(policy); const h = harness({ inputPolicy: input });
    input.allowedOrigins = ['https://attacker.example.com']; input.creator = `0x${'e'.repeat(40)}`;
    expect(await h.query.query('1')).toMatchObject({ ok: true });
  });
  it('retains an in-flight slot for each hung port after the caller times out', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ timeoutMs: 20 });
      const releases: Array<(value: Result<EntityObservation>) => void> = [];
      h.read.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
      const pending = Array.from({ length: 16 }, () => h.query.query('1'));
      await vi.advanceTimersByTimeAsync(20);
      expect((await Promise.all(pending)).every((value) => !value.ok)).toBe(true);
      expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
      expect(h.read).toHaveBeenCalledTimes(16);
      for (const release of releases) release({ ok: true, value: h.observation });
      await vi.runAllTimersAsync();
      expect(h.admit).not.toHaveBeenCalled();
      h.read.mockResolvedValue({ ok: true, value: h.observation });
      expect(await h.query.query('1')).toMatchObject({ ok: true });
    } finally { vi.useRealTimers(); }
  });
  it.each([
    { ...policy, allowedOrigins: [] }, { ...policy, allowedOrigins: ['http://rpc.example.com'] },
    { ...policy, allowedOrigins: ['https://rpc.example.com/path'] },
    { ...policy, allowedOrigins: ['https://rpc.example.com', 'https://rpc.example.com'] },
    { ...policy, licenseSha256: 'f'.repeat(64) },
  ])('rejects invalid operator policy', (input) => { expect(() => validatePublisherPolicy(input)).toThrow('Registry policy is invalid.'); });
});

// Public SDK-neutral consumer types must be usable without importing adapter internals.
const _readerConsumer: EntityReader | undefined = undefined;
void _readerConsumer;
