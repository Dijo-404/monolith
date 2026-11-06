import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as arkivSdk from '@arkiv-network/sdk';
import { normalizeSourceSnapshot, SOURCE_REPOSITORY } from '../../src/domain/source-policy.js';
import { importRegistry } from '../../src/application/import-registry.js';
import type { ImportJournal, JournalStore } from '../../src/ports/entity-writer.js';
import type { RegistryRecord, SourceSnapshot } from '../../src/ports/source-snapshot.js';
import {
  ARKIV_CHAIN_ID, createArkivEntityWriter, createRabdiEntityWriter,
  IMPORT_BATCH_GAS_LIMIT, IMPORT_GAS_PRICE_WEI, type ArkivWriterClient,
} from '../../src/adapters/arkiv/writer.js';

// Keep the real SDK implementations while recording their transport construction.
vi.mock('@arkiv-network/sdk', { spy: true });

// SIMULATED rows, receipts and intercepted SDK HTTP requests. No network or signing is used.
const publisher = `0x${'1'.repeat(40)}`;
const foreign = `0x${'2'.repeat(40)}`;
const entityKey = `0x${'a'.repeat(64)}`;
const txHash = `0x${'b'.repeat(64)}`;
const nowISO = '2030-01-01T00:00:00.000Z';
const revision = 'a'.repeat(40);

function candidate(id = 'a'.repeat(64)): RegistryRecord {
  return {
    record_id: id, chain_id: '1', chain_name: 'Ethereum Mainnet', rpc_host: 'https://ethereum.publicnode.com/',
    network_type: 'evm', status: 'candidate',
    source_url: `https://github.com/ethereum-lists/chains/blob/${revision}/_data/chains/eip155-1.json`,
    source_commit: revision,
    source_license: `https://github.com/ethereum-lists/chains/blob/${revision}/LICENSE`,
    license_sha256: 'b'.repeat(64), snapshot_sha256: 'c'.repeat(64),
    observed_at: '2026-11-06T12:00:00.000Z', measured_chain_id: '', importer_version: 'monolith-import-v1',
  };
}

function sourceSnapshot(): SourceSnapshot {
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  const license = readFileSync(new URL('../../src/adapters/source/LICENSE.ethereum-lists-chains', import.meta.url), 'utf8');
  const files = [
    { path: 'LICENSE', text: license },
    { path: 'README.md', text: 'Synthetic source fixture.\n' },
    { path: '_data/chains/eip155-1.json', text: JSON.stringify({ chainId: 1, name: 'Ethereum Mainnet', rpc: ['https://ethereum.publicnode.com/'] }) },
  ].map((file) => ({ ...file, byteLength: Buffer.byteLength(file.text), sha256: hash(file.text) }));
  const catalog = JSON.stringify({ sourceSha: revision, files: files.map((file) => ({ path: file.path, bytes: file.byteLength, sha256: file.sha256 })) }) + '\n';
  return {
    schemaVersion: 1, repository: SOURCE_REPOSITORY, revision, retrievedAt: '2026-11-06T12:00:00.000Z',
    snapshotSha256: hash(catalog), catalog, files,
    license: { url: `${SOURCE_REPOSITORY}/blob/${revision}/LICENSE`, sha256: hash(license), text: license },
  };
}

function row(record: RegistryRecord = candidate(), key = entityKey): Record<string, unknown> {
  return {
    $key: key, $creator: publisher, $owner: publisher, $expiresAt: 500n,
    $creationFlags: { readonly: true, permissionlessExtension: false, raw: 1 },
    content_expires_at: { type: 'str', value: '2030-01-02T00:00:00.000Z' },
    ...Object.fromEntries(Object.entries(record).map(([name, value]) => [name, { type: 'str', value }])),
  };
}

function setup(records = [candidate()]) {
  const rows = records.map((record, index) => row(record, `0x${String(index + 1).padStart(64, 'a')}`));
  const client = {
    getChainId: vi.fn(async () => ARKIV_CHAIN_ID),
    getBlockNumber: vi.fn(async () => 100n),
    getBalance: vi.fn(async () => 10n ** 18n),
    queryRecordIds: vi.fn(async () => ({ entities: rows, count: BigInt(rows.length), skipped: 0 })),
    readEntity: vi.fn(async (key: string) => rows.find((entry) => entry['$key'] === key)),
    getReceipt: vi.fn(async () => ({ status: 'success', from: publisher, to: '0x4400000000000000000000000000000000000044' })),
    executeBatch: vi.fn(async (_records: readonly RegistryRecord[], _hours: number, _deadline: string) =>
      ({ txHash, createdEntities: rows.map((entry) => entry['$key'] as string) })),
  } satisfies ArkivWriterClient;
  const writer = createArkivEntityWriter({ publisher, client, now: () => nowISO });
  return { client, writer, rows };
}

