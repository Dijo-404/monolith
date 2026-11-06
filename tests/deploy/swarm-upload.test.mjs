import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'vitest';
import { parseArguments, postCollection, prepareUpload, runCli } from '../../deploy/swarm/upload.mjs';

const roots = [];
const servers = [];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reference = 'bc9b942212421e2a19fe1ffdf0add641ae530923041ea8f549381747b14b2f2d';
const modulePath = fileURLToPath(new URL('../../deploy/swarm/upload.mjs', import.meta.url));

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((accept) => { server.close(accept); server.closeAllConnections(); });
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'monolith-swarm-upload-test-')); roots.push(root);
  const snapshot = join(root, 'snapshot');
  await mkdir(join(snapshot, 'dist/assets'), { recursive: true });
  const contents = { 'index.html': Buffer.from('<html><script src="/assets/app.js"></script></html>'),
    'assets/app.js': Buffer.from('console.log("SIMULATED test fixture");\n'),
    'assets/THIRD-PARTY-NOTICES.txt': Buffer.from('SIMULATED license notice\n') };
  const provenance = { schemaVersion: 1, status: 'ARTIFACTS_PREPARED_ONLY',
    sourceDisclosure: 'compiled-static-artifact-only', source: { commit: 'b'.repeat(40),
      repository: 'https://github.com/Dijo-404/monolith', archiveRetained: false },
    build: { node: '24.22.2', pnpm: '12.18.0', ambientEnvironmentForwarded: false,
      publicEnvironment: { MONOLITH_PUBLIC_OBSERVER_URL: 'https://observer.monolith.invalid-domain.org' } },
    artifacts: Object.entries(contents).map(([path, bytes]) => ({ path: `dist/${path}`, bytes: bytes.length, sha256: sha256(bytes) })) };
  for (const [path, bytes] of Object.entries(contents)) await writeFile(join(snapshot, 'dist', path), bytes);
  const save = () => writeFile(join(snapshot, 'provenance.json'), `${JSON.stringify(provenance)}\n`);
  await save();
  return { root, snapshot, provenance, contents, save, out: join(root, 'output'),
    argv: ['--snapshot', snapshot, '--out', join(root, 'output')] };
}

/** Independent USTAR consumer: checks checksums, regular-file metadata and zero padding. */
function readArchive(bytes) {
  const entries = []; let cursor = 0;
  while (!bytes.subarray(cursor, cursor + 512).equals(Buffer.alloc(512))) {
    const header = bytes.subarray(cursor, cursor + 512); assert.equal(header.length, 512);
    const field = (start, length) => header.subarray(start, start + length).toString('ascii').replace(/\0.*$/s, '');
    const checksum = Number.parseInt(field(148, 8).trim(), 8);
    const copy = Buffer.from(header); copy.fill(32, 148, 156);
    assert.equal(copy.reduce((sum, byte) => sum + byte, 0), checksum);
    assert.equal(field(257, 6), 'ustar'); assert.equal(field(263, 2), '00');
    assert.equal(field(156, 1), '0'); assert.equal(field(157, 100), '');
    assert.equal(field(345, 155), ''); assert.equal(field(265, 32), ''); assert.equal(field(297, 32), '');
    assert.equal(Number.parseInt(field(100, 8), 8), 0o644);
    for (const [start, length] of [[108, 8], [116, 8], [136, 12]]) assert.equal(Number.parseInt(field(start, length), 8), 0);
    const name = field(0, 100); const size = Number.parseInt(field(124, 12), 8);
    const content = bytes.subarray(cursor + 512, cursor + 512 + size);
    assert.equal(content.length, size);
    const next = cursor + 512 + Math.ceil(size / 512) * 512;
    assert(bytes.subarray(cursor + 512 + size, next).equals(Buffer.alloc(next - cursor - 512 - size)));
    entries.push({ name, content }); cursor = next;
    assert(entries.length <= 20);
  }
  assert.equal(bytes.length - cursor, 1024);
  assert(bytes.subarray(cursor).equals(Buffer.alloc(1024)));
  return entries;
}

async function serverPort(handler) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    handler(req, res);
  });
  servers.push(server);
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
  const port = server.address().port;
  const send = (options, timeoutMs = 1000) => postCollection(options, {
    request: (url, init, callback) => {
      assert.equal(url, 'https://api.gateway.ethswarm.org/bzz');
      return request(`http://127.0.0.1:${port}/upload`, init, callback);
    }, timeoutMs,
  });
  return { seen, send };
}

