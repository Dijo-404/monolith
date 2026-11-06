import { makeError, publicHttpsUrlSchema, type Result } from '@monolith/shared';
import { sourceUrlRejection } from './source-policy.js';

/** Admission of discovery metadata only. DNS and connection policy remain separate ports. */
export function validateEndpointOrigin(input: unknown, allowedOrigins: readonly string[]): Result<string> {
  if (typeof input !== 'string' || !publicHttpsUrlSchema.safeParse(input).success
    || sourceUrlRejection(input) !== null) return { ok: false, error: makeError('ENDPOINT_REJECTED') };
  try {
    const url = new URL(input);
    if (!allowedOrigins.includes(url.origin)) return { ok: false, error: makeError('ENDPOINT_REJECTED') };
    return { ok: true, value: url.href };
  } catch { return { ok: false, error: makeError('ENDPOINT_REJECTED') }; }
}
