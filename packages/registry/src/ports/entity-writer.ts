import type { RegistryRecord } from './source-snapshot.js';

export interface StoredRecord {
  recordId: string;
  entityKey: string;
  transactionHash: string | null;
  creator: string;
  owner: string;
  expiresAtBlock: string;
  /** Publisher-declared content deadline, independent of actual chain block expiry. */
  contentExpiresAt: string;
}

/** A reader must revalidate exact content, creator, owner and block expiry. */
export interface EntityWriter {
  readonly publisher: string;
  readonly evidence: 'OBSERVED_LIVE' | 'SIMULATED';
  currentBlock(): Promise<bigint>;
  lookup(records: readonly RegistryRecord[]): Promise<StoredRecord[]>;
  writeBatch(records: readonly RegistryRecord[], lifetimeHours: number): Promise<StoredRecord[]>;
}

export interface ImportJournal {
  schemaVersion: 1;
  publisher: string;
  sourceRevision: string;
  snapshotSha256: string;
  lifetimeHours: number;
  items: Record<string,
    | { state: 'pending' }
    | { state: 'confirmed'; stored: StoredRecord }
  >;
}

/** save must durably complete before sending a write; callers serialize the journal. */
export interface JournalStore {
  load(): Promise<ImportJournal | null>;
  save(journal: ImportJournal): Promise<void>;
}
