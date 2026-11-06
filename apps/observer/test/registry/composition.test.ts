import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makeError } from '@monolith/shared';
import type { EntityObservation, EntityReader, PublisherPolicy, RegistryEntity } from '@monolith/registry';
import { createConfiguredRegistry, createRegistryDnsAdmission, parseRegistryConfig } from '../../src/composition/registry.js';

const NOW = '2030-01-01T00:00:00.000Z';
const POLICY: PublisherPolicy = {
  creator: `0x${'a'.repeat(40)}`, owner: `0x${'a'.repeat(40)}`, sourceRevision: 'b'.repeat(40),
  snapshotSha256: 'c'.repeat(64), licenseSha256: '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
  allowedOrigins: ['https://rpc.example.org'],
};
const config = (value: unknown = POLICY) => ({ MONOLITH_REGISTRY_CONFIG: JSON.stringify(value) });
const immutable = {
  chain_id: '1', chain_name: 'Synthetic chain', rpc_host: 'https://rpc.example.org/', network_type: 'evm' as const,
  status: 'candidate' as const,
  source_url: `https://github.com/ethereum-lists/chains/blob/${POLICY.sourceRevision}/_data/chains/eip155-1.json`,
  source_commit: POLICY.sourceRevision,
  source_license: `https://github.com/ethereum-lists/chains/blob/${POLICY.sourceRevision}/LICENSE`,
  license_sha256: POLICY.licenseSha256, snapshot_sha256: POLICY.snapshotSha256,
  measured_chain_id: '' as const, importer_version: 'monolith-import-v1' as const,
};
const entity: RegistryEntity = {
  entityKey: `0x${'d'.repeat(64)}`, creator: POLICY.creator, owner: POLICY.owner,
  readonly: true, permissionlessExtension: false, expiresAtBlock: '200', contentExpiresAt: '2030-01-01T01:00:00.000Z',
  record: { record_id: createHash('sha256').update(JSON.stringify(immutable)).digest('hex'), ...immutable,
    observed_at: '2029-12-31T23:00:00.000Z' },
};
const observed: EntityObservation = { chainId: '1', blockNumber: '100', observedAt: NOW, evidence: 'SIMULATED', entities: [entity] };
const publicAnswers = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];

