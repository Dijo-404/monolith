// Actual browser rendering and SIMULATED fixture interactions; never live privacy proof.
/* global document, window, HTMLCanvasElement, WebGL2RenderingContext, PointerEvent */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../../../..');
const preview = new URL(process.env['MONOLITH_UI_PREVIEW_URL'] ?? 'http://127.0.0.1:5196/');
const output = resolve(process.env['MONOLITH_STAGE_OUTPUT'] ?? join(directory, 'interactions'));
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
  return {
    source: await inventory(join(repository, 'apps/dashboard/src')),
    dist: await inventory(join(repository, 'apps/dashboard/dist')),
    package: digest(await readFile(join(repository, 'apps/dashboard/package.json'))),
    lockfile: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
    originalJourneyRunner: digest(await readFile(join(directory, '../browser-journey.mjs'))),
    stageRunner: digest(await readFile(fileURLToPath(import.meta.url))),
  };
}
await mkdir(output);
const result = {
  schemaVersion: 1, sourceTask: '#86', evidence: 'SIMULATED',
  scope: 'Local production-preview WebGL rendering, controls and fixture transitions. Instrumented browser draw counts are local observations; no real RPC, anonymity, device FPS or general GPU performance claim.',
  livePrivacyAcceptance: false, startedAt: new Date().toISOString(), passed: false,
  node: process.version, playwright: '1.65.0', browser: '',
  checks: [], screenshots: [], pageErrors: [], shaderErrors: [], externalRequests: [], applicationApiRequests: [],
  sourceBefore: await binding(), sourceAfter: null,
};
const browser = await chromium.launch({ headless: true });
result.browser = browser.version();
const contexts = [];
const check = (name, detail = {}, status = 'PASS') => result.checks.push({ name, status, detail });
const button = (page, name) => page.getByRole('button', { name, exact: true });
const probe = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__monolithStageProbe)));

async function open({ width = 1440, height = 1000, reduced = false, fallback = false, mode = 'live', touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch });
  contexts.push(context);
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
  await context.addInitScript(({ forceFallback }) => {
    const metrics = window.__monolithStageProbe = { frames: 0, draws: 0, frameTimes: [], eye: null, shaderErrors: [], contextLosses: 0 };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const proto = WebGL2RenderingContext.prototype;
      const locations = new WeakMap();
      const originalLocation = proto.getUniformLocation;
      proto.getUniformLocation = function (program, name) {
        const location = originalLocation.call(this, program, name);
        if (location) locations.set(location, name);
        return location;
      };
      const originalUniform = proto.uniform3f;
      proto.uniform3f = function (location, x, y, z) {
        if (locations.get(location) === 'uEye' && this.canvas.classList.contains('stage__canvas')) metrics.eye = [x, y, z];
        return originalUniform.call(this, location, x, y, z);
      };
      const originalClear = proto.clear;
      proto.clear = function (mask) {
        if (this.canvas.classList.contains('stage__canvas') && (mask & this.COLOR_BUFFER_BIT)) {
          metrics.frames += 1;
          metrics.frameTimes.push(performance.now());
          if (metrics.frameTimes.length > 240) metrics.frameTimes.shift();
        }
        return originalClear.call(this, mask);
      };
      for (const name of ['drawElements', 'drawArrays']) {
        const originalDraw = proto[name];
        proto[name] = function (...args) {
          if (this.canvas.classList.contains('stage__canvas')) metrics.draws += 1;
          return originalDraw.apply(this, args);
        };
      }
      const originalCompile = proto.compileShader;
      proto.compileShader = function (shader) {
        const returned = originalCompile.call(this, shader);
        if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) metrics.shaderErrors.push(this.getShaderInfoLog(shader));
        return returned;
      };
    }
    document.addEventListener('webglcontextlost', () => { metrics.contextLosses += 1; }, true);
    if (forceFallback) {
      const originalContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return kind === 'webgl' || kind === 'webgl2' ? null : originalContext.call(this, kind, ...args);
      };
    }
  }, { forceFallback: fallback });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  await page.goto(new URL(mode === 'simulated' ? '/?mode=simulated' : '/', preview).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.stage').scrollIntoViewIfNeeded();
  if (!fallback) await page.waitForFunction(() => window.__monolithStageProbe.frames > 0);
  return { page, context };
}
async function shot(page, name, target = '.stage-card') {
  await page.locator(target).scrollIntoViewIfNeeded();
  await page.locator(target).screenshot({ path: join(output, name), animations: 'allow' });
  result.screenshots.push({ path: name, sha256: digest(await readFile(join(output, name))) });
}
async function frameDelta(page, duration = 400) {
  const started = Date.now();
  const before = await probe(page);
  await page.waitForTimeout(duration);
  const after = await probe(page);
  return { frames: after.frames - before.frames, draws: after.draws - before.draws, requestedWaitMs: duration, elapsedMs: Date.now() - started };
}

