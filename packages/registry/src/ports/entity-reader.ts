import type { ChainId, Result } from '@monolith/shared';
import type { RegistryRecord } from './source-snapshot.js';

/** SDK-free storage observation. Blocks and publisher ISO deadlines have different units. */
export interface RegistryEntity {
  entityKey: string;
  creator: string;
  owner: string;
  expiresAtBlock: string;
  readonly: boolean;
  permissionlessExtension: boolean;
  record: RegistryRecord;
  contentExpiresAt: string;
}

export interface EntityObservation {
  chainId: ChainId;
  blockNumber: string;
  observedAt: string;
  evidence: 'OBSERVED_LIVE' | 'SIMULATED';
  entities: readonly RegistryEntity[];
}

export interface EntityReader {
  readChain(chainId: ChainId): Promise<Result<EntityObservation>>;
}

/** DNS admission inspects metadata only; it authorizes no connection or browser read. */
export interface EndpointAdmission {
  check(rpcUrl: string): Promise<Result<void>>;
}

export interface RegistryQuery {
  query(chainId: ChainId): Promise<Result<import('@monolith/shared').RegistryManifest>>;
}

export interface PublisherPolicy {
  creator: string;
  owner: string;
  sourceRevision: string;
  snapshotSha256: string;
  licenseSha256: string;
  allowedOrigins: readonly string[];
}