describe('registry composition and current DNS admission (SIMULATED)', () => {
  it('defaults off and projects only the exact public operator policy', async () => {
    expect(parseRegistryConfig({ UNRELATED_PRIVATE_KEY: 'never read' })).toBeUndefined();
    expect(parseRegistryConfig({ MONOLITH_REGISTRY_CONFIG: '' })).toBeUndefined();
    expect(parseRegistryConfig(config())).toEqual(POLICY);
    expect(Object.isFrozen(parseRegistryConfig(config())?.allowedOrigins)).toBe(true);
    const reader: EntityReader = { readChain: vi.fn() };
    expect(await createConfiguredRegistry({}, { reader }).query('1')).toEqual({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
    expect(reader.readChain).not.toHaveBeenCalled();
  });

  it.each([
    null, [], {}, { ...POLICY, privateKey: 'secret' }, { ...POLICY, creator: 'secret' },
    { ...POLICY, sourceRevision: 'no' }, { ...POLICY, snapshotSha256: 'secret' },
    { ...POLICY, licenseSha256: 'f'.repeat(64) }, { ...POLICY, allowedOrigins: [] },
    { ...POLICY, allowedOrigins: ['https://rpc.example.org/'] },
    { ...POLICY, allowedOrigins: ['https://rpc.example.org/path'] },
    { ...POLICY, allowedOrigins: ['https://rpc.example.org?key=secret'] },
    { ...POLICY, allowedOrigins: ['http://rpc.example.org'] },
    { ...POLICY, allowedOrigins: ['https://user:secret@rpc.example.org'] },
    { ...POLICY, allowedOrigins: ['https://127.0.0.1'] },
    { ...POLICY, allowedOrigins: ['https://rpc.example.org', 'https://rpc.example.org'] },
  ])('rejects invalid configuration without echoing its contents %#', (value) => {
    expect(() => parseRegistryConfig(config(value))).toThrowError(/^Registry configuration is invalid\.$/);
  });

  it('bounds malformed/oversize JSON and does not expose parser text', () => {
    expect(() => parseRegistryConfig({ MONOLITH_REGISTRY_CONFIG: '{secret' })).toThrowError(/^Registry configuration is invalid\.$/);
    expect(() => parseRegistryConfig({ MONOLITH_REGISTRY_CONFIG: ' '.repeat(32_769) })).toThrowError(/^Registry configuration is invalid\.$/);
  });

  it('accepts checked global A and AAAA answers without making an endpoint request', async () => {
    const resolve = vi.fn(async () => publicAnswers);
    const admission = createRegistryDnsAdmission({ resolve });
    expect(await admission.check('https://rpc.example.org/')).toEqual({ ok: true, value: undefined });
    expect(resolve).toHaveBeenCalledExactlyOnceWith('rpc.example.org', expect.any(AbortSignal));
  });

  it.each([
    [{ address: '127.0.0.1', family: 4 }], [{ address: '10.1.2.3', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }], [{ address: '192.0.2.1', family: 4 }],
    [{ address: '::1', family: 6 }], [{ address: '::ffff:8.8.8.8', family: 6 }],
    [{ address: '2001:db8::1', family: 6 }], [{ address: '8.8.8.8', family: 6 }],
    [{ address: 'not an IP', family: 4 }], [{ address: '8.8.8.8', family: 7 }],
    [publicAnswers[0]!, { address: 'fc00::1', family: 6 }], [], Array(65).fill(publicAnswers[0]),
  ])('rejects unsafe, mixed or incomplete DNS results %#', async (answers) => {
    const resolve = vi.fn(async () => answers);
    expect(await createRegistryDnsAdmission({ resolve }).check('https://rpc.example.org/')).toEqual({ ok: false, error: makeError('ENDPOINT_REJECTED') });
  });

  it('fails before DNS on a credential-bearing, local or non-HTTPS URL', async () => {
    const resolve = vi.fn(async () => publicAnswers);
    for (const url of ['http://rpc.example.org', 'https://127.0.0.1/', 'https://local.internal/', 'https://user:secret@rpc.example.org/']) {
      expect((await createRegistryDnsAdmission({ resolve }).check(url)).ok).toBe(false);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('sanitizes resolver errors and cancels a hanging DNS operation', async () => {
    const resolve = vi.fn(async () => { throw new Error('private IP and secret URL'); });
    expect(await createRegistryDnsAdmission({ resolve }).check('https://rpc.example.org/')).toEqual({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
    let signal: AbortSignal | undefined;
    const hanging = vi.fn((_hostname: string, input?: AbortSignal) => {
      signal = input;
      return new Promise<never>(() => {});
    });
    expect(await createRegistryDnsAdmission({ resolve: hanging, timeoutMs: 5 }).check('https://rpc.example.org/'))
      .toEqual({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });
    expect(signal?.aborted).toBe(true);
  });

  it('rechecks backing storage and DNS per query and refuses a rebound name without stale fallback', async () => {
    const readChain = vi.fn(async () => ({ ok: true as const, value: structuredClone(observed) }));
    const resolve = vi.fn(async () => publicAnswers);
    const query = createConfiguredRegistry(config(), { reader: { readChain }, resolve, now: () => NOW });
    const first = await query.query('1');
    expect(first.ok).toBe(true);
    const second = await query.query('1');
    expect(second).toEqual(first);
    expect(readChain).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(2);
    resolve.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    expect((await query.query('1')).ok).toBe(false);
    expect(readChain).toHaveBeenCalledTimes(3);
    expect(resolve).toHaveBeenCalledTimes(3);
    readChain.mockResolvedValueOnce({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') } as never);
    expect((await query.query('1')).ok).toBe(false);
  });

  it('rejects an unapproved origin before performing DNS inspection', async () => {
    const resolve = vi.fn(async () => publicAnswers);
    const readChain = vi.fn(async () => ({ ok: true as const, value: structuredClone(observed) }));
    const query = createConfiguredRegistry(config({ ...POLICY, allowedOrigins: ['https://other.example.org'] }),
      { reader: { readChain }, resolve, now: () => NOW });
    expect((await query.query('1')).ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });
});
