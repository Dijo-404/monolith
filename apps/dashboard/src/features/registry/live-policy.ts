import type { RegistryPolicy } from '../../composition/registry.js';

/** Operator pins from the accepted MN-008 import, independent of received manifests. */
export const LIVE_CHAIN = '10';
export const LIVE_RPC_URL = 'https://mainnet.optimism.io/';
export const LIVE_OBSERVER_ENDPOINT = 'lab_optimism';
export const LIVE_SOURCE_REVISION = 'e17474286275730fb6b0490b1d7ea1c64a36ed9e';
export const LIVE_REGISTRY_POLICY: RegistryPolicy = {
  trustedPublishers: [{
    creator: '0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4',
    owner: '0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4',
  }],
  approvedOrigins: ['https://mainnet.optimism.io'],
  source: {
    revision: LIVE_SOURCE_REVISION,
    snapshotSha256: '2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952',
    licenseUrl: `https://github.com/ethereum-lists/chains/blob/${LIVE_SOURCE_REVISION}/LICENSE`,
    urlPrefix: `https://github.com/ethereum-lists/chains/blob/${LIVE_SOURCE_REVISION}/_data/chains/eip155-`,
  },
  maxManifestAgeMs: 30_000,
};
