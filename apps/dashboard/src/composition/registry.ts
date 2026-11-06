import {
  addressSchema, chainIdSchema, httpResultSchema, labelSchema, makeError, parseContract,
  publicHttpsUrlSchema, jsonValueSchema, sha256Schema, validateRegistryManifest,
  type Clock, type ErrorCode, type RegistryManifest, type Result,
} from '@monolith/shared';

export type RegistryPolicy = {
  trustedPublishers: readonly { creator: string; owner: string }[];
  approvedOrigins: readonly string[];
  source: { revision: string; snapshotSha256: string; licenseUrl: string; urlPrefix: string };
  maxManifestAgeMs?: number;
};

const failure = <T>(code: ErrorCode): Result<T> => ({ ok: false, error: makeError(code) });
const bounded = (value: number, maximum: number) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const publisherKey = (creator: string, owner: string) => `${creator.toLowerCase()}:${owner.toLowerCase()}`;

/** Deployment pins are captured independently of every received manifest. */
function capturePolicy(input: RegistryPolicy): RegistryPolicy | undefined {
  try {
    const maxManifestAgeMs = input.maxManifestAgeMs ?? 30_000;
    if (!bounded(maxManifestAgeMs, 300_000)
      || !Array.isArray(input.trustedPublishers) || input.trustedPublishers.length === 0
      || input.trustedPublishers.length > 256 || !Array.isArray(input.approvedOrigins)
      || input.approvedOrigins.length === 0 || input.approvedOrigins.length > 256
      || !input.trustedPublishers.every((publisher) => addressSchema.safeParse(publisher.creator).success
        && addressSchema.safeParse(publisher.owner).success)
      || !input.approvedOrigins.every((origin) => publicHttpsUrlSchema.safeParse(origin).success
        && new URL(origin).origin === origin)
      || !labelSchema.safeParse(input.source.revision).success
      || !sha256Schema.safeParse(input.source.snapshotSha256).success
      || !publicHttpsUrlSchema.safeParse(input.source.licenseUrl).success
      || !publicHttpsUrlSchema.safeParse(`${input.source.urlPrefix}0.json`).success
      || new URL(input.source.licenseUrl).search || new URL(`${input.source.urlPrefix}0.json`).search) return;
    return {
      trustedPublishers: input.trustedPublishers.map((publisher) => ({ ...publisher })),
      approvedOrigins: [...input.approvedOrigins], source: { ...input.source }, maxManifestAgeMs,
    };
  } catch { return; }
}

/** Recheck this bare manifest before and after asynchronous routing operations. */
export function admitRegistryManifest(
  input: unknown, chainId: string, policy: RegistryPolicy, nowISO: string,
): Result<RegistryManifest> {
  try {
    if (!chainIdSchema.safeParse(chainId).success) return failure('INVALID_INPUT');
    const pins = capturePolicy(policy);
    if (!pins) return failure('POLICY_DENIED');
    const parsed = validateRegistryManifest(input, nowISO);
    if (!parsed.ok) return parsed;
    const manifest = parsed.value;
    if (manifest.origin !== 'arkiv-query' || manifest.evidence !== 'OBSERVED_LIVE'
      || manifest.endpoints.length === 0) return failure('REGISTRY_UNTRUSTED');
    const generated = Date.parse(manifest.generatedAt);
    const expires = Date.parse(manifest.expiresAt);
    const maxAge = pins.maxManifestAgeMs ?? 30_000;
    if (Date.parse(nowISO) - generated > maxAge || expires - generated > maxAge) return failure('REGISTRY_EXPIRED');
    const publishers = new Set(pins.trustedPublishers.map((entry) => publisherKey(entry.creator, entry.owner)));
    const origins = new Set(pins.approvedOrigins);
    for (const candidate of manifest.endpoints) {
      if (candidate.chainId !== chainId) return failure('CHAIN_MISMATCH');
      if (!publishers.has(publisherKey(candidate.publisher.creator, candidate.publisher.owner))
        || candidate.source.revision !== pins.source.revision
        || candidate.source.snapshotSha256.toLowerCase() !== pins.source.snapshotSha256.toLowerCase()
        || candidate.source.licenseUrl !== pins.source.licenseUrl
        || candidate.source.url !== `${pins.source.urlPrefix}${chainId}.json`) return failure('REGISTRY_UNTRUSTED');
      if (!origins.has(new URL(candidate.rpcUrl).origin)) return failure('TARGET_DENIED');
      if (expires > Date.parse(candidate.expiresAt)) return failure('REGISTRY_EXPIRED');
    }
    return parsed;
  } catch { return failure('INVALID_INPUT'); }
}

