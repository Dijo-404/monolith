// Offline UI acceptance only. This is not anonymity or sponsor evidence.
/* global document, HTMLCanvasElement, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const output = process.env.MONOLITH_UI_REVIEW_OUTPUT ? resolve(process.env.MONOLITH_UI_REVIEW_OUTPUT) : directory;
const preview = new URL(process.env.MONOLITH_UI_PREVIEW_URL ?? 'http://127.0.0.1:5194');
const toolDirectory = process.env.MONOLITH_BROWSER_TOOLS;
assert(toolDirectory, 'Set MONOLITH_BROWSER_TOOLS to an isolated Playwright installation.');
const requireTools = createRequire(join(resolve(toolDirectory), 'package.json'));
assert.equal(requireTools('playwright/package.json').version, '1.65.0');
const { chromium } = requireTools('playwright');
const result = {
  evidence: 'SIMULATED', scope: 'Production-build UI shell with local fixture data. No live RPC, registry or privacy measurement.',
  generatedAt: null, passed: false, playwright: '1.65.0', preview: preview.origin,
  checks: [], pageErrors: [], externalRequests: [], apiRequests: [], assets: [],
};
const pendingAssets = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function context(viewport, fallback = false) {
  const session = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await session.route('**/*', async (route) => {
    const destination = new URL(route.request().url());
    if (destination.origin === preview.origin) {
      if (destination.pathname.startsWith('/api/')) result.apiRequests.push(destination.pathname);
      await route.continue();
    } else {
      result.externalRequests.push(destination.origin);
      await route.abort();
    }
  });
  if (fallback) await session.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : original.call(this, kind, ...args);
    };
  });
  const page = await session.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (/\/assets\/.+\.(js|css)$/.test(response.url())) pendingAssets.push(response.body().then((bytes) => ({
      path: new URL(response.url()).pathname, sha256: createHash('sha256').update(bytes).digest('hex'),
    })));
  });
  await page.goto(preview.href, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
  return { session, page };
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
try {
  const { session, page } = await context({ width: 1440, height: 1000 });
  assert.equal(await page.getByRole('switch', { name: 'Private mode', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await button(page, 'Pay 1 test-USDT').isDisabled(), true);
  await page.screenshot({ path: join(output, 'desktop-initial.png'), fullPage: true });
  result.checks.push('Desktop initial: private default, simulated badge, disabled payment, no horizontal overflow');

  await button(page, 'Send a direct read').click();
  await button(page, 'Next: Hide where it comes from').waitFor();
  await button(page, 'Next: Hide where it comes from').click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((item) => item.textContent.includes('Send a private read') && !item.disabled));
  await button(page, 'Send a private read').click();
  await button(page, 'Next: Catch a leak').waitFor();
  await button(page, 'Next: Catch a leak').click();
  await button(page, 'Inject a leak').click();
  await page.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').waitFor();
  assert.match(await page.locator('.route-card--direct').innerText(), /transaction hash readable/);
  assert.doesNotMatch(await page.locator('.route-card--direct').innerText(), /address readable/);
  await page.screenshot({ path: join(output, 'desktop-leak.png'), fullPage: true });
  result.checks.push('Receipt bypass fails GT03 and reports transaction-hash exposure, not an address');
  await button(page, 'Remove it and run again').click();
  await button(page, 'Next: Fail closed').waitFor();
  assert.match(await page.locator('.checks').innerText(), /No read bypasses MonolithTransport/);
  assert.equal(await page.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass').count(), 0);
  await button(page, 'Next: Fail closed').click();
  await button(page, 'Take the network offline').click();
  await button(page, 'Send a private read').click();
  await page.getByText('The managed read was blocked before send. No direct fallback was attempted.', { exact: true }).first().waitFor();
  await page.screenshot({ path: join(output, 'desktop-outage.png'), fullPage: true });
  result.checks.push('Full four-step direct/protected/leak/repair/outage fixture walkthrough recomputes outcomes');

  await page.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await button(page, 'Catch a leak').click();
  await button(page, 'Inject a leak').click();
  await page.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').waitFor();
  await button(page, 'Fail closed').click();
  await button(page, 'Take the network offline').click();
  await button(page, 'Send a private read').click();
  await page.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').nth(1).waitFor();
  assert.match(await page.locator('.guide').innerText(), /injected widget still sends directly/);
  assert.match(await page.locator('.checks').innerText(), /injected widget still bypasses/);
  assert.doesNotMatch(await page.locator('.guide').innerText(), /nothing leaks/);
  await page.screenshot({ path: join(output, 'desktop-bypass-during-outage.png'), fullPage: true });
  result.checks.push('Active bypass during outage is explicitly disclosed while the managed read remains blocked');
  await session.close();

  for (const [name, viewport, fallback] of [
    ['mobile', { width: 390, height: 844 }, false],
    ['narrow', { width: 320, height: 740 }, false],
    ['fallback', { width: 1280, height: 800 }, true],
  ]) {
    const { session: nextSession, page: nextPage } = await context(viewport, fallback);
    await nextPage.screenshot({ path: join(output, `${name}-initial.png`), fullPage: true });
    if (fallback) {
      await nextPage.locator('.stage-fallback').waitFor();
      await button(nextPage, 'Send a direct read').click();
      await button(nextPage, 'Next: Hide where it comes from').waitFor();
      assert.match(await nextPage.locator('.route-card--direct').innerText(), /Your network/);
    }
    result.checks.push(`${name}: no overflow, usable without animation${fallback ? ', WebGL2 unavailable fallback works' : ''}`);
    await nextSession.close();
  }
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.apiRequests, []);
  result.checks.push('Zero page errors, external network requests or application API requests across all contexts');
  result.passed = true;
} finally {
  await browser.close();
  result.assets = [...new Map((await Promise.all(pendingAssets)).map((asset) => [asset.path, asset])).values()];
  result.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'browser-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.info(JSON.stringify(result, null, 2));
}
