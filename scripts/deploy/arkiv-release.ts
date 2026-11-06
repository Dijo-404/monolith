import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, open, rename, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createSwarmRelease, validateSwarmRelease, publishSwarmRelease, readSwarmRelease,
} from '@monolith/registry/swarm-release';
import { loadImporterSigningKey } from '../importer-key-file.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fail(): never { throw new Error('SWARM_RELEASE_FAILED'); }
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const address = /^0x[0-9a-fA-F]{40}$/;
const hex32 = /^0x[0-9a-fA-F]{64}$/;
const unsigned = /^(?:0|[1-9][0-9]*)$/;
type Command = 'preview' | 'publish' | 'read';
type Parsed = { command: Command; flags: Map<string, string> };

/** Commands have separate allowlists; preview/read cannot select a signing key. */
export function parseReleaseArguments(argv: readonly string[]): Parsed {
  const command = argv[0];
  if (command !== 'preview' && command !== 'publish' && command !== 'read') fail();
  const common = ['--out'];
  const allowed = new Set([...common, ...(command === 'preview'
    ? ['--inventory', '--reference', '--source', '--published-at', '--expires-at']
    : command === 'publish'
      ? ['--descriptor', '--publisher', '--key-file', '--access-key-file', '--max-total-fee-wei', '--state']
      : ['--entity', '--publisher', '--release-id', '--access-key-file'])]);
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key || !allowed.has(key) || flags.has(key) || !value || value.startsWith('--')
      || value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) fail();
    flags.set(key, value);
  }
  const required = command === 'preview' ? ['--out', '--inventory', '--reference', '--source', '--expires-at']
    : command === 'publish' ? ['--out', '--descriptor', '--publisher', '--key-file', '--max-total-fee-wei', '--state']
      : ['--out', '--entity', '--publisher'];
  if (required.some((key) => !flags.has(key))) fail();
  for (const key of ['--out', '--inventory', '--descriptor', '--key-file', '--access-key-file', '--state']) {
    const value = flags.get(key); if (value !== undefined && !isAbsolute(value)) fail();
  }
  const publisher = flags.get('--publisher');
  if (publisher !== undefined && !address.test(publisher)) fail();
  const entity = flags.get('--entity'); if (entity !== undefined && !hex32.test(entity)) fail();
  const fee = flags.get('--max-total-fee-wei');
  if (fee !== undefined && (!unsigned.test(fee) || fee.length > 32 || BigInt(fee) <= 0n)) fail();
  return { command, flags };
}

async function readJson(path: string, maximumBytes = 32 * 1024): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) fail();
    const bytes = await handle.readFile(); if (bytes.length > maximumBytes) fail();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally { await handle.close(); }
}

async function durableJson(path: string, value: unknown, replace = false): Promise<void> {
  const target = replace ? `${path}.next-${process.pid}` : path;
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); }
  finally { await handle.close(); }
  if (replace) await rename(target, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function syncParent(path: string): Promise<void> {
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function stateDirectory(path: string): Promise<string> {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
    || typeof process.getuid === 'function' && metadata.uid !== process.getuid()) fail();
  await syncParent(path);
  return realpath(path);
}

/** Explicit server-only access file; no key value or file path enters artifacts. */
async function accessKey(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) return undefined;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 1024 || (metadata.mode & 0o077) !== 0
      || typeof process.getuid === 'function' && metadata.uid !== process.getuid()) fail();
    const content = await handle.readFile('utf8');
    const match = /^ARKIV_ACCESS_KEY=([\x21-\x7e]{1,512})\n?$/.exec(content);
    if (!match || !match[1]) fail();
    return match[1];
  } finally { await handle.close(); }
}

async function signingKey(file: string): Promise<string> {
  const prior = process.env['ARKIV_PUBLISHER_KEY_FILE'];
  process.env['ARKIV_PUBLISHER_KEY_FILE'] = file;
  try { return await loadImporterSigningKey(root); }
  finally {
    if (prior === undefined) delete process.env['ARKIV_PUBLISHER_KEY_FILE'];
    else process.env['ARKIV_PUBLISHER_KEY_FILE'] = prior;
  }
}

function acceptedSource(commit: string): void {
  if (!/^[a-f0-9]{40}$/.test(commit)) fail();
  try {
    const type = execFileSync('git', ['cat-file', '-t', commit], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    }).trim();
    if (type !== 'commit') fail();
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], {
      cwd: root, stdio: 'ignore', timeout: 5_000,
    });
  } catch { fail(); }
}

type Execution = {
  publish: typeof publishSwarmRelease;
  read: typeof readSwarmRelease;
  loadSigningKey: (path: string) => Promise<string>;
  now: () => string;
};

