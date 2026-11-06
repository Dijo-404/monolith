import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COLLECTOR_VERSION = 'monolith-agent-browser-v1';
const directory = dirname(fileURLToPath(import.meta.url));
const RPC_ORIGIN = 'https://rpc.mn029.example';
const RPC_URL = `${RPC_ORIGIN}/`;
const syntheticAddress = `0x${'0'.repeat(40)}`;
const completeKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

async function publicExport(repository, packageName, subpath = '.') {
  const base = join(repository, 'packages', packageName);
  const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
  const entry = manifest.exports?.[subpath]?.import;
  if (typeof entry !== 'string' || !entry.startsWith('./dist/')) throw new Error('PUBLIC_EXPORT_UNAVAILABLE');
  return join(base, entry);
}

function unavailable(code, cancelled = false) {
  return { schemaVersion: 1, collectorVersion: COLLECTOR_VERSION, evidence: 'BLOCKED',
    unavailable: !cancelled, cancelled, gatePassed: false, privacyPass: false, functionalPass: false,
    worker: { ready: false, kind: 'UNTESTED' }, captureComplete: false, unexpectedDirectRequests: 0,
    input: null, scope: null, report: null, diagnostics: [code],
    cleanup: { browserClosed: true, serverClosed: true } };
}

/** Capture parsing is fixed runner policy, never an app-provided route/source claim. */
export function classifyAgentRequest(event) {
  let body;
  try { body = JSON.parse(event.request.postData ?? ''); } catch { return null; }
  if (event.request.url !== RPC_URL || event.request.method !== 'POST'
    || !completeKeys(body, ['jsonrpc', 'id', 'method', 'params']) || body.jsonrpc !== '2.0'
    || body.id !== 'mn029_example_001' || body.method !== 'eth_getBalance'
    || JSON.stringify(body.params) !== JSON.stringify([syntheticAddress, 'latest'])) return null;
  return { ref: { readId: 'mn029_example_001', attempt: 1 }, method: 'eth_getBalance',
    callsiteAlias: 'agent.example' };
}

/** Trusted static scope is reconstructed independently of the example and its outputs. */
export function agentAnalyzerScope(captureComplete) {
  return { reportRunId: 'public_mn029_fixed', application: 'Monolith fixed agent example', captureComplete,
    origins: [{ alias: 'rpc', origin: RPC_ORIGIN }],
    callsites: ['agent.witness', 'agent.example', 'transport.chain-probe'].map((alias) => ({ alias, label: alias })),
    scenarios: [{ alias: 'fixed-balance', label: 'Fixed synthetic balance regression' }], bootstrapRules: [] };
}

/**
 * Real Chromium runs the fixed example. SIMULATED uses an explicitly fake worker
 * and intercepted fixed HTTP response; it earns no live anonymity claim.
 * Live collection deliberately remains unavailable until the normal dependency
 * acceptance and a separately reviewed genuine worker/observer adapter exist.
 */
