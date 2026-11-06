// Actual production UI only. No fake driver, SDK patch, mocked RPC or altered response.
/* global document, innerWidth */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { classifyFrameInventory, collectFrameDescriptors } from './hosting-frames.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const deployedOrigin = process.env['MONOLITH_DEPLOYED_UI_ORIGIN'];
const previewInput = process.env['MONOLITH_PREVIEW_URL'];
const preview = new URL(deployedOrigin ?? previewInput ?? 'http://127.0.0.1:5187/');
const observer = new URL(process.env['MONOLITH_LIVE_OBSERVER_ORIGIN'] ?? '');
const output = process.env['MONOLITH_LIVE_OUTPUT'];
const toolDirectory = process.env['MONOLITH_BROWSER_TOOLS'];
const publicOrigin = (url, value) => url.protocol === 'https:' && url.origin === value
  && url.hostname.includes('.') && !isIP(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(url.hostname);
if (process.version !== 'v24.22.2' || !output || !toolDirectory
  || (deployedOrigin ? previewInput !== undefined || !publicOrigin(preview, deployedOrigin)
    : preview.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(preview.hostname))
  || observer.protocol !== 'https:' || observer.username || observer.password || observer.pathname !== '/'
  || observer.search || observer.hash || preview.pathname !== '/' || preview.search || preview.hash
  || preview.username || preview.password) throw new Error('Pinned tools, explicit local preview or HTTPS deployment origin, public observer and new output directory required.');
await mkdir(output);
const toolRequire = createRequire(join(toolDirectory, 'package.json'));
const transportRequire = createRequire(join(repository, 'packages/transport/package.json'));
assert.equal(toolRequire('playwright/package.json').version, '1.65.0');
assert.equal(transportRequire('@anon-rpc/browser-harness/package.json').version, '0.4.0');
const hashEntry = toolRequire.resolve('@noble/hashes/sha3');
assert.equal(JSON.parse(await readFile(join(dirname(hashEntry), 'package.json'), 'utf8')).version, '1.8.0');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim(), '',
  'Commit the exact source before recording live acceptance.');
const { chromium } = toolRequire('playwright');
const { keccak_256 } = toolRequire('@noble/hashes/sha3');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const keccak = (bytes) => `0x${Buffer.from(keccak_256(bytes)).toString('hex')}`;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const runPattern = new RegExp(`^run-${uuid}$`);
const rpcPattern = new RegExp(`^rpc-${uuid}$`);
const allocation = (value) => {
  assert.equal(value.schemaVersion, 1); assert(runPattern.test(value.runId)); assert(rpcPattern.test(value.baselineRpcId));
  assert(Number.isFinite(Date.parse(value.expiresAt)));
  return { schemaVersion: 1, runId: value.runId, baselineRpcId: value.baselineRpcId, expiresAt: value.expiresAt };
};
const diagnostic = (value) => ({ schemaVersion: 1, runId: runPattern.test(value.runId) ? value.runId : null, expiresAt: value.expiresAt,
  observations: value.observations.map((row) => {
    assert(rpcPattern.test(row.rpcId)); assert(['eth_chainId', 'eth_getBalance'].includes(row.method));
    assert(['unknown', 'baseline', 'different-from-baseline'].includes(row.sourceClass));
    assert.equal(typeof row.addressPresent, 'boolean'); assert.equal(typeof row.success, 'boolean');
    return { rpcId: row.rpcId, method: row.method, addressPresent: row.addressPresent,
      sourceClass: row.sourceClass, success: row.success };
  }) });