/** Injected execution is SIMULATED; the executable never accepts injection flags. */
export async function runSwarmRelease(argv: readonly string[], injected?: Execution): Promise<unknown> {
  const { command, flags } = parseReleaseArguments(argv);
  if (process.env['DEBUG']) fail();
  const execution: Execution = injected ?? {
    publish: publishSwarmRelease, read: readSwarmRelease,
    loadSigningKey: signingKey, now: () => new Date().toISOString(),
  };
  const evidence = injected ? 'SIMULATED' : 'OBSERVED_LIVE';
  const out = flags.get('--out')!;
  await mkdir(out, { mode: 0o700 }); // Exclusive directory creation is the replay boundary.
  await syncParent(out);
  if (command === 'preview') {
    const input = await readJson(flags.get('--inventory')!);
    if (!input || typeof input !== 'object' || Array.isArray(input) || !('files' in input)
      || !Array.isArray(input.files)) fail();
    const sourceCommit = flags.get('--source')!;
    if ('sourceCommit' in input && input.sourceCommit !== sourceCommit) fail();
    acceptedSource(sourceCommit);
    const descriptor = createSwarmRelease({ sourceCommit, swarmReference: flags.get('--reference')!,
      publishedAt: flags.get('--published-at') ?? execution.now(), expiresAt: flags.get('--expires-at')!,
      files: input.files });
    await durableJson(join(out, 'descriptor.json'), descriptor);
    const result = { schemaVersion: 1, evidence: 'UNTESTED', status: 'DESCRIPTOR_PREVIEW_ONLY',
      descriptor, networkContact: false, signingKeyLoaded: false, postageProvenance: 'UNKNOWN' };
    await durableJson(join(out, 'preview.json'), result);
    return result;
  }
  const publisher = flags.get('--publisher')!;
  const selectedAccess = await accessKey(flags.get('--access-key-file'));
  const credential = selectedAccess === undefined ? {} : { accessKey: selectedAccess };
  if (command === 'read') {
    const expected = flags.get('--release-id');
    const result = await execution.read({ entityKey: flags.get('--entity')!, publisher, ...credential,
      ...(expected === undefined ? {} : { expectedReleaseId: expected }) });
    const report = { schemaVersion: 1, evidence, status: 'TRUSTED_RELEASE_CONTENT_VERIFIED', result,
      signingKeyLoaded: false, postageProvenance: 'UNKNOWN' };
    await durableJson(join(out, 'read.json'), report);
    return report;
  }
  const descriptor = validateSwarmRelease(await readJson(flags.get('--descriptor')!));
  acceptedSource(descriptor.sourceCommit);
  const key = await execution.loadSigningKey(flags.get('--key-file')!);
  const state = await stateDirectory(flags.get('--state')!);
  // Regenerating timestamps must not bypass an uncertain submission of the same content.
  const namespace = sha256(JSON.stringify({ publisher: publisher.toLowerCase(), sourceCommit: descriptor.sourceCommit,
    swarmReference: descriptor.swarmReference, inventorySha256: descriptor.inventorySha256 }));
  const journalPath = join(state, `${namespace}.json`);
  const journal = { schemaVersion: 1, phase: 'SUBMISSION_UNCERTAIN', publisher: publisher.toLowerCase(),
    releaseId: descriptor.releaseId, sourceCommit: descriptor.sourceCommit,
    descriptorSha256: sha256(json(descriptor)), reservedAt: execution.now(),
    maxTotalFeeWei: flags.get('--max-total-fee-wei'), automaticRetryAllowed: false };
  await durableJson(journalPath, journal);
  try {
    const published = await execution.publish({ descriptor, publisher, privateKey: key, ...credential,
      maxTotalFeeWei: flags.get('--max-total-fee-wei')!,
      onCreated: async (created) => {
        await durableJson(journalPath, { ...journal, phase: 'SUBMISSION_KNOWN', publication: created }, true);
      } });
    await durableJson(journalPath, { ...journal, phase: 'CONFIRMED', publication: published }, true);
    const receipt = { schemaVersion: 1, evidence, status: 'RELEASE_ENTITY_CONFIRMED', publication: published,
      postageProvenance: 'UNKNOWN', contentReadBack: 'PENDING' };
    await durableJson(join(out, 'publication.json'), receipt);
    const result = await execution.read({ entityKey: published.entityKey, publisher, ...credential,
      expectedReleaseId: descriptor.releaseId });
    const verified = { ...receipt, status: 'RELEASE_ENTITY_AND_CONTENT_VERIFIED', contentReadBack: 'VERIFIED', result };
    await durableJson(join(out, 'verification.json'), verified);
    return verified;
  } catch {
    await durableJson(join(out, 'blocked.json'), { schemaVersion: 1, evidence: 'BLOCKED',
      status: 'RECONCILE_BEFORE_ANOTHER_SUBMISSION', releaseId: descriptor.releaseId,
      automaticRetryAllowed: false, keyOrProviderDetailsRetained: false });
    fail();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const timer = setTimeout(() => {
    process.stderr.write('Swarm release deadline exceeded; reconcile any reserved submission.\n');
    process.exit(1);
  }, 180_000);
  runSwarmRelease(process.argv.slice(2)).then(() => {
    process.stdout.write('Swarm release command completed; inspect the retained report and remaining gates.\n');
  }).catch(() => {
    process.stderr.write('Swarm release failed; retain state and reconcile any uncertain submission.\n');
    process.exitCode = 1;
  }).finally(() => clearTimeout(timer));
}
