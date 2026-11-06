// Native-frame capture of SIMULATED fixture geometry; no RPC or anonymity proof.
/* global document, window, HTMLCanvasElement, WebGL2RenderingContext */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../../../..');
const output = resolve(process.env['MONOLITH_TRANSITION_OUTPUT'] ?? join(directory, 'native-frames'));
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
  return {
    source: await inventory(join(repository, 'apps/dashboard/src')),
    dist: await inventory(join(repository, 'apps/dashboard/dist')),
    package: digest(await readFile(join(repository, 'apps/dashboard/package.json'))),
    lockfile: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
    runner: digest(await readFile(fileURLToPath(import.meta.url))),
    originalJourneyRunner: digest(await readFile(join(directory, '../browser-journey.mjs'))),
  };
}
await mkdir(output);
const result = {
  schemaVersion: 1, sourceTask: '#86', evidence: 'SIMULATED',
  scope: 'Actual browser-native framebuffer snapshots and model matrices for a local fixture transition, plus narrow fallback bounds/keyboard checks. No live privacy or GPU performance acceptance.',
  startedAt: new Date().toISOString(), passed: false, node: process.version, playwright: '1.65.0', browser: '',
  sourceBefore: await binding(), sourceAfter: null, frames: [], fallback: [], tabletOverlays: [], bootstrap: null,
  pageErrors: [], externalRequests: [], applicationApiRequests: [],
};
const browser = await chromium.launch({ headless: true });
result.browser = browser.version();
const contexts = [];
async function context({ width = 1440, height = 1000, fallback = false, mode = 'simulated' } = {}) {
  const session = await browser.newContext({ viewport: { width, height }, reducedMotion: fallback ? 'reduce' : 'no-preference' });
  contexts.push(session);
  await session.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== preview.origin) {
      result.externalRequests.push({ origin: url.origin, method: route.request().method() });
      await route.abort();
    } else {
      if (url.pathname.startsWith('/api/')) result.applicationApiRequests.push(url.pathname);
      await route.continue();
    }
  });
  await session.addInitScript(({ forceFallback }) => {
    const probe = window.__monolithNativeFrameProbe = { frame: 0, models: [], view: null, pendingBefore: null, sequence: null };
    if (forceFallback) {
      const originalContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return kind === 'webgl' || kind === 'webgl2' ? null : originalContext.call(this, kind, ...args);
      };
      return;
    }
    const proto = WebGL2RenderingContext.prototype;
    const locations = new WeakMap();
    const originalLocation = proto.getUniformLocation;
    proto.getUniformLocation = function (program, name) {
      const location = originalLocation.call(this, program, name);
      if (location) locations.set(location, name);
      return location;
    };
    const originalMatrix = proto.uniformMatrix4fv;
    proto.uniformMatrix4fv = function (location, transpose, value) {
      if (this.canvas.classList.contains('stage__canvas')) {
        if (locations.get(location) === 'uModel') probe.models.push(Array.from(value));
        if (locations.get(location) === 'uViewProj') probe.view = Array.from(value);
      }
      return originalMatrix.call(this, location, transpose, value);
    };
    const originalClear = proto.clear;
    proto.clear = function (mask) {
      if (this.canvas.classList.contains('stage__canvas') && (mask & this.COLOR_BUFFER_BIT)) {
        probe.frame += 1;
        probe.models = [];
      }
      return originalClear.call(this, mask);
    };
    const nativeRAF = window.requestAnimationFrame.bind(window);
    const snapshot = () => {
      const canvas = document.querySelector('.stage__canvas');
      return { actualAtMs: performance.now(), frame: probe.frame, models: probe.models.map((matrix) => [...matrix]),
        view: probe.view ? [...probe.view] : null,
        workerLabel: document.querySelector('.lifecycle [aria-current="step"]')?.textContent.trim(),
        png: canvas.toDataURL('image/png'), canvas: { width: canvas.width, height: canvas.height } };
    };
    window.requestAnimationFrame = (callback) => nativeRAF((timestamp) => {
      const prior = probe.frame;
      callback(timestamp);
      if (probe.frame === prior || probe.models.length === 0) return;
      if (probe.pendingBefore) {
        const done = probe.pendingBefore;
        probe.pendingBefore = null;
        done(snapshot());
      }
      const sequence = probe.sequence;
      if (!sequence) return;
      const elapsed = performance.now() - sequence.startedAtMs;
      const target = sequence.targets[sequence.frames.length];
      if (target === undefined || elapsed < target) return;
      const frame = snapshot();
      sequence.frames.push({ targetAfterMs: target, actualAfterMs: frame.actualAtMs - sequence.startedAtMs, ...frame });
      if (sequence.frames.length === sequence.targets.length) {
        probe.sequence = null;
        sequence.done({ startedAtMs: sequence.startedAtMs, frames: sequence.frames });
      }
    });
  }, { forceFallback: fallback });
  const page = await session.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  await page.goto(new URL(mode === 'simulated' ? '/?mode=simulated' : '/', preview).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
function matrixDelta(left, right) {
  assert.equal(left.length, right.length);
  return Math.max(...left.flatMap((matrix, index) => matrix.map((value, cell) => Math.abs(value - right[index][cell]))));
}
async function saveFrame(frame, path) {
  const { png, ...metadata } = frame;
  assert(png.startsWith('data:image/png;base64,'));
  const bytes = Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
  assert(bytes.length > 10000, 'Expected a substantive actual framebuffer snapshot.');
  await writeFile(join(output, path), bytes, { flag: 'wx' });
  const record = { path, sha256: digest(bytes), ...metadata };
  result.frames.push(record);
  return record;
}

try {
  const page = await context();
  await page.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await page.locator('.stage').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => new Promise((done) => { window.__monolithNativeFrameProbe.pendingBefore = done; }));
  assert.equal(before.workerLabel, 'Ready');
  await saveFrame(before, 'before-ready.png');
  const sequence = await page.evaluate(() => new Promise((done) => {
    const select = document.querySelector('select.select');
    window.__monolithNativeFrameProbe.sequence = { startedAtMs: performance.now(), targets: [0, 100, 300, 1000], frames: [], done };
    select.value = 'worker-unavailable';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  result.transitionStartedAtMs = sequence.startedAtMs;
  for (const frame of sequence.frames) {
    assert.equal(frame.workerLabel, 'Offline');
    await saveFrame(frame, `after-change-target-${frame.targetAfterMs}ms.png`);
  }
  const [early, middle, , late] = sequence.frames;
  const earlyToMiddle = matrixDelta(early.models, middle.models);
  const middleToLate = matrixDelta(middle.models, late.models);
  assert(earlyToMiddle > 0.01 && middleToLate > 0.01, 'Actual geometry pose should continue changing across the state transition.');
  assert.notEqual(result.frames[1].sha256, result.frames[2].sha256);
  assert.notEqual(result.frames[2].sha256, result.frames.at(-1).sha256);
  result.poseChange = { earlyToMiddleMaxModelDelta: earlyToMiddle, middleToLateMaxModelDelta: middleToLate,
    method: 'uModel matrices and actual canvas-only PNGs captured synchronously after native rAF draw callbacks; DOM readout text is outside these images.' };

  for (const width of [320, 390]) {
    const fallback = await context({ width, height: 844, fallback: true });
    await fallback.locator('.stage').scrollIntoViewIfNeeded();
    assert.equal(await fallback.locator('.stage').getAttribute('data-webgl'), 'off');
    const bounds = await fallback.locator('.stage-card').evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return {
        card: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        children: [...card.querySelectorAll('.stage-fallback, .stage-fallback *, .hud')].map((element) => {
          const box = element.getBoundingClientRect();
          return { label: element.tagName.toLowerCase() + (element.className.baseVal ?? element.className),
            text: element.tagName.toLowerCase() === 'button' || element.tagName.toLowerCase() === 'p' ? element.textContent.trim() : null,
            left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        }).filter((box) => box.width > 0 && box.height > 0),
      };
    });
    const tolerancePx = 1;
    const overflow = bounds.children.filter((box) => box.left < bounds.card.left - tolerancePx || box.top < bounds.card.top - tolerancePx
      || box.right > bounds.card.right + tolerancePx || box.bottom > bounds.card.bottom + tolerancePx);
    const name = `fallback-${width}.png`;
    await fallback.locator('.stage-card').screenshot({ path: join(output, name) });
    result.fallback.push({ width, bounds, overflow, tolerancePx, path: name, sha256: digest(await readFile(join(output, name))) });
    assert.deepEqual(overflow, [], `${width}px fallback must contain every visible child.`);
    await fallback.getByRole('button', { name: 'Your browser and worker', exact: true }).focus();
    await fallback.keyboard.press('Enter');
    assert(await fallback.locator('#transport-title').isVisible());
    await fallback.getByRole('button', { name: 'RPC endpoint', exact: true }).focus();
    await fallback.keyboard.press('Enter');
    assert(await fallback.locator('.compare').isVisible());
    result.fallback.at(-1).keyboardActions = 'PASS: browser/worker and endpoint controls';
  }

  for (const width of [521, 768, 899]) {
    const tablet = await context({ width, height: 1024, mode: 'live' });
    await tablet.locator('.stage').scrollIntoViewIfNeeded();
    const overlayBounds = await tablet.locator('.stage-card').evaluate((card) => {
      const rect = card.getBoundingClientRect();
      const boxes = [...card.querySelectorAll('.hud, .stage__tools')].map((element) => {
        const box = element.getBoundingClientRect();
        return { name: element.className, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          width: box.width, height: box.height };
      }).filter((box) => box.width > 0 && box.height > 0);
      return { card: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, boxes };
    });
    const overlaps = [];
    for (let i = 0; i < overlayBounds.boxes.length; i++) {
      const a = overlayBounds.boxes[i];
      assert(a.left >= overlayBounds.card.left - 1 && a.right <= overlayBounds.card.right + 1
        && a.top >= overlayBounds.card.top - 1 && a.bottom <= overlayBounds.card.bottom + 1, `${width}: overlay escapes stage`);
      for (const b of overlayBounds.boxes.slice(i + 1)) {
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([a.name, b.name]);
      }
    }
    const name = `tablet-${width}-stage.png`;
    await tablet.locator('.stage-card').screenshot({ path: join(output, name) });
    result.tabletOverlays.push({ width, ...overlayBounds, overlaps, tolerancePx: 1, path: name, sha256: digest(await readFile(join(output, name))) });
    assert.deepEqual(overlaps, [], `${width}: HUD/status/control overlays must not overlap`);
  }

  // Close animated views before a short-lived bootstrap disclosure capture.
  for (const prior of contexts) await prior.close();
  const boot = await context({ width: 320, height: 844 });
  await boot.getByLabel('Scenario', { exact: true }).selectOption('warm');
  await boot.locator('.stage').scrollIntoViewIfNeeded();
  await boot.evaluate(() => {
    const select = document.querySelector('select.select');
    select.value = 'cold-start';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await boot.locator('.stage-label--bootstrap').waitFor();
  await boot.waitForFunction(() => document.querySelector('.stage-label--bootstrap')?.dataset.visible === 'true');
  const bootstrapBounds = await boot.locator('.stage-card').evaluate((card) => {
    const rect = card.getBoundingClientRect();
    const disclosure = card.querySelector('.stage-label--bootstrap');
    const label = disclosure.getBoundingClientRect();
    return { card: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      label: { left: label.left, right: label.right, top: label.top, bottom: label.bottom }, text: disclosure.innerText };
  });
  result.bootstrap = { width: 320, ...bootstrapBounds };
  assert.match(bootstrapBounds.text, /not anonymous/);
  assert(bootstrapBounds.label.left >= bootstrapBounds.card.left && bootstrapBounds.label.right <= bootstrapBounds.card.right
    && bootstrapBounds.label.top >= bootstrapBounds.card.top && bootstrapBounds.label.bottom <= bootstrapBounds.card.bottom);
  const hudBefore = await boot.locator('.hud--tl').innerText();
  assert.match(hudBefore, /Starting/);
  const captureStartedAtMs = await boot.evaluate(() => performance.now());
  const client = await boot.context().newCDPSession(boot);
  const captured = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await client.detach();
  await writeFile(join(output, 'bootstrap-320.png'), Buffer.from(captured.data, 'base64'), { flag: 'wx' });
  const hudAfter = await boot.locator('.hud--tl').innerText();
  assert.match(hudAfter, /Starting/);
  assert.match(await boot.locator('.stage-label--bootstrap').innerText(), /not anonymous/);
  result.bootstrap = { width: 320, ...bootstrapBounds, hudBefore, hudAfter, captureStartedAtMs,
    captureFinishedAtMs: await boot.evaluate(() => performance.now()),
    method: 'Immediate CDP viewport capture bracketed by actual Starting/disclosure DOM states; no locator stability wait.',
    path: 'bootstrap-320.png', sha256: digest(await readFile(join(output, 'bootstrap-320.png'))) };
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.applicationApiRequests, []);
  result.sourceAfter = await binding();
  assert.deepEqual(result.sourceAfter, result.sourceBefore);
  result.passed = true;
} catch (error) {
  result.failure = error.message;
  throw error;
} finally {
  for (const session of contexts) await session.close();
  await browser.close();
  result.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'transition-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ passed: result.passed, frames: result.frames.length, fallback: result.fallback.length, failure: result.failure, output })}\n`);
}
