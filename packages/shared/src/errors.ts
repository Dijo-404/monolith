import { z } from 'zod';
import { schemaVersionSchema } from './primitives.js';

const definitions = {
  INVALID_INPUT: ['The input does not match the contract.', false],
  UNSUPPORTED_VERSION: ['The contract version is unsupported.', false],
  POLICY_DENIED: ['The privacy policy denied the operation.', false],
  METHOD_DENIED: ['The RPC method is not allowed.', false],
  TARGET_DENIED: ['The destination is not allowed.', false],
  WORKER_UNAVAILABLE: ['The anonymity worker is unavailable.', true],
  WORKER_INTEGRITY_FAILED: ['Worker integrity verification failed.', false],
  ENDPOINT_REJECTED: ['The endpoint was rejected.', false],
  CHAIN_MISMATCH: ['The endpoint chain does not match.', false],
  REGISTRY_UNTRUSTED: ['The registry publisher or provenance is untrusted.', false],
  REGISTRY_EXPIRED: ['The registry snapshot has expired.', false],
  REGISTRY_UNAVAILABLE: ['The registry is unavailable.', true],
  UPSTREAM_TIMEOUT: ['The upstream request timed out.', true],
  UPSTREAM_UNAVAILABLE: ['The upstream is unavailable.', true],
  RPC_ERROR: ['The RPC endpoint returned an error.', false],
  RPC_RESPONSE_INVALID: ['The RPC response is invalid.', false],
  RATE_LIMITED: ['The request limit was reached.', true],
  EVIDENCE_EXPIRED: ['The diagnostic evidence has expired.', false],
  AUTHORIZATION_INVALID: ['The payment authorization is invalid.', false],
  PAYMENT_EXPIRED: ['The payment authorization has expired.', false],
  NONCE_CONFLICT: ['The payment nonce conflicts with an existing intent.', false],
  INSUFFICIENT_CREDIT: ['The allocated payment credit is insufficient.', false],
  PAYMENT_RECONCILE: ['The existing payment must be reconciled.', false],
} as const;

export type ErrorCode = keyof typeof definitions;
export type SafeError = { code: ErrorCode; message: string; retryable: boolean };
export type Result<T> = { ok: true; value: T } | { ok: false; error: SafeError };
export type HttpResult<T> = { schemaVersion: 1 } & Result<T>;

export const errorCodeSchema = z.enum(Object.keys(definitions) as [ErrorCode, ...ErrorCode[]]);

export function makeError(code: ErrorCode): SafeError {
  const [message, retryable] = definitions[code];
  return { code, message, retryable };
}

export const safeErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
}).refine((value) => {
  const expected = makeError(value.code);
  return value.message === expected.message && value.retryable === expected.retryable;
});

export function resultSchema<S extends z.ZodType>(valueSchema: S) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: valueSchema }),
    z.strictObject({ ok: z.literal(false), error: safeErrorSchema }),
  ]);
}

export function httpResultSchema<S extends z.ZodType>(valueSchema: S) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ schemaVersion: schemaVersionSchema, ok: z.literal(true), value: valueSchema }),
    z.strictObject({ schemaVersion: schemaVersionSchema, ok: z.literal(false), error: safeErrorSchema }),
  ]);
}

/** Validate decoded input without returning provider messages, issue paths or submitted values. */
export function parseContract<S extends z.ZodType>(schema: S, input: unknown): Result<z.output<S>> {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)
    && 'schemaVersion' in input && typeof input.schemaVersion === 'number'
    && Number.isSafeInteger(input.schemaVersion) && input.schemaVersion > 0 && input.schemaVersion !== 1) {
    return { ok: false, error: makeError('UNSUPPORTED_VERSION') };
  }
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: makeError('INVALID_INPUT') };
}
