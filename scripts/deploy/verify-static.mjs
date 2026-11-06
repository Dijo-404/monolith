import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicObserverOrigin } from './prepare-static.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Byte-check a publication against the retained, locally trusted build snapshot. */
export async function verifyStatic({ origin, snapshot, request = fetch }) {
  const site = publicObserverOrigin(origin);
  assert(isAbsolute(snapshot), 'Use an absolute retained snapshot directory.');
  assert.equal(await realpath(snapshot), snapshot, 'Snapshot must not contain symlink aliases.');
  assert((await lstat(join(snapshot, 'provenance.json'))).isFile(), 'Regular provenance required.');
  assert((await lstat(join(snapshot, 'provenance.json'))).size <= 1024 * 1024, 'Oversized provenance.');
  const manifestBytes = await readFile(join(snapshot, 'provenance.json'));
  const provenance = JSON.parse(manifestBytes);
  assert.equal(provenance.schemaVersion, 1);
  assert.match(provenance.source.commit, /^[0-9a-f]{40}$/);
  assert.equal(provenance.sourceDisclosure, 'compiled-static-artifact-only');
  assert(Array.isArray(provenance.artifacts) && provenance.artifacts.length > 0 && provenance.artifacts.length <= 1000);
  const paths = new Set();
  let totalBytes = 0;
  for (const row of provenance.artifacts) {
    assert(typeof row.path === 'string' && /^dist\/(?:index\.html|assets\/[a-zA-Z0-9_./-]+)$/.test(row.path));
    assert(!row.path.split('/').some((part) => ['', '.', '..'].includes(part)), 'Unsafe manifest path.');
    assert(!paths.has(row.path), 'Duplicate manifest path.'); paths.add(row.path);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 24 * 1024 * 1024);
    totalBytes += row.bytes; assert(totalBytes <= 64 * 1024 * 1024, 'Oversized distribution.');
    // Check every parent too: a locally changed snapshot cannot redirect the verifier outside it.
    let parent = snapshot;
    for (const part of row.path.split('/')) {
      parent = join(parent, part);
      assert(!(await lstat(parent)).isSymbolicLink(), 'Snapshot symlink rejected.');
    }
    const local = await readFile(join(snapshot, row.path));
    assert.equal(local.length, row.bytes); assert.equal(sha(local), row.sha256);
  }
  assert(paths.has('dist/index.html') && paths.has('dist/assets/worker-host.html'), 'Live worker host is required.');
  assert(paths.has('dist/assets/THIRD-PARTY-NOTICES.txt'), 'Served license notices are required.');
  const result = {
    schemaVersion: 1, evidence: 'OBSERVED_LIVE', passed: false,
    generatedAt: null, siteOrigin: site, sourceCommit: provenance.source.commit,
    snapshotProvenanceSha256: sha(manifestBytes), files: [], workerHost: null,
    limitations: ['Static byte identity only; browser worker execution and privacy acceptance require separate observations.'],
  };
  const bodies = new Map();
  for (const row of provenance.artifacts) {
    const path = row.path.slice('dist'.length);
    const response = await request(`${site}${path}`, {
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, `Unexpected status for ${path}.`);
    const contentLength = response.headers.get('content-length');
    if (contentLength) assert(Number(contentLength) <= 24 * 1024 * 1024, 'Oversized response.');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length; assert(bytes <= 24 * 1024 * 1024, 'Oversized response.'); chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    assert.equal(body.length, row.bytes, `Published size differs for ${path}.`);
    assert.equal(sha(body), row.sha256, `Published bytes differ for ${path}.`);
    result.files.push({ path, bytes: body.length, sha256: row.sha256, status: response.status });
    bodies.set(path, body);
  }
  const worker = bodies.get('/assets/worker-host.html').toString('utf8');
  assert.notEqual(worker, bodies.get('/index.html').toString('utf8'), 'Worker host resolved to SPA fallback.');
  assert.match(worker, /Monolith transport host/);
  const module = /<script\b[^>]*type="module"[^>]*src="([^"]+)"/.exec(worker)?.[1];
  assert(module?.startsWith('/assets/') && bodies.has(module), 'Worker host must load a verified local module.');
  result.workerHost = { path: '/assets/worker-host.html', distinctFromIndex: true, module, moduleVerified: true };
  result.passed = true; result.generatedAt = new Date().toISOString();
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [origin, snapshot, output] = process.argv.slice(2);
    assert(origin && snapshot && output && process.argv.length === 5, 'Usage: node verify-static.mjs <HTTPS origin> <absolute snapshot> <new output JSON>');
    assert(isAbsolute(output), 'Use an absolute new output path.');
    const result = await verifyStatic({ origin, snapshot });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ passed: true, files: result.files.length, sourceCommit: result.sourceCommit, output })}\n`);
  } catch (error) {
    process.stderr.write(`Deployment verification failed: ${error.message}\n`); process.exitCode = 1;
  }
}
