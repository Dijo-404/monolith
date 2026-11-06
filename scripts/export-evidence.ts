import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  observerRunSchema, privacyReportSchema, publicHttpsUrlSchema, registryManifestSchema, rpcTraceSchema,
  timestampSchema, verificationManifestSchema, type VerificationManifest,
} from '@monolith/shared';

// Resolve only the shared package's built public export through tsconfig.evidence.json.
// This offline operator script has no SDK, signing, provider or network dependency.
const MAX_PLAN = 256 * 1024;
const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 8 * MAX_FILE;
const MAX_FILES = 64;
const BUNDLE_ID = /^(?:run-|report_)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MANIFEST_NAME = 'verification-manifest.json';
const schemas = {
  'privacy-report': privacyReportSchema,
  'observer-run': observerRunSchema,
  'registry-manifest': registryManifestSchema,
  'rpc-trace': rpcTraceSchema,
} as const;
type ArtifactKind = keyof typeof schemas;
type FailureCode = 'INVALID_INPUT' | 'UNSAFE_PATH' | 'INVALID_PLAN' | 'ARTIFACT_INVALID'
  | 'HASH_MISMATCH' | 'REDACTION_REQUIRED' | 'OUTPUT_EXISTS' | 'LIMIT_EXCEEDED' | 'IO_FAILURE';

export class EvidenceFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = 'EvidenceFailure'; }
}
function fail(code: FailureCode): never { throw new EvidenceFailure(code); }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const record = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => (
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
);
const within = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

export interface BundleOptions { planPath: string; inputDirectory: string; nowISO: string }
export interface ValidatedBundle {
  manifest: VerificationManifest;
  artifacts: Array<{ path: string; bytes: Buffer }>;
}

/** Reject symlinks in every existing absolute component, including root ancestors. */
async function safeExistingPath(path: string): Promise<void> {
  const absolute = resolve(path);
  const parts = absolute.split(sep).filter(Boolean);
  let current: string = sep;
  for (const part of parts) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) fail('UNSAFE_PATH');
    if (current !== absolute && !info.isDirectory()) fail('UNSAFE_PATH');
  }
  if (await realpath(absolute) !== absolute) fail('UNSAFE_PATH');
}

/** Fixed-size descriptor reads avoid following leaf symlinks, FIFOs and growing files. */
async function boundedRead(path: string, maximum: number): Promise<Buffer> {
  await safeExistingPath(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail('UNSAFE_PATH');
    if (info.size > maximum) fail('LIMIT_EXCEEDED');
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > maximum) fail('LIMIT_EXCEEDED');
    const after = await handle.stat();
    if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs
      || length !== after.size) fail('IO_FAILURE');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

/** A canonical round trip excludes duplicate keys and hidden/ambiguous encodings. */
function parseCanonical(bytes: Buffer, error: FailureCode): unknown {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return fail(error); }
  if (canonical(value) !== bytes.toString('utf8')) fail(error);
  return value;
}

function readPlan(value: unknown, nowISO: string): { manifest: VerificationManifest; kinds: Record<string, ArtifactKind> } {
  if (!timestampSchema.safeParse(nowISO).success) fail('INVALID_INPUT');
  if (!record(value) || !exactKeys(value, ['manifest', 'kinds']) || !record(value['kinds'])) fail('INVALID_PLAN');
  const parsed = verificationManifestSchema.safeParse(value['manifest']);
  if (!parsed.success) fail('INVALID_PLAN');
  const manifest = parsed.data;
  if (!BUNDLE_ID.test(manifest.runId) || Date.parse(manifest.generatedAt) > Date.parse(nowISO)
    || manifest.artifacts.length === 0 || manifest.artifacts.length > MAX_FILES) fail('INVALID_PLAN');
  const kinds = value['kinds'];
  if (Object.keys(kinds).length !== manifest.artifacts.length) fail('INVALID_PLAN');
  const admitted: Record<string, ArtifactKind> = Object.create(null) as Record<string, ArtifactKind>;
  for (const artifact of manifest.artifacts) {
    if (artifact.path === MANIFEST_NAME || artifact.path.startsWith(`${MANIFEST_NAME}/`) || !artifact.path.endsWith('.json')
      || artifact.evidence !== manifest.evidence || !Object.hasOwn(kinds, artifact.path)) fail('INVALID_PLAN');
    checkPublicStrings(artifact.path, 'rpc-trace');
    const kind = kinds[artifact.path];
    if (typeof kind !== 'string' || !Object.hasOwn(schemas, kind)) fail('INVALID_PLAN');
    admitted[artifact.path] = kind as ArtifactKind;
  }
  // Reject file/directory prefix collisions before creating any output.
  const names = manifest.artifacts.map((artifact) => artifact.path);
  if (names.some((name) => names.some((other) => other.startsWith(`${name}/`)))) fail('INVALID_PLAN');
  return { manifest, kinds: admitted };
}

