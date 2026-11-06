// Explicit browser acceptance; external networks are never part of ordinary pnpm check.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const repoRequire = createRequire(join(repository, 'package.json'));
const transportRequire = createRequire(join(repository, 'packages/transport/package.json'));
const { createServer } = await import(repoRequire.resolve('vite'));
const args = process.argv.slice(2);
const offlineOnly = args.includes('--offline-only');
const outputFlag = args.indexOf('--output');
const outputPath = outputFlag >= 0 ? resolve(args[outputFlag + 1] ?? '') : undefined;
if (args.some((arg, index) => arg !== '--offline-only' && arg !== '--output' && index !== outputFlag + 1)
  || (outputFlag >= 0 && !args[outputFlag + 1])) throw new Error('Use --offline-only and/or --output <path>.');

let toolDirectory = process.env['MONOLITH_BROWSER_TOOLS'];
if (!toolDirectory) {
  toolDirectory = await mkdtemp(join(tmpdir(), 'monolith-transport-browser-tools-'));
  await writeFile(join(toolDirectory, 'package.json'), JSON.stringify({ name: 'monolith-browser-acceptance-tools',
    private: true, type: 'module', dependencies: { playwright: '1.65.0', '@noble/hashes': '1.8.0' } }));
  const installed = spawnSync('npm', ['install', '--no-fund'], { cwd: toolDirectory, stdio: 'inherit' });
  if (installed.status !== 0) throw new Error('Browser tool installation failed.');
}
const toolRequire = createRequire(join(resolve(toolDirectory), 'package.json'));
const { chromium } = toolRequire('playwright');
const { keccak_256 } = toolRequire('@noble/hashes/sha3');
const hashPackage = JSON.parse(await readFile(join(dirname(toolRequire.resolve('@noble/hashes/sha3')), 'package.json'), 'utf8'));
if (toolRequire('playwright/package.json').version !== '1.65.0'
  || hashPackage.version !== '1.8.0') throw new Error('Browser tool version mismatch.');
for (const name of ['@anon-rpc/browser-harness', '@anon-rpc/harness-core']) {
  if (transportRequire(`${name}/package.json`).version !== '0.4.0') throw new Error('Harness package version mismatch.');
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const keccak = (bytes) => `0x${Buffer.from(keccak_256(bytes)).toString('hex')}`;
async function sourceHashes(path, prefix = '', suffix = '.ts') {
  const hashes = {};
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(hashes, await sourceHashes(child, label, suffix));
    else if (entry.name.endsWith(suffix)) hashes[label] = digest(await readFile(child));
  }
  return hashes;
}

const artifact = {
  schemaVersion: 1, sourceTask: 'MN-007', startedAt: new Date().toISOString(), generatedAt: null,
  evidence: 'BLOCKED', node: process.version, browser: null,
  packages: { playwright: '1.65.0', '@noble/hashes': '1.8.0',
    '@anon-rpc/browser-harness': '0.4.0', '@anon-rpc/harness-core': '0.4.0' },
  transportSourceSha256: await sourceHashes(join(repository, 'packages/transport/src')),
  compiledTransportSha256: await sourceHashes(join(repository, 'packages/transport/dist'), '', '.js'),
  lockfileSha256: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
  cleanupControl: null, liveRead: null,
};
const target = 'https://ethereum-rpc.publicnode.com';
let browser;
let server;

function word(value) { return BigInt(value).toString(16).padStart(64, '0'); }
function encodedResolvers(url) {
  const text = Buffer.from(url).toString('hex');
  return `0x${word(32)}${word(1)}${word(32)}${word(text.length / 2)}${text.padEnd(Math.ceil(text.length / 64) * 64, '0')}`;
}

async function cleanupControl() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const bundle = Buffer.from('/* SIMULATED disposal-only bundle. Never executed. */');
  const resolver = 'https://resolver.monolith.example/worker.js';
  let resolveBundleSeen;
  let releaseBundle;
  const bundleSeen = new Promise((resolve) => { resolveBundleSeen = resolve; });
  const bundleReleased = new Promise((resolve) => { releaseBundle = resolve; });
  let lateFrameObserved = false;
  let closedAt = false;
  page.on('frameattached', () => { if (closedAt) lateFrameObserved = true; });
  await context.route('https://bootstrap.monolith.example/**', async (route) => {
    const body = route.request().postDataJSON();
    const selector = body.params?.[0]?.data;
    const result = selector === '0x3898587d' ? keccak(bundle) : encodedResolvers(resolver);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) });
  });
  await context.route(`${resolver}*`, async (route) => {
    resolveBundleSeen();
    await bundleReleased;
    try { await route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle,
      headers: { 'access-control-allow-origin': '*' } }); } catch { /* Removed host cancels its request. */ }
  });
  try {
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof globalThis.runCloseProbe === 'function');
    const probing = page.evaluate(() => globalThis.runCloseProbe());
    let timer;
    try { await Promise.race([bundleSeen, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('SIMULATED resolver request was not reached.')), 20_000);
    })]); } finally { clearTimeout(timer); }
    const iframeCountBeforeClose = await page.locator('iframe').count();
    await page.evaluate(() => globalThis.closeProbeNow());
    closedAt = true;
    releaseBundle();
    const result = await probing;
    // Allow queued child continuations to settle after the deliberately released resolver.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
    const iframeCountAfterRelease = await page.locator('iframe').count();
    return { ...result, scenario: 'close-during-pending-resolver', iframeCountBeforeClose,
      iframeCountAfterRelease, lateFrameObserved,
      expectedBundleHash: keccak(bundle), bundleEvidence: 'SIMULATED-never-used-for-live-read' };
  } finally { releaseBundle(); await context.close(); }
}

