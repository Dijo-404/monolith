import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import https from 'node:https';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDER = 'https://api.gateway.ethswarm.org';
const MAX_ARCHIVE = 1024 * 1024;
const MAX_RESPONSE = 64 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const fail = () => { throw new Error('Swarm upload failed.'); };
const requireValue = (condition) => { if (!condition) fail(); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function absolutePath(value) {
  requireValue(typeof value === 'string' && isAbsolute(value) && value === resolve(value)
    && !Array.from(value).some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127));
  return value;
}

function publicOrigin(value) {
  requireValue(typeof value === 'string' && value.length <= 2048 && value === value.trim());
  let url;
  try { url = new URL(value); } catch { fail(); }
  requireValue(url.protocol === 'https:' && url.origin === value && !url.username && !url.password
    && !url.port && !url.search && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.')
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname) && !/^[0-9.]+$/.test(url.hostname)
    && !/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(url.hostname));
  return value;
}

function safeFile(path) {
  requireValue(typeof path === 'string' && Buffer.byteLength(path) <= 100
    && /^(?:index\.html|assets\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/.test(path)
    && path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'))
    && !path.split('/').some((part) => /^(?:src|source|node_modules|credentials)$/i.test(part))
    && /\.(?:html|m?js|css|woff2?|png|jpe?g|svg|webp|avif|ico|gif|json|txt|wasm)$/i.test(path));
  return path;
}

async function regularBytes(path, maximum) {
  const before = await lstat(path);
  requireValue(before.isFile() && before.size > 0 && before.size <= maximum);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    requireValue(identity.isFile() && identity.dev === before.dev && identity.ino === before.ino
      && identity.size === before.size);
    const bytes = await handle.readFile();
    requireValue(bytes.length === before.size && bytes.length <= maximum);
    return bytes;
  } finally { await handle.close(); }
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  const field = (value, start, length) => header.write(value, start, length, 'ascii');
  const octal = (value, start, length) => field(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length);
  field(name, 0, 100); octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
  octal(size, 124, 12); octal(0, 136, 12); header.fill(32, 148, 156);
  field('0', 156, 1); field('ustar\0', 257, 6); field('00', 263, 2);
  octal(0, 329, 8); octal(0, 337, 8);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return header;
}

