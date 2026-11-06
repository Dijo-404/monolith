import { constants } from 'node:fs';
import { lstat, realpath, readdir, open, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, parse, relative, sep } from 'node:path';
import { APP_PATH, ORIGINAL_APP, REPAIRED_APP, TRUSTED_PATHS, LIMITS, HarnessError } from './policy.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const runFile = promisify(execFile);
const sessions = new WeakMap();

/** Reject symlinks at every ancestor as well as the final component. */
export async function assertCanonical(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new HarnessError('INVALID_SOURCE');
  }
  if (await realpath(absolute) !== absolute) throw new HarnessError('INVALID_SOURCE');
  return absolute;
}

export async function boundedRead(path, maxBytes = LIMITS.fileBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new HarnessError('INVALID_SOURCE');
    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const chunk = await handle.read(bytes, used, bytes.length - used, null);
      if (chunk.bytesRead === 0) break;
      used += chunk.bytesRead;
    }
    if (used > maxBytes) throw new HarnessError('INVALID_SOURCE');
    return bytes.subarray(0, used);
  } finally { await handle.close(); }
}

async function snapshot(repository) {
  const files = {};
  let totalBytes = 0;
  async function walk(path) {
    if (Object.keys(files).length >= LIMITS.files || path.split('/').length > 64) throw new HarnessError('INVALID_SOURCE');
    const full = join(repository, path);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new HarnessError('INVALID_SOURCE');
    if (stat.isDirectory()) {
      files[`${path.replace(/\/$/, '')}/`] = 'directory';
      for (const name of (await readdir(full)).sort()) await walk(`${path.replace(/\/$/, '')}/${name}`);
    } else {
      if (!stat.isFile() || Object.keys(files).length >= LIMITS.files) throw new HarnessError('INVALID_SOURCE');
      const bytes = await boundedRead(full);
      totalBytes += bytes.length;
      if (totalBytes > LIMITS.sourceBytes) throw new HarnessError('INVALID_SOURCE');
      files[path] = sha256(bytes);
    }
  }
  for (const path of TRUSTED_PATHS) {
    await assertCanonical(join(repository, path));
    await walk(path.replace(/\/$/, ''));
  }
  return files;
}

export async function createSession({ repository, workspaceRoot = tmpdir() }) {
  let directory;
  try {
    repository = await assertCanonical(repository);
    workspaceRoot = await assertCanonical(workspaceRoot);
    if (workspaceRoot === repository || workspaceRoot.startsWith(repository + sep)) throw new HarnessError('INVALID_SOURCE');
    const bindings = await snapshot(repository);
    const original = await boundedRead(join(repository, APP_PATH));
    if (original.toString('utf8') !== ORIGINAL_APP) throw new HarnessError('INVALID_SOURCE');
    directory = await mkdtemp(join(workspaceRoot, 'monolith-agent-harness-'));
    const exampleDirectory = join(directory, 'example');
    await mkdir(exampleDirectory, { mode: 0o700 });
    await writeFile(join(exampleDirectory, 'app.mjs'), original, { flag: 'wx', mode: 0o600 });
    // Original bytes are never candidate-writable and participate in every recheck.
    await writeFile(join(directory, 'original.mjs'), original, { flag: 'wx', mode: 0o400 });
    let sourceRevision = 'UNVERSIONED';
    try { sourceRevision = (await runFile('git', ['rev-parse', 'HEAD'], { cwd: repository,
      timeout: 3000, maxBuffer: 128, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } })).stdout.trim(); }
    catch { /* Content bindings remain authoritative for a source archive. */ }
    Object.freeze(bindings);
    const session = { repository, directory, exampleDirectory, sourceRevision, bindings,
      originalSourceHash: sha256(original), candidate: null, closed: false };
    sessions.set(session, { repository, directory, exampleDirectory, sourceRevision, bindings,
      originalSourceHash: session.originalSourceHash, candidate: null, applying: false, closed: false });
    return session;
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error instanceof HarnessError ? error : new HarnessError('INVALID_SOURCE');
  }
}