describe('Swarm uploader snapshot and archive boundaries (SIMULATED)', () => {
  it('produces deterministic USTAR containing exact reviewed files, excluding private snapshot siblings', async () => {
    const f = await fixture();
    await writeFile(join(f.snapshot, '.env'), 'DO_NOT_UPLOAD=simulated');
    await writeFile(join(f.snapshot, 'source.tar'), 'SIMULATED private source archive');
    const first = await prepareUpload(f.snapshot);
    f.provenance.artifacts.reverse(); await f.save();
    const second = await prepareUpload(f.snapshot);
    assert(first.archive.equals(second.archive));
    const members = readArchive(first.archive);
    assert.deepEqual(members.map((item) => item.name), Object.keys(f.contents).sort());
    for (const member of members) assert(member.content.equals(f.contents[member.name]));
    assert.equal(first.preview.archiveBytes, first.archive.length);
    assert.equal(first.preview.archiveSha256, sha256(first.archive));
    assert.equal(first.preview.sourceArchiveIncluded, false);
    assert.equal(first.preview.actualPostageBatchId, null);
    assert.equal(first.preview.deploymentReady, false);
  });

  it('rejects changed bytes, missing files, undeclared files and duplicate inventory entries', async () => {
    for (const mode of ['changed', 'missing', 'extra', 'duplicate']) {
      const f = await fixture();
      if (mode === 'changed') await writeFile(join(f.snapshot, 'dist/assets/app.js'), 'altered bytes');
      if (mode === 'missing') await rm(join(f.snapshot, 'dist/assets/app.js'));
      if (mode === 'extra') await writeFile(join(f.snapshot, 'dist/assets/undeclared.js'), 'extra');
      if (mode === 'duplicate') { f.provenance.artifacts.push(f.provenance.artifacts[0]); await f.save(); }
      await assert.rejects(prepareUpload(f.snapshot), /^Error: Swarm upload failed\.$/);
    }
  });

  it('rejects symlink roots, distribution directories, files and provenance', async () => {
    for (const mode of ['root', 'dist', 'file', 'provenance']) {
      const f = await fixture();
      if (mode === 'root') {
        const alias = join(f.root, 'alias'); await symlink(f.snapshot, alias);
        await assert.rejects(prepareUpload(alias)); continue;
      }
      const path = mode === 'dist' ? join(f.snapshot, 'dist') : mode === 'file'
        ? join(f.snapshot, 'dist/assets/app.js') : join(f.snapshot, 'provenance.json');
      const external = join(f.root, 'external');
      if (mode === 'dist') await mkdir(external); else await writeFile(external, 'SIMULATED');
      await rm(path, { recursive: true }); await symlink(external, path);
      await assert.rejects(prepareUpload(f.snapshot));
    }
  });

  it('rejects traversal, unsafe archive types, excessive names/count and oversized USTAR', async () => {
    for (const path of ['dist/../outside.js', 'dist/assets/../bad.js', 'dist/assets/.env', 'dist/assets/source.tar',
      'dist/assets/code.ts', 'dist/assets/a'.repeat(20) + '.js']) {
      const f = await fixture(); f.provenance.artifacts[1].path = path; await f.save();
      await assert.rejects(prepareUpload(f.snapshot));
    }
    const many = await fixture();
    while (many.provenance.artifacts.length < 21) many.provenance.artifacts.push({ path: `dist/assets/${many.provenance.artifacts.length}.js`, bytes: 1, sha256: 'a'.repeat(64) });
    await many.save(); await assert.rejects(prepareUpload(many.snapshot));
    const large = await fixture(); large.provenance.artifacts[1].bytes = 1024 * 1024;
    await large.save(); await assert.rejects(prepareUpload(large.snapshot));
  });

  it('rejects invalid source, ambient configuration, unsafe observer origins and PEM material', async () => {
    for (const modify of [
      (p) => { p.source.commit = 'not-a-source'; },
      (p) => { p.source.archiveRetained = true; },
      (p) => { p.build.ambientEnvironmentForwarded = true; },
      (p) => { p.build.publicEnvironment.SECRET = 'simulated'; },
      (p) => { p.build.publicEnvironment.MONOLITH_PUBLIC_OBSERVER_URL = 'https://user:pass@observer.example.org'; },
      (p) => { p.build.publicEnvironment.MONOLITH_PUBLIC_OBSERVER_URL = 'http://127.0.0.1:3001'; },
    ]) {
      const f = await fixture(); modify(f.provenance); await f.save(); await assert.rejects(prepareUpload(f.snapshot));
    }
    const f = await fixture(); const body = Buffer.from('-----BEGIN PRIVATE KEY-----\nSIMULATED\n');
    await writeFile(join(f.snapshot, 'dist/assets/app.js'), body);
    Object.assign(f.provenance.artifacts[1], { bytes: body.length, sha256: sha256(body) }); await f.save();
    await assert.rejects(prepareUpload(f.snapshot));
  });
});

