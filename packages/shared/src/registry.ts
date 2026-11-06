import * as z from 'zod';
import { makeError, parseContract, type Result } from './errors.js';
import {
  addressSchema,
  chainIdSchema,
  evidenceKindSchema,
  hex32Schema,
  identifierSchema,
  labelSchema,
  publicHttpsUrlSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from './primitives.js';

export const endpointCandidateSchema = z.strictObject({
  endpointId: identifierSchema,
  chainId: chainIdSchema,
  chainName: labelSchema,
  rpcUrl: publicHttpsUrlSchema,
  publisher: z.strictObject({ creator: addressSchema, owner: addressSchema }),
  entityKey: hex32Schema,
  expiresAt: timestampSchema,
  source: z.strictObject({
    url: publicHttpsUrlSchema,
    revision: labelSchema,
    licenseUrl: publicHttpsUrlSchema,
    snapshotSha256: sha256Schema,
  }),
});
export type EndpointCandidate = z.infer<typeof endpointCandidateSchema>;

export const registryManifestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  revision: labelSchema,
  generatedAt: timestampSchema,
  expiresAt: timestampSchema,
  evidence: evidenceKindSchema,
  origin: z.enum(['arkiv-query', 'fixture']),
  endpoints: z.array(endpointCandidateSchema).max(10_000),
}).superRefine((manifest, context) => {
  const generatedAt = Date.parse(manifest.generatedAt);
  if (Date.parse(manifest.expiresAt) <= generatedAt) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must follow generation.' });
  }
  if (manifest.origin === 'fixture' && manifest.evidence !== 'SIMULATED') {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'Fixtures must be marked SIMULATED.' });
  }
  const ids = new Set<string>();
  for (const [index, endpoint] of manifest.endpoints.entries()) {
    if (ids.has(endpoint.endpointId)) {
      context.addIssue({ code: 'custom', path: ['endpoints', index, 'endpointId'], message: 'Endpoint IDs must be unique.' });
    }
    ids.add(endpoint.endpointId);
    if (Date.parse(endpoint.expiresAt) <= generatedAt) {
      context.addIssue({ code: 'custom', path: ['endpoints', index, 'expiresAt'], message: 'Snapshot contains an expired endpoint.' });
    }
  }
});
export type RegistryManifest = z.infer<typeof registryManifestSchema>;

/** Validate a public DTO and its time window; no publisher, DNS, or chain trust is implied. */
export function validateRegistryManifest(input: unknown, nowISO: string): Result<RegistryManifest> {
  if (!timestampSchema.safeParse(nowISO).success) {
    return { ok: false, error: makeError('INVALID_INPUT') };
  }
  const parsed = parseContract(registryManifestSchema, input);
  if (!parsed.ok) return parsed;

  const now = Date.parse(nowISO);
  if (
    Date.parse(parsed.value.expiresAt) <= now
    || parsed.value.endpoints.some((endpoint) => Date.parse(endpoint.expiresAt) <= now)
  ) {
    return { ok: false, error: makeError('REGISTRY_EXPIRED') };
  }
  if (Date.parse(parsed.value.generatedAt) > now) {
    return { ok: false, error: makeError('INVALID_INPUT') };
  }
  return parsed;
}
