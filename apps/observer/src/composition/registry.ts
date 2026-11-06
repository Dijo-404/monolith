import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { addressSchema, makeError, publicHttpsUrlSchema } from '@monolith/shared';
import type { Result } from '@monolith/shared';
import { createQueryRegistry } from '@monolith/registry';
import type { EndpointAdmission, EntityReader, PublisherPolicy, RegistryQuery } from '@monolith/registry';
import { createRabdiEntityReader } from '@monolith/registry/reader';
import { resolveHost } from '../adapters/upstream/dns-resolver.js';
import type { ResolvedAddress } from '../adapters/upstream/dns-resolver.js';
import { isPublicAddress } from '../adapters/upstream/public-address.js';

const CONFIG_ERROR = 'Registry configuration is invalid.';
const CONFIG_KEYS = ['creator', 'owner', 'sourceRevision', 'snapshotSha256', 'licenseSha256', 'allowedOrigins'];
const LICENSE_SHA256 = '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685';

/** This public operator policy contains no signing material or per-user fields. */
export function parseRegistryConfig(input: Readonly<Record<string, string | undefined>>): PublisherPolicy | undefined {
  const raw = input['MONOLITH_REGISTRY_CONFIG'];
  if (raw === undefined || raw === '') return undefined;
  try {
    if (Buffer.byteLength(raw) > 32 * 1_024) throw new Error(CONFIG_ERROR);
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(CONFIG_ERROR);
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).length !== CONFIG_KEYS.length || !CONFIG_KEYS.every((key) => Object.hasOwn(fields, key))) {
      throw new Error(CONFIG_ERROR);
    }
    const creator = addressSchema.safeParse(fields['creator']);
    const owner = addressSchema.safeParse(fields['owner']);
    const sourceRevision = fields['sourceRevision'];
    const snapshotSha256 = fields['snapshotSha256'];
    const licenseSha256 = fields['licenseSha256'];
    const origins = fields['allowedOrigins'];
    if (!creator.success || !owner.success || typeof sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(sourceRevision)
      || typeof snapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotSha256)
      || licenseSha256 !== LICENSE_SHA256 || !Array.isArray(origins) || origins.length < 1 || origins.length > 64
      || origins.some((origin: unknown) => typeof origin !== 'string' || !publicHttpsUrlSchema.safeParse(origin).success
        || new URL(origin).origin !== origin) || new Set(origins).size !== origins.length) {
      throw new Error(CONFIG_ERROR);
    }
    return Object.freeze({ creator: creator.data, owner: owner.data, sourceRevision, snapshotSha256,
      licenseSha256, allowedOrigins: Object.freeze([...origins]) as readonly string[] });
  } catch {
    throw new Error(CONFIG_ERROR);
  }
}

export type RegistryDnsResolver = (hostname: string, signal?: AbortSignal) => Promise<readonly ResolvedAddress[]>;

/** Current DNS is admission metadata only. It grants no socket or browser routing capability. */
export function createRegistryDnsAdmission(options: {
  resolve?: RegistryDnsResolver;
  timeoutMs?: number;
} = {}): EndpointAdmission {
  const resolve = options.resolve ?? resolveHost;
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8_000) throw new Error(CONFIG_ERROR);
  return {
    async check(rpcUrl: string): Promise<Result<void>> {
      if (!publicHttpsUrlSchema.safeParse(rpcUrl).success) return { ok: false, error: makeError('ENDPOINT_REJECTED') };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const answers = await Promise.race([
          Promise.resolve().then(() => resolve(new URL(rpcUrl).hostname, controller.signal)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('Registry DNS timed out.')); }, timeoutMs);
          }),
        ]);
        if (controller.signal.aborted || !Array.isArray(answers) || answers.length < 1 || answers.length > 64
          || answers.some((answer) => !answer || ![4, 6].includes(answer.family)
            || isIP(answer.address) !== answer.family || !isPublicAddress(answer.address))) {
          return { ok: false, error: makeError('ENDPOINT_REJECTED') };
        }
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, error: makeError('REGISTRY_UNAVAILABLE') };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
    },
  };
}

export function createConfiguredRegistry(input: Readonly<Record<string, string | undefined>>, options: {
  reader?: EntityReader;
  resolve?: RegistryDnsResolver;
  now?: () => string;
  dnsTimeoutMs?: number;
} = {}): RegistryQuery {
  const policy = parseRegistryConfig(input);
  if (!policy) return { query: async () => ({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') }) };
  return createQueryRegistry({
    reader: options.reader ?? createRabdiEntityReader({ policy }), policy,
    hash: (text: string) => createHash('sha256').update(text).digest('hex'),
    admission: createRegistryDnsAdmission({ ...(options.resolve ? { resolve: options.resolve } : {}),
      ...(options.dnsTimeoutMs === undefined ? {} : { timeoutMs: options.dnsTimeoutMs }) }),
    ...(options.now ? { now: options.now } : {}),
  });
}
