// Actual published UI, with an explicitly injected worker-host network outage.
/* global HTMLCanvasElement, document, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicObserverOrigin } from './prepare-static.mjs';
import { classifyFrameInventory, collectFrameDescriptors } from '../../deploy/sites/hosting-frames.mjs';

const [siteValue, observerValue, verificationPath, output] = process.argv.slice(2);
assert(process.version === 'v24.22.2' && process.argv.length === 6 && output && process.env['MONOLITH_BROWSER_TOOLS'],
  'Pinned Node, MONOLITH_BROWSER_TOOLS and site/observer/static-verification/new-output-directory arguments required.');
const site = publicObserverOrigin(siteValue);
const observer = publicObserverOrigin(observerValue);
const verifiedBytes = await readFile(verificationPath);
const verified = JSON.parse(verifiedBytes);
assert(verified.passed && verified.siteOrigin === site && verified.rootDocumentMatchesIndex && verified.workerHost.moduleVerified);
await mkdir(output);
const requireTools = createRequire(join(process.env['MONOLITH_BROWSER_TOOLS'], 'package.json'));
assert.equal(requireTools('playwright/package.json').version, '1.65.0');
const { chromium } = requireTools('playwright');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifact = {
  schemaVersion: 1, evidence: 'BLOCKED', passed: false, siteOrigin: site, observerOrigin: observer,
  sourceCommit: verified.sourceCommit, staticVerificationSha256: digest(verifiedBytes),
  runnerSha256: digest(await readFile(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), generatedAt: null,
  framePolicySha256: digest(await readFile(new URL('../../deploy/sites/hosting-frames.mjs', import.meta.url))), frameChecks: [],
  browser: null, playwright: '1.65.0', node: process.version, layouts: [], screenshots: [],
  fault: 'TEST_INJECTED_WORKER_HOST_NETWORK_ABORT', workerHostAborts: 0,
  attemptedExternalRequests: 0, guardSelfCheck: false, uiBlocked: false, uiErrorCode: null,
  pageErrors: 0, contextDestroyed: false,
  limitations: ['Injected document unavailability tests startup fail-closed behavior; this is not an observed provider outage.',
    'No worker is allowed to start in this fault case. The separate live workflow proves normal worker execution.',
    'Separately recognized hosting security bootstrap is not anonymous; its fetched challenge runtime is outside transport verification.',
    'Request capture covers the fresh browser context, not extensions or unrelated pages.'],
};
const browser = await chromium.launch({ headless: true });
artifact.browser = browser.version();
const contexts = [];
const checkFrames = async (page, phase) => {
  const descriptors = await page.evaluate(collectFrameDescriptors, { origin: site });
  const counts = classifyFrameInventory(descriptors, {
    allowCloudflare: verified.htmlAdditionPolicy === 'PINNED_CLOUDFLARE_JSD_TEMPLATE',
  });
  artifact.frameChecks.push({ phase, ...counts });
  assert(counts.valid, 'Unrecognized or duplicate application/hosting frame.');
  assert.equal(counts.monolith, 0, 'Disposable Monolith frame was not removed.');
};
const screenshot = async (page, name) => {
  await page.screenshot({ path: join(output, name), fullPage: true });
  artifact.screenshots.push({ path: name, sha256: digest(await readFile(join(output, name))) });
};
const open = async (fallback = false) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
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
    if (url.origin !== site) { artifact.attemptedExternalRequests++; await route.abort('blockedbyclient'); }
    else if (url.pathname === verified.workerHost.path) { artifact.workerHostAborts++; await route.abort('failed'); }
    else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', () => artifact.pageErrors++);
  await page.goto(site);
  await page.getByRole('heading', { name: 'Monolith live privacy lab' }).waitFor();
  await checkFrames(page, fallback ? 'FALLBACK_BEFORE_STARTUP' : 'BEFORE_STARTUP');
  return page;
};
let heartbeat;
try {
  const page = await open();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(page, `published-${width}.png`);
    artifact.layouts.push({ width, passed: true });
  }
  const fallback = await open(true);
  await fallback.getByRole('heading', { name: 'Follow a request', exact: true }).waitFor();
  await fallback.getByRole('button', { name: 'Direct path', exact: true }).click();
  assert.equal(await fallback.getByRole('button', { name: 'Direct path', exact: true }).getAttribute('aria-pressed'), 'true');
  await fallback.getByRole('button', { name: 'Private path', exact: true }).click();
  assert.equal(await fallback.getByRole('button', { name: 'Private path', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await fallback.locator('canvas').count(), 0);
  await screenshot(fallback, 'published-no-webgl-required.png');
  artifact.layouts.push({ webglForcedUnavailable: true, requestExplorer: true, noCanvas: true, passed: true });
  // Confirm the external-request guard can actually observe a direct send, then reset its counter.
  await page.evaluate(async (url) => { try { await fetch(url, { method: 'POST', body: '{}' }); } catch { /* Expected interception. */ } },
    `${observer}/api/observer/read?endpointId=lab_optimism`);
  assert.equal(artifact.attemptedExternalRequests, 1); artifact.guardSelfCheck = true;
  artifact.attemptedExternalRequests = 0;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Run private read', exact: true }).click();
  heartbeat = setInterval(() => process.stdout.write('{"phase":"WAITING_FOR_FAIL_CLOSED_UI"}\n'), 25_000);
  await page.locator('main[data-live-phase="BLOCKED"]').waitFor({ timeout: 190_000 });
  clearInterval(heartbeat);
  artifact.uiBlocked = true;
  const code = await page.locator('.live-error .mono').textContent();
  assert.equal(code, 'WORKER_UNAVAILABLE'); artifact.uiErrorCode = code;
  assert.equal(await page.getByRole('button', { name: 'Export measured report' }).isDisabled(), true);
  await checkFrames(page, 'AFTER_INJECTED_WORKER_UNAVAILABILITY');
  await screenshot(page, 'published-worker-unavailable.png');
  for (const context of contexts) await context.close();
  artifact.contextDestroyed = true;
  assert(artifact.workerHostAborts >= 1); assert.equal(artifact.attemptedExternalRequests, 0);
  assert.equal(artifact.pageErrors, 0);
  artifact.passed = true; artifact.evidence = 'OBSERVED_LIVE';
} catch {
  artifact.failure = 'DEPLOYED_BROWSER_CHECK_FAILED'; process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  for (const context of contexts) await context.close();
  await browser.close(); artifact.contextDestroyed = true;
  if (artifact.attemptedExternalRequests !== 0 || artifact.pageErrors !== 0 || !artifact.contextDestroyed) {
    artifact.passed = false; artifact.evidence = 'BLOCKED';
    artifact.failure = 'DEPLOYED_BROWSER_TEARDOWN_FAILED'; process.exitCode = 1;
  }
  artifact.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'browser-deployed.json'), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: artifact.passed, evidence: artifact.evidence, output })}\n`);
}
