// Actual production-preview UI journeys with SIMULATED data; no live privacy acceptance.
/* global document, window, HTMLCanvasElement, innerWidth, matchMedia, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../../../..');
const output = resolve(process.env['MONOLITH_EXPLORER_OUTPUT'] ?? join(directory, 'browser'));
const preview = new URL(process.env['MONOLITH_UI_PREVIEW_URL'] ?? 'http://127.0.0.1:5196/');
assert.equal(process.version, 'v24.22.2');
assert.equal(preview.protocol, 'http:');
assert(['127.0.0.1', 'localhost'].includes(preview.hostname));
assert.equal(preview.pathname + preview.search + preview.hash + preview.username + preview.password, '/');
const requireTools = createRequire(join(process.env['MONOLITH_BROWSER_TOOLS'] ?? '/tmp/monolith-mn003-env', 'package.json'));
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
  return { source: await inventory(join(repository, 'apps/dashboard/src')), dist: await inventory(join(repository, 'apps/dashboard/dist')),
    package: digest(await readFile(join(repository, 'apps/dashboard/package.json'))), lockfile: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
    runner: digest(await readFile(fileURLToPath(import.meta.url))) };
}
await mkdir(output);
const result = { schemaVersion: 1, sourceTask: '#86', evidence: 'SIMULATED', passed: false,
  scope: 'Actual production-preview request-explorer controls, truthful fixture read metadata and existing lab journeys. Live mode is tested only with disabled/unconfigured networking; no live RPC or privacy acceptance.',
  livePrivacyAcceptance: false, startedAt: new Date().toISOString(), node: process.version, playwright: '1.65.0', browser: '',
  sourceBefore: await binding(), sourceAfter: null, checks: [], screenshots: [], inspectedReads: [], viewportBounds: [],
  pageErrors: [], externalRequests: [], applicationApiRequests: [], graphicsContexts: [] };
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
const contexts = [];
const pages = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const explorer = (page) => page.locator('.request-explorer');
const pathButton = (page, route) => explorer(page).getByRole('button', { name: route === 'private' ? /^Private (path|route)$/ : /^Direct (path|route)$/ });
const check = (name, detail = '') => result.checks.push({ name, passed: true, detail });
async function open({ width = 1440, height = 1000, mode = 'live', reduced = true, deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor });
  contexts.push(context);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== preview.origin) { result.externalRequests.push({ method: route.request().method(), origin: url.origin }); await route.abort(); }
    else { if (url.pathname.startsWith('/api/')) result.applicationApiRequests.push({ method: route.request().method(), path: url.pathname }); await route.continue(); }
  });
  await context.addInitScript(() => {
    window.__monolithGraphicsContexts = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      window.__monolithGraphicsContexts.push(kind);
      return original.call(this, kind, ...args);
    };
  });
  const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(14000);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  await page.goto(new URL(mode === 'simulated' ? '/?mode=simulated' : '/', preview).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('heading', { name: 'Follow a request', exact: true }).waitFor();
  return page;
}
async function noOverflow(page, name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: document has horizontal overflow`);
  const boxes = await explorer(page).evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const children = [...root.querySelectorAll('button, select, summary, .request-explorer__facts, .request-explorer__fields-body')].map((element) => {
      const box = element.getBoundingClientRect();
      return { name: element.tagName.toLowerCase(), text: element.tagName === 'BUTTON' ? element.textContent.trim() : null,
        left: box.left, right: box.right, width: box.width, height: box.height };
    }).filter((box) => box.width > 0 && box.height > 0);
    return { left: bounds.left, right: bounds.right, children };
  });
  const escaped = boxes.children.filter((box) => box.left < boxes.left - 1 || box.right > boxes.right + 1);
  assert.deepEqual(escaped, [], `${name}: explorer controls or fields escape the panel`);
  result.viewportBounds.push({ name, ...boxes });
}
async function shot(page, name, { fullPage = true, target = null } = {}) {
  let captureViewport = page.viewportSize();
  let method = fullPage ? 'Document-top full-page capture' : 'Document-top actual viewport capture';
  if (target) {
    const originalViewport = page.viewportSize();
    const needed = await page.locator(target).evaluate((element) => element.getBoundingClientRect().height
      + document.querySelector('.site-header').getBoundingClientRect().height + 96);
    captureViewport = { width: originalViewport.width, height: Math.max(2200, Math.ceil(needed)) };
    await page.setViewportSize(captureViewport);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.locator(target).evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.locator(target).screenshot({ path: join(output, name), animations: 'disabled' });
    method = 'Unobscured component in a tall viewport at the stated CSS width; product header/styles remain intact.';
    await page.setViewportSize(originalViewport);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(output, name), fullPage, animations: 'disabled' });
  }
  result.screenshots.push({ path: name, viewport: captureViewport, method, sha256: digest(await readFile(join(output, name))) });
}
async function policySnapshot(page) {
  return page.evaluate(() => ({ phase: document.querySelector('.live-lab')?.getAttribute('data-live-phase') ?? null,
    run: document.querySelector('.live-lab')?.getAttribute('data-live-run') ?? null,
    rows: document.querySelectorAll('.activity__row').length,
    values: [...document.querySelectorAll('.route-card__value')].map((element) => element.textContent.trim()),
    privacy: [...document.querySelectorAll('button[role="switch"]')].find((element) =>
      document.getElementById(element.getAttribute('aria-labelledby'))?.textContent.trim() === 'Private mode')?.getAttribute('aria-checked') ?? null }));
}
async function localExplorerJourney(page, label) {
  const before = await policySnapshot(page);
  assert.match(await explorer(page).innerText(), /Example only.*no requests sent/);
  await pathButton(page, 'private').focus(); await page.keyboard.press('Enter');
  if (label === 'Desktop live') await shot(page, 'keyboard-explorer-focus.png', { target: '.request-workspace' });
  assert.equal(await pathButton(page, 'private').getAttribute('aria-pressed'), 'true');
  assert.equal(await explorer(page).getAttribute('data-route'), 'private');
  assert.equal(await explorer(page).locator('.request-explorer__stop').count(), 4);
  const stops = ['app', 'policy', 'worker', 'endpoint'];
  for (const stop of stops) {
    const control = explorer(page).locator(`button[data-stop="${stop}"]`);
    await control.focus(); await page.keyboard.press('Enter');
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    assert.equal(await explorer(page).locator('.request-explorer__stop[aria-pressed="true"]').count(), 1);
    assert(await explorer(page).locator('.request-explorer__inspector h3').isVisible());
  }
  await explorer(page).locator('button[data-stop="app"]').click();
  assert(await button(page, 'Previous stop').isDisabled());
  await button(page, 'Next stop').click();
  assert.equal(await explorer(page).locator('button[data-stop="policy"]').getAttribute('aria-pressed'), 'true');
  await button(page, 'Previous stop').click();
  assert.equal(await explorer(page).locator('button[data-stop="app"]').getAttribute('aria-pressed'), 'true');
  await explorer(page).locator('button[data-stop="endpoint"]').click();
  assert(await button(page, 'Next stop').isDisabled());
  await pathButton(page, 'direct').focus(); await page.keyboard.press('Enter');
  assert.equal(await pathButton(page, 'direct').getAttribute('aria-pressed'), 'true');
  assert.equal(await explorer(page).locator('.request-explorer__stop').count(), 2);
  assert.match(await explorer(page).locator('.request-explorer__inspector').innerText(), /direct network source|source with the method/);
  await page.getByLabel('Example request', { exact: true }).selectOption('receipt');
  const fields = explorer(page).locator('.request-explorer__fields');
  await fields.locator('summary').focus(); await page.keyboard.press('Enter');
  assert(await fields.evaluate((element) => element.open));
  assert.match(await fields.innerText(), /eth_getTransactionReceipt/);
  assert.match(await fields.innerText(), /Transaction hash/);
  assert.doesNotMatch(await fields.innerText(), /Wallet address|Block tag/);
  assert.match(await fields.innerText(), /examples.*never sent/);
  if (label === 'Desktop live') await shot(page, 'desktop-example-fields.png', { target: '.request-workspace' });
  await noOverflow(page, `${label} receipt fields`);
  await page.getByLabel('Example request', { exact: true }).selectOption('balance');
  assert.match(await fields.innerText(), /eth_getBalance/);
  assert.match(await fields.innerText(), /Wallet address/);
  assert.match(await fields.innerText(), /Block tag/);
  await noOverflow(page, `${label} balance fields`);
  await fields.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await fields.evaluate((element) => element.open), false);
  await pathButton(page, 'private').click();
  assert.deepEqual(await policySnapshot(page), before, `${label}: explanatory controls changed actual policy/read state`);
  check(`${label}: keyboard path/stop/back/next/method/field controls explain without changing policy or sending reads`);
}
async function navigateSections(page, name) {
  const navigation = page.getByRole('navigation', { name: 'Sections' });
  await navigation.getByRole('link', { name: 'Evidence', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pill-nav a[href="#under-the-hood"]')?.getAttribute('aria-current') === 'location');
  await navigation.getByRole('link', { name: 'The lab', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pill-nav a[href="#demo"]')?.getAttribute('aria-current') === 'location');
  const bounds = await page.evaluate(() => ({ header: document.querySelector('.site-header').getBoundingClientRect().bottom,
    count: document.querySelector('.guide__count').getBoundingClientRect().top, title: document.querySelector('.guide__title').getBoundingClientRect().top }));
  assert(bounds.count >= bounds.header && bounds.title >= bounds.header, `${name}: sticky header hides the guided step`);
  check(`${name}: section navigation and post-anchor content remain clear`, bounds);
}
async function inspectRead(page, route, expected) {
  const details = page.locator(`.route-card--${route} .read-inspector`);
  if (!await details.evaluate((element) => element.open)) {
    await details.locator('summary').focus(); await page.keyboard.press('Enter');
  }
  assert(await details.evaluate((element) => element.open));
  const facts = await details.locator('dl').evaluate((list) => Object.fromEntries([...list.querySelectorAll(':scope > div')]
    .map((row) => [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()])));
  for (const [key, value] of Object.entries(expected)) assert.equal(facts[key], value);
  assert.match(facts['Read ID'], /^read-\d+-\d+$/);
  assert.match(facts['Round trip'], /^\d[\d,]* ms$/);
  assert.equal(facts.Evidence, 'SIMULATED');
  assert(!Object.keys(facts).some((key) => /params|wallet|address|signature|private/i.test(key)));
  result.inspectedReads.push(facts);
  check(`Recorded ${route} read inspector uses current read metadata`, facts);
  return facts;
}

try {
  const live = await open();
  assert.equal(await live.locator('canvas').count(), 0);
  assert(await button(live, 'Export measured report').isDisabled());
  assert.match(await live.getByTestId('live-coverage').innerText(), /not measured/);
  assert(await live.getByTestId('sandbox-walkthrough').isVisible());
  assert.equal(await live.getByTestId('sandbox-outcome').getAttribute('data-outcome'), 'untested');
  assert(await button(live, 'Run repaired fixture').isDisabled());
  await shot(live, 'desktop-live-initial.png');
  await shot(live, 'desktop-live-viewport.png', { fullPage: false });
  await live.setViewportSize({ width: 390, height: 844 });
  await live.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await noOverflow(live, 'Mobile initial');
  await shot(live, 'mobile-live-initial.png');
  await live.setViewportSize({ width: 1440, height: 1000 });
  await live.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [1280, 800], [1440, 1000]]) {
    await live.setViewportSize({ width, height });
    await live.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await noOverflow(live, `Initial ${width}`);
    await shot(live, `initial-${width}-top.png`, { fullPage: false });
    if (width <= 768) await shot(live, `initial-${width}-explorer-tall.png`, { target: '.request-workspace' });
  }
  await live.keyboard.press('Tab');
  assert(await live.getByRole('link', { name: 'Skip to the lab', exact: true }).evaluate((element) => element === document.activeElement));
  await live.keyboard.press('Enter'); await live.keyboard.press('Tab');
  assert(await button(live, 'Run private read').evaluate((element) => element === document.activeElement));
  assert.equal(await button(live, 'Run private read').evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
  await shot(live, 'keyboard-primary-focus.png', { fullPage: false });
  check('Live opening preserves the actual untouched lab, disabled export and mounted sandbox, with keyboard skip/focus');
  await localExplorerJourney(live, 'Desktop live');
  await navigateSections(live, 'Desktop live');
  await explorer(live).locator('button[data-stop="worker"]').click();
  await button(live, 'View transport details').click();
  assert(await live.locator('#transport-title').isVisible());
  await explorer(live).locator('button[data-stop="endpoint"]').click();
  await button(live, 'View endpoint details').click();
  assert(await live.locator('#registry-title').isVisible());
  await live.getByRole('link', { name: 'See run results', exact: true }).click();
  assert.equal(new URL(live.url()).hash, '#route-results');
  assert(await live.locator('#route-results').isVisible());
  check('Explorer context links reach real transport/endpoint panels and actual run results');
  await button(live, 'Run private read').click();
  await live.getByRole('heading', { name: 'The run could not be verified.', exact: true }).waitFor();
  assert(await button(live, 'Export measured report').isDisabled());
  assert.equal(await live.locator('iframe').count(), 0);
  assert.equal(await live.getByTestId('sandbox-outcome').getAttribute('data-outcome'), 'blocked');
  await button(live, 'Run leaky fixture').click();
  await live.getByRole('heading', { name: 'The run could not be verified.', exact: true }).waitFor();
  assert(await button(live, 'Run repaired fixture').isDisabled());
  await button(live, 'Retry private read').click();
  await live.getByRole('heading', { name: 'The run could not be verified.', exact: true }).waitFor();
  await noOverflow(live, 'Live blocked with sandbox');
  await shot(live, 'desktop-live-blocked.png');
  check('Actual live private/leaky-fixture/retry actions fail closed without bootstrap, export or fabricated repair');

  await live.locator('.mode-switch').focus(); await live.keyboard.press('Enter');
  await live.getByText('Simulated data', { exact: true }).waitFor();
  assert.equal(new URL(live.url()).searchParams.get('mode'), 'simulated');
  assert.equal(await live.getByRole('switch', { name: 'Private mode', exact: true }).getAttribute('aria-checked'), 'true');
  assert(await button(live, 'Pay 1 test-USDT').isDisabled());
  await live.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await localExplorerJourney(live, 'Desktop offline');
  await shot(live, 'desktop-offline-initial.png');
  await button(live, 'Send a direct read').focus(); await live.keyboard.press('Enter');
  await button(live, 'Next: Hide where it comes from').waitFor();
  assert.match(await live.locator('.route-card--direct').innerText(), /Your network/);
  const direct = await inspectRead(live, 'direct', { Method: 'eth_getBalance', Route: 'direct-debug', Outcome: 'arrived', Callsite: 'lab/direct-comparison.ts' });
  await shot(live, 'desktop-read-inspector.png', { target: '.route-card--direct' });
  await button(live, 'Next: Hide where it comes from').click();
  await button(live, 'Send a private read').click();
  await button(live, 'Next: Catch a leak').waitFor();
  assert.match(await live.locator('.route-card--anon').innerText(), /An exit relay/);
  assert.match(await live.locator('.route-card--anon').innerText(), /address readable/);
  await inspectRead(live, 'anon', { Method: 'eth_getBalance', Route: 'anon-tor', Outcome: 'arrived' });
  await button(live, 'Next: Catch a leak').click();
  await button(live, 'Inject a leak').click();
  await live.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').waitFor();
  assert.match(await live.locator('.route-card--direct').innerText(), /transaction hash readable/);
  const leaked = await inspectRead(live, 'direct', { Method: 'eth_getTransactionReceipt', Route: 'direct-debug', Outcome: 'arrived', Callsite: 'payments/status.ts:27' });
  assert.notEqual(leaked['Read ID'], direct['Read ID']);
  await shot(live, 'desktop-leak.png');
  await button(live, 'Remove it and run again').click();
  await button(live, 'Next: Fail closed').waitFor();
  assert.equal(await live.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass').count(), 0);
  assert.match(await live.locator('.guide').innerText(), /check passes again/);
  check('Full direct/private/leak/repair fixture sequence recomputes useful outcomes and truthful read inspectors');
  await button(live, 'Next: Fail closed').click();
  await button(live, 'Take the network offline').click();
  await button(live, 'Send a private read').click();
  await live.getByText('The managed read was blocked before send. No direct fallback was attempted.', { exact: true }).first().waitFor();
  await shot(live, 'desktop-worker-outage.png');
  await button(live, 'Bring it back online').click();
  await live.waitForFunction(() => [...document.querySelectorAll('.lifecycle li')].some((element) => element.textContent.trim() === 'Ready' && element.getAttribute('aria-current') === 'step'));
  check('Managed-worker outage remains blocked and explicit recovery restores the worker');
  await live.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await button(live, 'Catch a leak').click(); await button(live, 'Inject a leak').click();
  await live.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').waitFor();
  await button(live, 'Fail closed').click(); await button(live, 'Take the network offline').click(); await button(live, 'Send a private read').click();
  await live.getByRole('list', { name: 'Reads in this run' }).locator('li.is-bypass.is-arrived').nth(1).waitFor();
  assert.match(await live.locator('.guide').innerText(), /injected widget still sends directly/);
  check('An unrepaired bypass stays explicitly visible during an otherwise blocked worker outage');

  for (const [scenario, expected] of [['passthrough', 'POLICY_DENIED'], ['registry-expired', 'REGISTRY_EXPIRED'], ['observer-unavailable', 'UPSTREAM_UNAVAILABLE']]) {
    await live.getByLabel('Scenario', { exact: true }).selectOption(scenario);
    await button(live, 'Hide where it comes from').click(); await button(live, 'Send a private read').click();
    await live.getByRole('list', { name: 'Reads in this run' }).getByText(new RegExp(expected)).waitFor();
    assert.equal(await live.getByRole('list', { name: 'Reads in this run' }).locator('li.is-arrived').count(), 0);
    assert.equal(await live.getByRole('switch', { name: 'Private mode', exact: true }).getAttribute('aria-checked'), 'true');
    await noOverflow(live, `Fixture ${scenario}`);
    check(`${scenario}: managed read reports ${expected} without success or policy downgrade`);
  }
  await live.getByLabel('Scenario', { exact: true }).selectOption('degraded');
  await button(live, 'Hide where it comes from').click(); await button(live, 'Send a private read').click();
  await button(live, 'Next: Catch a leak').waitFor();
  assert.match(await live.locator('.request-workspace__status').innerText(), /Degraded/);
  assert.match(await live.locator('.route-card--anon').innerText(), /An exit relay/);
  check('Degraded fixture completes useful worker reads and keeps degraded provenance visible');

  for (const [name, width, height] of [['narrow', 320, 844], ['mobile', 390, 844], ['tablet', 768, 1024], ['laptop', 1280, 800], ['desktop', 1440, 1000]]) {
    const sized = await open({ width, height });
    await localExplorerJourney(sized, `${name} live`);
    await navigateSections(sized, name);
    await noOverflow(sized, `${name} live`);
    await shot(sized, `${name}-live-full.png`);
    if (width === 320 || width === 390 || width === 768) await shot(sized, `${name}-explorer.png`, { target: '.request-workspace' });
    await sized.locator('.mode-switch').click(); await sized.getByText('Simulated data', { exact: true }).waitFor();
    await button(sized, 'Send a direct read').click(); await button(sized, 'Next: Hide where it comes from').waitFor();
    await inspectRead(sized, 'direct', { Method: 'eth_getBalance', Route: 'direct-debug', Outcome: 'arrived' });
    await noOverflow(sized, `${name} offline read inspector`);
    check(`${name}: local controls, guide and read inspector fit ${width}×${height}`);
  }
  const zoomed = await open({ width: 720, height: 500, deviceScaleFactor: 2 });
  await localExplorerJourney(zoomed, '200% equivalent reflow');
  await noOverflow(zoomed, '200% equivalent reflow');
  await shot(zoomed, 'equivalent-reflow-200-percent.png');
  check('Equivalent 200% reflow preserves controls and wrapping', '720×500 CSS viewport at2x scale; no browser zoom-setting claim.');
  const normal = await open({ reduced: false });
  await localExplorerJourney(normal, 'Normal motion preference');
  assert.equal(await normal.locator('canvas').count(), 0);
  check('Normal-motion users get the same accessible DOM explorer without a graphics surface');
  assert(await live.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  assert.equal(await live.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  check('Reduced motion preserves every explorer control and uses immediate scrolling');

  for (const page of pages) {
    assert.equal(await page.locator('canvas').count(), 0);
    const kinds = await page.evaluate(() => window.__monolithGraphicsContexts);
    result.graphicsContexts.push(...kinds);
    assert(!kinds.some((kind) => /webgl/i.test(kind)), 'The replacement UI must not initialize WebGL.');
  }
  assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.externalRequests, []); assert.deepEqual(result.applicationApiRequests, []);
  result.sourceAfter = await binding(); assert.deepEqual(result.sourceAfter, result.sourceBefore);
  check('Zero canvas/WebGL, page errors, external requests or API requests; exact source/build stayed unchanged');
  result.passed = true;
} catch (error) { result.failure = error.message; throw error; }
finally {
  for (const context of contexts) await context.close(); await browser.close(); result.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'browser-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ passed: result.passed, checks: result.checks.length, failure: result.failure, output })}\n`);
}
