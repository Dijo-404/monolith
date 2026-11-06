import { open, mkdir, readFile, rename, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  importRegistry, normalizeSourceSnapshot,
  type ImportJournal, type ImportManifest, type JournalStore, type ImportOptions,
} from '@monolith/registry';
import { loadGitSourceSnapshot, sha256Text } from '@monolith/registry/source';
import { createRabdiEntityWriter } from '@monolith/registry/arkiv';
import { loadImporterSigningKey } from './importer-key-file.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const usage = 'registry:import preview|write|verify --source DIR --revision COMMIT --out DIR [--publisher ADDRESS --state DIR --max-networks 100 --batch-size 10 --lifetime-hours 24 --refresh-expired]';
const args = process.argv.slice(2);
const command = args.shift();
const flags = new Map<string, string>();
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (!flag?.startsWith('--') || flags.has(flag)) throw new Error('INVALID_ARGUMENTS');
  if (flag === '--refresh-expired') { flags.set(flag, 'true'); continue; }
  const value = args[++index];
  if (!value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
  flags.set(flag, value);
}
const allowed = new Set(['--source', '--revision', '--out', '--publisher', '--state', '--max-networks', '--batch-size', '--lifetime-hours', '--refresh-expired']);
const required = (key: string) => { const value = flags.get(key); if (!value) throw new Error('MISSING_ARGUMENT'); return value; };
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

