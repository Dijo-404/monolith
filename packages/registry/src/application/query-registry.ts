import {
  chainIdSchema, makeError, timestampSchema, validateRegistryManifest,
  type ChainId, type EndpointCandidate, type RegistryManifest, type Result,
} from '@monolith/shared';
import type { EndpointAdmission, EntityReader, PublisherPolicy, RegistryQuery } from '../ports/entity-reader.js';
import type { ContentHash } from '../ports/source-snapshot.js';
import { authenticRegistryEntity, validatePublisherPolicy } from '../domain/publisher-policy.js';
import { blockHeight, validateRegistryFreshness } from '../domain/freshness.js';

type Generation = { fingerprint: string; generatedAt: string; expiresAt: string };
const unavailable = (): Result<RegistryManifest> => ({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') });

/** Every query revalidates storage and DNS. Remembered generation metadata never serves a stale success. */
export function createQueryRegistry(options: {
  reader: EntityReader;
  policy: PublisherPolicy;
  hash: ContentHash;
  admission: EndpointAdmission;
  now?: () => string;
  timeoutMs?: number;
  generationTtlMs?: number;
}): RegistryQuery {
  const policy = validatePublisherPolicy(options.policy);
  const { reader, hash, admission } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new Error('Registry limits are invalid.');
  const generationTtlMs = options.generationTtlMs === undefined ? 30_000 : options.generationTtlMs;
  if (!Number.isSafeInteger(generationTtlMs) || generationTtlMs < 1 || generationTtlMs > 300_000) {
    throw new Error('Registry limits are invalid.');
  }
  const generations = new Map<ChainId, Generation>();
  let inFlight = 0;

  async function perform(chainId: ChainId, stillActive: () => boolean): Promise<Result<RegistryManifest>> {
    const startedAt = now();
    if (!timestampSchema.safeParse(startedAt).success) return unavailable();
    const result = await reader.readChain(chainId);
    if (!stillActive()) return unavailable();
    if (!result.ok) return { ok: false, error: makeError(
      result.error.code === 'REGISTRY_UNTRUSTED' ? 'REGISTRY_UNTRUSTED'
        : result.error.code === 'REGISTRY_EXPIRED' ? 'REGISTRY_EXPIRED' : 'REGISTRY_UNAVAILABLE',
    ) };
    const observation = result.value;
    const checkedAt = now();
    if (!timestampSchema.safeParse(checkedAt).success || !timestampSchema.safeParse(observation.observedAt).success
      || Date.parse(checkedAt) < Date.parse(startedAt) || Date.parse(observation.observedAt) < Date.parse(startedAt)
      || Date.parse(observation.observedAt) > Date.parse(checkedAt)
      || Date.parse(checkedAt) - Date.parse(observation.observedAt) > timeoutMs
      || observation.chainId !== chainId || !blockHeight(observation.blockNumber)
      || !['OBSERVED_LIVE', 'SIMULATED'].includes(observation.evidence)
      || !Array.isArray(observation.entities) || observation.entities.length > 1_000) {
      return { ok: false, error: makeError('REGISTRY_UNTRUSTED') };
    }
    if (observation.entities.length === 0) return unavailable();
    const keys = new Set<string>();
    const ids = new Set<string>();
    const endpoints: EndpointCandidate[] = [];
    for (const entity of observation.entities) {
      if (!authenticRegistryEntity(entity, policy, hash) || entity.record.chain_id !== chainId
        || keys.has(entity.entityKey.toLowerCase()) || ids.has(entity.record.record_id)) {
        return { ok: false, error: makeError('REGISTRY_UNTRUSTED') };
      }
      const fresh = validateRegistryFreshness(entity, observation.blockNumber, checkedAt);
      if (!fresh.ok) return fresh;
      keys.add(entity.entityKey.toLowerCase());
      ids.add(entity.record.record_id);
      endpoints.push({
        endpointId: `rpc_${entity.record.record_id}`, chainId, chainName: entity.record.chain_name,
        rpcUrl: entity.record.rpc_host, publisher: { creator: policy.creator, owner: policy.owner },
        entityKey: entity.entityKey.toLowerCase(), expiresAt: entity.contentExpiresAt,
        source: { url: entity.record.source_url, revision: entity.record.source_commit,
          licenseUrl: entity.record.source_license, snapshotSha256: entity.record.snapshot_sha256 },
      });
    }
    endpoints.sort((a, b) => a.endpointId < b.endpointId ? -1 : a.endpointId > b.endpointId ? 1 : 0);
    // Validate every destination locally before *any* DNS work, then inspect current
    // answers via a composition-owned port. No socket or RPC operation exists here.
    for (const endpoint of endpoints) {
      if (!stillActive()) return unavailable();
      const admitted = await admission.check(endpoint.rpcUrl);
      if (!stillActive()) return unavailable();
      if (!admitted.ok) return { ok: false, error: makeError('ENDPOINT_REJECTED') };
    }
    const generatedNow = now();
    if (!timestampSchema.safeParse(generatedNow).success || Date.parse(generatedNow) < Date.parse(checkedAt)
      || Date.parse(generatedNow) - Date.parse(observation.observedAt) > timeoutMs) return unavailable();
    const endpointDeadline = Math.min(...endpoints.map((endpoint) => Date.parse(endpoint.expiresAt)));
    if (endpointDeadline <= Date.parse(generatedNow)) return { ok: false, error: makeError('REGISTRY_EXPIRED') };
    const fingerprint = hash(JSON.stringify({ evidence: observation.evidence, endpoints }));
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) return { ok: false, error: makeError('REGISTRY_UNTRUSTED') };
    let generation = generations.get(chainId);
    if (!generation || generation.fingerprint !== fingerprint || Date.parse(generation.expiresAt) <= Date.parse(generatedNow)) {
      generation = { fingerprint, generatedAt: generatedNow,
        expiresAt: new Date(Math.min(Date.parse(generatedNow) + generationTtlMs, endpointDeadline)).toISOString() };
      if (generations.size >= 64 && !generations.has(chainId)) {
        const oldest = generations.keys().next().value;
        if (oldest !== undefined) generations.delete(oldest);
      }
      generations.set(chainId, generation);
    }
    return validateRegistryManifest({
      schemaVersion: 1, revision: `registry_${fingerprint}`, generatedAt: generation.generatedAt,
      expiresAt: generation.expiresAt, evidence: observation.evidence, origin: 'arkiv-query', endpoints,
    }, generatedNow);
  }

  return Object.freeze({
    async query(chainId: ChainId): Promise<Result<RegistryManifest>> {
      if (!chainIdSchema.safeParse(chainId).success) return { ok: false, error: makeError('INVALID_INPUT') };
      // A timed-out, unresponsive port still owns its slot until it settles.
      // This caps retained work even when infrastructure ignores cancellation.
      if (inFlight >= 16) return { ok: false, error: makeError('RATE_LIMITED') };
      inFlight++;
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          perform(chainId, () => active).catch(() => unavailable()).finally(() => { inFlight--; }),
          new Promise<Result<RegistryManifest>>((resolve) => {
            timer = setTimeout(() => { active = false; resolve(unavailable()); }, timeoutMs);
          }),
        ]);
      } finally { active = false; if (timer !== undefined) clearTimeout(timer); }
    },
  });
}
