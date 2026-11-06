import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicObserverOrigin } from './prepare-static.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SITES_JSD_TEMPLATE_SHA256 = '5c4f4c7822215cd0625b3ee9a67def801a05caa4891443116af3e81fa371c9b6';

/** Accept one reviewed hosting addition, with every authored byte unchanged. */
export function verifySitesHtmlAddition(authored, served) {
  const marker = Buffer.from('</body>');
  const insertion = authored.lastIndexOf(marker);
  assert(insertion >= 0 && served.length === authored.length + 1114, 'Unexpected hosted HTML addition size.');
  const before = authored.subarray(0, insertion); const after = authored.subarray(insertion);
  assert(served.subarray(0, before.length).equals(before) &&
    served.subarray(served.length - after.length).equals(after), 'Authored HTML bytes changed.');
  const addition = served.subarray(before.length, served.length - after.length);
  const text = addition.toString('utf8');
  assert(Buffer.from(text).equals(addition), 'Invalid hosted HTML encoding.');
  const params = [...text.matchAll(/window\.__CF\$cv\$params=\{r:'([a-f0-9]{16})',t:'([A-Za-z0-9+/]{14}==)'\};/g)];
  const rays = [...text.matchAll(/\?ray=([a-f0-9]{16})/g)];
  assert(params.length === 1 && rays.length === 1 && params[0][1] === rays[0][1],
    'Unexpected hosting challenge parameters.');
  const [, ray, encodedTime] = params[0]; const timestamp = Buffer.from(encodedTime, 'base64').toString('ascii');
  assert(/^[0-9]{10}$/.test(timestamp) && Buffer.from(timestamp).toString('base64') === encodedTime,
    'Unexpected hosting challenge timestamp.');
  const normalized = text.replace(`r:'${ray}',t:'${encodedTime}'`, "r:'0000000000000000',t:'MDAwMDAwMDAwMA=='")
    .replace(`?ray=${ray}`, '?ray=0000000000000000');
  assert.equal(sha(normalized), SITES_JSD_TEMPLATE_SHA256, 'Unreviewed hosting HTML addition.');
  return { kind: 'CLOUDFLARE_JAVASCRIPT_DETECTION', bytes: addition.length,
    sha256: sha(addition), normalizedTemplateSha256: SITES_JSD_TEMPLATE_SHA256,
    insertion: 'BEFORE_CLOSING_BODY', dynamicFields: ['rayId', 'timestamp'] };
}