export async function runBrowserScenario(options = {}) {
  const { signal } = options;
  if (signal?.aborted) return unavailable('CANCELLED', true);
  if (options.mode === 'live') return unavailable('LIVE_ACCEPTANCE_PENDING');
  if (options.mode !== undefined && options.mode !== 'simulated'
    || !['regression', 'repaired', 'worker-unavailable'].includes(options.scenario ?? 'regression')
    || typeof options.exampleDirectory !== 'string' || typeof options.browserTools !== 'string') {
    return unavailable('BROWSER_CONFIGURATION_UNAVAILABLE');
  }
  const repository = resolve(options.repository ?? join(directory, '../..'));
  let browser;
  let server;
  let context;
  let page;
  let result;
  let stopped = false;
  let timer;
  const closeForAbort = () => { stopped = true; void context?.close().catch(() => {}); };
  signal?.addEventListener('abort', closeForAbort, { once: true });
  try {
    const toolRequire = createRequire(join(resolve(options.browserTools), 'package.json'));
    if (toolRequire('playwright/package.json').version !== '1.65.0') throw new Error('BROWSER_TOOLS_UNAVAILABLE');
    const { chromium } = toolRequire('playwright');
    const repoRequire = createRequire(join(repository, 'package.json'));
    const { createServer } = await import(repoRequire.resolve('vite'));
    const analyzerPath = await publicExport(repository, 'privacy-analyzer');
    const { analyzePrivacyRun } = await import(pathToFileURL(analyzerPath).href);
    const sharedPath = await publicExport(repository, 'shared');
    const transportPath = await publicExport(repository, 'transport');
    const root = join(directory, 'browser');
    server = await createServer({ root, configFile: false,
      resolve: { alias: {
        '@monolith/transport': transportPath, '@monolith/shared': sharedPath,
        '@monolith-agent-example': join(resolve(options.exampleDirectory), 'app.mjs'),
      } },
      server: { host: '127.0.0.1', port: 0, fs: { allow: [repository, root, resolve(options.exampleDirectory)] },
        hmr: false, watch: null }, logLevel: 'silent' });
    await server.listen();
    if (signal?.aborted) throw new Error('CANCELLED');
    browser = await chromium.launch({ headless: true, timeout: 10_000 });
    context = await browser.newContext({ serviceWorkers: 'block' });
    if (signal?.aborted) throw new Error('CANCELLED');
    page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    const requests = new Map();
    const network = [];
    const captureIssues = new Set();
    const localOrigin = new URL(server.resolvedUrls.local[0]).origin;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === localOrigin) { await route.continue(); return; }
      if (url.origin === RPC_ORIGIN && request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } });
        return;
      }
      if (classifyAgentRequest({ request: { url: request.url(), method: request.method(), postData: request.postData() } })) {
        await route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'mn029_example_001', result: '0x1' }) });
      } else await route.abort('blockedbyclient');
    });
    session.on('Network.requestWillBeSent', (event) => {
      const url = new URL(event.request.url);
      if (url.origin === localOrigin || event.request.method === 'OPTIONS' && !event.request.postData) return;
      if (network.length >= 128) { captureIssues.add('CAPTURE_OVERFLOW'); return; }
      if (requests.has(event.requestId)) captureIssues.add('CAPTURE_ID_REUSED');
      const classified = classifyAgentRequest(event);
      if (!classified) captureIssues.add('UNEXPECTED_REQUEST_SHAPE');
      const row = { eventId: `ordinary_event_${network.length + 1}`, classified,
        started: event.timestamp, finalized: false, status: null, durationMs: 0, completed: false };
      requests.set(event.requestId, row); network.push(row);
    });
    session.on('Network.responseReceived', (event) => {
      const row = requests.get(event.requestId);
      if (row) row.status = event.response.status;
    });
    session.on('Network.loadingFinished', (event) => {
      const row = requests.get(event.requestId);
      if (row) { row.finalized = true; row.completed = row.status === 200;
        row.durationMs = Math.max(0, (event.timestamp - row.started) * 1000); }
    });
    session.on('Network.loadingFailed', (event) => {
      const row = requests.get(event.requestId);
      if (row) { row.finalized = true; row.durationMs = Math.max(0, (event.timestamp - row.started) * 1000); }
    });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { stopped = true; void context.close().catch(() => {}); reject(new Error('BROWSER_TIMEOUT')); }, 20_000);
    });
    const execute = async () => {
      await page.goto(server.resolvedUrls.local[0]);
      await page.waitForFunction(() => typeof globalThis.monolithAgentScenario === 'function');
      const snapshot = await page.evaluate((scenario) => globalThis.monolithAgentScenario({ scenario }), options.scenario ?? 'regression');
      // A protocol barrier follows the awaited response body before finalizing capture.
      await session.send('Runtime.evaluate', { expression: 'true' });
      if (network.some((row) => !row.finalized)) captureIssues.add('CAPTURE_COMPLETION_MISSING');
      const captureComplete = captureIssues.size === 0 && snapshot.closed === true && snapshot.pendingBound === true;
      const attempts = [...snapshot.attempts, ...network.filter((row) => row.classified).map((row) => ({
        eventId: row.eventId, ref: row.classified.ref, endpointId: 'mn029_endpoint_001', chainId: '10',
        method: row.classified.method, originAlias: 'rpc', callsiteAlias: row.classified.callsiteAlias,
        route: 'direct-debug', sent: true, completed: row.completed, durationMs: row.durationMs,
        workerVerified: false, evidence: 'SIMULATED',
      }))];
      const input = { schemaVersion: 1, runId: 'internal_mn029_fixed', evidence: 'SIMULATED',
        reads: snapshot.reads, traces: snapshot.traces, attempts };
      const scope = agentAnalyzerScope(captureComplete);
      const analysis = analyzePrivacyRun(input, scope);
      if (!analysis.ok) throw new Error('ANALYZER_REJECTED_CAPTURE');
      const report = analysis.value.report;
      const functionalPass = snapshot.witnessSucceeded === true && snapshot.usefulSucceeded === true
        && input.reads.filter((read) => read.method === 'eth_getBalance').every((read) =>
          attempts.filter((attempt) => attempt.ref?.readId === read.readId && attempt.sent && attempt.completed).length === 1);
      const privacyPass = captureComplete && network.length === 0 && report.findings.length === 0
        && report.eligibleReads === 3 && report.protectedReads === 3;
      return { schemaVersion: 1, collectorVersion: COLLECTOR_VERSION, evidence: 'SIMULATED',
        unavailable: false, cancelled: false, gatePassed: privacyPass && functionalPass,
        privacyPass, functionalPass, worker: { ready: snapshot.workerReady === true, kind: 'SIMULATED_TEST_DRIVER' },
        captureComplete, unexpectedDirectRequests: network.length, input, scope, report,
        diagnostics: [...captureIssues, ...(snapshot.failure ? [snapshot.failure] : [])],
        capture: network.map((row) => ({ eventId: row.eventId, method: row.classified?.method ?? 'unparsed',
          completed: row.completed, durationMs: row.durationMs, source: 'fixed-example-balance' })),
        tool: { playwright: '1.65.0', browser: browser.version() },
        limitations: ['Synthetic driver and intercepted HTTP; no live worker or privacy acceptance.',
          'Capture covers ordinary browser HTTP; no WebRTC, wallet, extension or arbitrary hostile-code claim.'],
      };
    };
    result = await Promise.race([execute(), deadline]);
  } catch (error) {
    const cancelled = signal?.aborted || error?.message === 'CANCELLED';
    const known = ['BROWSER_TOOLS_UNAVAILABLE', 'BROWSER_TIMEOUT', 'PUBLIC_EXPORT_UNAVAILABLE', 'ANALYZER_REJECTED_CAPTURE'];
    result = unavailable(cancelled ? 'CANCELLED' : known.includes(error?.message) ? error.message : 'BROWSER_EXECUTION_UNAVAILABLE', cancelled);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', closeForAbort);
    let browserClosed = !browser;
    let serverClosed = !server;
    try { await context?.close(); } catch { /* Browser close below remains independent. */ }
    try { await browser?.close(); browserClosed = true; } catch { /* Failed cleanup cannot earn acceptance. */ }
    try { await server?.close(); serverClosed = true; } catch { /* Failed cleanup cannot earn acceptance. */ }
    result ??= unavailable('BROWSER_EXECUTION_UNAVAILABLE');
    result.cleanup = { browserClosed, serverClosed };
    if (!browserClosed || !serverClosed || stopped) result.gatePassed = false;
    if (signal?.aborted) { result = { ...unavailable('CANCELLED', true), cleanup: result.cleanup }; }
  }
  return result;
}
