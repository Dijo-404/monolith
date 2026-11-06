// Explicit live acceptance. Ordinary pnpm check never starts networks or this runner.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--run' || args[1] !== '--output' || !args[2]) {
  throw new Error('Usage: node tests/e2e/registry-routing/live/run.mjs --run --output <artifact.json>');
}
const output = resolve(args[2]);
const rootRequire = createRequire(join(repository, 'package.json'));
const transportRequire = createRequire(join(repository, 'packages/transport/package.json'));
const toolDirectory = process.env['MONOLITH_BROWSER_TOOLS'];
if (!toolDirectory) throw new Error('Set MONOLITH_BROWSER_TOOLS to an isolated playwright1.65.0/@noble-hashes1.8.0 installation.');
const toolRequire = createRequire(join(resolve(toolDirectory), 'package.json'));
const { chromium } = toolRequire('playwright');
const { keccak_256 } = toolRequire('@noble/hashes/sha3');
const hashesPackage = JSON.parse(await readFile(join(dirname(toolRequire.resolve('@noble/hashes/sha3')), 'package.json'), 'utf8'));
if (toolRequire('playwright/package.json').version !== '1.65.0' || hashesPackage.version !== '1.8.0') {
  throw new Error('Browser acceptance tool version mismatch.');
}
for (const name of ['@anon-rpc/browser-harness', '@anon-rpc/harness-core']) {
  if (transportRequire(`${name}/package.json`).version !== '0.4.0') throw new Error('Harness version mismatch.');
}
const { createServer } = await import(rootRequire.resolve('vite'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(join(repository, path), 'utf8'));
const acceptedImport = await readJson('packages/registry/test/importer/observed-live-2026-11-06/import-full100.json');
const acceptedRecords = await readJson('packages/registry/test/importer/observed-live-2026-11-06/selected-records.json');
const selected = acceptedRecords.find((record) => record.chain_id === '10');
const importedEntity = acceptedImport.records.find((record) => record.recordId === selected?.record_id);
if (!selected || !importedEntity || !/^0x[0-9a-f]{64}$/i.test(importedEntity.entityKey)
  || acceptedImport.status !== 'COMPLETE' || selected.rpc_host !== 'https://mainnet.optimism.io/') {
  throw new Error('Accepted public chain-10 record unavailable or changed; review new operator policy explicitly.');
}
const targetOrigin = 'https://mainnet.optimism.io';
const publisher = acceptedImport.publisher;
const source = acceptedImport.source;
const observerPolicy = { creator: publisher, owner: publisher, sourceRevision: source.revision,
  snapshotSha256: source.snapshotSha256, licenseSha256: source.licenseSha256, allowedOrigins: [targetOrigin] };
const browserConfiguration = { chainId: '10', policy: {
  trustedPublishers: [{ creator: publisher, owner: publisher }], approvedOrigins: [targetOrigin],
  source: { revision: source.revision, snapshotSha256: source.snapshotSha256,
    licenseUrl: `https://github.com/ethereum-lists/chains/blob/${source.revision}/LICENSE`,
    urlPrefix: `https://github.com/ethereum-lists/chains/blob/${source.revision}/_data/chains/eip155-` },
  maxManifestAgeMs: 30_000,
} };

async function hashTree(path, extension, result = {}) {
  for (const entry of (await readdir(join(repository, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await hashTree(child, extension, result);
    else if (entry.name.endsWith(extension)) result[child] = digest(await readFile(join(repository, child)));
  }
  return result;
}
async function inventory() {
  const result = {};
  for (const path of ['packages/shared', 'packages/transport', 'packages/registry', 'apps/observer']) {
    Object.assign(result, await hashTree(`${path}/src`, '.ts'), await hashTree(`${path}/dist`, '.js'));
  }
  for (const path of ['apps/dashboard/src/composition/registry.ts', 'apps/dashboard/src/composition/transport.ts',
    'tests/e2e/registry-routing/live/main.ts', 'tests/e2e/registry-routing/live/host.ts',
    'tests/e2e/registry-routing/live/run.mjs', 'tests/e2e/registry-routing/live/index.html',
    'tests/e2e/registry-routing/live/host.html', 'tests/e2e/registry-routing/live/tsconfig.json',
    'packages/registry/test/importer/observed-live-2026-11-06/import-full100.json',
    'packages/registry/test/importer/observed-live-2026-11-06/selected-records.json']) {
    result[path] = digest(await readFile(join(repository, path)));
  }
  return result;
}
const before = await inventory();
const lockSha256 = digest(await readFile(join(repository, 'pnpm-lock.yaml')));
const artifact = {
  schemaVersion: 1, sourceTask: 'MN-013', evidence: 'BLOCKED', startedAt: new Date().toISOString(),
  generatedAt: null, reason: 'LIVE_REGISTRY_ROUTING_NOT_COMPLETED',
  environment: { node: process.version, browser: null, playwright: '1.65.0', nobleHashes: '1.8.0',
    harness: '0.4.0', observerSigningEnvironmentInherited: false, browserSigningEnvironmentInherited: false },
  sourceBinding: { files: before, lockSha256, unchangedAfterRun: false },
  operatorConfiguration: browserConfiguration,
  metadataContact: { anonymous: false, path: '/api/registry/chains?chainId=10',
    serverQuery: 'Fixed public Arkiv Rabdi read-only SDK; no wallet or session parameter.' },
  liveRead: null,
};

let observer;
let observerExited = false;
let observerExit;
let vite;
let browser;
async function freePort() {
  return new Promise((resolvePort, reject) => {
    const tcp = createTcpServer(); tcp.once('error', reject);
    tcp.listen(0, '127.0.0.1', () => {
      const address = tcp.address();
      if (!address || typeof address === 'string') { tcp.close(); reject(new Error('LOOPBACK_PORT_UNAVAILABLE')); return; }
      tcp.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}
async function startObserver() {
  const port = await freePort();
  observer = spawn(process.execPath, [join(repository, 'apps/observer/dist/composition/start.js')], {
    cwd: repository, stdio: 'ignore', env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'test',
      MONOLITH_OBSERVER_HOST: '127.0.0.1', MONOLITH_OBSERVER_PORT: String(port),
      MONOLITH_REGISTRY_CONFIG: JSON.stringify(observerPolicy) },
  });
  observerExit = new Promise((resolveExit) => {
    observer.once('exit', () => { observerExited = true; resolveExit(); });
    observer.once('error', () => { observerExited = true; resolveExit(); });
  });
  for (let index = 0; index < 100 && !observerExited; index++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(100) });
      if (response.status === 200) return port;
    } catch { /* Startup retry is restricted to this temporary loopback health endpoint. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error('OBSERVER_STARTUP_BLOCKED');
}
async function stopObserver() {
  if (!observer || observerExited) return;
  observer.kill('SIGTERM');
  let timer;
  await Promise.race([observerExit, new Promise((resolveDelay) => { timer = setTimeout(resolveDelay, 3_000); })]);
  clearTimeout(timer);
  if (!observerExited) { observer.kill('SIGKILL'); await observerExit; }
}

async function protectedRegistryRead() {
  const context = await browser.newContext();
  await context.addInitScript((configuration) => {
    globalThis.monolithRegistryConfiguration = configuration;
  }, browserConfiguration);
  const page = await context.newPage();
  let ordinaryTargetRequests = 0;
  let metadataRequests = 0;
  const metadataResponses = [];
  const metadataRequestTimes = [];
  const responseHashes = [];
  const pendingBodies = [];
  await context.route(`${targetOrigin}/**`, async (route) => {
    ordinaryTargetRequests++;
    await route.abort('blockedbyclient');
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/registry/chains') {
      metadataRequests++; metadataRequestTimes.push(new Date().toISOString());
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/api/registry/chains') {
      pendingBodies.push((async () => {
        try { metadataResponses.push({ status: response.status(), observedAt: new Date().toISOString(),
          body: await response.json() }); } catch { /* Missing metadata cannot satisfy acceptance. */ }
      })());
    }
    if (url.protocol !== 'https:' || response.request().method() !== 'GET') return;
    pendingBodies.push((async () => {
      try {
        const bytes = await response.body();
        responseHashes.push({ url: `${url.origin}${url.pathname}`, status: response.status(), bytes: bytes.length,
          receivedAt: new Date().toISOString(), keccak256: `0x${Buffer.from(keccak_256(bytes)).toString('hex')}` });
      } catch { /* An incomplete body cannot substantiate bundle-byte evidence. */ }
    })());
  });
  let heartbeat;
  let watchdog;
  try {
    await page.goto(vite.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof globalThis.runRegistryRead === 'function');
    await page.evaluate(async (url) => { try { await fetch(url, { method: 'POST' }); } catch { /* deliberate negative control */ } }, targetOrigin);
    const directDetectionSelfCheck = ordinaryTargetRequests === 1;
    ordinaryTargetRequests = 0;
    heartbeat = setInterval(async () => {
      try { console.info(JSON.stringify({ progress: await page.evaluate(() => globalThis.monolithProgress) })); }
      catch { /* Context cleanup also ends heartbeat observations. */ }
    }, 30_000);
    await Promise.race([page.evaluate(() => globalThis.runRegistryRead()), new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('BROWSER_WATCHDOG_EXPIRED')), 270_000);
    })]);
    const observed = await page.evaluate(() => globalThis.registryObservation);
    await context.close();
    await Promise.allSettled(pendingBodies);
    return { ...observed, directDetectionSelfCheck, metadataRequests, metadataRequestTimes, metadataResponses,
      independentHttpBoundary: { ordinaryTargetRequests,
        scope: 'Ordinary browser HTTP to mainnet.optimism.io; excludes WebRTC/KPS and disclosed specifier bootstrap.' },
      resolverResponses: responseHashes.filter((reply) => reply.keccak256 === observed.worker?.workerHash),
      contextDestroyed: true };
  } finally {
    clearInterval(heartbeat); clearTimeout(watchdog); await context.close();
  }
}

