import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSourceSnapshot, sourceUrlRejection, SOURCE_REPOSITORY } from '../../src/domain/source-policy.js';
import type { SourceSnapshot } from '../../src/ports/source-snapshot.js';

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const license = readFileSync(new URL('../../src/adapters/source/LICENSE.ethereum-lists-chains', import.meta.url), 'utf8');
const revision = 'a'.repeat(40);
const now = '2026-11-06T13:30:00.000Z';
const chain = (id = 1, rpc: unknown[] = ['https://rpc.example.org']) => ({ chainId: id, name: `Public chain ${id}`, rpc });

function snapshot(chains: Record<string, unknown> = { '1': chain() }, changes: { revision?: string; retrievedAt?: string; license?: string } = {}): SourceSnapshot {
  const rev = changes.revision ?? revision;
  const files = Object.entries({ LICENSE: changes.license ?? license, 'README.md': 'Synthetic source fixture.\n', ...Object.fromEntries(Object.entries(chains).map(([id, value]) => [`_data/chains/eip155-${id}.json`, typeof value === 'string' ? value : JSON.stringify(value)])) })
    .map(([path, text]) => ({ path, text, byteLength: Buffer.byteLength(text), sha256: hash(text) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const catalog = JSON.stringify({ sourceSha: rev, files: files.map((file) => ({ path: file.path, bytes: file.byteLength, sha256: file.sha256 })) }) + '\n';
  return { schemaVersion: 1, repository: SOURCE_REPOSITORY, revision: rev, retrievedAt: changes.retrievedAt ?? now, snapshotSha256: hash(catalog), catalog,
    license: { url: `${SOURCE_REPOSITORY}/blob/${rev}/LICENSE`, sha256: hash(changes.license ?? license), text: changes.license ?? license }, files };
}

describe('source normalization: SIMULATED source metadata, no RPC activity', () => {
  it('accounts for accepted, duplicate and rejected entries without exporting rejected URLs', () => {
    const secret = 'https://rpc.example.org?api_key=synthetic-secret';
    const result = normalizeSourceSnapshot(snapshot({ '1': chain(1, ['https://RPC.example.org', 'https://rpc.example.org/', secret, null, 'http://rpc.example.org']) }), hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.counts).toEqual({ sourceNetworks: 1, sourceRpcEntries: 5, eligibleNetworks: 1, eligibleRecords: 1, rejected: 3, duplicates: 1,
      reasons: { PLACEHOLDER_OR_KEY_MARKER: 1, NON_STRING_RPC: 1, UNSAFE_HTTPS_URL: 1, DUPLICATE_WITHIN_CHAIN: 1 } });
    const record = result.value.records[0];
    expect(record).toMatchObject({ chain_id: '1', rpc_host: 'https://rpc.example.org/', network_type: 'evm', status: 'candidate', measured_chain_id: '', observed_at: now });
    expect(record?.record_id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.value.counts)).not.toContain('synthetic-secret');
    expect(JSON.stringify(result.value.records)).not.toContain('synthetic-secret');
  });

  it('keeps same-snapshot IDs stable across file order and retrieval time', () => {
    const first = normalizeSourceSnapshot(snapshot({ '2': chain(2), '1': chain() }), hash);
    const later = snapshot({ '1': chain(), '2': chain(2) }, { retrievedAt: '2026-11-06T14:00:00.000Z' });
    later.files.reverse();
    const second = normalizeSourceSnapshot(later, hash);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.records.map((record) => record.record_id)).toEqual(second.value.records.map((record) => record.record_id));
    expect(new Set(first.value.records.map((record) => record.record_id)).size).toBe(2);
    expect(first.value.counts.eligibleNetworks).toBe(2);
    expect(second.value.records[0]?.observed_at).toBe(later.retrievedAt);
  });

  it('binds identity to source revision and exact normalized content', () => {
    const variants = [snapshot(), snapshot({ '1': chain() }, { revision: 'b'.repeat(40) }), snapshot({ '1': { ...chain(), name: 'Renamed public chain' } })];
    const ids = variants.map((input) => { const result = normalizeSourceSnapshot(input, hash); expect(result.ok).toBe(true); return result.ok ? result.value.records[0]?.record_id : null; });
    expect(new Set(ids).size).toBe(3);
  });

  it('counts inactive and reused networks, empty RPC lists and UTF-8 SDK limits honestly', () => {
    const result = normalizeSourceSnapshot(snapshot({ '1': { ...chain(), status: 'incubating' }, '2': { ...chain(2), redFlags: ['reusedChainID'] }, '3': chain(3, []), '4': { ...chain(4), name: 'é'.repeat(65) } }), hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.counts).toEqual({ sourceNetworks: 4, sourceRpcEntries: 3, eligibleNetworks: 0, eligibleRecords: 0, rejected: 3, duplicates: 0,
      reasons: { INACTIVE_OR_REUSED_CHAIN: 2, SDK_STRING_TOO_LONG: 1 } });
  });

  it.each([
    ['9007199254740992', '{"chainId":9007199254740992,"name":"Unsafe number","rpc":[]}'],
    ['1', '{"chainId":2,"name":"Wrong file","rpc":[]}'],
    ['1', '{"chainId":1,"chainId":1,"name":"Duplicate numeric key","rpc":[]}'],
    ['1', '{"chainId":1e0,"name":"Noncanonical numeric token","rpc":[]}'],
    ['1', '{"chainId":"1","name":"String numeric value","rpc":[]}'],
    ['1', '{"chainId":1,"name":"Missing RPC array"}'],
  ])('rejects malformed identity before producing any plan (%s)', (id, text) => {
    expect(normalizeSourceSnapshot(snapshot({ [id]: text }), hash)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('rejects a changed file, altered catalog and unrelated license', () => {
    const changedFile = snapshot();
    changedFile.files[0]!.text += 'tamper';
    const changedCatalog = snapshot();
    changedCatalog.catalog += '\n';
    for (const input of [changedFile, changedCatalog, snapshot({ '1': chain() }, { license: 'Permission is not established.\n' })]) {
      expect(normalizeSourceSnapshot(input, hash)).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
    }
  });

  it('rejects invalid hash-port results and returns fixed safe errors', () => {
    const result = normalizeSourceSnapshot(snapshot(), () => { throw new Error('private adapter error'); });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});

describe('conservative source URL policy', () => {
  const unsafe = [
    'http://rpc.example.org', 'wss://rpc.example.org', 'https://user:password@rpc.example.org',
    'https://rpc.example.org?key=', 'https://rpc.example.org?%61pi_key=synthetic',
    'https://rpc.example.org/v3/YOUR_API_KEY', 'https://rpc.example.org/${PROJECT_ID}',
    'https://rpc.example.org/%253Ctoken%253E', 'https://rpc.example.org/%25252525252525252524',
    'https://rpc.example.org/custom-path', 'https://rpc.example.org/%72pc',
    'https://127.0.0.1/rpc', 'https://0x7f000001/rpc', 'https://localhost/rpc',
    'https://node.internal/rpc', 'https://rpc.example.test', 'https://rpc.example.org:8443',
    'https://rpc.example.org/#fragment', 'https://rpc.example.org\\@localhost/rpc',
    `https://${'x'.repeat(63)}.${'y'.repeat(63)}.example.org/rpc`,
    'https://rpc.example.org/%', null,
  ];
  it.each(unsafe.map((value, index) => [index, value] as const))('rejects unsafe URL case %i without exposing its value', (_index, value) => {
    const reason = sourceUrlRejection(value);
    expect(reason).toMatch(/^[A-Z_]+$/);
  });
  it.each(['https://rpc.example.org', 'https://rpc.example.org/rpc', 'https://rpc.example.org/evm/', 'https://rpc.example.org/v2'])('admits a public-path candidate %s without claiming endpoint verification', (value) => {
    expect(sourceUrlRejection(value)).toBeNull();
  });
});
