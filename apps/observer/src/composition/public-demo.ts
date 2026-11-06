import { createPublicLabEdge, type EdgeLimits } from '../adapters/http/public-lab-edge.js';
import type { UpstreamReader } from '../domain/ports.js';
import type { RegistryQuery } from '@monolith/registry';
import { buildServer } from './server.js';
import { createConfiguredRegistry } from './registry.js';

export const PUBLIC_DEMO_TARGET = Object.freeze({ endpointId: 'lab_optimism', chainId: '10', rpcUrl: 'https://mainnet.optimism.io/' });
export const PUBLIC_REGISTRY_PINS = Object.freeze({
  creator: '0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4', owner: '0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4',
  sourceRevision: 'e17474286275730fb6b0490b1d7ea1c64a36ed9e',
  snapshotSha256: '2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952',
  licenseSha256: '1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685',
  allowedOrigins: ['https://mainnet.optimism.io'],
});

/** Explicit demo composition opts into synthetic allocation; normal server defaults stay disabled. */
export async function createPublicDemo(options: { registry?: RegistryQuery; upstream?: UpstreamReader;
  nowMs?: () => number; edgeLimits?: Partial<EdgeLimits> } = {}) {
  const observer = buildServer({
    config: { endpoints: [{ ...PUBLIC_DEMO_TARGET, calls: [] }],
      sourcePolicy: { mode: 'trusted-proxy', trustedProxies: ['127.0.0.1'] }, labRuns: [] },
    registry: options.registry ?? createConfiguredRegistry({ MONOLITH_REGISTRY_CONFIG: JSON.stringify(PUBLIC_REGISTRY_PINS) }),
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