async function protectedRead() {
  const context = await browser.newContext();
  const page = await context.newPage();
  let directRequests = 0;
  const replies = [];
  const pending = [];
  await context.route(`${target}/**`, async (route) => { directRequests++; await route.abort('blockedbyclient'); });
  page.on('response', (response) => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.protocol !== 'https:' || response.request().method() !== 'GET') return;
    pending.push((async () => {
      try {
        const bytes = await response.body();
        replies.push({ url: `${url.origin}${url.pathname}`, status: response.status(),
          bytes: bytes.length, keccak256: keccak(bytes) });
      } catch { /* Incomplete responses never become matching-byte evidence. */ }
    })());
  });
  let heartbeat;
  let watchdog;
  try {
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof globalThis.runPackageRead === 'function');
    await page.evaluate(async (url) => { try { await fetch(url, { method: 'POST' }); } catch { /* deliberately blocked */ } }, target);
    const directDetectionSelfCheck = directRequests === 1;
    directRequests = 0;
    heartbeat = setInterval(async () => {
      try { console.log(JSON.stringify({ progress: await page.evaluate(() => globalThis.monolithProgress) })); }
      catch { /* Context teardown. */ }
    }, 30_000);
    await Promise.race([page.evaluate(() => globalThis.runPackageRead()), new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('Live package browser watchdog expired.')), 315_000);
    })]);
    const observed = await page.evaluate(() => globalThis.packageObservation);
    await context.close();
    await Promise.allSettled(pending);
    const matching = replies.filter((reply) => observed.worker?.workerHash === reply.keccak256);
    return { ...observed, directDetectionSelfCheck,
      independentHttpBoundary: { ordinaryTargetRequests: directRequests,
        scope: 'Ordinary browser HTTP to configured target; excludes WebRTC/KPS and disclosed bootstrap.' },
      resolverResponses: matching, contextDestroyed: true };
  } finally {
    clearInterval(heartbeat); clearTimeout(watchdog); await context.close();
  }
}

try {
  server = await createServer({ root: directory, configFile: false, server: {
    host: '127.0.0.1', port: 4327, strictPort: true, fs: { allow: [repository] }, hmr: false, watch: null,
  } });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env['MONOLITH_CHROMIUM_PATH'] ? { executablePath: process.env['MONOLITH_CHROMIUM_PATH'] } : {}) });
  artifact.browser = browser.version();
  artifact.cleanupControl = await cleanupControl();
  console.log(JSON.stringify({ cleanupControl: artifact.cleanupControl }));
  const control = artifact.cleanupControl;
  if (!control.initializationRejected || control.iframeCountBeforeClose !== 1 || control.iframeCount !== 0
    || control.iframeCountAfterRelease !== 0 || control.lateFrameObserved || !control.metadataCleared) {
    throw new Error('Disposable host cleanup control failed.');
  }
  if (!offlineOnly) artifact.liveRead = await protectedRead();
  const live = artifact.liveRead;
  const protectedTrace = live?.traces.filter((trace) => !trace.bootstrap && trace.route === 'anon-nym' && trace.success);
  const bootstraps = live?.traces.filter((trace) => trace.bootstrap);
  const accepted = live?.evidence === 'OBSERVED_LIVE' && live.failure === null && live.result === '0x1'
    && live.endpointValidated && live.readState === 'READY' && live.worker?.bootstrapCalls === 2
    && live.directDetectionSelfCheck && live.independentHttpBoundary.ordinaryTargetRequests === 0
    && live.shutdown.state === 'CLOSED' && live.shutdown.iframeCount === 0 && live.shutdown.metadataCleared
    && live.shutdown.postCloseReadRejected && live.contextDestroyed
    && protectedTrace.length >= 2 && bootstraps.length === 2 && bootstraps.every((trace) => trace.success)
    && live.resolverResponses.some((reply) => reply.status === 200 && reply.bytes > 0);
  artifact.evidence = offlineOnly ? 'SIMULATED' : accepted ? 'OBSERVED_LIVE' : 'BLOCKED';
  if (!offlineOnly && !accepted) process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  artifact.generatedAt = new Date().toISOString();
  const destination = outputPath ?? join(await mkdtemp(join(tmpdir(), 'monolith-transport-evidence-')), 'observed.json');
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Redacted observations: ${destination}`);
  console.log(JSON.stringify({ evidence: artifact.evidence, result: artifact.liveRead?.result ?? null,
    sourceTask: artifact.sourceTask, generatedAt: artifact.generatedAt }));
}
