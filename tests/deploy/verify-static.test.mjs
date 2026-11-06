import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifySitesHtmlAddition, verifyStatic } from '../../scripts/deploy/verify-static.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'monolith-verify-static-')); roots.push(root);
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  const files = new Map([
    ['/index.html', '<html><body><script type="module" src="/assets/app.js"></script></body></html>'],
    ['/assets/app.js', 'console.log("synthetic app")'],
    ['/assets/host.js', 'console.log("synthetic host")'],
    ['/assets/worker-host.html', '<html><title>Monolith transport host</title><body><script type="module" crossorigin src="/assets/host.js"></script></body></html>'],
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
  it('explicitly verifies authored HTML and records a pinned hosting template separately from served bytes', async () => {
    const f = await fixture();
    const addition = await readFile(new URL('./fixtures/cloudflare-js-detection-simulated.html', import.meta.url), 'utf8');
    const request = (url, options) => {
      const path = new URL(url).pathname; const html = f.files.get(path === '/' ? '/index.html' : path);
      return path === '/' || path.endsWith('.html')
        ? new Response(html.replace('</body>', `${addition}</body>`), { headers: { 'content-type': 'text/html' } }) : f.request(url, options);
    };
    const result = await verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowReviewedSitesHtmlAddition: true });
    expect(result.htmlAdditionPolicy).toBe('PINNED_CLOUDFLARE_JSD_TEMPLATE');
    const html = result.files.filter((row) => row.hostingAddition);
    expect(html).toHaveLength(3);
    expect(html.every((row) => row.authoredBytesVerified && row.bytes === row.authoredBytes + 1114 &&
      row.sha256 !== row.authoredSha256 && row.hostingAddition.normalizedTemplateSha256 ===
      '5c4f4c7822215cd0625b3ee9a67def801a05caa4891443116af3e81fa371c9b6')).toBe(true);
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request })).rejects.toThrow(/Published size differs/);
  });
  it('accepts only canonical dynamic challenge fields without persisting their values', async () => {
    const template = await readFile(new URL('./fixtures/cloudflare-js-detection-simulated.html', import.meta.url), 'utf8');
    const ray = '0123456789abcdef'; const time = Buffer.from('1793994128').toString('base64');
    const addition = template.replaceAll('0000000000000000', ray).replace('MDAwMDAwMDAwMA==', time);
    const original = Buffer.from('<html><body>synthetic</body></html>');
    const served = Buffer.from(original.toString().replace('</body>', `${addition}</body>`));
    const result = verifySitesHtmlAddition(original, served);
    expect(result.bytes).toBe(1114); expect(result.insertion).toBe('BEFORE_CLOSING_BODY');
    expect(JSON.stringify(result)).not.toContain(ray); expect(JSON.stringify(result)).not.toContain(time);
  });
  for (const fault of ['authored-change', 'unknown-script-change', 'wrong-placement', 'two-additions', 'extra-byte',
    'mismatched-ray', 'nonnumeric-time', 'uppercase-ray', 'invalid-time-encoding']) {
    it(`rejects unreviewed hosted HTML instead of generically removing scripts: ${fault}`, async () => {
      const template = await readFile(new URL('./fixtures/cloudflare-js-detection-simulated.html', import.meta.url), 'utf8');
      const original = '<html><body>synthetic</body></html>';
      let addition = template; let authored = original; let marker = '</body>';
      if (fault === 'authored-change') authored = original.replace('synthetic', 'different');
      if (fault === 'unknown-script-change') addition = addition.replace('a.style.top=0;', 'a.style.top=1;');
      if (fault === 'wrong-placement') marker = '</html>';
      if (fault === 'two-additions') addition += addition;
      if (fault === 'extra-byte') addition += ' ';
      if (fault === 'mismatched-ray') addition = addition.replace('?ray=0000000000000000', '?ray=1111111111111111');
      if (fault === 'nonnumeric-time') addition = addition.replace('MDAwMDAwMDAwMA==', Buffer.from('abcdefghij').toString('base64'));
      if (fault === 'uppercase-ray') addition = addition.replaceAll('0000000000000000', 'ABCDEF0123456789');
      if (fault === 'invalid-time-encoding') addition = addition.replace('MDAwMDAwMDAwMA==', 'not-a-timestamp');
      const served = authored.replace(marker, `${addition}${marker}`);
      expect(() => verifySitesHtmlAddition(Buffer.from(original), Buffer.from(served))).toThrow();
    });
  }
  it('does not allow a hosting addition on a script asset', async () => {
    const f = await fixture(); const addition = await readFile(new URL('./fixtures/cloudflare-js-detection-simulated.html', import.meta.url), 'utf8');
    const request = (url, options) => new URL(url).pathname === '/assets/app.js'
      ? new Response(f.files.get('/assets/app.js') + addition, { headers: { 'content-type': 'text/javascript' } }) : f.request(url, options);
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowReviewedSitesHtmlAddition: true })).rejects.toThrow(/Published size differs/);
  });
  it('records and byte-checks only the two explicitly enabled same-origin HTML canonicalizations', async () => {
    const f = await fixture(); const calls = [];
    const request = async (url, options) => {
      const path = new URL(url).pathname; calls.push({ path, options });
      const target = { '/index.html': '/', '/assets/worker-host.html': '/assets/worker-host' }[path];
      if (target) return new Response(null, { status: 307, headers: { location: target } });
      if (path === '/assets/worker-host') return new Response(f.files.get('/assets/worker-host.html'), { headers: { 'content-type': 'text/html' } });
      return f.request(url, options);
    };
    const result = await verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true });
    expect(result.htmlRedirectPolicy).toBe('EXACT_SAME_ORIGIN_307');
    expect(result.files.filter((row) => row.redirect).map((row) => row.redirect)).toEqual([
      { status: 307, from: '/index.html', to: '/' },
      { status: 307, from: '/assets/worker-host.html', to: '/assets/worker-host' },
    ]);
    expect(result.workerHost.moduleVerified).toBe(true);
    expect(calls.filter(({ options }) => options.redirect === 'manual').map(({ path }) => path))
      .toEqual(['/index.html', '/assets/worker-host.html']);
    expect(calls.every(({ options }) => options.credentials === 'omit' && options.signal)).toBe(true);
  });
  it('keeps redirects rejected by default', async () => {
    const f = await fixture(); const visited = [];
    const request = (url, options) => {
      visited.push(new URL(url).pathname);
      return new URL(url).pathname === '/index.html'
        ? new Response(null, { status: 307, headers: { location: '/' } }) : f.request(url, options);
    };
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request })).rejects.toThrow(/Unexpected status/);
    expect(visited).toEqual(['/index.html']);
  });
  for (const location of ['https://other.host/', '//other.host/', '/?token=synthetic', '/#fragment',
    'https://user:synthetic@monolith.host/', '/assets/worker-host', '/index.html', 'https://monolith.host:444/', '/%2f']) {
    it(`rejects an unexpected canonical destination without following it: ${location}`, async () => {
      const f = await fixture(); const visited = [];
      const request = (url) => { visited.push(new URL(url).pathname); return new Response(null, { status: 307, headers: { location } }); };
      await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true }))
        .rejects.toThrow(/Unexpected canonical HTML redirect/);
      expect(visited).toEqual(['/index.html']);
    });
  }
  it('accepts an exact absolute same-origin canonical destination', async () => {
    const f = await fixture();
    const request = (url, options) => new URL(url).pathname === '/index.html'
      ? new Response(null, { status: 307, headers: { location: 'https://monolith.host/' } }) : f.request(url, options);
    expect((await verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true })).passed).toBe(true);
  });
  for (const status of [301, 302, 308]) {
    it(`rejects an unapproved redirect status ${status}`, async () => {
      const f = await fixture();
      const request = () => new Response(null, { status, headers: { location: '/' } });
      await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true })).rejects.toThrow(/Unexpected status/);
    });
  }
  it('rejects a second redirect and does not follow a chain', async () => {
    const f = await fixture(); const visited = [];
    const request = (url) => { visited.push(new URL(url).pathname); return new Response(null, { status: 307, headers: { location: '/' } }); };
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true })).rejects.toThrow(/Unexpected status/);
    expect(visited).toEqual(['/index.html', '/']);
  });
  it('rejects redirected script assets even when HTML canonicalization is enabled', async () => {
    const f = await fixture(); const visited = [];
    const request = (url, options) => {
      const path = new URL(url).pathname; visited.push(path);
      return path === '/assets/app.js' ? new Response(null, { status: 307, headers: { location: '/assets/host.js' } }) : f.request(url, options);
    };
    await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true })).rejects.toThrow(/Unexpected status/);
    expect(visited).toEqual(['/index.html', '/assets/app.js']);
  });
  for (const wrongMime of [false, true]) {
    it(`still rejects incorrect canonical HTML ${wrongMime ? 'MIME' : 'bytes'}`, async () => {
      const f = await fixture();
      const request = (url, options) => {
        const path = new URL(url).pathname;
        if (path === '/index.html') return new Response(null, { status: 307, headers: { location: '/' } });
        if (path === '/') return new Response(wrongMime ? f.files.get('/index.html') : '<html>different</html>',
          { headers: { 'content-type': wrongMime ? 'text/plain' : 'text/html' } });
        return f.request(url, options);
      };
      await expect(verifyStatic({ origin: 'https://monolith.host', snapshot: f.root, request, allowCanonicalHtmlRedirects: true })).rejects.toThrow(wrongMime ? /MIME required/ : /Published (?:size|bytes) differs/);
    });
  }
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
