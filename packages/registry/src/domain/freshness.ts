import { makeError, timestampSchema, type Result } from '@monolith/shared';
import type { RegistryEntity } from '../ports/entity-reader.js';

export function blockHeight(input: unknown): input is string {
  return typeof input === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(input);
}

/** Both independently observed engine blocks and publisher UTC deadlines must be live. */
export function validateRegistryFreshness(entity: RegistryEntity, currentBlock: string, nowISO: string): Result<void> {
  if (!blockHeight(currentBlock) || !blockHeight(entity.expiresAtBlock)
    || !timestampSchema.safeParse(nowISO).success || !timestampSchema.safeParse(entity.contentExpiresAt).success
    || !timestampSchema.safeParse(entity.record.observed_at).success
    || Date.parse(entity.record.observed_at) > Date.parse(nowISO)
    || Date.parse(entity.contentExpiresAt) <= Date.parse(entity.record.observed_at)) {
    return { ok: false, error: makeError('REGISTRY_UNTRUSTED') };
  }
  if (BigInt(entity.expiresAtBlock) <= BigInt(currentBlock) || Date.parse(entity.contentExpiresAt) <= Date.parse(nowISO)) {
    return { ok: false, error: makeError('REGISTRY_EXPIRED') };
  }
  return { ok: true, value: undefined };
}
