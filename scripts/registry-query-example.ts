import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import type { EntityObservation, EntityReader, ImportManifest, RegistryRecord } from '@monolith/registry';
import { createRabdiEntityReader } from '@monolith/registry/reader';

// Accepted public import references are trust anchors, never query-response fallbacks.
const referenceDirectory = new URL('../packages/registry/test/importer/observed-live-2026-11-06/', import.meta.url);
const referenceHashes = {
  'import-full100.json': '38728e8d02c845ab545b0bf83e450b04256bda5bb00b49cf09cb7e080cc85bb6',
  'selected-records.json': '4fed832c98adfe2f30d43e84cc69042656a7a0d63ae527bdb7c6a382f204ffeb',
  'source-catalog.json': '2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952',
  'LICENSE.ethereum-lists-chains': '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
} as const;
const usage = 'pnpm exec tsx scripts/registry-query-example.ts --chain-id <accepted decimal chain ID> | --help | --self-test';
const decimal = /^(0|[1-9][0-9]*)$/;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
class QueryFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'REFERENCE_CHANGED' | 'REGISTRY_UNAVAILABLE'
    | 'REGISTRY_UNTRUSTED' | 'REGISTRY_EXPIRED') { super(code); }
}
function fail(code: QueryFailure['code']): never { throw new QueryFailure(code); }

export interface AcceptedReferences {
  manifest: ImportManifest;
  records: readonly RegistryRecord[];
}

/** Pin exact reviewed bytes; an operator must review a new import before changing these pins. */
export async function loadAcceptedReferences(): Promise<AcceptedReferences> {
  const files = new Map<string, string>();
  for (const [name, expected] of Object.entries(referenceHashes)) {
    const bytes = await readFile(new URL(name, referenceDirectory));
    if (sha256(bytes) !== expected) fail('REFERENCE_CHANGED');
    files.set(name, bytes.toString('utf8'));
  }
  // The hashes above bind the complete JSON shapes, not just these TypeScript casts.
  const manifest = JSON.parse(files.get('import-full100.json')!) as ImportManifest;
  const records = JSON.parse(files.get('selected-records.json')!) as RegistryRecord[];
  if (manifest.status !== 'COMPLETE' || manifest.storageEvidence !== 'OBSERVED_LIVE'
    || manifest.counts.selectedRecords !== records.length || manifest.records.length !== records.length
    || new Set(records.map((record) => record.chain_id)).size !== manifest.counts.selectedNetworks) fail('REFERENCE_CHANGED');
  return { manifest, records };
}

/** Pure storage-result check; no origin admission, DNS lookup or target RPC probe is implied. */
export function verifyObservation(
  observation: EntityObservation, chainId: string, references: AcceptedReferences,
  startedAt: string, completedAt: string,
): void {
  const expected = references.records.filter((record) => record.chain_id === chainId);
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  const observed = Date.parse(observation.observedAt);
  if (expected.length === 0 || observation.chainId !== chainId || observation.evidence !== 'OBSERVED_LIVE'
    || typeof observation.blockNumber !== 'string' || !decimal.test(observation.blockNumber)
    || !Number.isFinite(started) || !Number.isFinite(completed)
    || !Number.isFinite(observed) || observed < started || observed > completed
    || completed < started || completed - started > 20_000
    || observation.entities.length !== expected.length) fail('REGISTRY_UNTRUSTED');
  const seen = new Set<string>();
  for (const entity of observation.entities) {
    const record = expected.find((item) => item.record_id === entity.record.record_id);
    const stored = references.manifest.records.find((item) => item.recordId === entity.record.record_id);
    if (!record || !stored || seen.has(record.record_id)
      || Object.keys(entity.record).length !== Object.keys(record).length
      || Object.entries(record).some(([name, value]) => !Object.hasOwn(entity.record, name)
        || entity.record[name as keyof RegistryRecord] !== value)
      || entity.entityKey.toLowerCase() !== stored.entityKey.toLowerCase()
      || entity.creator.toLowerCase() !== references.manifest.publisher.toLowerCase()
      || entity.owner.toLowerCase() !== references.manifest.publisher.toLowerCase()
      || entity.readonly !== true || entity.permissionlessExtension !== false
      || entity.expiresAtBlock !== stored.expiresAtBlock || entity.contentExpiresAt !== stored.contentExpiresAt) fail('REGISTRY_UNTRUSTED');
    if (BigInt(entity.expiresAtBlock) <= BigInt(observation.blockNumber)
      || Date.parse(entity.contentExpiresAt) <= completed) fail('REGISTRY_EXPIRED');
    seen.add(record.record_id);
  }
}

