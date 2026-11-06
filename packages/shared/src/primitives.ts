import { z } from 'zod';

export const schemaVersionSchema = z.literal(1);
export const unsignedDecimalStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).max(78);
export const chainIdSchema = unsignedDecimalStringSchema;
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const sha256Schema = z.string().regex(/^[0-9a-fA-F]{64}$/);
export const timestampSchema = z.iso.datetime();
export const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const labelSchema = z.string().min(1).max(256).refine(
  (value) => [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
);
export const jsonRpcIdSchema = labelSchema.max(128);
export const evidenceKindSchema = z.enum(['OBSERVED_LIVE', 'SIMULATED', 'UNTESTED', 'BLOCKED']);
export const workerStateSchema = z.enum(['BOOTSTRAPPING', 'READY', 'DEGRADED', 'BLOCKED', 'CLOSED']);
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 10_000;

/** Iterative validation bounds recursion before schemas inspect arbitrary RPC payload values. */
export function isBoundedJson(input: unknown): input is JsonValue {
  const pending: Array<{ value: unknown; depth: number; leave?: boolean }> = [{ value: input, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  try {
    while (pending.length > 0) {
      const entry = pending.pop();
      if (!entry) break;
      const { value, depth } = entry;
      if (entry.leave && value !== null && typeof value === 'object') {
        ancestors.delete(value);
        continue;
      }
      if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return false;
        continue;
      }
      if (typeof value !== 'object' || ancestors.has(value)) return false;
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
      const values: unknown[] = Array.isArray(value) ? value : Object.values(value);
      if (values.length > MAX_JSON_NODES - nodes) return false;
      ancestors.add(value);
      pending.push({ value, depth, leave: true });
      for (const child of values) pending.push({ value: child, depth: depth + 1 });
    }
    return true;
  } catch {
    return false;
  }
}

export const jsonValueSchema = z.custom<JsonValue>(isBoundedJson, { message: 'Expected a bounded JSON value.' });

/** Lexical candidate check only. Publisher, DNS, host allowlists and chain checks belong to adapters. */
export const publicHttpsUrlSchema = z.string().max(2048).refine((value) => {
  if (value !== value.trim() || /[\s\\]/.test(value)) return false;
  try {
    if (/[${}]/.test(decodeURIComponent(value))) return false;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return false;
    const host = url.hostname.toLowerCase();
    // URL normalizes numeric/hex IPv4 aliases before this check. No IP literals are accepted here.
    if (/^[0-9.]+$/.test(host) || host.includes(':')) return false;
    if (/(^|\.)(localhost|local|internal)$/.test(host)) return false;
    const labels = host.split('.');
    return host.length <= 253 && labels.length >= 2 && labels.every(
      (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    );
  } catch {
    return false;
  }
});

export type ChainId = z.infer<typeof chainIdSchema>;
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export type WorkerState = z.infer<typeof workerStateSchema>;
