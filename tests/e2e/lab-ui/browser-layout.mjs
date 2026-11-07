// Actual production-preview rendering only. No live integration success is claimed.
/* global HTMLCanvasElement, document, innerWidth, matchMedia */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const tools = process.env['MONOLITH_BROWSER_TOOLS'];
const preview = process.env['MONOLITH_PREVIEW_URL'];
const output = process.env['MONOLITH_LAYOUT_OUTPUT'];
if (process.version !== 'v24.22.2' || !tools || !preview || !output) throw new Error('Pinned Node/browser tools, local preview URL and new output directory required.');
const origin = new URL(preview);
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)
  || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Use a local production preview origin.');
await mkdir(output);
const requireTools = createRequire(join(tools, 'package.json'));
assert.equal(requireTools('playwright/package.json').version, '1.65.0');
const { chromium } = requireTools('playwright');
const startedAt = new Date().toISOString();
const errors = [];
const external = [];
const apis = [];
const checks = [];
const screenshots = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function files(root, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await files(root, path));
    else result[path] = digest(await readFile(join(root, path)));
  }
  return result;
}
const source = {
  dashboard: await files(join(repository, 'apps/dashboard/src')),
  dist: await files(join(repository, 'apps/dashboard/dist')),
  viteConfig: digest(await readFile(join(repository, 'apps/dashboard/vite.config.ts'))),
  workerHost: digest(await readFile(join(repository, 'apps/dashboard/assets/worker-host.html'))),
  package: digest(await readFile(join(repository, 'apps/dashboard/package.json'))),
  lockfile: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
  runner: digest(await readFile(fileURLToPath(import.meta.url))),
};
const browser = await chromium.launch({ headless: true });
const contexts = [];
const open = async (options = {}, fallback = false) => {
  const context = await browser.newContext(options);
  contexts.push(context);
  if (fallback) await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl' || kind === 'webgl2') return null;
      return original.call(this, kind, ...args);
    };
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin.origin) { external.push({ method: route.request().method(), category: 'EXTERNAL_REQUEST' }); await route.abort(); }
    else { if (url.pathname.startsWith('/api/')) apis.push({ method: route.request().method(), category: 'APP_API_REQUEST' }); await route.continue(); }
  });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('PAGE_ERROR'));
  await page.goto(origin.href);
  await page.getByRole('heading', { name: 'Monolith live privacy lab' }).waitFor();
  await page.getByRole('heading', { name: 'Follow a request', exact: true }).waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  return page;
};
const screenshot = async (page, name) => {
  await page.screenshot({ path: join(output, name), fullPage: true });
  screenshots.push({ path: name, sha256: digest(await readFile(join(output, name))) });
};
try {
  const page = await open({ viewport: { width: 1440, height: 1000 } });
  for (const [name, width, height] of [['desktop-initial.png', 1440, 1000], ['mobile-initial.png', 390, 844], ['narrow-initial.png', 320, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByText('Coming later', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Run private read', exact: true }).count(), 1);
    await screenshot(page, name);
    checks.push({ name: `layout-${width}`, passed: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Run private read', exact: true }).click();
  await page.getByRole('heading', { name: 'The run could not be verified.' }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push({ name: 'unconfigured-fails-before-bootstrap', passed: true });
  await screenshot(page, 'desktop-blocked-config.png');
  const host = await page.request.get(new URL('/assets/worker-host.html', origin).href);
  assert.equal(host.status(), 200);
  assert.match(await host.text(), /\/assets\/workerHost-/);
  checks.push({ name: 'built-same-origin-host-served', passed: true });

  const reduced = await open({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  assert.equal(await reduced.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  checks.push({ name: 'reduced-motion', passed: true });
  const fallback = await open({ viewport: { width: 1440, height: 1000 } }, true);
  await fallback.getByRole('button', { name: 'Direct route', exact: true }).click();
  assert.equal(await fallback.getByRole('button', { name: 'Direct route', exact: true }).getAttribute('aria-pressed'), 'true');
  await fallback.getByRole('button', { name: 'Private route', exact: true }).click();
  assert.equal(await fallback.getByRole('button', { name: 'Private route', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await fallback.locator('canvas').count(), 0);
  await screenshot(fallback, 'no-webgl-required.png');
  checks.push({ name: 'interactive-explorer-without-webgl', passed: true });

  await page.goto(new URL('/?mode=simulated', origin).href);
  await page.getByText('Simulated data', { exact: true }).waitFor();
  checks.push({ name: 'secondary-walkthrough-clearly-simulated', passed: true });
  assert.equal(errors.length, 0); assert.equal(external.length, 0); assert.equal(apis.length, 0);
  const result = { schemaVersion: 1, sourceTask: 'MN-014', evidence: 'UNTESTED',
    scope: 'ACTUAL_BROWSER_LAYOUT_AND_DISABLED_CONFIG_ONLY', startedAt, generatedAt: new Date().toISOString(),
    node: process.version, browser: browser.version(), playwright: '1.65.0', checks,
    pageErrors: errors.length, externalRequests: external.length, applicationApiRequests: apis.length,
    liveRpcAcceptance: false, source, screenshots };
  await writeFile(join(output, 'browser-layout.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ checks: checks.length, pageErrors: 0, externalRequests: 0,
    applicationApiRequests: 0, liveRpcAcceptance: false, output })}\n`);
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