try {
  const { page, context } = await open();
  assert.equal(await page.locator('.stage').getAttribute('data-webgl'), 'on');
  assert.deepEqual((await probe(page)).shaderErrors, []);
  const moving = await frameDelta(page);
  assert(moving.frames > 2 && moving.draws > moving.frames);
  await shot(page, 'desktop-motion-before.png');
  await page.waitForTimeout(180);
  await shot(page, 'desktop-motion-mid.png');
  await page.waitForTimeout(180);
  await shot(page, 'desktop-motion-after.png');
  check('Real WebGL programs compile and normal-preference scene renders successive frames', moving);

  await button(page, 'Reset 3D view').click();
  await page.waitForTimeout(150);
  const baselineEye = (await probe(page)).eye;
  const canvas = page.locator('.stage__canvas');
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.55);
  await page.waitForTimeout(400);
  const leftEye = (await probe(page)).eye;
  await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height * 0.55);
  await page.waitForTimeout(400);
  const rightEye = (await probe(page)).eye;
  assert(rightEye[0] - leftEye[0] > 0.2, 'Stage-local pointer should meaningfully change the camera');
  await shot(page, 'desktop-pointer-view.png');
  await button(page, 'Reset 3D view').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const resetEye = (await probe(page)).eye;
  assert(Math.hypot(...resetEye.map((value, i) => value - baselineEye[i])) < 0.04);
  check('Stage-local pointer parallax responds, and keyboard Reset view restores the camera', { baselineEye, leftEye, rightEye, resetEye });
  await page.mouse.move(10, 10);
  await page.waitForTimeout(850);
  const outsideBefore = (await probe(page)).eye;
  await page.mouse.move(280, 20);
  await page.waitForTimeout(400);
  const outsideAfter = (await probe(page)).eye;
  assert(Math.abs(outsideAfter[0] - outsideBefore[0]) < 0.05);
  check('Pointer movement outside the stage does not steer its view', { outsideBefore, outsideAfter, caveat: 'Small ambient camera drift remains allowed.' });

  await button(page, 'Pause scene motion').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.stage').getAttribute('data-motion'), 'paused');
  assert.equal(await button(page, 'Resume scene motion').getAttribute('aria-pressed'), 'true');
  await shot(page, 'desktop-paused-before.png', '.stage__canvas');
  const paused = await frameDelta(page, 450);
  await shot(page, 'desktop-paused-after.png', '.stage__canvas');
  assert.equal(paused.frames, 0);
  assert.equal(result.screenshots.at(-1).sha256, result.screenshots.at(-2).sha256);
  check('Keyboard Pause stops ambient draw frames and preserves an identical rendered image', paused);
  await button(page, 'Resume scene motion').click();
  const resumed = await frameDelta(page);
  assert(resumed.frames > 2);
  check('Resume restores ambient motion', resumed);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const offscreen = await frameDelta(page);
  assert.equal(offscreen.frames, 0);
  await page.locator('.stage').scrollIntoViewIfNeeded();
  const returned = await frameDelta(page);
  assert(returned.frames > 2);
  check('Actual offscreen scrolling parks drawing and returning restarts it', { offscreen, returned });

  const secondPage = await context.newPage();
  await secondPage.goto('about:blank');
  await secondPage.bringToFront();
  await page.waitForTimeout(150);
  const nativeHidden = await page.evaluate(() => document.hidden);
  if (nativeHidden) {
    const hiddenDelta = await frameDelta(page);
    assert.equal(hiddenDelta.frames, 0);
    check('A genuinely hidden document parks the scene', { method: 'Another browser tab brought to front', hiddenDelta });
  } else {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenDelta = await frameDelta(page);
    assert.equal(hiddenDelta.frames, 0);
    check('Document-visibility handling parks the scene under a controlled browser event', {
      method: 'SIMULATED document.hidden getter + visibilitychange; headless tab switching did not expose native hidden state', hiddenDelta,
      limit: 'This does not prove browser/OS background throttling.' });
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await secondPage.close();
  await page.bringToFront();
  assert((await frameDelta(page)).frames > 2);

  const reduced = (await open({ reduced: true })).page;
  assert.equal(await reduced.locator('.stage').getAttribute('data-motion'), 'reduced');
  assert.equal(await button(reduced, 'Pause scene motion').count(), 0);
  assert.equal(await reduced.getByText('Reduced motion', { exact: true }).isVisible(), true);
  const reducedSample = await frameDelta(reduced);
  assert.equal(reducedSample.frames, 0);
  await shot(reduced, 'desktop-reduced-motion.png');
  check('Reduced motion is a clear static view with an explicit note and no Pause control', reducedSample);

  const mobile = (await open({ width: 390, height: 844, touch: true })).page;
  assert.equal(await button(mobile, 'Reset 3D view').isVisible(), false);
  assert.equal(await button(mobile, 'Pause scene motion').isVisible(), true);
  await button(mobile, 'Pause scene motion').tap();
  assert.equal(await mobile.locator('.stage').getAttribute('data-motion'), 'paused');
  const mobileBefore = (await probe(mobile)).eye;
  await mobile.locator('.stage__canvas').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: rect.right - 10, clientY: rect.top + 90, bubbles: true }));
  });
  await mobile.waitForTimeout(200);
  assert.deepEqual((await probe(mobile)).eye, mobileBefore);
  await shot(mobile, 'mobile-stage-controls.png');
  check('Touch layout hides mouse-only Reset, keeps Pause usable and does not require pointer parallax', { mobileBefore });

  const fixture = (await open({ mode: 'simulated' })).page;
  await fixture.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await fixture.locator('.stage').scrollIntoViewIfNeeded();
  await fixture.waitForTimeout(600);
  await shot(fixture, 'transition-ready.png');
  await button(fixture, 'Fail closed').click();
  await button(fixture, 'Take the network offline').click();
  await shot(fixture, 'transition-outage-before.png');
  await fixture.waitForTimeout(180);
  await shot(fixture, 'transition-outage-mid.png');
  await fixture.waitForTimeout(800);
  await shot(fixture, 'transition-outage-after.png');
  assert.match(await fixture.locator('.guide').innerText(), /offline|blocked|outage/i);
  check('Fixture worker-state transition has real before/mid/after rendered captures', { evidence: 'SIMULATED', intervalMs: [0, 180, 980] });
  await fixture.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await fixture.locator('.stage').scrollIntoViewIfNeeded();
  await button(fixture, 'Pause scene motion').click();
  await button(fixture, 'See what the endpoint learns').click();
  const beforeRead = (await probe(fixture)).frames;
  await button(fixture, 'Send a direct read').click();
  await button(fixture, 'Next: Hide where it comes from').waitFor();
  assert.equal(await fixture.locator('.stage').getAttribute('data-motion'), 'paused');
  assert((await probe(fixture)).frames > beforeRead);
  assert.match(await fixture.locator('.route-card--direct').innerText(), /Your network/);
  await shot(fixture, 'paused-fixture-read-result.png');
  check('Pause preserves useful fixture reads and application-state updates', { evidence: 'SIMULATED' });

  const fallback = (await open({ reduced: true, fallback: true, mode: 'simulated' })).page;
  assert.equal(await fallback.locator('.stage').getAttribute('data-webgl'), 'off');
  await button(fallback, 'Send a direct read').click();
  await button(fallback, 'Next: Hide where it comes from').waitFor();
  await shot(fallback, 'fallback-schematic.png');
  await button(fallback, 'Your browser and worker').focus();
  await fallback.keyboard.press('Enter');
  assert(await fallback.locator('#transport-title').isVisible());
  check('WebGL-unavailable schematic preserves readable routes, fixture actions and keyboard detail links');

  const loss = (await open()).page;
  const contextLossAvailable = await loss.locator('.stage__canvas').evaluate((element) => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  if (contextLossAvailable) {
    await loss.waitForTimeout(300);
    const fallbackActive = await loss.locator('.stage').getAttribute('data-webgl') === 'off';
    assert(fallbackActive, 'An actual runtime context loss must switch to the accessible schematic.');
    await button(loss, 'Your browser and worker').focus();
    await loss.keyboard.press('Enter');
    assert(await loss.locator('#transport-title').isVisible());
    await shot(loss, 'runtime-context-loss.png');
    check('Runtime GPU-context loss outcome', { eventObserved: (await probe(loss)).contextLosses > 0, fallbackActive,
      keyboardDetailAction: 'PASS' });
  } else check('Runtime GPU-context loss outcome', { limitation: 'WEBGL_lose_context extension unavailable.' }, 'UNTESTED');

  for (const context of contexts) for (const current of context.pages()) result.shaderErrors.push(...(await probe(current)).shaderErrors);
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.shaderErrors, []);
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.applicationApiRequests, []);
  result.sourceAfter = await binding();
  assert.deepEqual(result.sourceAfter, result.sourceBefore, 'Source or build changed during evidence capture.');
  result.passed = true;
} catch (error) {
  result.failure = error.message;
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  result.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'stage-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ passed: result.passed, checks: result.checks.length, failure: result.failure, output })}\n`);
}
