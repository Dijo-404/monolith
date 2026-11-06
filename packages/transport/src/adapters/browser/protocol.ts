import { timestampSchema, type RpcTrace } from '@monolith/shared';
import { WORKER_SPECIFIERS } from './io.js';

export type Network = 'nym' | 'tor' | 'passthrough';
export type WorkerMetadata = {
  network: Network;
  specifier: string;
  workerHash: string;
  harnessVersion: '0.4.0';
  verification: 'harness-ready-after-specifier-lookup';
  bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP';
  bootstrapCalls: number;
  privacyLabel: 'ANONYMIZING_WORKER' | 'NOT_ANONYMIZED';
  observedAt: string;
};

/** Metadata is a public export, so decode exact fields and project only fixed public facts. */
export function decodeWorkerMetadata(value: unknown, network: Network): WorkerMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.hasOwn(WORKER_SPECIFIERS, network)
    || Object.keys(value).sort().join(',')
      !== 'bootstrap,bootstrapCalls,harnessVersion,network,observedAt,privacyLabel,specifier,verification,workerHash') return null;
  const input = value as Record<string, unknown>;
  const specifier = WORKER_SPECIFIERS[network];
  const privacyLabel = network === 'passthrough' ? 'NOT_ANONYMIZED' : 'ANONYMIZING_WORKER';
  if (input['network'] !== network
    || typeof input['specifier'] !== 'string' || input['specifier'].toLowerCase() !== specifier.toLowerCase()
    || typeof input['workerHash'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(input['workerHash'])
    || input['bootstrapCalls'] !== 2 || input['harnessVersion'] !== '0.4.0'
    || input['verification'] !== 'harness-ready-after-specifier-lookup'
    || input['bootstrap'] !== 'NON_ANONYMOUS_SPECIFIER_LOOKUP'
    || input['privacyLabel'] !== privacyLabel
    || typeof input['observedAt'] !== 'string' || !timestampSchema.safeParse(input['observedAt']).success
    || new Date(input['observedAt']).toISOString() !== input['observedAt']) return null;
  return {
    network,
    specifier,
    workerHash: input['workerHash'].toLowerCase(),
    harnessVersion: '0.4.0',
    verification: 'harness-ready-after-specifier-lookup',
    bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP',
    bootstrapCalls: 2,
    privacyLabel,
    observedAt: input['observedAt'],
  };
}
export type HostSettings = {
  network: Network;
  bootstrapRpcUrl: string;
  approvedOrigins: string[];
  torGateways?: string[];
};
export type HostTrace = { kind: 'trace'; trace: RpcTrace };
export const CONNECT = 'monolith-worker-host-v1';
