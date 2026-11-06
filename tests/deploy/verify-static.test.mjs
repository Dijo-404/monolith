import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyStatic } from '../../scripts/deploy/verify-static.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'monolith-verify-static-')); roots.push(root);
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  const files = new Map([
    ['/index.html', '<html><script type="module" src="/assets/app.js"></script></html>'],
    ['/assets/app.js', 'console.log("synthetic app")'],
    ['/assets/host.js', 'console.log("synthetic host")'],
    ['/assets/worker-host.html', '<html><title>Monolith transport host</title><script type="module" crossorigin src="/assets/host.js"></script></html>'],
    ['/assets/THIRD-PARTY-NOTICES.txt', 'Synthetic retained license fixture'],
  ]);
  const artifacts = [];
  for (const [path, content] of files) {
    await writeFile(join(root, 'dist', path), content);
    artifacts.push({ path: `dist${path}`, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') });
  }
  const provenance = { schemaVersion: 1, source: { commit: '1'.repeat(40) }, sourceDisclosure: 'compiled-static-artifact-only', artifacts };
  await writeFile(join(root, 'provenance.json'), JSON.stringify(provenance));
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    const mime = path === '/' || path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/plain';
    return new Response(files.get(path === '/' ? '/index.html' : path), { status: 200, headers: { 'content-type': mime } });
  };
  return { root, files, provenance, calls, request };
}

describe('deployed static provenance verification', () => {
  it('checks every locally bound byte and distinct worker module with bounded, credential-free GETs', async () => {
    const f = await fixture();
    const result = await verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request: f.request });
    expect(result.passed).toBe(true); expect(result.files).toHaveLength(6);
    expect(result.rootDocumentMatchesIndex).toBe(true);
    expect(result.workerHost.moduleVerified).toBe(true);
    expect(f.calls.every(({ options }) => options.redirect === 'error' && options.credentials === 'omit' && options.signal)).toBe(true);
  });
  it('rejects a changed live script instead of accepting a successful status', async () => {
    const f = await fixture(); f.files.set('/assets/app.js', 'console.log("different code")');
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request: f.request })).rejects.toThrow(/Published (?:size|bytes) differs/);
  });
  it('rejects duplicate and traversal manifest entries before any network contact', async () => {
    const f = await fixture();
    for (const invalid of [f.provenance.artifacts[0], { ...f.provenance.artifacts[0], path: 'dist/assets/../../outside' }]) {
      await writeFile(join(f.root, 'provenance.json'), JSON.stringify({ ...f.provenance, artifacts: [...f.provenance.artifacts, invalid] }));
      await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request: f.request })).rejects.toThrow();
    }
    expect(f.calls).toHaveLength(0);
  });
  it('rejects symlinked artifact parents before fetching', async () => {
    const f = await fixture();
    await rm(join(f.root, 'dist/assets'), { recursive: true });
    await symlink(tmpdir(), join(f.root, 'dist/assets'));
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request: f.request })).rejects.toThrow(/symlink/);
    expect(f.calls).toHaveLength(0);
  });
  it('rejects a wrong root document even when index.html is correct', async () => {
    const f = await fixture();
    const request = (url, options) => new URL(url).pathname === '/'
      ? new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) : f.request(url, options);
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request })).rejects.toThrow(/Published (?:size|bytes) differs/);
  });
  it('rejects non-executable worker HTML and JavaScript MIME types', async () => {
    const f = await fixture();
    for (const target of ['/assets/worker-host.html', '/assets/host.js']) {
      const request = (url, options) => new URL(url).pathname === target
        ? new Response(f.files.get(target), { headers: { 'content-type': 'text/plain' } }) : f.request(url, options);
      await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request })).rejects.toThrow(/MIME required/);
    }
  });
  it('rejects nonregular or oversized local artifacts before reading or contacting the site', async () => {
    const f = await fixture();
    const artifact = join(f.root, 'dist/assets/app.js');
    await writeFile(artifact, 'x'.repeat(100_000));
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request: f.request })).rejects.toThrow(/Regular artifact/);
    await rm(artifact); await mkdir(artifact);
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request: f.request })).rejects.toThrow(/Regular artifact/);
    expect(f.calls).toHaveLength(0);
  });
});
