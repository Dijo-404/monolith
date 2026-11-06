import { createHash } from 'node:crypto';
import { makeError } from '@monolith/shared';
import { createPublicLabEdge, type EdgeLimits } from '../adapters/http/public-lab-edge.js';
import type { UpstreamReader } from '../domain/ports.js';
import { createQueryRegistry, type RegistryQuery, type EntityReader, type EndpointAdmission } from '@monolith/registry';
import { createRabdiEntityReader } from '@monolith/registry/reader';
import { buildServer } from './server.js';
import { createRegistryDnsAdmission, parseRegistryConfig } from './registry.js';

export const PUBLIC_DEMO_TARGET = Object.freeze({ endpointId: 'lab_optimism', chainId: '10', rpcUrl: 'https://mainnet.optimism.io/' });
// Explicit lab policy covers bounded real worker exchanges; actual entity deadlines still clamp it.
export const PUBLIC_DEMO_GENERATION_TTL_MS = 120_000;
export const PUBLIC_REGISTRY_PINS = Object.freeze({
  creator: '0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4', owner: '0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4',
  sourceRevision: 'e17474286275730fb6b0490b1d7ea1c64a36ed9e',
  snapshotSha256: '2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952',
  licenseSha256: '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
  allowedOrigins: ['https://mainnet.optimism.io'],
});

/** Each actual GET gets fresh generation metadata; true entity expiry is never extended. */
export function createFreshPublicRegistry(options: { reader?: EntityReader; admission?: EndpointAdmission;
  nowMs?: () => number; queryTimeoutMs?: number; accessKey?: string } = {}): RegistryQuery {
  const policy = parseRegistryConfig({ MONOLITH_REGISTRY_CONFIG: JSON.stringify(PUBLIC_REGISTRY_PINS) });
  if (!policy) throw new Error('Invalid public registry configuration.');
  const timeoutMs = options.queryTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new Error('Invalid public registry configuration.');
  const reader = options.reader ?? createRabdiEntityReader({ policy,
    ...(options.accessKey === undefined ? {} : { accessKey: options.accessKey }),
  });
  const admission = options.admission ?? createRegistryDnsAdmission();
  const nowMs = options.nowMs ?? Date.now;
  let inFlight = 0;
  return { async query(chainId) {
    if (inFlight >= 16) return { ok: false, error: makeError('RATE_LIMITED') };
    inFlight++;
    let returned = false; let retained = 0; let released = false;
    const release = () => { if (returned && retained === 0 && !released) { released = true; inFlight--; } };
    const track = <T>(operation: () => Promise<T>): Promise<T> => {
      retained++;
      return Promise.resolve().then(operation).finally(() => { retained--; release(); });
    };
    try {
      const query = createQueryRegistry({ policy, timeoutMs, generationTtlMs: PUBLIC_DEMO_GENERATION_TTL_MS,
        now: () => new Date(nowMs()).toISOString(),
        hash: (text) => createHash('sha256').update(text).digest('hex'),
        reader: { readChain: (chain) => track(() => reader.readChain(chain)) },
        admission: { check: (url) => track(() => admission.check(url)) },
      });
      return await query.query(chainId);
    } finally {
      // A timeout cannot release work retained by an unresponsive injected port.
      returned = true; release();
    }
  } };
}

/** Explicit demo composition opts into synthetic allocation; normal server defaults stay disabled. */
export async function createPublicDemo(options: { registry?: RegistryQuery; upstream?: UpstreamReader;
  nowMs?: () => number; edgeLimits?: Partial<EdgeLimits>; accessKey?: string } = {}) {
  const observer = buildServer({
    config: { endpoints: [{ ...PUBLIC_DEMO_TARGET, calls: [] }],
      sourcePolicy: { mode: 'trusted-proxy', trustedProxies: ['127.0.0.1'] }, labRuns: [] },
    registry: options.registry ?? createFreshPublicRegistry({ ...(options.nowMs ? { nowMs: options.nowMs } : {}),
      ...(options.accessKey === undefined ? {} : { accessKey: options.accessKey }),
    }),
    publicLabRuns: true,
    ...(options.upstream ? { upstream: options.upstream } : {}),
    ...(options.nowMs ? { nowMs: options.nowMs } : {}),
  });
  try {
    await observer.listen({ host: '127.0.0.1', port: 0 });
    const address = observer.server.address();
    if (!address || typeof address === 'string') throw new Error('Public demo could not bind.');
    const edge = await createPublicLabEdge({ observerPort: address.port,
      ...(options.nowMs ? { nowMs: options.nowMs } : {}), ...(options.edgeLimits ? { limits: options.edgeLimits } : {}) });
    let closing: Promise<void> | undefined;
    return { edgePort: edge.port, observerPort: address.port, counters: edge.counters,
      close() { closing ??= edge.close().finally(() => observer.close()); return closing; } };
  } catch {
    await observer.close();
    throw new Error('Public demo could not start.');
  }
}