/** Only reviewed distribution files enter the deterministic regular-file USTAR. */
export async function prepareUpload(snapshot) {
  try {
    absolutePath(snapshot);
    requireValue((await lstat(snapshot)).isDirectory() && await realpath(snapshot) === snapshot);
    const provenanceBytes = await regularBytes(join(snapshot, 'provenance.json'), 128 * 1024);
    const provenance = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(provenanceBytes));
    requireValue(provenance.schemaVersion === 1 && provenance.status === 'ARTIFACTS_PREPARED_ONLY'
      && provenance.sourceDisclosure === 'compiled-static-artifact-only'
      && object(provenance.source) && typeof provenance.source.commit === 'string' && /^[0-9a-f]{40}$/.test(provenance.source.commit)
      && provenance.source.repository === 'https://github.com/Dijo-404/monolith'
      && provenance.source.archiveRetained === false && object(provenance.build)
      && provenance.build.node === '24.22.2' && provenance.build.pnpm === '12.18.0'
      && provenance.build.ambientEnvironmentForwarded === false && object(provenance.build.publicEnvironment)
      && Object.keys(provenance.build.publicEnvironment).join(',') === 'MONOLITH_PUBLIC_OBSERVER_URL');
    const publicObserverOrigin = publicOrigin(provenance.build.publicEnvironment.MONOLITH_PUBLIC_OBSERVER_URL);
    requireValue(Array.isArray(provenance.artifacts) && provenance.artifacts.length >= 2 && provenance.artifacts.length <= 20);
    const files = provenance.artifacts.map((entry) => {
      requireValue(object(entry) && Object.keys(entry).sort().join(',') === 'bytes,path,sha256'
        && typeof entry.path === 'string' && entry.path.startsWith('dist/')
        && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= MAX_ARCHIVE
        && typeof entry.sha256 === 'string' && SHA256.test(entry.sha256));
      return { path: safeFile(entry.path.slice(5)), bytes: entry.bytes, sha256: entry.sha256 };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    requireValue(new Set(files.map((file) => file.path)).size === files.length
      && files.some((file) => file.path === 'index.html')
      && files.some((file) => file.path === 'assets/THIRD-PARTY-NOTICES.txt'));
    const dist = join(snapshot, 'dist');
    requireValue((await lstat(dist)).isDirectory());
    const found = [];
    let entries = 0;
    async function walk(directory, prefix = '') {
      for (const name of await readdir(directory)) {
        entries++;
        requireValue(entries <= 80 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name));
        const path = prefix ? `${prefix}/${name}` : name;
        const information = await lstat(join(directory, name));
        if (information.isDirectory()) {
          requireValue((path === 'assets' || path.startsWith('assets/')) && path.split('/').length <= 8);
          await walk(join(directory, name), path);
        } else {
          requireValue(information.isFile());
          found.push(safeFile(path));
        }
      }
    }
    await walk(dist);
    requireValue(found.sort().join('\n') === files.map((file) => file.path).join('\n'));
    const archiveSize = files.reduce((total, file) => total + 512 + Math.ceil(file.bytes / 512) * 512, 1024);
    requireValue(archiveSize <= MAX_ARCHIVE);
    const blocks = [];
    for (const file of files) {
      const bytes = await regularBytes(join(dist, file.path), MAX_ARCHIVE);
      requireValue(bytes.length === file.bytes && sha256(bytes) === file.sha256
        && !/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(bytes.toString('utf8')));
      blocks.push(tarHeader(file.path, bytes.length), bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    const archive = Buffer.concat(blocks);
    requireValue(archive.length === archiveSize);
    return { archive, preview: { schemaVersion: 1, status: 'PREVIEW_ONLY', sourceCommit: provenance.source.commit,
      publicObserverOrigin, provenanceSha256: sha256(provenanceBytes), archiveSha256: sha256(archive),
      archiveBytes: archive.length, files, uploadService: PROVIDER,
      sourceArchiveIncluded: false, actualPostageBatchId: null, postageProvenance: 'UNKNOWN', deploymentReady: false } };
  } catch { fail(); }
}

function manifestCid(reference) {
  const bytes = Buffer.concat([Buffer.from([1, 250, 1, 27, 32]), Buffer.from(reference, 'hex')]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = 'b'; let bits = 0; let accumulator = 0;
  for (const byte of bytes) {
    accumulator = accumulator << 8 | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[accumulator >>> bits & 31]; }
    accumulator &= (1 << bits) - 1;
  }
  if (bits) result += alphabet[accumulator << (5 - bits) & 31];
  return result;
}

/** Fixed HTTPS service. The request port/deadline override exists only for offline library tests. */
export function postCollection({ archive }, { request = https.request, timeoutMs = 30_000 } = {}) {
  requireValue(Buffer.isBuffer(archive) && archive.length > 0 && archive.length <= MAX_ARCHIVE && Number.isInteger(timeoutMs)
    && timeoutMs > 0 && timeoutMs <= 30_000);
  return new Promise((accept, reject) => {
    let done = false; let timer; let response; let req;
    const stop = (code) => {
      if (done) return;
      done = true; clearTimeout(timer); response?.destroy(); req?.destroy();
      reject(Object.assign(new Error('Swarm upload failed.'), { code }));
    };
    try {
      req = request(`${PROVIDER}/bzz`, { method: 'POST', agent: false, rejectUnauthorized: true, maxHeaderSize: 8192,
        headers: { accept: 'application/json', 'accept-encoding': 'identity', connection: 'close',
          'content-type': 'application/x-tar', 'content-length': String(archive.length),
          'swarm-collection': 'true', 'swarm-index-document': 'index.html',
          'swarm-postage-batch-id': '0'.repeat(64), 'swarm-deferred-upload': 'false' } }, (incoming) => {
        response = incoming;
        if (incoming.statusCode !== 201) { stop('HTTP_NOT_CONFIRMED'); return; }
        if (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') {
          stop('RESPONSE_INVALID'); return;
        }
        const declared = incoming.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE)) {
          stop('RESPONSE_LIMIT'); return;
        }
        const chunks = []; let size = 0;
        incoming.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE) { stop('RESPONSE_LIMIT'); return; }
          chunks.push(chunk);
        });
        incoming.once('error', () => stop('NETWORK_UNCERTAIN'));
        incoming.once('aborted', () => stop('NETWORK_UNCERTAIN'));
        incoming.once('end', () => {
          if (done) return;
          done = true; clearTimeout(timer);
          accept({ statusCode: incoming.statusCode, mime: incoming.headers['content-type'] ?? '', body: Buffer.concat(chunks) });
        });
      });
      timer = setTimeout(() => stop('DEADLINE_EXCEEDED'), timeoutMs);
      req.once('error', () => stop('NETWORK_UNCERTAIN'));
      req.end(archive);
    } catch { stop('NETWORK_UNCERTAIN'); }
  });
}