function publicUrl(input: string): void {
  if (!publicHttpsUrlSchema.safeParse(input).success) fail('REDACTION_REQUIRED');
  let url: URL;
  try { url = new URL(input); } catch { return fail('REDACTION_REQUIRED'); }
  if (url.protocol !== 'https:' || url.username || url.password || input.includes('?') || input.includes('#')
    || url.port || isIP(url.hostname) || url.hostname.startsWith('[')
    || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname)) {
    fail('REDACTION_REQUIRED');
  }
}

function containsIpToken(text: string): boolean {
  return (text.match(/[0-9a-f:.%]+/gi) ?? []).some((token) => {
    // A prose period/colon or a zone suffix must not hide an otherwise literal IP.
    const address = token.split('%')[0]!.replace(/^\.+|\.+$/g, '');
    return isIP(address) !== 0 || isIP(address.replace(/:+$/, '')) !== 0;
  });
}

/** Conservative checks complement strict DTOs; they are not a universal secret detector. */
function checkPublicStrings(value: unknown, kind: ArtifactKind): void {
  const stack: Array<{ value: unknown; path: string[] }> = [{ value, path: [] }];
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++count > 20_000 || item.path.length > 32) fail('LIMIT_EXCEEDED');
    if (Array.isArray(item.value)) {
      item.value.forEach((child, index) => stack.push({ value: child, path: [...item.path, String(index)] }));
    } else if (record(item.value)) {
      Object.entries(item.value).forEach(([key, child]) => stack.push({ value: child, path: [...item.path, key] }));
    } else if (typeof item.value === 'string') {
      const text = item.value;
      const publicRegistryHex = kind === 'registry-manifest' && (
        /^endpoints\.\d+\.publisher\.(creator|owner)$/.test(item.path.join('.'))
        || /^endpoints\.\d+\.(entityKey|source\.snapshotSha256)$/.test(item.path.join('.'))
      );
      if (publicRegistryHex) continue;
      if (/0x[0-9a-f]{40,}/i.test(text) || /\b[0-9a-f]{64}\b/i.test(text)
        || /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)
        || containsIpToken(text)
        || /(?:private[ _-]?key|api[ _-]?key|authorization|bearer\s|mnemonic|password|signature|secret[ _-]?key)/i.test(text)
        ) {
        fail('REDACTION_REQUIRED');
      }
      if (/https?:\/\//i.test(text)) publicUrl(text);
    }
  }
}

function validateArtifact(bytes: Buffer, kind: ArtifactKind, artifact: VerificationManifest['artifacts'][number],
  manifest: VerificationManifest): void {
  const value = parseCanonical(bytes, 'ARTIFACT_INVALID');
  const parsed = schemas[kind].safeParse(value);
  if (!parsed.success || !record(value)) fail('ARTIFACT_INVALID');
  if (Object.hasOwn(value, 'evidence') && value['evidence'] !== artifact.evidence) fail('ARTIFACT_INVALID');
  if (Object.hasOwn(value, 'runId') && value['runId'] !== manifest.runId) fail('ARTIFACT_INVALID');
  if (Object.hasOwn(value, 'generatedAt') && value['generatedAt'] !== artifact.generatedAt) fail('ARTIFACT_INVALID');
  if (kind === 'observer-run' && (typeof value['expiresAt'] !== 'string'
    || Date.parse(value['expiresAt']) <= Date.parse(artifact.generatedAt))) fail('ARTIFACT_INVALID');
  checkPublicStrings(value, kind);
}