async function inventory() {
  const result = {};
  async function walk(path) {
    for (const entry of (await readdir(join(repository, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else result[name] = sha(await readFile(join(repository, name)));
    }
  }
  for (const name of ['apps/dashboard/src', 'apps/dashboard/dist', ...['shared', 'registry', 'transport', 'privacy-analyzer']
    .flatMap((name) => [`packages/${name}/src`, `packages/${name}/dist`])]) await walk(name);
  for (const file of ['pnpm-lock.yaml', 'package.json', 'apps/dashboard/package.json', 'apps/dashboard/vite.config.ts',
    'apps/dashboard/assets/worker-host.html', 'tests/e2e/lab-ui/browser-live.mjs',
    'tests/e2e/lab-ui/hosting-frames.mjs']) result[file] = sha(await readFile(join(repository, file)));
  result.officialSdkEntry = sha(await readFile(transportRequire.resolve('@anon-rpc/browser-harness')));
  return result;
}
const source = await inventory();
const artifact = { schemaVersion: 1, sourceTask: 'MN-014', evidence: 'BLOCKED', passed: false,
  startedAt: new Date().toISOString(), generatedAt: null, node: process.version, playwright: '1.65.0', browser: null,
  observerOrigin: observer.origin, target: { kind: deployedOrigin ? 'deployed-https' : 'local-production-preview', origin: preview.origin },
  sourceWorkingTreeClean: true,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  source, sourceUnchangedAfterRun: false, cases: [], layouts: [], resolverResponses: [], bootstrapRequests: [], metadata: [],
  hostingBootstrapRequests: [], frameChecks: [],
  sandboxChecks: { repairInitiallyDisabled: false, fixtureOnlyDisclosure: false, completed: [] },
  controls: { ordinaryProtectedTargetRequests: 0, directDetectionSelfCheck: false, pageErrors: 0, forgedLeakLabels: [] },
  shutdown: { browserContextDestroyed: false, iframeRemovedOnNavigation: false,
    iframeScope: 'MONOLITH_DISPOSABLE_WORKER_HOST', globalFramesAfterNavigation: null }, failure: null,
  limitations: ['One observed synthetic workflow through the configured trusted observer/forwarder; no universal anonymity claim.',
    'The tunnel provider and observer can see source and request payloads. Their operational retention is unverified.',
    'Two worker bootstrap lookups and ordinary allocation/registry/diagnostic metadata contacts are disclosed separately.',
    'Public hosting may add a non-anonymous Cloudflare security bootstrap and hidden challenge frame. It is recorded separately from app reads and the owned worker lifecycle; fetched challenge runtime is outside transport privacy measurement.',
    'The existing explicit leak POST receives test-only forged forwarding/case labels; its body and wire ID are preserved and its independent source must remain baseline.',
    'Ordinary page/frame HTTP is intercepted. Worker WebRTC/KPS, wallets, extensions and unrelated pages are outside capture.',
    'No raw IP, forwarding headers, RPC params, private wallet input or raw provider messages are retained.'] };
let mode = 'idle';
let activeAllocation = null;
let latestDiagnostics;
let leakScenario;
let leakFixture;
let controlIds = new Set();
let browser; let context; let page; let heartbeat;
const pending = [];
const directRequests = [];
const deny = async (route) => { artifact.controls.ordinaryProtectedTargetRequests++; await route.abort('blockedbyclient'); };
const recordFrames = async (stage) => {
  const frames = await page.evaluate(collectFrameDescriptors, { origin: preview.origin });
  const counts = classifyFrameInventory(frames, { allowCloudflare: Boolean(deployedOrigin) });
  artifact.frameChecks.push({ stage, ...counts, frames });
  return counts;
};
try {
  browser = await chromium.launch({ headless: true });
  artifact.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === preview.origin && url.pathname.startsWith('/cdn-cgi/challenge-platform/')) {
      if (artifact.hostingBootstrapRequests.length >= 64) artifact.failure ??= 'HOSTING_BOOTSTRAP_LIMIT_EXCEEDED';
      else artifact.hostingBootstrapRequests.push({ mode, method: request.method(), category: 'cloudflare-security-bootstrap' });
    }
    let rpc;
    try { rpc = request.postDataJSON(); } catch { /* Only exact RPC envelopes receive an exemption. */ }
    if (url.origin === 'https://mainnet.optimism.io') { await deny(route); return; }
    if (url.origin === observer.origin && url.pathname === '/api/observer/read') {
      if (request.method() === 'OPTIONS') { await route.continue(); return; }
      // Observe the actual allocation response without racing the application's reader.
      if (!activeAllocation) await Promise.allSettled(pending);
      const expectedUrl = activeAllocation
        ? `${observer.origin}/api/observer/read?endpointId=lab_optimism&runId=${activeAllocation.runId}` : null;
      const baseline = rpc?.id === activeAllocation?.baselineRpcId;
      const directAllowed = mode !== 'private' && mode !== 'idle' && request.url() === expectedUrl
        && request.method() === 'POST' && rpc && Object.keys(rpc).sort().join(',') === 'id,jsonrpc,method,params'
        && rpc.jsonrpc === '2.0' && typeof rpc.id === 'string' && rpcPattern.test(rpc.id) && rpc.method === 'eth_getBalance'
        && JSON.stringify(rpc.params) === JSON.stringify([`0x${'0'.repeat(40)}`, 'latest'])
        && !controlIds.has(rpc.id) && (baseline || mode === 'leak' && controlIds.size === 1)
        && controlIds.size < (mode === 'leak' ? 2 : 1);
      if (!directAllowed) { await deny(route); return; }
      controlIds.add(rpc.id); directRequests.push({ mode, rpcId: rpc.id, role: baseline ? 'direct-control' : 'leak' });
      if (!baseline && mode === 'leak') {
        // Test-only origin-label forgery on the already-counted native leak. No body/ID override.
        const bodySha256 = sha(request.postData() ?? '');
        artifact.controls.forgedLeakLabels.push({ rpcId: rpc.id, bodySha256, bodyOverridden: false,
          categories: ['forwarding-labels', 'protected-case-label'], reservedDocumentationAddressesOnly: true });
        await route.continue({ headers: { ...request.headers(), 'x-forwarded-for': '192.0.2.77, 198.51.100.42',
          forwarded: 'for=192.0.2.77', 'x-real-ip': '192.0.2.78', 'cf-connecting-ip': '192.0.2.79',
          'x-monolith-case': 'protected' } });
        return;
      }
    } else if (rpc?.jsonrpc === '2.0' && url.origin !== preview.origin) {
      const selector = rpc?.params?.[0]?.data;
      const bootstrap = url.href === 'https://ethereum.publicnode.com/' && rpc.method === 'eth_call'
        && Object.keys(rpc).sort().join(',') === 'id,jsonrpc,method,params'
        && Array.isArray(rpc.params) && rpc.params.length === 2
        && rpc.params[0] && typeof rpc.params[0] === 'object' && !Array.isArray(rpc.params[0])
        && Object.keys(rpc.params[0]).sort().join(',') === 'data,to'
        && typeof rpc.params[0].to === 'string'
        && rpc.params[0].to.toLowerCase() === '0x3acd9742c68f6d993066ae25533e09b9e1f60ed0'
        && (rpc.id === 'monolith_bootstrap_hash' && selector === '0x3898587d'
          || rpc.id === 'monolith_bootstrap_resolvers' && selector === '0x1c67ff29')
        && rpc.params[1] === 'latest'
        && artifact.bootstrapRequests.length < 2 && !artifact.bootstrapRequests.some((row) => row.id === rpc.id);
      if (!bootstrap) { await deny(route); return; }
      artifact.bootstrapRequests.push({ id: rpc.id, method: rpc.method, selector });
    }
    await route.continue();
  });
  context.on('response', (response) => {
    const url = new URL(response.url());
    const method = response.request().method();
    if (url.origin === observer.origin && url.pathname.startsWith('/api/') && method !== 'OPTIONS') pending.push((async () => {
      artifact.metadata.push({ mode, method, path: url.pathname.startsWith('/api/observer/runs/')
        ? '/api/observer/runs/:runId' : url.pathname, status: response.status() });
      if (url.pathname === '/api/observer/runs' && method === 'POST') {
        const body = await response.json();
        if (response.status() === 201 && body.ok) activeAllocation = allocation(body.value);
      } else if (url.pathname.startsWith('/api/observer/runs/') && method === 'GET') {
        const body = await response.json();
        if (response.status() === 200 && body.ok) latestDiagnostics = diagnostic(body.value);
      }
    })().catch(() => { artifact.failure ??= 'PUBLIC_METADATA_INVALID'; }));
    if (method === 'GET' && url.protocol === 'https:' && url.origin !== observer.origin) pending.push((async () => {
      try {
        const bytes = await response.body();
        if (bytes.length > 1024 * 1024) artifact.resolverResponses.push({ status: response.status(), bytes: bytes.length,
          sha256: sha(bytes), keccak256: keccak(bytes) });
      } catch { /* An incomplete body never proves integrity. */ }
    })());
  });
  page = await context.newPage();
  page.on('pageerror', () => artifact.controls.pageErrors++);
  await page.goto(preview.href);
  await page.getByRole('heading', { name: 'Monolith live privacy lab' }).waitFor();
  const sandbox = page.getByTestId('sandbox-walkthrough');
  await sandbox.waitFor();
  assert.equal(await sandbox.getByRole('button', { name: 'Run repaired fixture', exact: true }).isDisabled(), true);
  assert.equal(await sandbox.getByTestId('sandbox-outcome').getAttribute('data-outcome'), 'untested');
  assert.equal(await sandbox.getByText('This changes one fixed sandbox fixture. It does not edit arbitrary production code.', { exact: true }).count(), 1);
  assert.equal(await sandbox.getByTestId('sandbox-patch').textContent(), "- route: 'direct-debug'\n+ route: 'anon-nym'");
  artifact.sandboxChecks.repairInitiallyDisabled = true;
  artifact.sandboxChecks.fixtureOnlyDisclosure = true;
  const startupFrames = await recordFrames('startup');
  assert(startupFrames.valid); assert.equal(startupFrames.monolith, 0);
  await page.evaluate(async (target) => { try { await fetch(target, { method: 'POST', body: '{}' }); } catch { /* Expected interception. */ } },
    `${observer.origin}/api/observer/read?endpointId=lab_optimism&runId=run-${randomUUID()}`);
  artifact.controls.directDetectionSelfCheck = artifact.controls.ordinaryProtectedTargetRequests === 1;
  assert(artifact.controls.directDetectionSelfCheck);
  artifact.controls.ordinaryProtectedTargetRequests = 0;
  heartbeat = setInterval(() => process.stdout.write(`${JSON.stringify({ phase: `RUNNING_${mode.toUpperCase()}` })}\n`), 25_000);
  for (const [index, selected] of ['private', 'compare', 'leak', 'repair'].entries()) {
    mode = selected; activeAllocation = null; latestDiagnostics = null; controlIds = new Set();
    process.stdout.write(`${JSON.stringify({ phase: `STARTING_${mode.toUpperCase()}` })}\n`);
    await page.locator('.steps button').nth(index).click();
    const actionOrigin = ['leak', 'repair'].includes(mode) ? 'sandbox-presenter' : 'live-guide';
    if (actionOrigin === 'sandbox-presenter') {
      await sandbox.getByRole('button', { name: mode === 'leak' ? 'Run leaky fixture' : 'Run repaired fixture', exact: true }).click();
    } else {
      await page.getByRole('button', { name: mode === 'private' ? 'Run private read' : 'Compare direct and private', exact: true }).click();
    }
    const previousRun = artifact.cases.at(-1)?.allocation.runId ?? null;
    await page.waitForFunction((previous) => {
      const main = document.querySelector('main[data-live-phase]');
      return main?.getAttribute('data-live-phase') === 'BLOCKED'
        || main?.getAttribute('data-live-phase') === 'READY' && main.getAttribute('data-live-run') !== previous;
    }, previousRun, { timeout: 280_000 });
    await Promise.allSettled(pending);
    if (await page.locator('.live-error').count()) throw new Error('UI_RUN_BLOCKED');
    const activeFrames = await recordFrames(`${mode}-complete`);
    assert(activeFrames.valid); assert.equal(activeFrames.monolith, 1);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export measured report' }).click();
    const downloaded = await download;
    const report = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
    assert.equal(report.mode, mode); assert.equal(report.failure, null);
    assert.equal(report.report.evidence, 'OBSERVED_LIVE');
    assert.equal(await page.getByRole('heading', { name: 'Arkiv endpoint registry' }).locator('..')
      .getByText('Recorded snapshot', { exact: true }).count(), 1);
    assert.equal(report.scenario.scenarioId, 'monolith.synthetic-balance-widget.v1');
    assert.equal(report.scenario.seed, 'monolith-zero-address-balance-v1');
    assert.match(await page.getByTestId('live-balance').textContent(), /^0x[0-9a-f]+(?:…[0-9a-f]+)?$/);
    assert(activeAllocation && latestDiagnostics && latestDiagnostics.runId === activeAllocation.runId);
    const rows = await page.locator('.activity__row').evaluateAll((elements) => elements.map((element) => ({
      rpcId: element.getAttribute('data-rpc-id'), logicalReadId: element.getAttribute('data-read-id'),
      traceReadId: element.getAttribute('data-trace-read-id'), role: element.getAttribute('data-role'),
      route: element.getAttribute('data-route'), method: element.querySelector('.activity__method')?.textContent,
    })));
    assert.equal(rows.length, mode === 'private' ? 2 : mode === 'compare' ? 3 : 4);
    assert.deepEqual(rows.map((row) => row.rpcId).sort(), latestDiagnostics.observations.map((row) => row.rpcId).sort());
    for (const row of rows) {
      const observed = latestDiagnostics.observations.find((entry) => entry.rpcId === row.rpcId);
      assert.equal(observed.method, row.method); assert.equal(observed.addressPresent, row.method === 'eth_getBalance');
      assert.equal(observed.success, true);
      assert.equal(observed.sourceClass, mode === 'private' ? 'unknown'
        : ['direct-control', 'leak'].includes(row.role) ? 'baseline' : 'different-from-baseline');
      assert.equal(row.traceReadId, row.role === 'leak' ? null : row.logicalReadId);
      assert.equal(row.route, row.role === 'leak' ? null : row.role === 'direct-control' ? 'direct-debug' : 'anon-nym');
    }
    assert.equal(controlIds.size, mode === 'private' ? 0 : mode === 'leak' ? 2 : 1);
    assert.equal(report.sourceComparison, mode === 'private' ? 'not-run' : 'confirmed');
    assert.equal(report.report.eligibleReads, rows.length);
    assert.equal(report.report.protectedReads, mode === 'private' ? 0 : mode === 'repair' ? 3 : 2);
    if (mode === 'leak') {
      assert(report.report.findings.some((row) => row.code === 'DIRECT_BYPASS'));
      assert.equal(report.widgetFixture.route, 'direct-debug');
      leakScenario = report.scenario; leakFixture = report.widgetFixture;
      assert.equal(artifact.controls.forgedLeakLabels.length, 1);
      assert.equal(latestDiagnostics.observations.find((row) => row.rpcId === artifact.controls.forgedLeakLabels[0].rpcId)?.sourceClass, 'baseline');
    }
    if (mode === 'repair') {
      assert.equal(report.widgetPrivacy, 'pass'); assert.equal(report.summary.functionalAcceptance, 'pass');
      assert(report.previousLeakReport.findings.some((row) => row.code === 'DIRECT_BYPASS'));
      assert.deepEqual(report.scenario, leakScenario);
      assert.deepEqual(report.widgetFixture, { ...leakFixture, route: 'anon-nym' });
      assert.deepEqual(report.fixturePatch.before, leakFixture);
      assert.deepEqual(report.fixturePatch.after, report.widgetFixture);
      assert.deepEqual(report.fixturePatch.operations, [{ op: 'test', path: '', value: leakFixture },
        { op: 'replace', path: '/route', value: 'anon-nym' }]);
    }
    if (actionOrigin === 'sandbox-presenter') {
      const expectedOutcome = mode === 'leak' ? 'leak-observed' : 'repaired';
      assert.equal(await sandbox.getByTestId('sandbox-outcome').getAttribute('data-outcome'), expectedOutcome);
      assert.equal(await sandbox.getByTestId('sandbox-evidence').textContent(), 'OBSERVED LIVE');
      assert.equal(await sandbox.getByText(report.report.runId, { exact: true }).first().isVisible(), true);
      assert.equal(await sandbox.getByRole('button', { name: 'Run repaired fixture', exact: true }).isEnabled(), true);
      if (mode === 'repair') {
        assert.notEqual(report.previousLeakReport.runId, report.report.runId);
        assert.equal(await sandbox.getByText(report.previousLeakReport.runId, { exact: true }).first().isVisible(), true);
      }
      artifact.sandboxChecks.completed.push({ mode, outcome: expectedOutcome, evidence: 'OBSERVED_LIVE',
        reportId: report.report.runId, previousLeakReportId: report.previousLeakReport?.runId ?? null });
    }
    assert(artifact.resolverResponses.some((row) => row.keccak256 === report.worker.workerHash && row.status === 200));
    const screenshot = `${mode}.png`;
    await page.screenshot({ path: join(output, screenshot), fullPage: true });
    await writeFile(join(output, `${mode}-report.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    artifact.cases.push({ mode, actionOrigin, passed: true, allocation: activeAllocation, inventory: rows,
      scenarioId: report.scenario.scenarioId, seed: report.scenario.seed,
      fixtureRoute: report.widgetFixture?.route ?? null,
      diagnostics: latestDiagnostics, reportSha256: sha(await readFile(join(output, `${mode}-report.json`))),
      screenshot, screenshotSha256: sha(await readFile(join(output, screenshot))) });
  }
  assert.equal(artifact.controls.ordinaryProtectedTargetRequests, 0);
  assert.equal(artifact.controls.pageErrors, 0); assert.equal(artifact.bootstrapRequests.length, 2);
  assert.equal(new Set(artifact.cases.map((row) => row.allocation.runId)).size, 4);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const path = `repair-${width}.png`;
    await page.screenshot({ path: join(output, path), fullPage: true });
    artifact.layouts.push({ width, passed: true, path, sha256: sha(await readFile(join(output, path))) });
  }
  // Navigation destroys the live document; the clearly marked secondary view owns no live driver.
  await page.goto(new URL('/?mode=simulated', preview).href);
  await page.getByText('Simulated data', { exact: true }).waitFor();
  const navigatedFrames = await recordFrames('navigation');
  artifact.shutdown.iframeRemovedOnNavigation = navigatedFrames.valid && navigatedFrames.monolith === 0;
  artifact.shutdown.globalFramesAfterNavigation = navigatedFrames.total;
  assert(artifact.shutdown.iframeRemovedOnNavigation);
  await context.close(); context = null;
  artifact.shutdown.browserContextDestroyed = true;
  await Promise.allSettled(pending);
  assert.equal(artifact.controls.ordinaryProtectedTargetRequests, 0);
  assert.equal(artifact.controls.pageErrors, 0); assert.equal(artifact.failure, null);
  assert.deepEqual(await inventory(), source);
  artifact.sourceUnchangedAfterRun = true; artifact.evidence = 'OBSERVED_LIVE'; artifact.passed = true;
} catch (error) {
  artifact.failure ??= error?.message === 'UI_RUN_BLOCKED' ? 'UI_RUN_BLOCKED' : 'LIVE_UI_ACCEPTANCE_FAILED';
  const code = await page?.locator('.live-error .mono').textContent({ timeout: 1000 }).catch(() => null);
  artifact.failedAttempt = { mode, allocation: activeAllocation, diagnostics: latestDiagnostics,
    uiErrorCode: typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : null };
  try { await recordFrames('failed-attempt'); } catch { /* An unavailable page cannot establish frame ownership. */ }
  try {
    await page?.screenshot({ path: join(output, 'blocked.png'), fullPage: true, timeout: 5000 });
    artifact.failedAttempt.screenshot = 'blocked.png';
    artifact.failedAttempt.screenshotSha256 = sha(await readFile(join(output, 'blocked.png')));
  } catch { /* Failure evidence is retained even if the rendering context has gone away. */ }
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  if (context) { await context.close(); artifact.shutdown.browserContextDestroyed = true; }
  await browser?.close(); await Promise.allSettled(pending);
  if (artifact.passed && (artifact.controls.ordinaryProtectedTargetRequests !== 0
    || artifact.controls.pageErrors !== 0 || artifact.failure !== null)) {
    artifact.passed = false; artifact.evidence = 'BLOCKED';
    artifact.failure ??= 'LATE_CAPTURE_FAILED'; process.exitCode = 1;
  }
  artifact.directRequests = directRequests;
  artifact.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'browser-live.json'), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: artifact.passed, evidence: artifact.evidence, failure: artifact.failure, output })}\n`);
}