/** An injectable reader permits offline boundary checks; the executable always uses real Rabdi. */
export async function queryAcceptedChain(
  reader: EntityReader, chainId: string, references: AcceptedReferences,
  now: () => string = () => new Date().toISOString(),
) {
  if (!decimal.test(chainId) || !references.records.some((record) => record.chain_id === chainId)) fail('INVALID_INPUT');
  const startedAt = now();
  const result = await reader.readChain(chainId);
  if (!result.ok) fail(result.error.code === 'REGISTRY_UNTRUSTED' ? 'REGISTRY_UNTRUSTED'
    : result.error.code === 'REGISTRY_EXPIRED' ? 'REGISTRY_EXPIRED' : 'REGISTRY_UNAVAILABLE');
  const completedAt = now();
  verifyObservation(result.value, chainId, references, startedAt, completedAt);
  return {
    schemaVersion: 1, evidence: 'OBSERVED_LIVE', sourceTask: 'MN-015',
    operation: 'independent-public-storage-query', startedAt, completedAt,
    network: { name: 'Arkiv Rabdi', chainId: '7794095', rpcUrl: 'https://rpc.rabdi.db-chain.testnet.arkiv.network' },
    query: { chainId, creator: references.manifest.publisher, owner: references.manifest.publisher,
      sourceRevision: references.manifest.source.revision, snapshotSha256: references.manifest.source.snapshotSha256 },
    references: { hashes: referenceHashes, source: references.manifest.source,
      acceptedSelectedNetworks: references.manifest.counts.selectedNetworks,
      acceptedSelectedRecords: references.manifest.counts.selectedRecords },
    observedAt: result.value.observedAt, blockNumber: result.value.blockNumber,
    found: result.value.entities.length,
    entities: result.value.entities.map((entity) => ({
      entityKey: entity.entityKey, creator: entity.creator, owner: entity.owner,
      readonly: entity.readonly, permissionlessExtension: entity.permissionlessExtension,
      expiresAtBlock: entity.expiresAtBlock, contentExpiresAt: entity.contentExpiresAt,
      record: Object.fromEntries(Object.keys(references.records.find((record) => record.record_id === entity.record.record_id)!)
        .map((name) => [name, entity.record[name as keyof RegistryRecord]])),
    })),
    independence: { monolithApiUsed: false, dashboardCacheUsed: false, signingKeyUsed: false, candidateRpcContacted: false },
    endpointValidation: 'UNTESTED',
    limits: 'Public storage discovery only. The Arkiv node sees this direct metadata query. Source strings are publisher metadata; this command does not re-fetch upstream Git. No DNS admission, endpoint health, protected chain probe, anonymity or sponsor eligibility is established. No stale fallback; expired or unavailable records fail.',
  };
}