async function validate(options: BundleOptions): Promise<ValidatedBundle> {
  if (typeof options.planPath !== 'string' || !options.planPath || typeof options.inputDirectory !== 'string'
    || !options.inputDirectory) fail('INVALID_INPUT');
  const root = resolve(options.inputDirectory);
  await safeExistingPath(root);
  if (!(await lstat(root)).isDirectory()) fail('UNSAFE_PATH');
  const plan = readPlan(parseCanonical(await boundedRead(resolve(options.planPath), MAX_PLAN), 'INVALID_PLAN'), options.nowISO);
  const artifacts: ValidatedBundle['artifacts'] = [];
  let total = 0;
  for (const artifact of plan.manifest.artifacts) {
    const path = resolve(root, artifact.path);
    if (!within(root, path)) fail('UNSAFE_PATH');
    const bytes = await boundedRead(path, MAX_FILE);
    total += bytes.length;
    if (total > MAX_TOTAL) fail('LIMIT_EXCEEDED');
    if (hash(bytes) !== artifact.sha256) fail('HASH_MISMATCH');
    validateArtifact(bytes, plan.kinds[artifact.path]!, artifact, plan.manifest);
    artifacts.push({ path: artifact.path, bytes });
  }
  return { manifest: plan.manifest, artifacts };
}

function sanitized(error: unknown): never {
  if (error instanceof EvidenceFailure) throw error;
  fail('IO_FAILURE');
}

/** Validate recorded facts and byte integrity only; no live truth or release gate is inferred. */
export async function validateBundle(options: BundleOptions): Promise<ValidatedBundle> {
  try { return await validate(options); } catch (error: unknown) { return sanitized(error); }
}

/** Snapshot all validated bytes before writes; commit the manifest after all artifacts. */
export async function exportBundle(options: BundleOptions & { outputDirectory: string }): Promise<VerificationManifest> {
  try {
    if (typeof options.outputDirectory !== 'string' || !options.outputDirectory) fail('INVALID_INPUT');
    const output = resolve(options.outputDirectory);
    const input = resolve(options.inputDirectory);
    if (within(input, output) || within(output, input) || within(output, resolve(options.planPath))) fail('UNSAFE_PATH');
    await safeExistingPath(dirname(output));
    try { await lstat(output); fail('OUTPUT_EXISTS'); }
    catch (error: unknown) {
      if (error instanceof EvidenceFailure) throw error;
      if (!record(error) || error['code'] !== 'ENOENT') throw error;
    }
    const bundle = await validate(options);
    if (bundle.manifest.evidence === 'SIMULATED'
      && output.split(sep).some((part) => part.toLowerCase() === 'evidence')) fail('UNSAFE_PATH');
    try { await mkdir(output, { mode: 0o700 }); }
    catch (error: unknown) { if (record(error) && error['code'] === 'EEXIST') fail('OUTPUT_EXISTS'); throw error; }
    // Operate in an operator-controlled directory. Concurrent hostile filesystem mutation
    // is outside this local tool's model; O_NOFOLLOW is not an openat sandbox.
    for (const artifact of bundle.artifacts) {
      const path = resolve(output, artifact.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, artifact.bytes, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(resolve(output, MANIFEST_NAME), canonical(bundle.manifest), { flag: 'wx', mode: 0o600 });
    return bundle.manifest;
  } catch (error: unknown) { return sanitized(error); }
}

const usage = 'pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json scripts/export-evidence.ts '
  + '--verify|--export --plan <plan.json> --input <directory> --now <UTC ISO timestamp> [--output <new directory>]';

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const mode = args[0];
  if (mode !== '--verify' && mode !== '--export') fail('INVALID_INPUT');
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!key || !['--plan', '--input', '--now', '--output'].includes(key) || flags.has(key)
      || !value || value.startsWith('--')) fail('INVALID_INPUT');
    flags.set(key, value);
  }
  if (!flags.has('--plan') || !flags.has('--input') || !flags.has('--now')
    || (mode === '--export') !== flags.has('--output')) fail('INVALID_INPUT');
  const options = { planPath: flags.get('--plan')!, inputDirectory: flags.get('--input')!, nowISO: flags.get('--now')! };
  const manifest = mode === '--export'
    ? await exportBundle({ ...options, outputDirectory: flags.get('--output')! })
    : (await validateBundle(options)).manifest;
  console.log(JSON.stringify({ schemaVersion: 1, sourceTask: 'MN-017', status: mode === '--export' ? 'EXPORTED' : 'VALIDATED',
    evidence: manifest.evidence, artifactCount: manifest.artifacts.length, releaseAcceptance: 'UNTESTED' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(JSON.stringify({ schemaVersion: 1, sourceTask: 'MN-017', evidence: 'BLOCKED',
      error: { code: error instanceof EvidenceFailure ? error.code : 'IO_FAILURE' } }));
    process.exitCode = error instanceof EvidenceFailure && error.code === 'INVALID_INPUT' ? 2 : 1;
  });
}
