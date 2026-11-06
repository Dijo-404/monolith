import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createQueryRegistry, type EntityObservation, type PublisherPolicy, type RegistryEntity } from '../../src/index.js';

// Invented clocks, catalog identity, addresses and destinations are SIMULATED.
const START = Date.parse('2030-01-01T00:00:00.000Z');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const policy: PublisherPolicy = {
  creator: `0x${'a'.repeat(40)}`, owner: `0x${'a'.repeat(40)}`,
  sourceRevision: 'b'.repeat(40), snapshotSha256: 'c'.repeat(64),
  licenseSha256: '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
  allowedOrigins: ['https://rpc.example.com'],
};

function harness(generationTtlMs?: number) {
  let time = START;
  const immutable = {
    chain_id: '1', chain_name: 'Synthetic Ethereum', rpc_host: 'https://rpc.example.com/',
    network_type: 'evm' as const, status: 'candidate' as const,
    source_url: `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/_data/chains/eip155-1.json`,
    source_commit: policy.sourceRevision,
    source_license: `https://github.com/ethereum-lists/chains/blob/${policy.sourceRevision}/LICENSE`,
    license_sha256: policy.licenseSha256, snapshot_sha256: policy.snapshotSha256,
    measured_chain_id: '' as const, importer_version: 'monolith-import-v1' as const,
  };
  const row: RegistryEntity = {
    entityKey: `0x${'d'.repeat(64)}`, creator: policy.creator, owner: policy.owner,
    expiresAtBlock: '200', readonly: true, permissionlessExtension: false,
    contentExpiresAt: new Date(START + 3_600_000).toISOString(),
    record: { record_id: hash(JSON.stringify(immutable)), ...immutable,
      observed_at: new Date(START - 1_000).toISOString() },
  };
  const observation: EntityObservation = {
    chainId: '1', blockNumber: '100', observedAt: new Date(time).toISOString(),
    evidence: 'SIMULATED', entities: [row],
  };
  const read = vi.fn(async () => {
    observation.observedAt = new Date(time).toISOString();
    return { ok: true as const, value: structuredClone(observation) };
  });
  const admit = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const query = createQueryRegistry({ reader: { readChain: read }, policy, hash,
    admission: { check: admit }, now: () => new Date(time).toISOString(),
    ...(generationTtlMs === undefined ? {} : { generationTtlMs }),
  });
  return { row, observation, read, admit, query, advance: (ms: number) => { time += ms; } };
}

describe('SIMULATED explicit registry generation policy', () => {
  it.each([undefined, 1, 120_000, 300_000])('preserves the default and accepts bounded opt-in %s', async (ttl) => {
    const h = harness(ttl);
    expect(await h.query.query('1')).toMatchObject({ ok: true, value: {
      generatedAt: new Date(START).toISOString(), expiresAt: new Date(START + (ttl ?? 30_000)).toISOString(),
    } });
    expect(h.read).toHaveBeenCalledTimes(1); expect(h.admit).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, 300_001, Number.NaN, Number.POSITIVE_INFINITY, '120000', null])(
    'rejects invalid generation configuration %s', (value) => {
      expect(() => harness(value as unknown as number)).toThrow('Registry limits are invalid.');
    },
  );

  it('never retimestamps a received generation, even after fresh storage and DNS validation', async () => {
    const h = harness(120_000);
    const first = await h.query.query('1'); expect(first.ok).toBe(true);
    h.advance(20_000);
    expect(await h.query.query('1')).toEqual(first);
    expect(h.read).toHaveBeenCalledTimes(2); expect(h.admit).toHaveBeenCalledTimes(2);
    h.advance(100_000);
    const replacement = await h.query.query('1');
    expect(replacement).toMatchObject({ ok: true, value: {
      generatedAt: new Date(START + 120_000).toISOString(), expiresAt: new Date(START + 240_000).toISOString(),
    } });
    expect(first).toMatchObject({ ok: true, value: { expiresAt: new Date(START + 120_000).toISOString() } });
  });

  it('clamps the explicit window to real content expiry and rejects that exact deadline', async () => {
    const h = harness(120_000);
    h.row.contentExpiresAt = new Date(START + 60_000).toISOString();
    expect(await h.query.query('1')).toMatchObject({ ok: true, value: { expiresAt: h.row.contentExpiresAt } });
    h.advance(60_000);
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_EXPIRED' } });
    expect(h.admit).toHaveBeenCalledTimes(1);
  });

  it('rechecks the current engine block before reusing an unexpired generation', async () => {
    const h = harness(120_000);
    expect(await h.query.query('1')).toMatchObject({ ok: true });
    h.advance(1_000); h.observation.blockNumber = '200';
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_EXPIRED' } });
    expect(h.read).toHaveBeenCalledTimes(2); expect(h.admit).toHaveBeenCalledTimes(1);
  });

  it('does not extend content that expires while DNS admission is pending', async () => {
    const h = harness(120_000);
    h.row.contentExpiresAt = new Date(START + 1_000).toISOString();
    h.admit.mockImplementation(async () => { h.advance(1_000); return { ok: true, value: undefined }; });
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_EXPIRED' } });
  });

  it.each(['publisher', 'source', 'chain'] as const)('keeps %s trust rejection before DNS under the longer policy', async (fault) => {
    const h = harness(120_000);
    if (fault === 'publisher') h.row.creator = `0x${'e'.repeat(40)}`;
    if (fault === 'source') h.row.record.source_commit = 'f'.repeat(40);
    if (fault === 'chain') h.observation.chainId = '10';
    expect(await h.query.query('1')).toMatchObject({ ok: false, error: { code: 'REGISTRY_UNTRUSTED' } });
    expect(h.admit).not.toHaveBeenCalled();
  });
});
