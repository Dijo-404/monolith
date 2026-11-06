import {
  addressSchema, blockTagSchema, labelSchema, publicHttpsUrlSchema, routePolicySchema,
  type RoutePolicy,
} from '@monolith/shared';
import type { AllowedCall, TransportOptions } from '../ports/driver.js';

export type CapturedConfiguration = {
  valid: boolean;
  policy: RoutePolicy | undefined;
  route: TransportOptions['driver']['route'];
  evidence: TransportOptions['driver']['evidence'];
  publishers: ReadonlySet<string>;
  origins: ReadonlySet<string>;
  callsites: ReadonlySet<string>;
  calls: readonly AllowedCall[];
  maxAttempts: number;
  requestTimeoutMs: number;
  initializationTimeoutMs: number;
  validationTtlMs: number;
};

const bounded = (value: number, maximum: number) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
export const publisherKey = (creator: string, owner: string) => `${creator.toLowerCase()}:${owner.toLowerCase()}`;

/** Copy policy arrays and lists so callers cannot expand capabilities after construction. */
export function captureConfiguration(options: TransportOptions): CapturedConfiguration {
  const parsed = routePolicySchema.safeParse(options.policy);
  const route = options.driver.route;
  const evidence = options.driver.evidence;
  const maxAttempts = options.maxAttempts ?? 2;
  const requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
  const initializationTimeoutMs = options.initializationTimeoutMs ?? 180_000;
  const validationTtlMs = options.validationTtlMs ?? 60_000;
  const publishers = new Set(options.trustedPublishers.map((entry) => publisherKey(entry.creator, entry.owner)));
  const origins = new Set(options.approvedOrigins);
  const callsites = new Set(options.allowedCallsites);
  const calls = (options.allowedCalls ?? []).map((call) => ({
    target: call.target.toLowerCase(), selector: call.selector.toLowerCase(), blockTags: [...call.blockTags],
  }));
  const valid = parsed.success
    && parsed.data.allowedMethods.includes('eth_chainId')
    && ['anon-tor', 'anon-nym', 'passthrough', 'direct-debug'].includes(route)
    && ['OBSERVED_LIVE', 'SIMULATED'].includes(evidence)
    && (route !== 'passthrough' || !parsed.data.privacyRequired)
    && (route !== 'direct-debug' || (!parsed.data.privacyRequired && parsed.data.allowDirectDebugControl))
    && bounded(maxAttempts, 3) && bounded(requestTimeoutMs, 180_000)
    && bounded(initializationTimeoutMs, 300_000) && bounded(validationTtlMs, 300_000)
    && publishers.size > 0 && publishers.size <= 256
    && options.trustedPublishers.every((entry) => addressSchema.safeParse(entry.creator).success
      && addressSchema.safeParse(entry.owner).success)
    && origins.size > 0 && origins.size <= 256 && [...origins].every((origin) =>
      publicHttpsUrlSchema.safeParse(origin).success && new URL(origin).origin === origin)
    && callsites.size > 0 && callsites.size <= 256
    && [...callsites].every((label) => labelSchema.safeParse(label).success)
    && calls.length <= 256 && calls.every((call) => addressSchema.safeParse(call.target).success
      && /^0x[0-9a-f]{8}$/.test(call.selector) && call.blockTags.length > 0
      && call.blockTags.length <= 64 && call.blockTags.every((tag) => blockTagSchema.safeParse(tag).success));
  return {
    valid, policy: parsed.success ? parsed.data : undefined, route, evidence,
    publishers, origins, callsites, calls, maxAttempts, requestTimeoutMs, initializationTimeoutMs, validationTtlMs,
  };
}