export async function verifyBindings(session) {
  try {
    const internal = sessions.get(session);
    if (!internal || internal.closed || session.closed || session.repository !== internal.repository
      || session.directory !== internal.directory || session.exampleDirectory !== internal.exampleDirectory
      || session.sourceRevision !== internal.sourceRevision
      || session.bindings !== internal.bindings || session.originalSourceHash !== internal.originalSourceHash
      || session.candidate !== internal.candidate) throw new Error();
    await assertCanonical(session.repository);
    await assertCanonical(session.directory);
    await assertCanonical(session.exampleDirectory);
    const actual = await snapshot(session.repository);
    if (JSON.stringify(actual) !== JSON.stringify(session.bindings)
      || sha256(await boundedRead(join(session.directory, 'original.mjs'))) !== session.originalSourceHash
      || (await boundedRead(join(session.exampleDirectory, 'app.mjs'))).toString('utf8')
        !== (session.candidate ? REPAIRED_APP : ORIGINAL_APP)) throw new Error();
    if ((await readdir(session.exampleDirectory)).sort().join(',') !== 'app.mjs') throw new Error();
    return true;
  } catch { throw new HarnessError('BINDING_CHANGED'); }
}

/** No fuzzy application, shell git-apply, arbitrary JS, file creation, or renames. */
export function decodePatch(patch) {
  if (typeof patch !== 'string' || Buffer.byteLength(patch) > LIMITS.patchBytes
    || patch.includes('\0') || patch.includes('\r') || !patch.endsWith('\n')) throw new HarnessError('INVALID_PATCH');
  const lines = patch.slice(0, -1).split('\n');
  if (lines[0] === `diff --git a/${APP_PATH} b/${APP_PATH}`) {
    lines.shift();
    if (/^index [0-9a-f]{7,64}\.\.[0-9a-f]{7,64}( 100644)?$/.test(lines[0] ?? '')) lines.shift();
  }
  if (lines.shift() !== `--- a/${APP_PATH}` || lines.shift() !== `+++ b/${APP_PATH}`) throw new HarnessError('INVALID_PATCH');
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(lines.shift() ?? '');
  if (!match || Number(match[1]) !== Number(match[3])) throw new HarnessError('INVALID_PATCH');
  const before = []; const after = [];
  for (const line of lines) {
    if (![' ', '-', '+'].includes(line[0])) throw new HarnessError('INVALID_PATCH');
    if (line[0] !== '+') before.push(line.slice(1));
    if (line[0] !== '-') after.push(line.slice(1));
  }
  const start = Number(match[1]) - 1;
  if (start < 0 || before.length !== Number(match[2] ?? 1) || after.length !== Number(match[4] ?? 1)) throw new HarnessError('INVALID_PATCH');
  const original = ORIGINAL_APP.slice(0, -1).split('\n');
  if (original.slice(start, start + before.length).join('\n') !== before.join('\n')) throw new HarnessError('INVALID_PATCH');
  const output = [...original.slice(0, start), ...after, ...original.slice(start + before.length)].join('\n') + '\n';
  if (output !== REPAIRED_APP) throw new HarnessError('INVALID_PATCH');
  return output;
}

export async function applyCandidate(session, patch) {
  const internal = sessions.get(session);
  if (!internal || internal.closed) throw new HarnessError('BINDING_CHANGED');
  // Reserve synchronously: asynchronous filesystem checks are not a claim lock.
  if (internal.applying || internal.candidate) throw new HarnessError('CANDIDATE_ALREADY_APPLIED');
  internal.applying = true;
  try {
    await verifyBindings(session);
    const source = decodePatch(patch);
    // File descriptor bound to the verified regular file; no candidate-selected paths.
    const full = join(session.exampleDirectory, 'app.mjs');
    await assertCanonical(full);
    const handle = await open(full, constants.O_WRONLY | constants.O_NOFOLLOW);
    try { await handle.truncate(0); await handle.writeFile(source); } finally { await handle.close(); }
    session.candidate = Object.freeze({ path: APP_PATH, sha256: sha256(patch), sourceSha256: sha256(source) });
    internal.candidate = session.candidate;
    await verifyBindings(session);
    return session.candidate;
  } finally { internal.applying = false; }
}

export async function closeSession(session) {
  const internal = sessions.get(session);
  if (!internal || internal.closed) return;
  // Never recursively follow a replaced symlink; rm removes only that link.
  const directory = resolve(internal.directory);
  if (relative(dirname(directory), directory).startsWith('monolith-agent-harness-')) {
    await rm(directory, { recursive: true, force: true });
  }
  session.closed = true;
  internal.closed = true;
}