async function durableFile(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export function parseArguments(argv) {
  const values = { upload: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--upload') { requireValue(!values.upload); values.upload = true; continue; }
    const name = flag === '--snapshot' ? 'snapshot' : flag === '--out' ? 'out' : null;
    requireValue(name && !Object.hasOwn(values, name) && typeof argv[index + 1] === 'string');
    values[name] = absolutePath(argv[++index]);
  }
  absolutePath(values.snapshot); absolutePath(values.out);
  return values;
}

/** Preview has no network side effects. Upload intent is durable before the one POST. */
export async function runCli(argv, { postCollection: send = postCollection, syncDirectory: sync = syncDirectory } = {}) {
  try {
    const options = parseArguments(argv);
    const { archive, preview } = await prepareUpload(options.snapshot);
    requireValue(await realpath(dirname(options.out)) === dirname(options.out)
      && relative(options.snapshot, options.out).startsWith(`..${sep}`));
    await mkdir(options.out, { mode: 0o700 });
    // Persist the new directory entry, not only the later files inside that directory.
    await sync(dirname(options.out));
    const writeJson = (name, value) => durableFile(join(options.out, name), `${JSON.stringify(value, null, 2)}\n`);
    await durableFile(join(options.out, 'collection.tar'), archive);
    await writeJson('release-preview.json', preview);
    if (!options.upload) return preview;
    const startedAt = new Date().toISOString();
    await writeJson('upload-intent.json', { schemaVersion: 1, status: 'UPLOAD_OUTCOME_UNCERTAIN', startedAt,
      sourceCommit: preview.sourceCommit, archiveSha256: preview.archiveSha256, archiveBytes: archive.length,
      maximumPostCount: 1, uploadService: PROVIDER, reconcileBeforeAnotherAttempt: true });
    await sync(options.out);
    const receipt = { ...preview, status: 'UPLOAD_NOT_CONFIRMED', startedAt,
      requestStamp: 'PROVIDER_SELECTED_NULL_STAMP', artifactIdentity: 'UNTESTED', privacy: 'UNTESTED', arkiv: 'UNTESTED' };
    try {
      const result = await send({ archive });
      requireValue(result.statusCode === 201 && typeof result.mime === 'string'
        && /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(result.mime)
        && Buffer.isBuffer(result.body) && result.body.length <= MAX_RESPONSE);
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.body));
      requireValue(object(value) && Object.keys(value).join(',') === 'reference'
        && typeof value.reference === 'string' && /^[a-fA-F0-9]{64}$/.test(value.reference));
      receipt.status = 'UPLOADED_NOT_VERIFIED'; receipt.reference = value.reference.toLowerCase();
      receipt.cid = manifestCid(receipt.reference);
      receipt.candidateOrigins = ['bzz.link', 'bzz.limo'].map((domain) => `https://${receipt.cid}.${domain}`);
      receipt.responseSha256 = sha256(result.body); receipt.httpStatus = 201;
    } catch (error) {
      receipt.failure = ['HTTP_NOT_CONFIRMED', 'RESPONSE_INVALID', 'RESPONSE_LIMIT', 'NETWORK_UNCERTAIN',
        'DEADLINE_EXCEEDED'].includes(error.code) ? error.code : 'RESPONSE_INVALID';
    }
    receipt.completedAt = new Date().toISOString();
    await writeJson('upload-receipt.json', receipt);
    return receipt;
  } catch { fail(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify({ status: result.status, sourceCommit: result.sourceCommit,
      reference: result.reference ?? null, deploymentReady: false })}\n`);
    if (result.status === 'UPLOAD_NOT_CONFIRMED') process.exitCode = 1;
  }).catch(() => { process.stderr.write('Swarm upload failed.\n'); process.exitCode = 1; });
}