type RegistryClientOptions = {
  url: string;
  policy: RegistryPolicy;
  clock: Clock;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function registryUrl(value: string): string | undefined {
  try {
    if (value !== value.trim() || /[\s\\]/.test(value)) return;
    const base = typeof location === 'undefined' ? undefined : location.href;
    const url = new URL(value, base);
    const sameOrigin = typeof location !== 'undefined' && url.origin === location.origin;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/registry/chains'
      || !(sameOrigin && ['http:', 'https:'].includes(url.protocol) || publicHttpsUrlSchema.safeParse(url.href).success)) return;
    return url.href;
  } catch { return; }
}

async function readBody(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)) {
    await response.body?.cancel();
    throw new Error('REGISTRY_RESPONSE_REJECTED');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('REGISTRY_RESPONSE_REJECTED');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('REGISTRY_RESPONSE_REJECTED');
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw new Error('REGISTRY_RESPONSE_REJECTED');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('REGISTRY_RESPONSE_REJECTED'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Public metadata contact is ordinary HTTP, separately disclosed from protected RPC. No cache fallback. */
export function createRegistryClient(options: RegistryClientOptions): {
  load(chainId: string, signal?: AbortSignal): Promise<Result<RegistryManifest>>;
} {
  const policy = capturePolicy(options.policy);
  const url = registryUrl(options.url);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
  const fetchMetadata = options.fetch ?? globalThis.fetch;
  const clock = options.clock;
  const valid = policy !== undefined && url !== undefined && bounded(timeoutMs, 60_000)
    && bounded(maxResponseBytes, 4_000_000) && typeof fetchMetadata === 'function';
  let active = 0;

  return {
    async load(chainId, signal) {
      if (!valid || !policy || !url) return failure('POLICY_DENIED');
      if (!chainIdSchema.safeParse(chainId).success) return failure('INVALID_INPUT');
      if (signal?.aborted) return failure('REGISTRY_UNAVAILABLE');
      if (active >= 8) return failure('RATE_LIMITED');
      active++;
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      let abortListener: (() => void) | undefined;
      signal?.addEventListener('abort', abort, { once: true });
      const aborted = new Promise<Result<RegistryManifest>>((resolve) => {
        abortListener = () => resolve(failure(timedOut ? 'UPSTREAM_TIMEOUT' : 'REGISTRY_UNAVAILABLE'));
        controller.signal.addEventListener('abort', abortListener, { once: true });
      });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const work = (async (): Promise<Result<RegistryManifest>> => {
        try {
          if (signal?.aborted) controller.abort();
          if (controller.signal.aborted) return failure('REGISTRY_UNAVAILABLE');
          const destination = new URL(url);
          destination.searchParams.set('chainId', chainId);
          const response = await fetchMetadata(destination.href, {
            method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
            redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal,
          });
          if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); return failure('REGISTRY_UNAVAILABLE'); }
          if (response.redirected || response.type === 'opaqueredirect' || (response.url && response.url !== destination.href)
            || response.status < 200 || response.status >= 600
            || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) {
            void response.body?.cancel().catch(() => undefined);
            return failure('REGISTRY_UNAVAILABLE');
          }
          const body = await readBody(response, maxResponseBytes, controller.signal);
          const parsed = parseContract(httpResultSchema(jsonValueSchema), body);
          if (!parsed.ok) return parsed;
          if (!parsed.value.ok) {
            if (response.ok) return failure('REGISTRY_UNAVAILABLE');
            return failure(parsed.value.error.code);
          }
          if (!response.ok) return failure('REGISTRY_UNAVAILABLE');
          return admitRegistryManifest(parsed.value.value, chainId, policy, clock.now());
        } catch { return failure('REGISTRY_UNAVAILABLE'); }
        finally { active--; }
      })();
      // Retain the concurrency slot until even an abort-ignoring fetch/body operation settles.
      try { return await Promise.race([work, aborted]); }
      finally {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      }
    },
  };
}
