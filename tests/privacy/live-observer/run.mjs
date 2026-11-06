// MN-009 operator composition: ephemeral tunnel, existing observer process, real
// browser transport and independently correlated, redacted observations.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createObserverEdge, createTunnelOutputProjector } from './edge.mjs';
import { validatePairedProof } from './proof.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!['--output', '--cloudflared', '--browser-tools'].includes(key) || !args[index + 1]) {
    throw new Error('Use --output <new-file> --cloudflared <pinned-binary> --browser-tools <tool-directory>.');
  }
  options[key.slice(2)] = resolve(args[++index]);
}
if (process.versions.node !== '24.22.2') throw new Error('Use the pinned Node 24.22.2 runtime.');
const binary = options.cloudflared;
const toolDirectory = options['browser-tools'] ?? process.env['MONOLITH_BROWSER_TOOLS'];
if (!binary || !toolDirectory) throw new Error('Pinned cloudflared and browser tools are required.');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const binaryHash = digest(await readFile(binary));
if (binaryHash !== '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872') {
  throw new Error('cloudflared 2026.10.7 release digest mismatch.');
}
const repoRequire = createRequire(join(repository, 'package.json'));
const transportRequire = createRequire(join(repository, 'packages/transport/package.json'));
const toolRequire = createRequire(join(resolve(toolDirectory), 'package.json'));
if (toolRequire('playwright/package.json').version !== '1.65.0') throw new Error('Use Playwright 1.65.0.');
const hashLocation = toolRequire.resolve('@noble/hashes/sha3');
if (JSON.parse(await readFile(join(dirname(hashLocation), 'package.json'), 'utf8')).version !== '1.8.0') {
  throw new Error('Use @noble/hashes 1.8.0.');
}
for (const name of ['@anon-rpc/browser-harness', '@anon-rpc/harness-core']) {
  if (transportRequire(`${name}/package.json`).version !== '0.4.0') throw new Error('Use harness 0.4.0.');
}
const { chromium } = toolRequire('playwright');
const { keccak_256 } = toolRequire('@noble/hashes/sha3');
const { createServer: createViteServer } = await import(repoRequire.resolve('vite'));
const keccak = (bytes) => `0x${Buffer.from(keccak_256(bytes)).toString('hex')}`;
const artifactDirectory = await mkdtemp(join(tmpdir(), 'monolith-mn009-live-'));
const output = options.output ?? join(artifactDirectory, 'comparison.json');
try { await readFile(output); throw new Error('Evidence output already exists; preserve earlier runs.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

async function fingerprints(path, prefix = '', suffixes = ['.ts', '.mjs', '.html']) {
  const result = {};
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await fingerprints(join(path, entry.name), name, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) result[name] = digest(await readFile(join(path, entry.name)));
  }
  return result;
}
async function freePort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function stop(child) {
  if (!child || !child.pid) return false;
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    let completed = false;
    const finish = (value) => {
      if (completed) return;
      completed = true; clearTimeout(escalate); clearTimeout(deadline); resolve(value);
    };
    const escalate = setTimeout(() => { child.kill('SIGKILL'); }, 3_000);
    const deadline = setTimeout(() => finish(child.exitCode !== null || child.signalCode !== null), 5_000);
    child.once('exit', () => finish(true));
    child.once('close', () => finish(true));
    child.once('error', () => finish(false));
    if (!child.kill('SIGTERM')) finish(child.exitCode !== null || child.signalCode !== null);
  });
}
function bounded(promise, milliseconds, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
async function localJson(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ hostname: '127.0.0.1', port, path, headers, method: 'GET', agent: false }, (response) => {
      const chunks = []; let length = 0;
      response.on('error', () => reject(new Error('LOCAL_RESPONSE_INVALID')));
      response.on('aborted', () => reject(new Error('LOCAL_RESPONSE_INVALID')));
      response.on('data', (chunk) => { length += chunk.length; if (length > 65_536) call.destroy(); else chunks.push(chunk); });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(new Error('LOCAL_RESPONSE_INVALID')); }
      });
    });
    call.setTimeout(2_000, () => call.destroy());
    call.on('error', () => reject(new Error('LOCAL_REQUEST_FAILED')));
    call.end();
  });
}
async function healthy(port) {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    try { if ((await localJson(port, '/api/health')).body?.ok) return; } catch { /* Startup only, never retry an RPC. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('OBSERVER_START_FAILED');
}
async function publicDnsReady(origin) {
  const hostname = new URL(origin).hostname;
  const deadline = Date.now() + 180_000;
  let lastProgress = Date.now();
  while (Date.now() < deadline) {
    try {
      const rows = await bounded(lookup(hostname, { all: true }), 3_000, 'DNS_TIMEOUT');
      if (rows.length > 0) return true;
    } catch { /* Only hostname publication is polled; never retry an RPC. */ }
    if (Date.now() - lastProgress >= 25_000) {
      console.log(JSON.stringify({ phase: 'WAITING_PUBLIC_DNS' }));
      lastProgress = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('PUBLIC_DNS_UNAVAILABLE');
}

const artifact = {
  schemaVersion: 1, sourceTask: 'MN-009', startedAt: new Date().toISOString(), generatedAt: null,
  evidence: 'BLOCKED', stage: 'SETUP', failure: null, node: process.version, browser: null,
  packages: { cloudflared: '2026.10.7', cloudflaredSha256: binaryHash,
    playwright: '1.65.0', '@noble/hashes': '1.8.0', '@anon-rpc/browser-harness': '0.4.0' },
  source: {
    lab: await fingerprints(directory), transport: await fingerprints(join(repository, 'packages/transport/src')),
    compiledTransport: await fingerprints(join(repository, 'packages/transport/dist'), '', ['.js']),
    observer: await fingerprints(join(repository, 'apps/observer/src')),
    compiledObserver: await fingerprints(join(repository, 'apps/observer/dist'), '', ['.js']),
    officialSdkEntrySha256: digest(await readFile(transportRequire.resolve('@anon-rpc/browser-harness'))),
    entrypointSha256: digest(await readFile(join(repository, 'scripts/compare-rpc-routes.ts'))),
    lockfileSha256: digest(await readFile(join(repository, 'pnpm-lock.yaml'))),
  },
  deployment: {
    kind: 'ephemeral-cloudflare-quick-tunnel', origin: null,
    sourceMode: 'trusted-proxy', trustedLocalPeer: 'loopback-only',
    sourceRule: 'Single Cloudflare connection source on authenticated local hop; all caller forwarding headers discarded.',
    localLogPolicy: 'Observer/edge logger disabled; raw tunnel stdout/stderr discarded in memory.',
    platformLogs: 'Cloudflare-managed retention/configuration not verified.',
    upstream: 'https://ethereum.publicnode.com',
  },
  controls: {}, comparison: null, shutdown: null,
  limitations: [
    'Cloudflare is a trusted intermediary and can see source and payload; this is one observed deployment path.',
    'The RPC destination can read the JSON-RPC method and synthetic address payload.',
    'Two specifier bootstrap reads are non-anonymous and excluded from paired application reads.',
    'Configured synthetic candidate identity/provenance is not an Arkiv product-use claim.',
    'Ordinary browser HTTP interception excludes worker WebRTC/KPS and unrelated page/wallet traffic.',
    'This temporary URL is stopped after the run; recorded evidence is not a persistent public service.',
  ],
};
let tunnel; let observer; let edge; let vite; let browser; let context; let page;
let browserClosed = false;
let heartbeat;
let warmedWorker;
const replies = []; const pending = [];
const stage = (value) => { artifact.stage = value; console.log(JSON.stringify({ phase: value })); };
try {
  const observerPort = await freePort();
  const capabilityHost = `${randomBytes(32).toString('hex')}.invalid`;
  const runId = `run-${randomUUID()}`;
  const baselineRpcId = `rpc-${randomUUID()}`;
  const directControlRpcId = `rpc-${randomUUID()}`;
  edge = await createObserverEdge({ observerPort, capabilityHost });
  const denied = await localJson(edge.port, '/api/health');
  const forged = await localJson(edge.port, '/api/health', { host: 'wrong.invalid', 'cf-connecting-ip': '192.0.2.12' });
  artifact.controls.localUnauthenticatedDenied = denied.status === 403 && forged.status === 403 && edge.counters().forwarded === 0;
  if (!artifact.controls.localUnauthenticatedDenied) throw new Error('EDGE_AUTH_CONTROL_FAILED');
  stage('STARTING_TUNNEL');
  const emptyConfiguration = join(artifactDirectory, 'empty-cloudflared.yml');
  await writeFile(emptyConfiguration, '{}\n', { mode: 0o600 });
  const origin = await bounded(new Promise((resolve, reject) => {
    const projector = createTunnelOutputProjector(resolve);
    tunnel = spawn(binary, ['tunnel', '--config', emptyConfiguration, '--no-autoupdate', '--url', `http://127.0.0.1:${edge.port}`,
      '--http-host-header', capabilityHost, '--metrics', '127.0.0.1:0', '--management-diagnostics=false',
      '--protocol', 'http2', '--grace-period', '1s'], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
    tunnel.stdout.on('data', projector.push); tunnel.stderr.on('data', projector.push);
    tunnel.once('error', () => reject(new Error('TUNNEL_START_FAILED')));
    tunnel.once('exit', () => { projector.end(); reject(new Error('TUNNEL_STOPPED')); });
  }), 60_000, 'TUNNEL_ORIGIN_TIMEOUT');
  artifact.deployment.origin = origin;
  stage('WAITING_PUBLIC_DNS');
  const dnsStarted = Date.now();
  artifact.controls.publicDnsReady = await publicDnsReady(origin);
  artifact.controls.publicDnsWaitMs = Date.now() - dnsStarted;
  const target = `${origin}/api/observer/read?endpointId=mn009_ethereum`;
  vite = await createViteServer({ root: directory, configFile: false,
    resolve: { alias: {
      '@monolith/transport/browser': join(repository, 'packages/transport/dist/browser.js'),
      '@monolith/transport': join(repository, 'packages/transport/dist/index.js'),
      '@monolith/shared': join(repository, 'packages/shared/dist/index.js'),
      '@anon-rpc/browser-harness': join(directory, 'harness.ts'),
      '@mn009/official-browser-harness': transportRequire.resolve('@anon-rpc/browser-harness'),
    } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, hmr: false, watch: null } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  artifact.browser = browser.version();
  context = await browser.newContext();
  page = await context.newPage();
  let ordinaryProtectedTargetRequests = 0;
  let directPosts = 0;
  let spoofControlSent = false;
  const directIds = new Set();
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && request.url() === `${origin}/api/observer/runs/${runId}`) {
      // Public coarse diagnostic metadata, disclosed separately from RPC reads.
      await route.continue(); return;
    }
    if (request.method() === 'OPTIONS') {
      // Preflight contains no RPC; local response prevents worker gateway CORS variations.
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type,x-monolith-run,x-monolith-case' } }); return;
    }
    let body;
    try { body = request.postDataJSON(); } catch { /* No unparsed body is exempted. */ }
    const phase = await page.evaluate(() => globalThis.mn009Progress?.phase).catch(() => 'UNKNOWN');
    const headers = request.headers();
    const direct = request.url() === target && request.method() === 'POST'
      && body && Object.keys(body).sort().join(',') === 'id,jsonrpc,method,params'
      && body.jsonrpc === '2.0' && body.method === 'eth_getBalance'
      && JSON.stringify(body.params) === JSON.stringify([`0x${'0'.repeat(40)}`, 'latest'])
      && headers['content-type'] === 'application/json' && headers['x-monolith-run'] === runId
      && !directIds.has(body.id)
      && (phase === 'DIRECT_BASELINE' && body.id === baselineRpcId && headers['x-monolith-case'] === 'baseline'
        || phase === 'DIRECT_CONTROL' && body.id === directControlRpcId && headers['x-monolith-case'] === 'protected');
    if (direct) {
      directIds.add(body.id);
      directPosts++;
      if (phase === 'DIRECT_CONTROL') {
        spoofControlSent = true;
        await route.continue({ headers: { ...request.headers(), 'x-forwarded-for': '192.0.2.77, 198.51.100.42',
          forwarded: 'for=192.0.2.77', 'x-real-ip': '192.0.2.78', 'cf-connecting-ip': '192.0.2.79' } });
      } else await route.continue();
      return;
    }
    ordinaryProtectedTargetRequests++;
    await route.abort('blockedbyclient');
  });
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url() === target) {
      let rpcId;
      try { rpcId = response.request().postDataJSON()?.id; } catch { /* No body values are exported. */ }
      const role = rpcId === baselineRpcId ? 'direct-baseline' : rpcId === directControlRpcId ? 'direct-control' : 'unexpected';
      artifact.controls.directResponses ??= [];
      artifact.controls.directResponses.push({ role, status: response.status(),
        jsonContentType: response.headers()['content-type']?.split(';')[0]?.trim() === 'application/json',
        corsWildcard: response.headers()['access-control-allow-origin'] === '*' });
    }
    if (response.request().method() !== 'GET' || !response.url().startsWith('https://')) return;
    pending.push((async () => {
      try { const bytes = await response.body(); replies.push({ status: response.status(), bytes: bytes.length, keccak256: keccak(bytes) }); }
      catch { /* Incomplete bytes never establish integrity. */ }
    })());
  });
  await page.goto(vite.resolvedUrls.local[0]);
  await page.waitForFunction(() => typeof globalThis.mn009?.warm === 'function');
  // Independently establish that a top-level bypass is actually intercepted.
  await page.evaluate(async (url) => { try { await fetch(url, { method: 'POST' }); } catch { /* Expected denial. */ } }, target);
  const detectionSelfCheck = ordinaryProtectedTargetRequests === 1;
  ordinaryProtectedTargetRequests = 0;
  artifact.controls.directDetectionSelfCheck = detectionSelfCheck;
  if (!detectionSelfCheck) throw new Error('HTTP_BOUNDARY_SELF_CHECK_FAILED');
  heartbeat = setInterval(async () => {
    const progress = await page.evaluate(() => globalThis.mn009Progress?.phase).catch(() => 'CONTEXT_CLOSED');
    if (typeof progress === 'string' && /^[A-Z_]{1,48}$/.test(progress)) console.log(JSON.stringify({ phase: progress }));
  }, 25_000);
  stage('WARMING_REAL_WORKER');
  const warmed = await bounded(page.evaluate((config) => globalThis.mn009.warm(config), { target, runId, baselineRpcId, directControlRpcId }),
    190_000, 'WORKER_WARM_TIMEOUT');
  if (!warmed || warmed.failure) throw new Error('WORKER_WARM_FAILED');
  warmedWorker = warmed.worker;
  stage('STARTING_FRESH_OBSERVER');
  observer = spawn(process.execPath, [join(repository, 'apps/observer/dist/composition/start.js')], {
    cwd: repository, stdio: ['ignore', 'ignore', 'ignore'], env: {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin', NODE_ENV: 'production',
      MONOLITH_OBSERVER_HOST: '127.0.0.1', MONOLITH_OBSERVER_PORT: String(observerPort),
      MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1',
      MONOLITH_OBSERVER_LAB_RUNS: JSON.stringify([{ runId, baselineRpcId }]),
      MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify([{ endpointId: 'mn009_ethereum', chainId: '1',
        rpcUrl: 'https://ethereum.publicnode.com', calls: [] }]),
    },
  });
  observer.on('error', () => {});
  await healthy(observerPort);
  const publicHealth = await fetch(`${origin}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  artifact.controls.publicHealthStatus = publicHealth.status;
  await publicHealth.body?.cancel();
  if (publicHealth.status !== 200) {
    artifact.controls.edgeCounters = edge.counters();
    throw new Error('PUBLIC_EDGE_DENIED');
  }
  stage('PAIRED_READS');
  const paired = await bounded(page.evaluate(() => globalThis.mn009.pair()), 180_000, 'PAIRED_READ_TIMEOUT');
  artifact.controls.edgeCounters = edge.counters();
  const safeFailures = ['INVALID_INPUT', 'POLICY_DENIED', 'WORKER_UNAVAILABLE', 'UPSTREAM_TIMEOUT',
    'UPSTREAM_UNAVAILABLE', 'RPC_RESPONSE_INVALID', 'RPC_ERROR', 'BASELINE_UNCONFIRMED', 'RATE_LIMITED', 'TARGET_DENIED'];
  if (paired.failure) artifact.controls.pairFailure = safeFailures.includes(paired.failure) ? paired.failure : 'PAIRED_READ_FAILED';
  const diagnostics = await localJson(observerPort, `/api/observer/runs/${runId}`);
  if (diagnostics.status !== 200 || !diagnostics.body?.ok) throw new Error('DIAGNOSTICS_UNAVAILABLE');
  const shutdown = await page.evaluate(() => globalThis.mn009.close());
  artifact.shutdown = shutdown;
  await context.close(); context = undefined;
  browserClosed = true;
  await Promise.allSettled(pending);
  const matching = replies.filter((reply) => reply.keccak256 === paired.worker?.workerHash);
  artifact.controls.spoofedForwardingControlSent = spoofControlSent;
  artifact.controls.directPostCount = directPosts;
  artifact.controls.ordinaryProtectedTargetRequests = ordinaryProtectedTargetRequests;
  artifact.controls.resolverResponses = matching;
  artifact.comparison = validatePairedProof({ schemaVersion: 1, evidence: 'OBSERVED_LIVE', runId,
    startedAt: paired.startedAt, completedAt: paired.completedAt,
    inventory: paired.inventory, traces: paired.traces, worker: paired.worker,
    diagnostics: diagnostics.body.value, resolverResponses: matching,
    boundary: { ordinaryProtectedTargetRequests, detectionSelfCheck },
    topology: { mode: 'trusted-proxy', verified: artifact.controls.localUnauthenticatedDenied && spoofControlSent && directPosts === 2 },
    shutdown: { closed: shutdown.closed && shutdown.iframeCount === 0 && shutdown.metadataCleared && shutdown.postCloseReadRejected },
  }, new Date().toISOString());
  artifact.evidence = artifact.comparison.evidence;
  if (paired.failure) artifact.failure = 'PAIRED_READ_FAILED';
  if (artifact.comparison.verdict !== 'OBSERVED_LIVE') process.exitCode = 1;
  stage(artifact.evidence === 'OBSERVED_LIVE' ? 'OBSERVED_LIVE' : 'INCONCLUSIVE_OR_BLOCKED');
} catch (error) {
  const known = ['EDGE_AUTH_CONTROL_FAILED', 'TUNNEL_START_FAILED', 'TUNNEL_STOPPED', 'TUNNEL_ORIGIN_TIMEOUT',
    'OBSERVER_START_FAILED', 'WORKER_WARM_TIMEOUT', 'WORKER_WARM_FAILED', 'HTTP_BOUNDARY_SELF_CHECK_FAILED',
    'PAIRED_READ_TIMEOUT', 'DIAGNOSTICS_UNAVAILABLE', 'PUBLIC_DNS_UNAVAILABLE', 'PUBLIC_EDGE_DENIED'];
  artifact.failure = known.includes(error?.message) ? error.message : 'LIVE_RUN_FAILED';
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  try {
    if (page && !browserClosed) artifact.shutdown = await bounded(page.evaluate(() => globalThis.mn009?.close()), 5_000, 'CLOSE_TIMEOUT');
  } catch { /* Context destruction below. */ }
  let browserContextDestroyed = browserClosed;
  try {
    if (context) { await bounded(context.close(), 5_000, 'CLOSE_TIMEOUT'); browserContextDestroyed = true; }
  } catch { /* Browser-level destruction below remains independent. */ }
  try {
    if (browser) { await bounded(browser.close(), 5_000, 'CLOSE_TIMEOUT'); browserContextDestroyed = Boolean(page); }
  } catch { /* A false cleanup fact is preserved, never upgraded. */ }
  await Promise.allSettled(pending);
  if (warmedWorker) artifact.warmup = { evidence: 'OBSERVED_LIVE', scope: 'worker-bootstrap-only',
    worker: warmedWorker, resolverResponses: replies.filter((reply) => reply.keccak256 === warmedWorker.workerHash) };
  await vite?.close().catch(() => {});
  const observerStopped = await stop(observer);
  const tunnelStopped = await stop(tunnel);
  await edge?.close();
  artifact.shutdown = { ...(artifact.shutdown ?? {}), browserContextDestroyed,
    observerProcessStarted: Boolean(observer?.pid), observerStopped,
    tunnelProcessStarted: Boolean(tunnel?.pid), tunnelStopped, edgeStopped: Boolean(edge) };
  artifact.generatedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ evidence: artifact.evidence, failure: artifact.failure, artifact: output }));
}
