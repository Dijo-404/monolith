// Supplementary real-keyboard anchor frames; no RPC or live privacy acceptance.
/* global document, window, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../../..');
const output = join(directory, 'browser/navigation');
const preview = new URL(process.env['MONOLITH_UI_PREVIEW_URL'] ?? 'http://127.0.0.1:5196/');
assert.equal(process.version, 'v24.22.2');
assert.equal(preview.protocol, 'http:');
assert(['127.0.0.1', 'localhost'].includes(preview.hostname));
assert.equal(preview.pathname + preview.search + preview.hash, '/');
const requireTools = createRequire(join(process.env['MONOLITH_BROWSER_TOOLS'] ?? '/tmp/monolith-mn003-env', 'package.json'));
assert.equal(requireTools('playwright/package.json').version, '1.65.0');
const { chromium } = requireTools('playwright');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baselinePath = join(directory, 'browser/current/browser-result.json');
const baselineBytes = await readFile(baselinePath);
const baseline = JSON.parse(baselineBytes);
assert.equal(baseline.passed, true);
assert.equal(baseline.checks.length, 26);
const baselineHash = digest(baselineBytes);
async function inventory(root, prefix = '') {
  const entries = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(entries, await inventory(root, name));
    else entries[name] = digest(await readFile(join(root, name)));
  }
  return entries;
}
async function binding() {
  return {
    source: await inventory(join(repository, 'apps/dashboard/src')),
    dist: await inventory(join(repository, 'apps/dashboard/dist')),
    package: digest(await readFile(join(repository, 'apps/dashboard/package.json'))),
    lockfile: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
    runner: digest(await readFile(join(directory, 'browser-journey.mjs'))),
  };
}
const sourceBefore = await binding();
assert.deepEqual(sourceBefore, baseline.sourceAfter);
await mkdir(output);
const result = {
  schemaVersion: 1, sourceTask: '#86', evidence: 'UNTESTED',
  scope: 'Actual local production-preview keyboard navigation and sticky-header bounds only. No live RPC or privacy acceptance.',
  startedAt: new Date().toISOString(), passed: false, node: process.version,
  playwright: '1.65.0', browser: '', baselineResultSha256: baselineHash,
  originalJourneyRunnerSha256: sourceBefore.runner,
  captureRunnerSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  sourceBefore, sourceAfter: null, frames: [], pageErrors: [], externalRequests: [], applicationApiRequests: [],
};
const browser = await chromium.launch({ headless: true });
result.browser = browser.version();
try {
  for (const [width, height] of [[320, 844], [390, 844], [768, 1024]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    try {
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== preview.origin) {
          result.externalRequests.push({ method: route.request().method(), origin: url.origin });
          await route.abort();
        } else {
          if (url.pathname.startsWith('/api/')) result.applicationApiRequests.push(url.pathname);
          await route.continue();
        }
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => result.pageErrors.push(error.message));
      await page.goto(preview.href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('link', { name: 'Skip to the lab', exact: true }).evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
      assert.equal(new URL(page.url()).hash, '#demo');
      const bounds = await page.evaluate(() => {
        const box = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, height: rect.height };
        };
        return { header: box('.site-header'), progress: box('.guide__progress'), count: box('.guide__count'),
          title: box('.guide__title'), scrollY: window.scrollY, viewportHeight: window.innerHeight };
      });
      for (const item of ['progress', 'count', 'title']) {
        assert(bounds[item].top >= bounds.header.bottom, `${width}: ${item} obscured by sticky header`);
        assert(bounds[item].bottom <= height, `${width}: ${item} outside viewport`);
      }
      const name = `${width}.png`;
      await page.screenshot({ path: join(output, name), fullPage: false });
      result.frames.push({ path: name, viewport: { width, height }, action: 'Keyboard Tab focuses skip link, then Enter follows #demo; capture without resetting scroll.', bounds,
        sha256: digest(await readFile(join(output, name))) });
    } finally { await context.close(); }
  }
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.applicationApiRequests, []);
  result.sourceAfter = await binding();
  assert.deepEqual(result.sourceAfter, sourceBefore);
  assert.equal(digest(await readFile(baselinePath)), baselineHash);
  result.passed = true;
} finally {
  await browser.close();
  result.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'navigation-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ passed: result.passed, frames: result.frames.length, output })}\n`);
}