describe('Arkiv importer adapter — SIMULATED SDK boundary', () => {
  it('accepts actual source-normalizer output with exact pinned per-chain provenance', async () => {
    const normalized = normalizeSourceSnapshot(sourceSnapshot(), (text) => createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error('SIMULATED_SOURCE_FIXTURE_REJECTED');
    expect(normalized.value.records).toHaveLength(1);
    const record = normalized.value.records[0]!;
    expect(record.source_url).toBe(`https://github.com/ethereum-lists/chains/blob/${revision}/_data/chains/eip155-1.json`);
    const { writer, client } = setup(normalized.value.records);
    expect((await writer.lookup(normalized.value.records))[0]?.recordId).toBe(record.record_id);
    expect((await writer.writeBatch(normalized.value.records, 24))[0]?.transactionHash).toBe(txHash);
    expect(client.executeBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps actual expiry blocks and safe projection with no invented transaction on query', async () => {
    const { client, writer, rows } = setup();
    rows[0]!['private_extra'] = 'must not leave the boundary';
    expect(await writer.lookup([candidate()])).toEqual([{
      recordId: candidate().record_id, entityKey: rows[0]!['$key'], transactionHash: null,
      creator: publisher, owner: publisher, expiresAtBlock: '500', contentExpiresAt: '2030-01-02T00:00:00.000Z',
    }]);
    expect(client.queryRecordIds).toHaveBeenCalledWith([candidate().record_id], publisher, 0, 20);
    expect(writer.evidence).toBe('SIMULATED');
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it('reuses immutable content while preserving the old source acquisition observation', async () => {
    const { writer } = setup();
    const later = { ...candidate(), observed_at: '2026-11-07T00:00:00.000Z' };
    expect((await writer.lookup([later]))[0]?.recordId).toBe(later.record_id);
  });

  it.each([
    ['$creator', foreign], ['$owner', foreign], ['$expiresAt', '500'],
    ['$creationFlags', { readonly: false, permissionlessExtension: false, raw: 0 }],
    ['$key', '0xshort'], ['rpc_host', { type: 'str', value: 'https://attacker.example/' }],
    ['chain_id', { type: 'str', value: '2' }], ['status', { type: 'str', value: 'verified' }],
    ['source_commit', { type: 'str', value: 'd'.repeat(40) }],
    ['source_license', { type: 'str', value: 'https://attacker.example/LICENSE' }],
    ['snapshot_sha256', { type: 'str', value: 'd'.repeat(64) }],
    ['observed_at', { type: 'str', value: '2040-01-01T00:00:00.000Z' }],
    ['observed_at', { type: 'str', value: 'not a timestamp' }],
    ['chain_name', { type: 'str', value: 'é'.repeat(65) }],
    ['measured_chain_id', { type: 'str', value: '1' }],
    ['chain_name', { type: 'bytes', value: 'Ethereum Mainnet' }],
  ])('rejects untrusted or changed row %s without writing', async (field, value) => {
    const { writer, rows, client } = setup();
    rows[0]![field as string] = value;
    await expect(writer.lookup([candidate()])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it('checks expiry against a fresh block after the query', async () => {
    const { writer, client } = setup();
    client.getBlockNumber.mockResolvedValue(500n);
    expect(await writer.lookup([candidate()])).toEqual([]);
  });

  it('fails closed for a block-live match at its separate ISO deadline', async () => {
    const { writer, rows } = setup();
    rows[0]!['content_expires_at'] = { type: 'str', value: nowISO };
    await expect(writer.lookup([candidate()])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
    rows[0]!['content_expires_at'] = { type: 'str', value: '500' };
    await expect(writer.lookup([candidate()])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
  });

  it('still permits absence after actual block expiry with an expired ISO deadline', async () => {
    const { writer, rows, client } = setup();
    rows[0]!['content_expires_at'] = { type: 'str', value: nowISO };
    client.getBlockNumber.mockResolvedValue(500n);
    expect(await writer.lookup([candidate()])).toEqual([]);
  });

  it.each([
    [nowISO, false], [nowISO, true],
    ['2029-12-31T23:59:59.000Z', false], ['2029-12-31T23:59:59.000Z', true],
  ])('blocks a fresh-journal duplicate at deadline %s with refresh=%s', async (deadline, refreshExpired) => {
    const normalized = normalizeSourceSnapshot(sourceSnapshot(), (text) => createHash('sha256').update(text, 'utf8').digest('hex'));
    if (!normalized.ok) throw new Error('SIMULATED_SOURCE_FIXTURE_REJECTED');
    const plan = normalized.value;
    const { writer, rows, client } = setup(plan.records);
    rows[0]!['content_expires_at'] = { type: 'str', value: deadline };
    let saved: ImportJournal | null = null;
    const journal: JournalStore = {
      load: async () => saved,
      save: vi.fn(async (value) => { saved = structuredClone(value); }),
    };
    const options = { maxNetworks: 1, batchSize: 1, lifetimeHours: 24, refreshExpired };
    // If a duplicate is attempted, simulate a successful fresh creation/readback.
    client.executeBatch.mockImplementation(async (_records, _hours, newDeadline) => {
      rows[0]!['content_expires_at'] = { type: 'str', value: newDeadline };
      return { txHash, createdEntities: rows.map((entry) => entry['$key'] as string) };
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await importRegistry(plan, writer, journal, options, nowISO);
      expect(result).toMatchObject({
        status: 'BLOCKED', reason: 'LOOKUP_FAILED',
        counts: { written: 0, reused: 0, transactions: 0, uncertain: 0 },
      });
    }
    expect(client.executeBatch).not.toHaveBeenCalled();
    expect(client.getReceipt).not.toHaveBeenCalled();
    expect(journal.save).not.toHaveBeenCalled();
    expect(saved).toBeNull();
  });

  it('rejects ambiguous duplicate IDs even when total count fits the requested batch', async () => {
    const records = [candidate(), candidate('d'.repeat(64))];
    const { writer, rows } = setup(records);
    rows[1]!['record_id'] = { type: 'str', value: records[0]!.record_id };
    await expect(writer.lookup(records)).rejects.toThrow('ARKIV_LOOKUP_FAILED');
  });

  it('never treats skipped rows or absent pagination matches as proof of absence', async () => {
    const { writer, client } = setup();
    client.queryRecordIds.mockResolvedValue({ entities: [], count: 1n, skipped: 1 });
    await expect(writer.lookup([candidate()])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
    client.queryRecordIds.mockResolvedValue({ entities: [], count: 1n, skipped: 0 });
    await expect(writer.lookup([candidate()])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
  });

  it('finishes empty exact-ID query without reporting a successful import', async () => {
    const { writer, client } = setup();
    client.queryRecordIds.mockResolvedValue({ entities: [], count: 0n, skipped: 0 });
    expect(await writer.lookup([candidate()])).toEqual([]);
  });

  it('sanitizes SDK exceptions rather than exposing upstream content', async () => {
    const { writer, client } = setup();
    client.queryRecordIds.mockRejectedValue(new Error('https://provider.example/?apiKey=secret'));
    await expect(writer.lookup([candidate()])).rejects.toThrow(/^ARKIV_LOOKUP_FAILED$/);
    client.executeBatch.mockRejectedValue(new Error('signed transaction private payload'));
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow(/^ARKIV_WRITE_UNCERTAIN$/);
    expect(client.executeBatch).toHaveBeenCalledTimes(1);
  });

  it('caps total reserved test fees even after uncertain broadcasts', async () => {
    const { writer, client } = setup();
    client.executeBatch.mockRejectedValue(new Error('uncertain broadcast'));
    for (let index = 0; index < 63; index++) {
      await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    }
    expect(client.executeBatch).toHaveBeenCalledTimes(62);
    expect(IMPORT_BATCH_GAS_LIMIT * IMPORT_GAS_PRICE_WEI * 62n).toBeLessThan(10n ** 18n);
  });

  it('pins Rabdi before any query or write', async () => {
    const { writer, client } = setup();
    client.getChainId.mockResolvedValue(1);
    await expect(writer.lookup([candidate()])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    expect(client.queryRecordIds).not.toHaveBeenCalled();
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it('writes at most ten ordered readonly candidates and validates receipt plus actual readback', async () => {
    const records = [candidate(), candidate('d'.repeat(64))];
    const { writer, client, rows } = setup(records);
    expect(await writer.writeBatch(records, 24)).toEqual(rows.map((entry, index) => ({
      recordId: records[index]!.record_id, entityKey: entry['$key'], transactionHash: txHash,
      creator: publisher, owner: publisher, expiresAtBlock: '500', contentExpiresAt: '2030-01-02T00:00:00.000Z',
    })));
    expect(client.executeBatch).toHaveBeenCalledTimes(1);
    expect(client.executeBatch).toHaveBeenCalledWith(records, 24, '2030-01-02T00:00:00.000Z');
    expect(client.getReceipt).toHaveBeenCalledWith(txHash);
    expect(client.readEntity).toHaveBeenCalledTimes(2);
    expect(IMPORT_BATCH_GAS_LIMIT * IMPORT_GAS_PRICE_WEI * 10n).toBeLessThan(10n ** 18n);
  });

  it.each([
    { status: 'reverted', from: publisher, to: '0x4400000000000000000000000000000000000044' },
    { status: 'success', from: foreign, to: '0x4400000000000000000000000000000000000044' },
    { status: 'success', from: publisher, to: foreign },
  ])('leaves invalid receipt uncertain without retries', async (receipt) => {
    const { writer, client } = setup();
    client.getReceipt.mockResolvedValue(receipt);
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    expect(client.executeBatch).toHaveBeenCalledTimes(1);
    expect(client.readEntity).not.toHaveBeenCalled();
  });

  it('rejects mismatched created-key mapping and post-write content', async () => {
    const { writer, client, rows } = setup();
    client.readEntity.mockResolvedValue(row());
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    client.readEntity.mockResolvedValue(rows[0]);
    rows[0]!['rpc_host'] = { type: 'str', value: 'https://other.example/' };
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    expect(client.executeBatch).toHaveBeenCalledTimes(2);
  });

  it('refuses an unfunded publisher before signing', async () => {
    const { writer, client } = setup();
    client.getBalance.mockResolvedValue(0n);
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it('requires a signing capability; read-only clients still support exact lookup', async () => {
    const { client } = setup();
    const readonlyClient: ArkivWriterClient = { ...client };
    delete readonlyClient.executeBatch;
    const writer = createArkivEntityWriter({ publisher, client: readonlyClient, now: () => nowISO });
    expect((await writer.lookup([candidate()])).length).toBe(1);
    await expect(writer.writeBatch([candidate()], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it('validates signers locally before a real factory can make any network call', () => {
    expect(() => createRabdiEntityWriter({ publisher: 'invalid' })).toThrow('INVALID_IMPORT_PUBLISHER');
    expect(() => createRabdiEntityWriter({ publisher, privateKey: 'secret' })).toThrow('INVALID_IMPORT_SIGNER');
    expect(() => createRabdiEntityWriter({ publisher, privateKey: `0x${'0'.repeat(64)}` })).toThrow('INVALID_IMPORT_SIGNER');
    // A synthetic test key is never used to construct a transaction or contact a network.
    expect(() => createRabdiEntityWriter({ publisher, privateKey: `0x${'1'.repeat(64)}` })).toThrow('IMPORT_SIGNER_MISMATCH');
  });

  it.each([
    { status: 'verified' }, { rpc_host: 'http://unsafe.example/' },
    { rpc_host: 'https://rpc.example/?apikey=secret' }, { chain_name: 'é'.repeat(65) },
    { source_url: 'https://whitechain.example/' }, { source_license: 'https://other.example/LICENSE' },
  ])('rejects malformed candidate before SDK activity', async (change) => {
    const { writer, client } = setup();
    await expect(writer.writeBatch([{ ...candidate(), ...change } as RegistryRecord], 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    expect(client.getChainId).not.toHaveBeenCalled();
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it.each([
    'https://github.com/ethereum-lists/chains',
    `https://github.com/ethereum-lists/chains/blob/${revision}/_data/chains/eip155-2.json`,
    `https://github.com/ethereum-lists/chains/blob/${'b'.repeat(40)}/_data/chains/eip155-1.json`,
  ])('rejects source provenance that does not pin this exact chain record', async (sourceUrl) => {
    const { writer, client } = setup();
    await expect(writer.lookup([{ ...candidate(), source_url: sourceUrl }])).rejects.toThrow('ARKIV_LOOKUP_FAILED');
    expect(client.getChainId).not.toHaveBeenCalled();
    expect(client.queryRecordIds).not.toHaveBeenCalled();
  });

  it('rejects oversize, empty, duplicate or invalid lifetime batches before SDK activity', async () => {
    const { writer, client } = setup();
    for (const records of [[], Array.from({ length: 11 }, () => candidate()), [candidate(), candidate()]]) {
      await expect(writer.writeBatch(records, 24)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    }
    for (const hours of [0, 0.5, 73, Infinity]) {
      await expect(writer.writeBatch([candidate()], hours)).rejects.toThrow('ARKIV_WRITE_UNCERTAIN');
    }
    expect(client.getChainId).not.toHaveBeenCalled();
    expect(client.executeBatch).not.toHaveBeenCalled();
  });
});


// Publicly known fixture scalar 1, solely for constructing an offline wallet client.
// No transaction is constructed or signed with this fixture.
const fixturePrivateKey = `0x${'0'.repeat(63)}1`;
const fixturePublisher = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const rabdiRpcUrl = 'https://rpc.rabdi.db-chain.testnet.arkiv.network/';
const redirectStatuses = [301, 302, 303, 307, 308] as const;

afterEach(() => vi.unstubAllGlobals());

describe('Rabdi importer — intercepted real SDK HTTP transports, SIMULATED evidence', () => {
  it.each(['public', 'wallet'] as const)('rejects redirects in the effective %s transport without retrying', async (kind) => {
    const publicFactory = vi.mocked(arkivSdk.createPublicClient);
    const walletFactory = vi.mocked(arkivSdk.createWalletClient);
    createRabdiEntityWriter({ publisher: fixturePublisher, privateKey: fixturePrivateKey });
    const settings = kind === 'public' ? publicFactory.mock.calls[0]?.[0] : walletFactory.mock.calls[0]?.[0];
    if (!settings?.transport) throw new Error('Missing configured SDK transport.');
    const transport = settings.transport({ chain: settings.chain, pollingInterval: 2_000 });
    for (const status of redirectStatuses) {
      const requests: Request[] = [];
      const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return new Response('synthetic-private-provider-body', {
          status, headers: { location: 'https://redirect.example/?private=synthetic-secret' },
        });
      });
      vi.stubGlobal('fetch', fetch);
      await expect(transport.request({ method: 'eth_chainId' })).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(rabdiRpcUrl);
      expect(requests[0]?.redirect).toBe('error');
    }
  });

  it.each(['currentBlock', 'lookup'] as const)('sanitizes redirect failure through %s without retry or fallback', async (operation) => {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      throw new TypeError('synthetic-private-provider-body https://redirect.example/?private=synthetic-secret');
    }));
    const writer = createRabdiEntityWriter({ publisher });
    const pending = operation === 'currentBlock' ? writer.currentBlock() : writer.lookup([candidate()]);
    await expect(pending).rejects.toThrow(operation === 'currentBlock' ? /^ARKIV_BLOCK_UNAVAILABLE$/ : /^ARKIV_LOOKUP_FAILED$/);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(rabdiRpcUrl);
    expect(requests[0]?.redirect).toBe('error');
  });

  it('retains key-free successful chain-pinned reads with redirect denial', async () => {
    const walletFactory = vi.mocked(arkivSdk.createWalletClient);
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const rpc = JSON.parse(await request.text()) as { id: number; method: string };
      if (!['eth_chainId', 'eth_blockNumber'].includes(rpc.method)) throw new Error('Unexpected SDK RPC.');
      return Response.json({ jsonrpc: '2.0', id: rpc.id,
        result: rpc.method === 'eth_chainId' ? `0x${ARKIV_CHAIN_ID.toString(16)}` : '0x64' });
    }));
    const writer = createRabdiEntityWriter({ publisher });
    await expect(writer.currentBlock()).resolves.toBe(100n);
    expect(walletFactory).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.url === rabdiRpcUrl && request.redirect === 'error')).toBe(true);
  });
});
