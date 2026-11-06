import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublisherPolicy } from '../../src/ports/entity-reader.js';
import type { RegistryRecord } from '../../src/ports/source-snapshot.js';
import {
  createArkivEntityReader, createRabdiEntityReader,
  type ArkivReaderClient, type ArkivReaderPage,
} from '../../src/adapters/arkiv/reader.js';

// SIMULATED rows and an intercepted SDK HTTP transport; no network or signing is used.
const creator = `0x${'1'.repeat(40)}`;
const owner = `0x${'2'.repeat(40)}`;
const nowISO = '2030-01-01T00:00:00.000Z';
const policy: PublisherPolicy = {
  creator, owner, sourceRevision: 'a'.repeat(40), snapshotSha256: 'b'.repeat(64),
  licenseSha256: 'c'.repeat(64), allowedOrigins: ['https://rpc.example.com'],
};
const key = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const record = (n = 1): RegistryRecord => ({
  record_id: n.toString(16).padStart(64, '0'), chain_id: '1', chain_name: 'Synthetic Ethereum',
  rpc_host: 'https://rpc.example.com/', network_type: 'evm', status: 'candidate',
  source_url: `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/_data/chains/eip155-1.json`,
  source_commit: policy.sourceRevision,
  source_license: `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/LICENSE`,
  license_sha256: policy.licenseSha256, snapshot_sha256: policy.snapshotSha256,
  observed_at: '2029-12-31T23:00:00.000Z', measured_chain_id: '', importer_version: 'monolith-import-v1',
});
function row(n = 1): Record<string, unknown> {
  return {
    $key: key(n), $creator: creator, $owner: owner, $expiresAt: 2000n,
    $creationFlags: { raw: 1, readonly: true, permissionlessExtension: false },
    ...Object.fromEntries(Object.entries(record(n)).map(([name, value]) => [name, { type: 'str', value }])),
    content_expires_at: { type: 'str', value: '2030-01-02T00:00:00.000Z' },
  };
}
function page(entities: readonly unknown[] = [row()], count = BigInt(entities.length), blockNumber = 101n): ArkivReaderPage {
  return { entities, count, blockNumber, skipped: 0 };
}
function setup(pages: ArkivReaderPage[] = [page()]) {
  const pending = [...pages];
  const client = {
    getChainId: vi.fn(async () => 7794095),
    getBlockNumber: vi.fn(async () => 100n).mockResolvedValueOnce(100n).mockResolvedValue(110n),
    queryChainPage: vi.fn(async (_input: Parameters<ArkivReaderClient['queryChainPage']>[0]) => {
      const result = pending.shift();
      if (!result) throw new Error('Unexpected query in SIMULATED adapter test.');
      return result;
    }),
  } satisfies ArkivReaderClient;
  const reader = createArkivEntityReader({ client, policy, now: () => nowISO });
  return { client, reader };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Arkiv reader — SIMULATED storage boundary', () => {
  it('projects only SDK-free content, preserving independent expiry units and simulated evidence', async () => {
    const { reader, client } = setup();
    const result = await reader.readChain('1');
    expect(result).toEqual({ ok: true, value: {
      chainId: '1', blockNumber: '110', observedAt: nowISO, evidence: 'SIMULATED',
      entities: [{ entityKey: key(1), creator, owner, expiresAtBlock: '2000', readonly: true,
        permissionlessExtension: false, record: record(), contentExpiresAt: '2030-01-02T00:00:00.000Z' }],
    } });
    expect(client.getChainId).toHaveBeenCalledTimes(2);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
    expect(client.queryChainPage).toHaveBeenCalledExactlyOnceWith({ chainId: '1', policy, limit: 100 });
  });

  it('uses sorted key cursors and remaining counts across different observed blocks', async () => {
    const first = Array.from({ length: 100 }, (_, index) => row(index + 1));
    const { reader, client } = setup([page(first, 101n), page([row(101)], 1n, 102n)]);
    const result = await reader.readChain('1');
    expect(result.ok && result.value.entities).toHaveLength(101);
    expect(client.queryChainPage.mock.calls[1]?.[0]).toEqual({ chainId: '1', policy, afterKey: key(100), limit: 100 });
  });

  it('returns an empty current observation without inventing registry records', async () => {
    const { reader } = setup([page([])]);
    const result = await reader.readChain('1');
    expect(result.ok && result.value.entities).toEqual([]);
  });

  it.each(['01', '-1', '0x1', '1&wallet=private', '1'.repeat(79)])('rejects malformed public chain input %s without a network call', async (chainId) => {
    const { reader, client } = setup();
    expect(await reader.readChain(chainId)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(client.getChainId).not.toHaveBeenCalled();
  });

  it.each([
    ['$creator', `0x${'9'.repeat(40)}`], ['$owner', `0x${'9'.repeat(40)}`], ['$creator', undefined],
    ['$key', 'user-wallet'], ['$expiresAt', '2000'], ['$expiresAt', -1n],
    ['$creationFlags', undefined], ['$creationFlags', { raw: 0, readonly: false, permissionlessExtension: false }],
    ['$creationFlags', { raw: 3, readonly: true, permissionlessExtension: true }],
    ['$creationFlags', { raw: 5, readonly: true, permissionlessExtension: false }],
    ['rpc_host', { type: 'bytes', value: 'https://rpc.example.com/' }],
    ['source_commit', { type: 'str', value: 'f'.repeat(40) }],
    ['snapshot_sha256', { type: 'str', value: 'f'.repeat(64) }],
    ['license_sha256', { type: 'str', value: 'f'.repeat(64) }],
    ['chain_id', { type: 'str', value: '11155111' }],
    ['status', { type: 'str', value: 'verified' }],
    ['measured_chain_id', { type: 'str', value: '1' }],
    ['importer_version', { type: 'str', value: 'simulated-preflight' }],
    ['chain_name', { type: 'str', value: 'é'.repeat(65) }],
    ['chain_name', { type: 'str', value: 'hidden\u200bname' }],
    ['observed_at', { type: 'str', value: 'not-a-date' }],
    ['content_expires_at', { type: 'str', value: '2000' }],
  ])('rejects malformed or forged returned field %s despite server filters', async (field, value) => {
    const invalid = row();
    invalid[field as string] = value;
    const { reader } = setup([page([invalid])]);
    expect(await reader.readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });

  it.each([
    ['skipped typed matches', { ...page([]), skipped: 1, count: 1n }],
    ['negative skipped', { ...page(), skipped: -1 }],
    ['missing count', { ...page(), count: undefined }],
    ['impossible total', page([row()], 0n)],
    ['incomplete short page', page([row()], 2n)],
    ['oversize page', page(Array.from({ length: 101 }, (_, index) => row(index + 1)))],
    ['oversize scan budget', page([row()], 1001n)],
    ['negative page block', page([row()], 1n, -1n)],
    ['stale page block', page([row()], 1n, 99n)],
    ['excessive block span', page([row()], 1n, 229n)],
    ['missing page block', { ...page(), blockNumber: undefined }],
    ['duplicate keys', page([row(1), row(1)])],
    ['unsorted keys', page([row(2), row(1)])],
    ['conflicting record identity', page([row(1), { ...row(2), record_id: row(1)['record_id'] }])],
  ])('fails closed on %s', async (_name, invalid) => {
    const { reader } = setup([invalid as ArkivReaderPage]);
    expect(await reader.readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });

  it('rejects cursor count changes instead of publishing an incomplete accepted set', async () => {
    const first = Array.from({ length: 100 }, (_, index) => row(index + 1));
    const { reader } = setup([page(first, 101n), page([row(101)], 2n, 102n)]);
    expect(await reader.readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });

  it('rejects a repeated or earlier key across page boundaries', async () => {
    const first = Array.from({ length: 100 }, (_, index) => row(index + 1));
    const { reader } = setup([page(first, 101n), page([row(100)], 1n, 102n)]);
    expect(await reader.readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });

  it.each(['initial', 'final'])('rejects a %s wrong Arkiv network', async (when) => {
    const { client, reader } = setup();
    if (when === 'initial') client.getChainId.mockResolvedValueOnce(1);
    else client.getChainId.mockResolvedValueOnce(7794095).mockResolvedValueOnce(1);
    expect(await reader.readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });

  it('rejects a final block behind the query observation', async () => {
    const { client, reader } = setup();
    client.getBlockNumber.mockResolvedValueOnce(100n).mockResolvedValueOnce(100n);
    expect(await reader.readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });

  it('uses a fresh scan after failure, without a stale success fallback or raw errors', async () => {
    const { client, reader } = setup();
    expect((await reader.readChain('1')).ok).toBe(true);
    client.getChainId.mockRejectedValueOnce(new Error('secret private RPC body 192.168.0.1'));
    const result = await reader.readChain('1');
    expect(result).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toMatch(/secret|192\.168|private RPC/);
  });

  it('clones trusted operator policy before asynchronous requests', async () => {
    const { client } = setup();
    const mutableOrigins = [...policy.allowedOrigins];
    const mutablePolicy = { ...structuredClone(policy), allowedOrigins: mutableOrigins };
    const reader = createArkivEntityReader({ client, policy: mutablePolicy, now: () => nowISO });
    mutablePolicy.creator = `0x${'9'.repeat(40)}`;
    mutableOrigins.push('https://untrusted.example.com');
    expect((await reader.readChain('1')).ok).toBe(true);
    expect(client.queryChainPage.mock.calls[0]?.[0].policy).toEqual(policy);
  });

  it('bounds a hanging read and cannot start a later stage after its timeout', async () => {
    vi.useFakeTimers();
    const { client, reader } = setup();
    let complete: ((chain: number) => void) | undefined;
    client.getChainId.mockImplementationOnce(() => new Promise<number>((resolve) => { complete = resolve; }));
    const reading = reader.readChain('1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await reading).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
    complete?.(7794095);
    await Promise.resolve();
    expect(client.getBlockNumber).not.toHaveBeenCalled();
    expect(client.queryChainPage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function rpcRow(n: number): Record<string, unknown> {
  return {
    key: key(n), creator, owner, expiresAt: '0x7d0', creationFlags: 1,
    attributes: [
      { name: 'arkiv.schema', type: 'str', value: 'monolith.rpc.v1' },
      ...Object.entries(record(n)).map(([name, value]) => ({ name, type: 'str', value })),
      { name: 'content_expires_at', type: 'str', value: '2030-01-02T00:00:00.000Z' },
    ],
  };
}

describe('fixed Rabdi reader — intercepted real SDK protocol, SIMULATED evidence', () => {
  it('sends exact indexed trust filters and a key cursor, with bounded projections and no wallet RPC', async () => {
    const requests: Array<{ url: string; method: string; params: unknown[] }> = [];
    let pageIndex = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params?: unknown[] };
      requests.push({ url: input instanceof Request ? input.url : String(input), method: request.method, params: request.params ?? [] });
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x76edaf';
      else if (request.method === 'eth_blockNumber') result = '0x64';
      else if (request.method === 'arkiv_query') {
        result = pageIndex++ === 0
          ? { data: Array.from({ length: 100 }, (_, index) => rpcRow(index + 1)), blockNumber: '0x64', count: '0x65' }
          : { data: [rpcRow(101)], blockNumber: '0x64', count: '0x1' };
      } else throw new Error('Unexpected write or signing RPC in intercepted SDK test.');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
    }));
    const result = await createRabdiEntityReader({ policy }).readChain('1');
    expect(result.ok && result.value.entities).toHaveLength(101);
    // The production factory labels its real port OBSERVED_LIVE; these intercepted responses remain SIMULATED.
    const queries = requests.filter((request) => request.method === 'arkiv_query');
    expect(queries).toHaveLength(2);
    expect(new Set(requests.map((request) => request.url))).toEqual(new Set(['https://rpc.rabdi.db-chain.testnet.arkiv.network/']));
    const first = String(queries[0]?.params[0]);
    expect(first).toContain("chain_id = str('1')");
    expect(first).toContain(`source_commit = str('${policy.sourceRevision}')`);
    expect(first).toContain(`snapshot_sha256 = str('${policy.snapshotSha256}')`);
    expect(first).toContain(`$creator = addr(${creator})`);
    expect(first).toContain(`$owner = addr(${owner})`);
    expect(first).toContain('ORDER BY $key:key ASC');
    expect(String(queries[1]?.params[0])).toContain(`$key > key(${key(100)})`);
    expect(queries[0]?.params[1]).toMatchObject({ limit: '0x64', select: {
      key: true, creator: true, owner: true, expiresAt: true, creationFlags: true, count: true,
      attributes: { ...Object.fromEntries(Object.keys(record()).map((name) => [name, true])), 'arkiv.schema': true, content_expires_at: true },
    } });
    expect(requests.every((request) => ['eth_chainId', 'eth_blockNumber', 'arkiv_query'].includes(request.method))).toBe(true);
  });

  it.each(['missing creator', 'wrong schema field type'])('rejects an SDK row with %s', async (failure) => {
    const malformed = rpcRow(1);
    if (failure === 'missing creator') delete malformed['creator'];
    else malformed['attributes'] = (malformed['attributes'] as Array<{name: string; type: string; value: unknown}>).map((attribute) => attribute.name === 'rpc_host' ? { ...attribute, type: 'i32', value: 42 } : attribute);
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = request.method === 'eth_chainId' ? '0x76edaf' : request.method === 'eth_blockNumber' ? '0x64'
        : { data: [malformed], blockNumber: '0x64', count: '0x1' };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    }));
    expect(await createRabdiEntityReader({ policy }).readChain('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
  });
});
