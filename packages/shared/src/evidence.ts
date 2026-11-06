import * as z from 'zod';
import {
  evidenceKindSchema,
  identifierSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from './primitives.js';

export const evidencePathSchema = z.string().min(1).max(256).refine((value) => (
  value.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== '.' && part !== '..')
), { message: 'Expected a traversal-safe relative artifact path.' });

export const evidenceArtifactSchema = z.strictObject({
  path: evidencePathSchema,
  sha256: sha256Schema,
  generatedAt: timestampSchema,
  evidence: evidenceKindSchema,
  sourceTask: z.string().regex(/^MN-\d{3}$/),
});
export type EvidenceArtifact = z.infer<typeof evidenceArtifactSchema>;

export const verificationManifestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  runId: identifierSchema,
  generatedAt: timestampSchema,
  evidence: evidenceKindSchema,
  artifacts: z.array(evidenceArtifactSchema).max(1_000),
}).superRefine((manifest, context) => {
  const paths = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (paths.has(artifact.path)) {
      context.addIssue({ code: 'custom', path: ['artifacts', index, 'path'], message: 'Artifact paths must be unique.' });
    }
    paths.add(artifact.path);
    if (Date.parse(artifact.generatedAt) > Date.parse(manifest.generatedAt)) {
      context.addIssue({ code: 'custom', path: ['artifacts', index, 'generatedAt'], message: 'Artifact generation cannot follow manifest generation.' });
    }
    if (
      (manifest.evidence === 'SIMULATED' && artifact.evidence !== 'SIMULATED')
      || (manifest.evidence === 'OBSERVED_LIVE' && artifact.evidence !== 'OBSERVED_LIVE')
    ) {
      context.addIssue({ code: 'custom', path: ['artifacts', index, 'evidence'], message: 'Artifact evidence must match this manifest claim.' });
    }
  }
  if (manifest.evidence === 'OBSERVED_LIVE' && manifest.artifacts.length === 0) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'An observed manifest requires artifacts.' });
  }
});
export type VerificationManifest = z.infer<typeof verificationManifestSchema>;
