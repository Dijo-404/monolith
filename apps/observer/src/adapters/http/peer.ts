import { isIP } from 'node:net';
import type { SourcePolicy } from '../../domain/ports.js';

export function normalizePeer(value: string | undefined): string | undefined {
  if (!value || value !== value.trim() || value.includes('%') || isIP(value) === 0) return undefined;
  if (isIP(value) === 4) return value;
  try {
    const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16);
      const low = Number.parseInt(mapped[2]!, 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return normalized;
  } catch { return undefined; }
}

/** Only the deployment can declare topology. Caller route labels are never evidence. */
export function resolvePeer(policy: SourcePolicy, socketPeer: string | undefined, rawHeaders: readonly string[]): string | undefined {
  const peer = normalizePeer(socketPeer);
  if (policy.mode === 'unknown' || !peer) return undefined;
  if (policy.mode === 'direct') return peer;
  if (!policy.trustedProxies.some((proxy) => normalizePeer(proxy) === peer)) return undefined;
  const forwarded: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]?.toLowerCase();
    if (name === 'forwarded') return undefined;
    if (name === 'x-forwarded-for') forwarded.push(rawHeaders[index + 1] ?? '');
  }
  // The configured edge must overwrite XFF with exactly one source address.
  if (forwarded.length !== 1 || forwarded[0]!.includes(',')) return undefined;
  return normalizePeer(forwarded[0]);
}