/** Atomic durable replacement; never write a submission before its journal is synced. */
async function durableJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.next-${process.pid}`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
  const directory = await open(resolve(path, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function freshArtifact(directory: string, name: string, value: unknown): Promise<void> {
  const handle = await open(join(directory, name), 'wx', 0o644);
  try { await handle.writeFile(typeof value === 'string' ? value : json(value)); await handle.sync(); }
  finally { await handle.close(); }
}

function filesystemJournal(path: string): JournalStore {
  return {
    async load() {
      try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.size > 2_000_000) throw new Error('INVALID_JOURNAL');
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('INVALID_JOURNAL');
        return parsed as ImportJournal;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
        throw new Error('JOURNAL_UNAVAILABLE', { cause: error });
      }
    },
    save: (value) => durableJson(path, value),
  };
}

async function main(): Promise<void> {
  if (!['preview', 'write', 'verify'].includes(command ?? '') || [...flags.keys()].some((key) => !allowed.has(key))) {
    console.error(usage); process.exitCode = 2; return;
  }
  if (process.env['DEBUG']) throw new Error('DEBUG_LOGGING_MUST_BE_DISABLED');
  const revision = required('--revision');
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('IMMUTABLE_REVISION_REQUIRED');
  const out = resolve(required('--out'));
  await mkdir(out, { recursive: true });
  const publisher = command === 'preview' ? null : required('--publisher');
  if (publisher !== null && !/^0x[a-fA-F0-9]{40}$/.test(publisher)) throw new Error('INVALID_PUBLISHER');
  const options: ImportOptions = {
    maxNetworks: Number(flags.get('--max-networks') ?? '100'),
    batchSize: Number(flags.get('--batch-size') ?? '10'),
    lifetimeHours: Number(flags.get('--lifetime-hours') ?? '24'),
    refreshExpired: flags.has('--refresh-expired'),
  };
  if (!Number.isInteger(options.maxNetworks) || options.maxNetworks < 1 || options.maxNetworks > 1_000
    || !Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10
    || !Number.isInteger(options.lifetimeHours) || options.lifetimeHours < 1 || options.lifetimeHours > 72) {
    throw new Error('INVALID_IMPORT_LIMITS');
  }
  const state = command === 'write' ? resolve(required('--state')) : null;
  let release: (() => Promise<void>) | undefined;
  let retrievedAt = new Date().toISOString();
  try {
    let journal: JournalStore | undefined;
    if (state) {
      await mkdir(state, { recursive: true, mode: 0o700 });
      const namespace = createHash('sha256').update(`monolith-import-v1:${publisher?.toLowerCase()}:${revision}`).digest('hex');
      const lock = join(state, `${namespace}.lock`);
      const handle = await open(lock, 'wx', 0o600);
      await handle.writeFile(String(process.pid)); await handle.sync();
      release = async () => { await handle.close(); await rm(lock); };
      const acquisition = join(state, `${namespace}.source.json`);
      try {
        const existing: unknown = JSON.parse(await readFile(acquisition, 'utf8'));
        if (typeof existing !== 'object' || existing === null || !('retrievedAt' in existing)
          || typeof existing.retrievedAt !== 'string') throw new Error('INVALID_SOURCE_STATE');
        retrievedAt = existing.retrievedAt;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          await durableJson(acquisition, { revision, retrievedAt, sourceContact: 'local-pinned-git-tree' });
        } else throw new Error('SOURCE_STATE_INVALID', { cause: error });
      }
      journal = filesystemJournal(join(state, `${namespace}.journal.json`));
    }
    const snapshot = await loadGitSourceSnapshot(resolve(required('--source')), revision, retrievedAt);
    const prepared = normalizeSourceSnapshot(snapshot, sha256Text);
    if (!prepared.ok) throw new Error('SOURCE_NORMALIZATION_FAILED');
    const plan = prepared.value;
    await freshArtifact(out, 'source-catalog.json', snapshot.catalog);
    await freshArtifact(out, 'LICENSE.ethereum-lists-chains', snapshot.license.text);
    await freshArtifact(out, 'source-preview.json', {
      schemaVersion: 1, evidence: 'UNTESTED', status: 'SOURCE_ONLY', source: {
        repository: snapshot.repository, revision, retrievedAt, snapshotSha256: snapshot.snapshotSha256,
        licenseUrl: snapshot.license.url, licenseSha256: snapshot.license.sha256,
      }, counts: plan.counts, fetchedDuringThisCommand: false,
      limits: 'Read local immutable source bytes; zero endpoint probes. This preview is not an Arkiv import.',
    });
    if (command === 'preview') {
      console.log(json({ status: 'SOURCE_ONLY', counts: plan.counts, snapshotSha256: snapshot.snapshotSha256 }));
      return;
    }
    const selected = plan.records.filter((record, index, records) => records.findIndex((r) => r.chain_id === record.chain_id) === index)
      .slice(0, options.maxNetworks);
    if (command === 'verify') {
      // This branch neither reads a key nor constructs a signing client.
      const reader = createRabdiEntityWriter({ publisher: publisher! });
      const rows = [];
      for (let offset = 0; offset < selected.length; offset += options.batchSize) {
        rows.push(...await reader.lookup(selected.slice(offset, offset + options.batchSize)));
      }
      const result = {
        schemaVersion: 1, evidence: 'OBSERVED_LIVE', observedAt: new Date().toISOString(),
        sourceRevision: revision, snapshotSha256: snapshot.snapshotSha256, publisher,
        selectedRecords: selected.length, foundRecords: rows.length, complete: rows.length === selected.length,
        currentBlock: String(await reader.currentBlock()), records: rows,
        endpointValidation: 'UNTESTED', limits: 'Key-free independent record lookup; candidate URLs unprobed.',
      };
      await freshArtifact(out, 'independent-query.json', result);
      console.log(json({ status: result.complete ? 'READ_BACK_COMPLETE' : 'READ_BACK_INCOMPLETE', found: rows.length, selected: selected.length }));
      if (!result.complete) process.exitCode = 2;
      return;
    }
    if (!journal) throw new Error('JOURNAL_REQUIRED');
    const writer = createRabdiEntityWriter({ publisher: publisher!, privateKey: await loadImporterSigningKey(root) });
    const manifest: ImportManifest = await importRegistry(plan, writer, journal, options, new Date().toISOString());
    await freshArtifact(out, 'import-manifest.json', manifest);
    await freshArtifact(out, 'selected-records.json', selected);
    console.log(json({ status: manifest.status, reason: manifest.reason, counts: manifest.counts }));
    if (manifest.status !== 'COMPLETE') process.exitCode = 2;
  } finally { if (release) await release(); }
}

// A terminated process leaves any reserved batch uncertain. No timeout grants a retry.
const deadline = setTimeout(() => {
  console.error('IMPORT_DEADLINE: retain journal and reconcile before another submission.');
  process.exit(2);
}, 10 * 60_000);
main().catch(() => {
  // SDK exceptions can contain access URLs, signed transaction data or arbitrary provider text.
  console.error('IMPORT_FAILED: inspect source/configuration and retained journal; reconcile uncertain writes before retry.');
  process.exitCode = 2;
}).finally(() => clearTimeout(deadline));
