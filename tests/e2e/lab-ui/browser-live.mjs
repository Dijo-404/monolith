// Actual production UI only. No fake driver, SDK patch, mocked RPC or altered response.
/* global document */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const preview = new URL(process.env['MONOLITH_PREVIEW_URL'] ?? '');
const observer = new URL(process.env['MONOLITH_LIVE_OBSERVER_ORIGIN'] ?? '');
const output = process.env['MONOLITH_LIVE_OUTPUT'];
const toolDirectory = process.env['MONOLITH_BROWSER_TOOLS'];
if (process.version !== 'v24.22.2' || !output || !toolDirectory
  || preview.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(preview.hostname)
  || observer.protocol !== 'https:' || observer.username || observer.password || observer.pathname !== '/'
  || observer.search || observer.hash || preview.pathname !== '/' || preview.search || preview.hash
  || preview.username || preview.password) throw new Error('Pinned tools, local preview, public observer origin and new output directory required.');
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
    'apps/dashboard/assets/worker-host.html', 'tests/e2e/lab-ui/browser-live.mjs']) result[file] = sha(await readFile(join(repository, file)));
  result.officialSdkEntry = sha(await readFile(transportRequire.resolve('@anon-rpc/browser-harness')));
  return result;
}
const source = await inventory();
const artifact = { schemaVersion: 1, sourceTask: 'MN-014', evidence: 'BLOCKED', passed: false,
  startedAt: new Date().toISOString(), generatedAt: null, node: process.version, playwright: '1.65.0', browser: null,
  observerOrigin: observer.origin, sourceWorkingTreeClean: true,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  source, sourceUnchangedAfterRun: false, cases: [], resolverResponses: [], bootstrapRequests: [], metadata: [],
  controls: { ordinaryProtectedTargetRequests: 0, directDetectionSelfCheck: false, pageErrors: 0 },
  shutdown: { browserContextDestroyed: false, iframeRemovedOnNavigation: false }, failure: null,
  limitations: ['One observed synthetic workflow through the configured trusted observer/forwarder; no universal anonymity claim.',
    'The tunnel provider and observer can see source and request payloads. Their operational retention is unverified.',
    'Two worker bootstrap lookups and ordinary allocation/registry/diagnostic metadata contacts are disclosed separately.',
    'Ordinary page/frame HTTP is intercepted. Worker WebRTC/KPS, wallets, extensions and unrelated pages are outside capture.',
    'No raw IP, forwarding headers, RPC params, private wallet input or raw provider messages are retained.'] };
let mode = 'idle';
let activeAllocation = null;
let latestDiagnostics;
let controlIds = new Set();
let browser; let context; let page; let heartbeat;
const pending = [];
const directRequests = [];
const deny = async (route) => { artifact.controls.ordinaryProtectedTargetRequests++; await route.abort('blockedbyclient'); };
try {
  browser = await chromium.launch({ headless: true });
  artifact.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
        && rpc.jsonrpc === '2.0' && rpcPattern.test(rpc.id) && rpc.method === 'eth_getBalance'
        && JSON.stringify(rpc.params) === JSON.stringify([`0x${'0'.repeat(40)}`, 'latest'])
        && !controlIds.has(rpc.id) && (baseline || mode === 'leak' && controlIds.size === 1)
        && controlIds.size < (mode === 'leak' ? 2 : 1);
      if (!directAllowed) { await deny(route); return; }
      controlIds.add(rpc.id); directRequests.push({ mode, rpcId: rpc.id, role: baseline ? 'direct-control' : 'leak' });
    } else if (rpc?.jsonrpc === '2.0' && url.origin !== preview.origin) {
      const selector = rpc?.params?.[0]?.data;
      const bootstrap = url.href === 'https://ethereum.publicnode.com/' && rpc.method === 'eth_call'
        && rpc.params?.[0]?.to?.toLowerCase() === '0x3acd9742c68f6d993066ae25533e09b9e1f60ed0'
        && ['0x3898587d', '0x1c67ff29'].includes(selector) && rpc.params?.[1] === 'latest'
        && ['monolith_bootstrap_hash', 'monolith_bootstrap_resolvers'].includes(rpc.id)
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
  assert.equal(await page.locator('iframe').count(), 0);
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
    await page.locator('.guide__actions .btn--primary').click();
    const previousRun = artifact.cases.at(-1)?.allocation.runId ?? null;
    await page.waitForFunction((previous) => {
      const main = document.querySelector('main[data-live-phase]');
      return main?.getAttribute('data-live-phase') === 'BLOCKED'
        || main?.getAttribute('data-live-phase') === 'READY' && main.getAttribute('data-live-run') !== previous;
    }, previousRun, { timeout: 280_000 });
    await Promise.allSettled(pending);
    if (await page.locator('.live-error').count()) throw new Error('UI_RUN_BLOCKED');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export measured report' }).click();
    const downloaded = await download;
    const report = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
    assert.equal(report.mode, mode); assert.equal(report.failure, null);
    assert.equal(report.report.evidence, 'OBSERVED_LIVE');
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
    if (mode === 'leak') assert(report.report.findings.some((row) => row.code === 'DIRECT_BYPASS'));
    if (mode === 'repair') {
      assert.equal(report.widgetPrivacy, 'pass'); assert.equal(report.summary.functionalAcceptance, 'pass');
      assert(report.previousLeakReport.findings.some((row) => row.code === 'DIRECT_BYPASS'));
    }
    assert(artifact.resolverResponses.some((row) => row.keccak256 === report.worker.workerHash && row.status === 200));
    const screenshot = `${mode}.png`;
    await page.screenshot({ path: join(output, screenshot), fullPage: true });
    await writeFile(join(output, `${mode}-report.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    artifact.cases.push({ mode, passed: true, allocation: activeAllocation, inventory: rows,
      diagnostics: latestDiagnostics, reportSha256: sha(await readFile(join(output, `${mode}-report.json`))),
      screenshot, screenshotSha256: sha(await readFile(join(output, screenshot))) });
  }
  assert.equal(artifact.controls.ordinaryProtectedTargetRequests, 0);
  assert.equal(artifact.controls.pageErrors, 0); assert.equal(artifact.bootstrapRequests.length, 2);
  assert.equal(new Set(artifact.cases.map((row) => row.allocation.runId)).size, 4);
  // Navigation destroys the live document; the clearly marked secondary view owns no live driver.
  await page.goto(new URL('/?mode=simulated', preview).href);
  await page.getByText('Simulated data', { exact: true }).waitFor();
  artifact.shutdown.iframeRemovedOnNavigation = await page.locator('iframe').count() === 0;
  assert(artifact.shutdown.iframeRemovedOnNavigation);
  await context.close(); context = null;
  artifact.shutdown.browserContextDestroyed = true;
  assert.deepEqual(await inventory(), source);
  artifact.sourceUnchangedAfterRun = true; artifact.evidence = 'OBSERVED_LIVE'; artifact.passed = true;
} catch (error) {
  artifact.failure ??= error?.message === 'UI_RUN_BLOCKED' ? 'UI_RUN_BLOCKED' : 'LIVE_UI_ACCEPTANCE_FAILED';
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  if (context) { await context.close(); artifact.shutdown.browserContextDestroyed = true; }
  await browser?.close(); await Promise.allSettled(pending);
  artifact.directRequests = directRequests;
  artifact.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'browser-live.json'), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: artifact.passed, evidence: artifact.evidence, failure: artifact.failure, output })}\n`);
}
