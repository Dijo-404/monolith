import * as z from 'zod';
import {
  evidenceKindSchema,
  identifierSchema,
  labelSchema,
  schemaVersionSchema,
} from './primitives.js';

export const privacyFindingSchema = z.strictObject({
  code: labelSchema,
  readId: identifierSchema.optional(),
  callsite: labelSchema,
  message: labelSchema,
});
export type PrivacyFinding = z.infer<typeof privacyFindingSchema>;

const scopeOriginSchema = z.string().max(2_048).refine((input) => {
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol)
      && url.username === '' && url.password === '' && url.origin === input;
  } catch {
    return false;
  }
}, { message: 'Expected an HTTP(S) origin without credentials.' });

export const privacyReportSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  runId: identifierSchema,
  evidence: evidenceKindSchema,
  eligibleReads: z.number().int().nonnegative(),
  protectedReads: z.number().int().nonnegative(),
  successfulReads: z.number().int().nonnegative(),
  protectedCoverage: z.number().finite().min(0).max(1).nullable(),
  findings: z.array(privacyFindingSchema).max(10_000),
  scope: z.strictObject({
    rpcOrigins: z.array(scopeOriginSchema).max(1_000),
    scenarios: z.array(labelSchema).max(1_000),
    bootstrapExclusions: z.array(labelSchema).max(1_000),
  }),
}).superRefine((report, context) => {
  if (report.protectedReads > report.eligibleReads) {
    context.addIssue({ code: 'custom', path: ['protectedReads'], message: 'Protected reads cannot exceed eligible reads.' });
  }
  if (report.successfulReads > report.eligibleReads) {
    context.addIssue({ code: 'custom', path: ['successfulReads'], message: 'Successful reads cannot exceed eligible reads.' });
  }
  if (report.eligibleReads === 0) {
    if (report.protectedCoverage !== null) {
      context.addIssue({ code: 'custom', path: ['protectedCoverage'], message: 'Zero eligible reads require null coverage.' });
    }
  } else if (
    report.protectedCoverage === null
    || Math.abs(report.protectedCoverage - report.protectedReads / report.eligibleReads) > 1e-12
  ) {
    context.addIssue({ code: 'custom', path: ['protectedCoverage'], message: 'Coverage must match the measured numerator and denominator.' });
  }
});
export type PrivacyReport = z.infer<typeof privacyReportSchema>;
