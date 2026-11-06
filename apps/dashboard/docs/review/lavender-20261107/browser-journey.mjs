// Production-preview usability checks. Fixture journeys are SIMULATED, never live privacy evidence.
/* global document, HTMLCanvasElement, innerWidth, matchMedia, requestAnimationFrame, window, getComputedStyle */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../../..');
const preview = new URL(process.env['MONOLITH_UI_PREVIEW_URL'] ?? 'http://127.0.0.1:5196/');
const browserTools = process.env['MONOLITH_BROWSER_TOOLS'] ?? '/tmp/monolith-mn003-env';
const output = resolve(process.env['MONOLITH_UI_REVIEW_OUTPUT'] ?? join(directory, 'browser'));
assert.equal(process.version, 'v24.22.2');
assert.equal(preview.protocol, 'http:');
assert(['127.0.0.1', 'localhost'].includes(preview.hostname));
assert.equal(preview.pathname, '/');
assert.equal(preview.search + preview.hash + preview.username + preview.password, '');
const requireTools = createRequire(join(browserTools, 'package.json'));
assert.equal(requireTools('playwright/package.json').version, '1.65.0');
const { chromium } = requireTools('playwright');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
    runner: digest(await readFile(fileURLToPath(import.meta.url))),
  };
}
await mkdir(output, { recursive: false });
const result = {
  schemaVersion: 1, sourceTask: '#86', evidence: 'SIMULATED',
  scope: 'Actual production-preview usability, local fixtures and disabled live configuration. No real RPC, worker, registry or source-anonymity acceptance.',
  livePrivacyAcceptance: false, startedAt: new Date().toISOString(), passed: false,
  node: process.version, playwright: '1.65.0', browser: '', checks: [], screenshots: [],
  pageErrors: [], externalRequests: [], applicationApiRequests: [], sourceBefore: await binding(), sourceAfter: null,
};
const browser = await chromium.launch({ headless: true });
result.browser = browser.version();
const contexts = [];
const check = (name, detail = '') => result.checks.push({ name, passed: true, detail });
const button = (page, name) => page.getByRole('button', { name, exact: true });
const nav = (page, name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true });
async function open({ width = 1440, height = 1000, fallback = false, mode = 'live', deviceScaleFactor = 1 } = {}) {
  const session = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, reducedMotion: 'reduce' });
  contexts.push(session);
  await session.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== preview.origin) {
      result.externalRequests.push({ method: route.request().method(), origin: url.origin });
      await route.abort();
    } else {
      if (url.pathname.startsWith('/api/')) result.applicationApiRequests.push({ method: route.request().method(), path: url.pathname });
      await route.continue();
    }
  });
  if (fallback) await session.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl' || kind === 'webgl2' ? null : original.call(this, kind, ...args);
    };
  });
  const page = await session.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  await page.goto(new URL(mode === 'simulated' ? '/?mode=simulated' : '/', preview).href, { waitUntil: 'networkidle' });
  await page.locator('.stage').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function noOverflow(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name);
}
async function screenshot(page, name, fullPage = true) {
  // The renderer parks offscreen. Visit it as a user would before a document-top full capture.
  await page.locator('.stage').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  if (fullPage && /(?:mobile|narrow|tablet)-live-full/.test(name)) {
    const stageName = name.replace('-full', '-stage');
    await page.locator('.stage-card').screenshot({ path: join(output, stageName) });
    result.screenshots.push({ path: stageName, sha256: digest(await readFile(join(output, stageName))) });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, name), fullPage });
  result.screenshots.push({ path: name, sha256: digest(await readFile(join(output, name))) });
}
async function active(page, name) {
  await page.waitForFunction(({ title }) => [...document.querySelectorAll('.pill-nav a')]
    .some((link) => link.textContent.trim() === title && link.getAttribute('aria-current') === 'location'), { title: name });
}
async function sections(page, label) {
  await nav(page, 'Evidence').click();
  await active(page, 'Evidence');
  await nav(page, 'The lab').click();
  await active(page, 'The lab');
  const bounds = await page.evaluate(() => {
    const header = document.querySelector('.site-header').getBoundingClientRect();
    const progress = document.querySelector('.guide__progress').getBoundingClientRect();
    const count = document.querySelector('.guide__count').getBoundingClientRect();
    return { headerBottom: header.bottom, progressTop: progress.top, countTop: count.top };
  });
  assert(bounds.progressTop >= bounds.headerBottom, `${label}: sticky header covers step progression ${JSON.stringify(bounds)}`);
  assert(bounds.countTop >= bounds.headerBottom, `${label}: sticky header covers step count ${JSON.stringify(bounds)}`);
  check(`${label}: visible section navigation tracks both directions`);
}