/** Byte-check a publication against the retained, locally trusted build snapshot. */
export async function verifyStatic({ origin, snapshot, request = fetch, allowCanonicalHtmlRedirects = false,
  allowReviewedSitesHtmlAddition = false }) {
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
  const localFiles = new Map();
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
    const parts = row.path.split('/');
    for (const [index, part] of parts.entries()) {
      parent = join(parent, part);
      const info = await lstat(parent);
      assert(!info.isSymbolicLink(), 'Snapshot symlink rejected.');
      if (index === parts.length - 1) {
        assert(info.isFile() && info.size === row.bytes, 'Regular artifact with bound size required.');
      } else assert(info.isDirectory(), 'Artifact parents must be directories.');
    }
    const local = await readFile(join(snapshot, row.path));
    assert.equal(local.length, row.bytes); assert.equal(sha(local), row.sha256);
    localFiles.set(row.path, local);
  }
  assert(paths.has('dist/index.html') && paths.has('dist/assets/worker-host.html'), 'Live worker host is required.');
  assert(paths.has('dist/assets/THIRD-PARTY-NOTICES.txt'), 'Served license notices are required.');
  const result = {
    schemaVersion: 1, evidence: 'OBSERVED_LIVE', passed: false,
    generatedAt: null, siteOrigin: site, sourceCommit: provenance.source.commit,
    htmlRedirectPolicy: allowCanonicalHtmlRedirects ? 'EXACT_SAME_ORIGIN_307' : 'REJECT',
    htmlAdditionPolicy: allowReviewedSitesHtmlAddition ? 'PINNED_CLOUDFLARE_JSD_TEMPLATE' : 'REJECT',
    snapshotProvenanceSha256: sha(manifestBytes), files: [], workerHost: null,
    rootDocumentMatchesIndex: false,
    limitations: ['Authored asset identity only; browser worker execution and privacy acceptance require separate observations.',
      'When explicitly enabled, reviewed hosting security HTML is recorded separately. Its fetched challenge runtime and non-anonymous bootstrap are outside transport verification.'],
  };
  const bodies = new Map();
  const targets = provenance.artifacts.map((row) => ({ ...row, servedPath: row.path.slice('dist'.length) }));
  targets.push({ ...provenance.artifacts.find((row) => row.path === 'dist/index.html'), servedPath: '/' });
  for (const row of targets) {
    const path = row.servedPath;
    const canonicalPath = allowCanonicalHtmlRedirects
      ? { '/index.html': '/', '/assets/worker-host.html': '/assets/worker-host' }[path] : undefined;
    let response = await request(`${site}${path}`, {
      redirect: canonicalPath ? 'manual' : 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
    let redirect = null;
    if (canonicalPath && response.status === 307) {
      const location = response.headers.get('location');
      assert(location === canonicalPath || location === `${site}${canonicalPath}`,
        'Unexpected canonical HTML redirect.');
      await response.body?.cancel();
      redirect = { status: 307, from: path, to: canonicalPath };
      response = await request(`${site}${canonicalPath}`, {
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000),
      });
    }
    assert.equal(response.status, 200, `Unexpected status for ${path}.`);
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (path === '/' || path.endsWith('.html')) assert.equal(mime, 'text/html', 'HTML MIME required.');
    if (path.endsWith('.js') || path.endsWith('.mjs')) assert(['application/javascript', 'text/javascript'].includes(mime), 'JavaScript MIME required.');
    if (path.endsWith('.wasm')) assert.equal(mime, 'application/wasm', 'WASM MIME required.');
    if (path.endsWith('.css')) assert.equal(mime, 'text/css', 'CSS MIME required.');
    const contentLength = response.headers.get('content-length');
    if (contentLength) assert(Number(contentLength) <= 24 * 1024 * 1024, 'Oversized response.');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length; assert(bytes <= 24 * 1024 * 1024, 'Oversized response.'); chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const observedSha256 = sha(body);
    let hostingAddition = null;
    if (allowReviewedSitesHtmlAddition && ['/index.html', '/', '/assets/worker-host.html'].includes(path) &&
      (body.length !== row.bytes || observedSha256 !== row.sha256)) {
      hostingAddition = verifySitesHtmlAddition(localFiles.get(row.path), body);
    } else {
      assert.equal(body.length, row.bytes, `Published size differs for ${path}.`);
      assert.equal(observedSha256, row.sha256, `Published bytes differ for ${path}.`);
    }
    result.files.push({ path, servedPath: redirect?.to ?? path, redirect, bytes: body.length, sha256: observedSha256,
      authoredBytes: row.bytes, authoredSha256: row.sha256, authoredBytesVerified: true,
      hostingAddition, status: response.status, mime });
    bodies.set(path, body);
  }
  const worker = bodies.get('/assets/worker-host.html').toString('utf8');
  assert.notEqual(worker, bodies.get('/index.html').toString('utf8'), 'Worker host resolved to SPA fallback.');
  assert.match(worker, /Monolith transport host/);
  const module = /<script\b[^>]*type="module"[^>]*src="([^"]+)"/.exec(worker)?.[1];
  assert(module?.startsWith('/assets/') && bodies.has(module), 'Worker host must load a verified local module.');
  result.workerHost = { path: '/assets/worker-host.html', distinctFromIndex: true, module, moduleVerified: true };
  result.rootDocumentMatchesIndex = true;
  result.passed = true; result.generatedAt = new Date().toISOString();
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [origin, snapshot, output, ...policies] = process.argv.slice(2);
    assert(origin && snapshot && output && new Set(policies).size === policies.length &&
      policies.every((value) => ['--allow-canonical-html-redirects', '--allow-reviewed-sites-html-addition'].includes(value)),
    'Usage: node verify-static.mjs <HTTPS origin> <absolute snapshot> <new output JSON> [--allow-canonical-html-redirects] [--allow-reviewed-sites-html-addition]');
    assert(isAbsolute(output), 'Use an absolute new output path.');
    const result = await verifyStatic({ origin, snapshot,
      allowCanonicalHtmlRedirects: policies.includes('--allow-canonical-html-redirects'),
      allowReviewedSitesHtmlAddition: policies.includes('--allow-reviewed-sites-html-addition') });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ passed: true, files: result.files.length, sourceCommit: result.sourceCommit, output })}\n`);
  } catch (error) {
    process.stderr.write(`Deployment verification failed: ${error.message}\n`); process.exitCode = 1;
  }
}