describe('Swarm uploader execution boundaries (SIMULATED)', () => {
  it('preview writes only the archive/receipt and performs zero POSTs', async () => {
    const f = await fixture(); let posts = 0;
    const result = await runCli(f.argv, { postCollection: () => { posts++; throw new Error('must not run'); } });
    assert.equal(posts, 0); assert.equal(result.status, 'PREVIEW_ONLY');
    assert.deepEqual((await readdir(f.out)).sort(), ['collection.tar', 'release-preview.json']);
    assert.deepEqual(JSON.parse(await readFile(join(f.out, 'release-preview.json'), 'utf8')), result);
    assert.equal((await lstat(f.out)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(f.out, 'collection.tar'))).mode & 0o777, 0o600);
    const cli = spawnSync(process.execPath, [modulePath, '--snapshot', f.snapshot, '--out', join(f.root, 'cli')], { encoding: 'utf8' });
    assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).status, 'PREVIEW_ONLY');
  });

  it('explicit upload has durable intent before one exact POST and leaves all acceptance untested', async () => {
    const f = await fixture(); let calls = 0;
    const port = await serverPort((_req, res) => { res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ reference })); });
    const result = await runCli([...f.argv, '--upload'], { postCollection: async (options) => {
      calls++;
      const intent = JSON.parse(await readFile(join(f.out, 'upload-intent.json'), 'utf8'));
      assert.equal(intent.status, 'UPLOAD_OUTCOME_UNCERTAIN'); assert.equal(intent.maximumPostCount, 1);
      assert.equal(intent.archiveSha256, sha256(options.archive));
      assert.equal((await lstat(join(f.out, 'upload-intent.json'))).mode & 0o777, 0o600);
      return port.send(options);
    } });
    assert.equal(calls, 1); assert.equal(port.seen.length, 1); const sent = port.seen[0];
    assert.equal(sent.method, 'POST'); assert.equal(sent.path, '/upload');
    assert.equal(sent.headers['content-type'], 'application/x-tar');
    assert.equal(sent.headers['swarm-collection'], 'true'); assert.equal(sent.headers['swarm-index-document'], 'index.html');
    assert.equal(sent.headers['swarm-postage-batch-id'], '0'.repeat(64)); assert.equal(sent.headers['swarm-deferred-upload'], 'false');
    assert.equal(sent.headers.authorization, undefined); assert.equal(sent.headers.cookie, undefined);
    assert.equal(sent.headers['swarm-error-document'], undefined);
    assert(sent.body.equals(await readFile(join(f.out, 'collection.tar')))); readArchive(sent.body);
    assert.equal(result.status, 'UPLOADED_NOT_VERIFIED'); assert.equal(result.reference, reference);
    assert.equal(result.cid, 'bah5acgzaxsnziiqsiipcugp6d767blowigxfgcjdaqpkr5kjhalupmklf4wq');
    assert.equal(result.actualPostageBatchId, null); assert.equal(result.postageProvenance, 'UNKNOWN');
    assert.equal(result.artifactIdentity, 'UNTESTED'); assert.equal(result.privacy, 'UNTESTED');
    assert.equal(result.arkiv, 'UNTESTED'); assert.equal(result.deploymentReady, false);
    await assert.rejects(runCli([...f.argv, '--upload'], { postCollection: () => { calls++; } }));
    assert.equal(calls, 1);
  });

  it('does not follow redirects or leak upstream response bodies and preserves uncertain intent', async () => {
    const f = await fixture();
    const port = await serverPort((_req, res) => { res.writeHead(302, { location: '/must-not-follow' }); res.end('SIMULATED_PRIVATE_UPSTREAM_MESSAGE'); });
    const result = await runCli([...f.argv, '--upload'], { postCollection: port.send });
    assert.equal(port.seen.length, 1); assert.equal(result.status, 'UPLOAD_NOT_CONFIRMED');
    assert.equal(result.failure, 'HTTP_NOT_CONFIRMED');
    assert(!JSON.stringify(result).includes('SIMULATED_PRIVATE_UPSTREAM_MESSAGE'));
    assert.equal(JSON.parse(await readFile(join(f.out, 'upload-intent.json'), 'utf8')).reconcileBeforeAnotherAttempt, true);
    assert.equal(JSON.parse(await readFile(join(f.out, 'upload-receipt.json'), 'utf8')).status, 'UPLOAD_NOT_CONFIRMED');
  });

  it('requires both output-parent and intent-directory persistence before any upload', async () => {
    const f = await fixture(); const synchronized = []; let posts = 0;
    const result = await runCli([...f.argv, '--upload'], {
      syncDirectory: async (path) => { synchronized.push(path); },
      postCollection: async () => {
        posts++;
        assert.deepEqual(synchronized, [f.root, f.out]);
        assert.equal(JSON.parse(await readFile(join(f.out, 'upload-intent.json'), 'utf8')).status, 'UPLOAD_OUTCOME_UNCERTAIN');
        return { statusCode: 201, mime: 'application/json', body: Buffer.from(JSON.stringify({ reference })) };
      },
    });
    assert.equal(result.status, 'UPLOADED_NOT_VERIFIED'); assert.equal(posts, 1);
    for (const blockedStage of ['parent', 'owned']) {
      const blocked = await fixture(); let requests = 0;
      await assert.rejects(runCli([...blocked.argv, '--upload'], {
        syncDirectory: async (path) => {
          if (path === (blockedStage === 'parent' ? blocked.root : blocked.out)) throw new Error('SIMULATED filesystem persistence failure');
        },
        postCollection: () => { requests++; },
      }));
      assert.equal(requests, 0);
      if (blockedStage === 'owned') assert.equal(JSON.parse(await readFile(join(blocked.out, 'upload-intent.json'), 'utf8')).reconcileBeforeAnotherAttempt, true);
    }
  });

  it('bounds declared/streaming response size and absolute timeout without retrying', async () => {
    for (const kind of ['declared', 'stream', 'timeout']) {
      const f = await fixture();
      const port = await serverPort((_req, res) => {
        res.writeHead(201, { 'content-type': 'application/json', ...(kind === 'declared' ? { 'content-length': String(65537) } : {}) });
        if (kind === 'timeout') {
          const interval = setInterval(() => res.write(' '), 5); res.on('close', () => clearInterval(interval));
        } else res.end(Buffer.alloc(65537, 97));
      });
      const result = await runCli([...f.argv, '--upload'], { postCollection: (options) => port.send(options, kind === 'timeout' ? 40 : 1000) });
      assert.equal(result.status, 'UPLOAD_NOT_CONFIRMED'); assert.equal(port.seen.length, 1);
      assert.equal(result.failure, kind === 'timeout' ? 'DEADLINE_EXCEEDED' : 'RESPONSE_LIMIT');
    }
  });

  it('rejects wrong MIME, compression, invalid JSON/UTF8/references and supplied extra fields', async () => {
    const responses = [
      { mime: 'text/html', bytes: Buffer.from(JSON.stringify({ reference })) },
      { mime: 'application/json', bytes: Buffer.from('not-json: SIMULATED_SECRET') },
      { mime: 'application/json', bytes: Buffer.from([0xff]) },
      { mime: 'application/json', bytes: Buffer.from(JSON.stringify({ reference: 'a'.repeat(128) })) },
      { mime: 'application/json', bytes: Buffer.from(JSON.stringify({ reference, secret: 'SIMULATED_SECRET' })) },
      { mime: 'application/json', bytes: Buffer.from(JSON.stringify({ reference })), encoding: 'gzip' },
    ];
    for (const response of responses) {
      const f = await fixture();
      const port = await serverPort((_req, res) => {
        res.writeHead(201, { 'content-type': response.mime, ...(response.encoding ? { 'content-encoding': response.encoding } : {}) });
        res.end(response.bytes);
      });
      const result = await runCli([...f.argv, '--upload'], { postCollection: port.send });
      assert.equal(result.status, 'UPLOAD_NOT_CONFIRMED'); assert.equal(result.failure, 'RESPONSE_INVALID');
      assert.equal(port.seen.length, 1); assert(!JSON.stringify(result).includes('SIMULATED_SECRET'));
      assert.equal(result.reference, undefined);
    }
  });

  it('rejects existing outputs and malformed arguments before any transport operation', async () => {
    const f = await fixture(); let calls = 0;
    await mkdir(f.out); await writeFile(join(f.out, 'keep.txt'), 'keep');
    await assert.rejects(runCli([...f.argv, '--upload'], { postCollection: () => { calls++; } }));
    assert.equal(calls, 0); assert.equal(await readFile(join(f.out, 'keep.txt'), 'utf8'), 'keep');
    for (const args of [[], ['--snapshot', 'relative', '--out', f.out], [...f.argv, '--upload', '--upload'],
      [...f.argv, '--bee-url', 'https://evil.example.org'], [...f.argv, '--out', f.out]]) assert.throws(() => parseArguments(args));
    const invalid = spawnSync(process.execPath, [modulePath, '--snapshot', f.snapshot, '--out', f.out, '--token', 'SIMULATED_SECRET'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.equal(invalid.stderr, 'Swarm upload failed.\n');
    assert(!invalid.stdout.includes('SIMULATED_SECRET'));
    const inside = [...f.argv]; inside[3] = join(f.snapshot, 'output');
    await assert.rejects(runCli(inside));
    assert.equal(dirname(inside[3]), f.snapshot);
  });
});