try {
  const observerPort = await startObserver();
  // The root test folder is not a workspace consumer; aliases use only the
  // packages' declared public build entry points, never implementation paths.
  vite = await createServer({ root: directory, configFile: false, envDir: directory,
    resolve: { alias: [
      { find: '@monolith/shared', replacement: join(repository, 'packages/shared/dist/index.js') },
      { find: '@monolith/transport/browser', replacement: join(repository, 'packages/transport/dist/browser.js') },
      { find: '@monolith/transport', replacement: join(repository, 'packages/transport/dist/index.js') },
    ] },
    envPrefix: 'MONOLITH_LIVE_PUBLIC_UNUSED_', server: {
      host: '127.0.0.1', port: 0, fs: { allow: [repository] }, hmr: false, watch: null,
      proxy: { '/api/registry': { target: `http://127.0.0.1:${observerPort}` } },
    } });
  await vite.listen();
  browser = await chromium.launch({ headless: true,
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '/tmp', LANG: 'C.UTF-8' },
    ...(process.env['MONOLITH_CHROMIUM_PATH'] ? { executablePath: process.env['MONOLITH_CHROMIUM_PATH'] } : {}),
  });
  artifact.environment.browser = browser.version();
  artifact.liveRead = await protectedRegistryRead();
  const live = artifact.liveRead;
  const manifest = live.selection?.manifest;
  const endpoint = live.selection?.endpoint;
  const protectedTraces = live.traces.filter((trace) => !trace.bootstrap && trace.route === 'anon-nym' && trace.success);
  const probes = protectedTraces.filter((trace) => trace.method === 'eth_chainId' && trace.callsite === 'transport.chain-probe');
  const reads = protectedTraces.filter((trace) => trace.method === 'eth_blockNumber' && trace.callsite === 'registry.acceptance.block');
  const bootstrap = live.traces.filter((trace) => trace.bootstrap);
  const freshUntilRead = manifest && live.readReturnedAt && Date.parse(live.readReturnedAt) < Date.parse(manifest.expiresAt);
  const sourceMatched = manifest?.evidence === 'OBSERVED_LIVE' && manifest.origin === 'arkiv-query'
    && endpoint?.endpointId === `rpc_${selected.record_id}` && endpoint?.chainId === '10'
    && endpoint.entityKey === importedEntity.entityKey && endpoint.expiresAt === importedEntity.contentExpiresAt
    && endpoint.rpcUrl === selected.rpc_host && endpoint.source.snapshotSha256 === source.snapshotSha256
    && endpoint.source.revision === source.revision && endpoint.publisher.creator === publisher.toLowerCase()
    && endpoint.publisher.owner === publisher.toLowerCase()
    && live.metadataResponses.length === 1 && live.metadataResponses[0].status === 200
    && live.metadataResponses[0].body.ok === true
    && JSON.stringify(live.metadataResponses[0].body.value) === JSON.stringify(manifest);
  const accepted = live.evidence === 'OBSERVED_LIVE' && live.failure === null
    && typeof live.result === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(live.result)
    && sourceMatched && freshUntilRead && live.readState === 'READY'
    && live.selectionAtReadEnd?.manifest?.revision === manifest.revision
    && live.directDetectionSelfCheck && live.metadataRequests === 1
    && live.independentHttpBoundary.ordinaryTargetRequests === 0
    && probes.length === 1 && reads.length === 1 && live.worker?.bootstrapCalls === 2
    && bootstrap.length === 2 && bootstrap.every((trace) => trace.success)
    && live.resolverResponses.some((reply) => reply.status === 200 && reply.bytes > 0
      && Date.parse(reply.receivedAt) <= Date.parse(live.metadataRequestTimes[0]))
    && live.shutdown.state === 'CLOSED' && live.shutdown.iframeCount === 0
    && live.shutdown.selectionCleared && live.shutdown.metadataCleared && live.shutdown.postCloseReadRejected
    && live.contextDestroyed;
  if (!accepted) throw new Error('LIVE_REGISTRY_ROUTING_ASSERTION_FAILED');
  const after = await inventory();
  if (JSON.stringify(before) !== JSON.stringify(after)
    || digest(await readFile(join(repository, 'pnpm-lock.yaml'))) !== lockSha256) {
    throw new Error('SOURCE_CHANGED_DURING_RUN');
  }
  artifact.sourceBinding.unchangedAfterRun = true;
  artifact.evidence = 'OBSERVED_LIVE'; artifact.reason = 'ARKIV_DRIVEN_PROTECTED_READ_VERIFIED';
} catch (error) {
  artifact.reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_REGISTRY_ROUTING_FAILED';
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), vite?.close(), stopObserver()]);
  const cleanupPassed = cleanup.every((result) => result.status === 'fulfilled') && observerExited;
  artifact.shutdown = { observerStarted: Boolean(observer), observerStopped: observerExited,
    browserStarted: Boolean(browser), browserClosed: Boolean(browser) && cleanup[0].status === 'fulfilled',
    viteStarted: Boolean(vite), viteStopped: Boolean(vite) && cleanup[1].status === 'fulfilled' };
  if (!cleanupPassed && artifact.evidence === 'OBSERVED_LIVE') {
    artifact.evidence = 'BLOCKED'; artifact.reason = 'RESOURCE_SHUTDOWN_FAILED';
  }
  artifact.generatedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.info(JSON.stringify({ evidence: artifact.evidence, reason: artifact.reason, output }));
  if (artifact.evidence !== 'OBSERVED_LIVE') process.exitCode = 1;
}