try {
  const page = await open();
  assert.equal(await button(page, 'Export measured report').isDisabled(), true);
  assert.match(await page.locator('.live-lab').innerText(), /UNTESTED/);
  assert.match(await page.getByTestId('live-coverage').innerText(), /not measured/);
  await screenshot(page, 'desktop-live-initial.png');
  await screenshot(page, 'desktop-live-viewport.png', false);
  check('Live opening: clear next action, no measured coverage, disabled export');

  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('link', { name: 'Skip to the lab', exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#demo');
  await page.keyboard.press('Tab');
  assert.equal(await button(page, 'Run private read').evaluate((element) => element === document.activeElement), true);
  assert.equal(await button(page, 'Run private read').evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
  check('Keyboard skip link is first; next Tab reaches the primary action with a visible focus ring');
  await sections(page, 'Desktop live');
  await page.keyboard.press('Home');
  await page.locator('.mode-switch').focus();
  await page.keyboard.press('Enter');
  await page.getByText('Simulated data', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('mode'), 'simulated');
  assert.equal(await page.getByRole('switch', { name: 'Private mode', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await button(page, 'Pay 1 test-USDT').isDisabled(), true);
  check('Keyboard mode switch opens clearly simulated practice with private default and payment disabled');
  await screenshot(page, 'desktop-offline-initial.png');

  await button(page, 'Send a direct read').focus();
  await page.keyboard.press('Enter');
  await button(page, 'Next: Hide where it comes from').waitFor();
  assert.match(await page.locator('.route-card--direct').innerText(), /Your network/);
  await button(page, 'Next: Hide where it comes from').click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((element) => element.textContent.includes('Send a private read') && !element.disabled));
  await button(page, 'Send a private read').click();
  await button(page, 'Next: Catch a leak').waitFor();
  assert.match(await page.locator('.route-card--anon').innerText(), /An exit relay/);
  assert.match(await page.locator('.route-card--anon').innerText(), /address readable/);
  check('Fixture direct/private sequence changes origin while retaining payload visibility');

  await button(page, 'Next: Catch a leak').click();
  await button(page, 'Inject a leak').click();
  await page.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').waitFor();
  assert.match(await page.locator('.route-card--direct').innerText(), /transaction hash readable/);
  assert.match(await page.locator('.checks').innerText(), /bypass/);
  await screenshot(page, 'desktop-offline-leak.png');
  await button(page, 'Remove it and run again').click();
  await button(page, 'Next: Fail closed').waitFor();
  assert.equal(await page.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass').count(), 0);
  assert.match(await page.locator('.guide').innerText(), /check passes again/);
  check('Fixture leak is caught; repair creates a fresh useful run and removes bypass');

  await button(page, 'Next: Fail closed').click();
  await button(page, 'Take the network offline').click();
  await button(page, 'Send a private read').click();
  await page.getByText('The managed read was blocked before send. No direct fallback was attempted.', { exact: true }).first().waitFor();
  await screenshot(page, 'desktop-offline-outage.png');
  await button(page, 'Bring it back online').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lifecycle li')].some((element) => element.textContent.trim() === 'Ready' && element.getAttribute('aria-current') === 'step'));
  check('Fixture outage blocks managed reads; explicit recovery restores the worker');
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
  check('An unrepaired direct bypass remains visibly disclosed during a managed-worker outage');
  await sections(page, 'Desktop offline');
  await page.getByRole('button', { name: 'Your browser', exact: true }).click();
  assert.equal(await page.locator('#transport-title').isVisible(), true);
  const transportY = await page.locator('#transport-title').evaluate((element) => element.getBoundingClientRect().top);
  assert(transportY >= 0 && transportY < 1000);
  check('Stage browser action reaches the readable transport panel');

  await page.locator('.mode-switch').click();
  await page.getByText('Live network', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('mode'), false);
  await button(page, 'RPC endpoint').click();
  const registryY = await page.locator('#registry-title').evaluate((element) => element.getBoundingClientRect().top);
  assert(registryY >= 0 && registryY < 1000);
  check('Stage endpoint action reaches the trusted registry detail');
  await button(page, 'Run private read').click();
  await page.getByRole('heading', { name: 'The run could not be verified.', exact: true }).waitFor();
  assert.equal(await button(page, 'Export measured report').isDisabled(), true);
  assert.equal(await page.locator('iframe').count(), 0);
  await button(page, 'Retry private read').click();
  await page.getByRole('heading', { name: 'The run could not be verified.', exact: true }).waitFor();
  await noOverflow(page, 'Live blocked state');
  await screenshot(page, 'desktop-live-blocked.png');
  check('Live configuration failure and explicit retry stay blocked before bootstrap; export remains unavailable');

  for (const [name, width, height] of [['narrow', 320, 740], ['mobile', 390, 844], ['tablet', 768, 1024], ['laptop', 1280, 800], ['desktop', 1440, 1000]]) {
    const sized = await open({ width, height });
    await noOverflow(sized, `${name} live initial`);
    assert.equal(await nav(sized, 'The lab').isVisible(), true);
    assert.equal(await nav(sized, 'Evidence').isVisible(), true);
    await sections(sized, name);
    await screenshot(sized, `${name}-live-full.png`);
    if (width === 390 || width === 768) await screenshot(sized, `${name}-live-viewport.png`, false);
    await sized.locator('.mode-switch').click();
    await sized.getByText('Simulated data', { exact: true }).waitFor();
    await noOverflow(sized, `${name} offline initial`);
    await button(sized, 'Send a direct read').click();
    await button(sized, 'Next: Hide where it comes from').waitFor();
    await noOverflow(sized, `${name} offline result`);
    check(`${name}: live/offline controls and result fit ${width}×${height}`);
  }

  const zoomed = await open({ width: 720, height: 500, deviceScaleFactor: 2 });
  await noOverflow(zoomed, '200 percent equivalent viewport reflow');
  assert.equal(await nav(zoomed, 'The lab').isVisible(), true);
  assert.equal(await button(zoomed, 'Run private read').isVisible(), true);
  await screenshot(zoomed, 'zoom-200-percent.png');
  check('200% equivalent viewport reflow preserves visible controls and avoids horizontal overflow', '720×500 CSS viewport at2x device scale represents1440×1000 output. This is a layout-reflow approximation, not an OS/browser zoom setting claim.');

  const reduced = await open();
  assert.equal(await reduced.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await reduced.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  check('Reduced motion removes smooth scrolling and leaves content available');
  const fallback = await open({ fallback: true, mode: 'simulated' });
  assert.equal(await fallback.locator('.stage').getAttribute('data-webgl'), 'off');
  await button(fallback, 'Send a direct read').click();
  await button(fallback, 'Next: Hide where it comes from').waitFor();
  assert.match(await fallback.locator('.route-card--direct').innerText(), /Your network/);
  await noOverflow(fallback, 'WebGL unavailable fallback');
  await screenshot(fallback, 'webgl-fallback.png');
  check('WebGL unavailable schematic and the same fixture action remain usable');

  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.applicationApiRequests, []);
  result.sourceAfter = await binding();
  assert.deepEqual(result.sourceAfter, result.sourceBefore, 'Source/build changed during capture; rerun against a stable production build.');
  check('Zero browser errors, external requests or application API requests; source/build stayed stable');
  result.passed = true;
} catch (error) {
  result.failure = error.message;
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  result.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'browser-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ passed: result.passed, checks: result.checks.length, failure: result.failure, output })}\n`);
}
