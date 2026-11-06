// Offline Chromium regression: all fixture RPC HTTP is intercepted, never sent to an external server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEgressCollector } from '../../privacy/egress/collector.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDirectory = join(repository, 'tests/fixtures/leak-widget');
const fixture = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'));
const modes = ['leak', 'fixed', 'retry', 'outage', 'block-all', 'unexplained', 'missing-trace', 'direct-control'];
let selectedMode;
let output;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (!['--case', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('Use --case <scenario> and/or --output <newfile>.');
  if (args[index] === '--case') selectedMode = args[++index];
  else output = resolve(args[++index]);
}
if (selectedMode && !modes.includes(selectedMode)) throw new Error('Unsupported fixture case.');
const rootRequire = createRequire(join(repository, 'package.json'));
const publicEntries = {};
for (const name of ['shared', 'transport', 'privacy-analyzer']) {
  const manifest = JSON.parse(await readFile(join(repository, `packages/${name}/package.json`), 'utf8'));
  publicEntries[`@monolith/${name}`] = join(repository, `packages/${name}`, manifest.exports['.'].import);
}
if (!process.env.MONOLITH_BROWSER_TOOLS) throw new Error('Set MONOLITH_BROWSER_TOOLS to isolated Playwright 1.65.0 tools.');
const browserRequire = createRequire(join(resolve(process.env.MONOLITH_BROWSER_TOOLS), 'package.json'));
assert.equal(browserRequire('playwright/package.json').version, '1.65.0');
const { chromium } = browserRequire('playwright');
const { createServer } = await import(rootRequire.resolve('vite'));
const vite = await createServer({ root: fixtureDirectory, configFile: false, envDir: fixtureDirectory,
  envPrefix: 'MN012_UNUSED_', resolve: { alias: publicEntries },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [repository] } } });
const result = { evidence: 'SIMULATED', seed: fixture.seed, passed: false, generatedAt: null,
  cases: [], sourceHashes: {}, sourceUnchangedAfterRun: false, externalRequests: [], pageErrors: [],
  limitations: ['The test-owned driver returns authored responses. This is browser egress and transport policy regression evidence, not live anonymity.',
    'CDP captures ordinary Chromium page requests at configured origins; worker WebRTC/KPS, wallets, extensions and uninstrumented apps are outside scope.'] };
let browser;
async function sourceInventory() {
  const files = ['pnpm-lock.yaml', 'package.json', '.node-version', 'tests/e2e/privacy/run.mjs',
    'tests/privacy/egress/collector.mjs', 'tests/privacy/egress/static.mjs', 'tests/privacy/egress/reviewed-adapters.json',
    'tests/fixtures/leak-widget/main.ts', 'tests/fixtures/leak-widget/leak-widget.ts', 'tests/fixtures/leak-widget/manifest.json'];
  async function walk(directory) {
    for (const entry of (await readdir(join(repository, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:ts|js)$/.test(entry.name)) files.push(path);
    }
  }
  for (const name of ['shared', 'transport', 'privacy-analyzer']) {
    files.push(`packages/${name}/package.json`); await walk(`packages/${name}/src`); await walk(`packages/${name}/dist`);
  }
  return Object.fromEntries(await Promise.all(files.sort().map(async (file) => [file,
    createHash('sha256').update(await readFile(join(repository, file))).digest('hex')])));
}
const before = await sourceInventory();
try {
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  for (const mode of selectedMode ? [selectedMode] : modes) {
    const context = await browser.newContext();
    const collector = createEgressCollector(fixture, { allowDirectControl: mode === 'direct-control' });
    let completedCaptures = 0;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === new URL(origin).origin) { await route.continue(); return; }
      if (![new URL(fixture.rpcUrl).origin, new URL(fixture.bootstrapUrl).origin].includes(url.origin)) {
        result.externalRequests.push('outside-configured-fixture-origins'); await route.abort(); return;
      }
      const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' };
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      const body = request.postDataJSON();
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ jsonrpc: '2.0', id: body.id,
        result: body.method === 'eth_getTransactionReceipt' ? null : '0x1' }) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.pageErrors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', (event) => collector.request(event));
    cdp.on('Network.responseReceived', (event) => collector.response(event));
    cdp.on('Network.loadingFinished', (event) => { collector.finished(event); completedCaptures++; });
    cdp.on('Network.loadingFailed', (event) => { collector.failed(event); completedCaptures++; });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof globalThis.fixtureRun === 'function');
    const snapshot = await page.evaluate((scenario) => globalThis.fixtureRun(scenario), mode);
    // Flush CDP completion events without joining by time or method; requestId is the only network identity.
    await cdp.send('Runtime.evaluate', { expression: '0' });
    await context.close();
    const analyzed = collector.finish(snapshot, completedCaptures > 0);
    result.cases.push({ mode, ...analyzed });
    if (mode === 'fixed' || mode === 'retry' || mode === 'direct-control') {
      assert.equal(analyzed.gatePassed, true, `${mode} must complete useful reads privately in the fixture`);
      assert.equal(analyzed.report.protectedCoverage, mode === 'direct-control' ? 0.75 : 1);
    } else if (mode === 'outage' || mode === 'block-all') {
      assert.equal(analyzed.privacyPass, true, `${mode} has no direct fallback`);
      assert.equal(analyzed.functionalPass, false, 'Blocking useful reads must fail functional acceptance');
      assert.equal(analyzed.gatePassed, false);
      assert.equal(analyzed.unexpectedDirectRequests, 0);
    } else {
      assert.equal(analyzed.gatePassed, false, `${mode} must fail the gate`);
      if (mode === 'leak') {
        assert.equal(analyzed.functionalPass, true, 'The same useful balance/receipt operations must still work');
        assert.equal(analyzed.violations[0]?.method, 'eth_getTransactionReceipt');
        assert.equal(analyzed.violations[0]?.callsite?.file, 'leak-widget.ts');
      }
      if (mode === 'unexplained') assert(analyzed.report.findings.some((entry) => entry.code === 'UNEXPLAINED_EGRESS'));
      if (mode === 'missing-trace') assert(analyzed.report.findings.some((entry) => entry.code === 'MISSING_TRACE'));
    }
    console.info(JSON.stringify({ mode, evidence: 'SIMULATED', gatePassed: analyzed.gatePassed,
      privacyPass: analyzed.privacyPass, functionalPass: analyzed.functionalPass,
      eligibleReads: analyzed.report.eligibleReads, unexpectedDirectRequests: analyzed.unexpectedDirectRequests,
      violations: analyzed.violations }));
  }
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.pageErrors, []);
  result.sourceHashes = before;
  assert.deepEqual(await sourceInventory(), before, 'Runtime inputs changed during capture');
  result.sourceUnchangedAfterRun = true;
  result.passed = selectedMode ? result.cases[0].gatePassed : true;
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser?.close(); await vite.close();
  result.generatedAt = new Date().toISOString();
  if (output) await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.info(JSON.stringify({ passed: result.passed, evidence: result.evidence, cases: result.cases.length }));
}