/** Offline CLI trust-boundary checks; never construct a Rabdi client or upgrade mocks to live proof. */
async function selfTest(): Promise<void> {
  const references = await loadAcceptedReferences();
  const record = references.records.find((item) => item.chain_id === '10')!;
  const stored = references.manifest.records.find((item) => item.recordId === record.record_id)!;
  const startedAt = '2026-11-06T15:30:00.000Z';
  const completedAt = '2026-11-06T15:30:01.000Z';
  const baseline: EntityObservation = {
    chainId: '10', blockNumber: '295000', observedAt: '2026-11-06T15:30:00.500Z', evidence: 'OBSERVED_LIVE',
    entities: [{ entityKey: stored.entityKey, creator: stored.creator, owner: stored.owner,
      expiresAtBlock: stored.expiresAtBlock, contentExpiresAt: stored.contentExpiresAt,
      readonly: true, permissionlessExtension: false, record: structuredClone(record) }],
  };
  let passed = 0;
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Offline self-test forbids networking.'); };
  const rejects = (mutate: (observation: EntityObservation) => void, expected = 'REGISTRY_UNTRUSTED') => {
    const observation = structuredClone(baseline);
    mutate(observation);
    assert.throws(() => verifyObservation(observation, '10', references, startedAt, completedAt),
      (error: unknown) => error instanceof QueryFailure && error.code === expected);
    passed++;
  };
  const readerFor = (observation: EntityObservation): EntityReader => ({
    readChain: async () => ({ ok: true, value: observation }),
  });
  const clock = () => { let index = 0; return () => [startedAt, completedAt][index++]!; };
  try {
    verifyObservation(baseline, '10', references, startedAt, completedAt); passed++;
    rejects((value) => { value.entities[0]!.creator = `0x${'12'.repeat(20)}`; });
    rejects((value) => { value.entities[0]!.owner = `0x${'12'.repeat(20)}`; });
    rejects((value) => { value.entities[0]!.entityKey = `0x${'12'.repeat(32)}`; });
    rejects((value) => { value.entities[0]!.record.rpc_host = 'https://unapproved.example/'; });
    rejects((value) => { value.entities[0]!.record.source_commit = '1'.repeat(40); });
    rejects((value) => { value.entities[0]!.record.source_license = 'https://unapproved.example/LICENSE'; });
    rejects((value) => { value.entities[0]!.record.snapshot_sha256 = '1'.repeat(64); });
    rejects((value) => { value.entities[0]!.readonly = false; });
    rejects((value) => { value.entities[0]!.permissionlessExtension = true; });
    rejects((value) => { value.entities[0]!.expiresAtBlock = '999999999'; });
    rejects((value) => { value.entities[0]!.contentExpiresAt = '2026-12-01T00:00:00.000Z'; });
    rejects((value) => { value.blockNumber = value.entities[0]!.expiresAtBlock; }, 'REGISTRY_EXPIRED');
    rejects((value) => { value.observedAt = '2026-11-06T15:29:59.000Z'; });
    rejects((value) => { value.observedAt = '2026-11-06T15:30:02.000Z'; });
    rejects((value) => { value.entities = []; });
    rejects((value) => { value.entities = [...value.entities, structuredClone(value.entities[0]!)]; });
    rejects((value) => { value.entities[0]!.record = Object.assign(Object.create(record),
      Object.fromEntries(Object.keys(record).map((_, index) => [`private_${index}`, 'PRIVATE_MARKER']))) as RegistryRecord; });
    const expired = structuredClone(baseline);
    expired.observedAt = stored.contentExpiresAt;
    assert.throws(() => verifyObservation(expired, '10', references,
      new Date(Date.parse(stored.contentExpiresAt) - 1000).toISOString(), stored.contentExpiresAt),
    (error: unknown) => error instanceof QueryFailure && error.code === 'REGISTRY_EXPIRED'); passed++;
    const simulated = structuredClone(baseline); simulated.evidence = 'SIMULATED';
    await assert.rejects(queryAcceptedChain(readerFor(simulated), '10', references, clock()),
      (error: unknown) => error instanceof QueryFailure && error.code === 'REGISTRY_UNTRUSTED'); passed++;
    let readerCalls = 0;
    await assert.rejects(queryAcceptedChain({ readChain: async () => { readerCalls++; throw new Error('Unexpected read.'); } },
      '999999999', references, clock()), (error: unknown) => error instanceof QueryFailure && error.code === 'INVALID_INPUT');
    assert.equal(readerCalls, 0); passed++;
    await assert.rejects(queryAcceptedChain({ readChain: async () => ({ ok: false,
      error: { code: 'UPSTREAM_TIMEOUT', message: 'PRIVATE_MARKER', retryable: true } } as never) },
    '10', references, clock()), (error: unknown) => error instanceof QueryFailure
      && error.code === 'REGISTRY_UNAVAILABLE' && !String(error).includes('PRIVATE_MARKER')); passed++;
    const projected = Object.assign(structuredClone(baseline.entities[0]!), { privateIp: 'PRIVATE_MARKER' });
    const output = await queryAcceptedChain(readerFor({ ...structuredClone(baseline), entities: [projected] }),
      '10', references, clock());
    assert.equal(output.found, 1); assert.equal(output.endpointValidation, 'UNTESTED');
    assert.deepEqual(output.entities[0]!.record, record);
    assert.equal(JSON.stringify(output).includes('PRIVATE_MARKER'), false); passed++;
    assert.equal(networkCalls, 0);
    console.log(JSON.stringify({ schemaVersion: 1, sourceTask: 'MN-015', evidence: 'SIMULATED', passed, networkCalls }));
  } finally { globalThis.fetch = originalFetch; }
}


async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (args.length === 1 && args[0] === '--self-test') { await selfTest(); return; }
  if (args.length !== 2 || args[0] !== '--chain-id' || !args[1] || !decimal.test(args[1])) fail('INVALID_INPUT');
  // SDK debugging may print raw provider data; reject before constructing any client.
  if (process.env['DEBUG']) fail('INVALID_INPUT');
  const chainId = args[1];
  const references = await loadAcceptedReferences();
  if (!references.records.some((record) => record.chain_id === chainId)) fail('INVALID_INPUT');
  const source = references.manifest.source;
  const reader = createRabdiEntityReader({ policy: {
    creator: references.manifest.publisher, owner: references.manifest.publisher,
    sourceRevision: source.revision, snapshotSha256: source.snapshotSha256, licenseSha256: source.licenseSha256,
    // The storage adapter does not admit destinations. No candidate URL is ever contacted.
    allowedOrigins: [],
  } });
  console.log(JSON.stringify(await queryAcceptedChain(reader, chainId, references), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(JSON.stringify({ schemaVersion: 1, evidence: 'BLOCKED', sourceTask: 'MN-015',
      error: { code: error instanceof QueryFailure ? error.code : 'REGISTRY_UNAVAILABLE' } }));
    process.exitCode = error instanceof QueryFailure && error.code === 'INVALID_INPUT' ? 2 : 1;
  });
}
