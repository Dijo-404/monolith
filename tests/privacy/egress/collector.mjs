import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Resolve the declared ESM public export without adding a root workspace dependency.
const analyzerManifest = JSON.parse(readFileSync(join(repository, 'packages/privacy-analyzer/package.json'), 'utf8'));
const { analyzePrivacyRun, exportPrivacyReport } = await import(join(repository, 'packages/privacy-analyzer', analyzerManifest.exports['.'].import));
const METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_call', 'eth_getTransactionReceipt']);

function locationFrom(initiator) {
  for (let stack = initiator?.stack; stack; stack = stack.parent) {
    for (const frame of stack.callFrames ?? []) {
      let path;
      try { path = new URL(frame.url).pathname; } catch { continue; }
      const file = path.split('/').at(-1);
      if (['main.ts', 'leak-widget.ts'].includes(file)) return {
        file, line: frame.lineNumber + 1, column: frame.columnNumber + 1,
        function: ['bootstrapFixture', 'leakingReceipt', 'unexplainedRead', 'explicitDirectControl'].includes(frame.functionName)
          ? frame.functionName : 'fixture-operation',
      };
    }
  }
  return null;
}

/** Request classification uses captured bytes and initiator metadata, never a route header or app trace. */
export function classifyCapturedRequest(event, fixture, bootstrapUsed = false, directControlAllowed = false, directControlUsed = false) {
  const source = locationFrom(event.initiator);
  let request;
  try { request = JSON.parse(event.request.postData ?? ''); } catch { return { kind: 'unparsed', source }; }
  if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'id,jsonrpc,method,params'
    || request.jsonrpc !== '2.0' || typeof request.id !== 'string' || !METHODS.has(request.method)
    || !Array.isArray(request.params)) return { kind: 'unparsed', source };
  const canonical = JSON.stringify(request.params);
  const bootstrap = !bootstrapUsed && event.request.url === fixture.bootstrapUrl && event.request.method === 'POST'
    && request.id === 'bootstrap_fixture_001' && request.method === 'eth_call'
    && canonical === JSON.stringify([{ to: fixture.bootstrapContract, data: fixture.bootstrapSelector }, 'latest'])
    && source?.file === 'main.ts' && source.function === 'bootstrapFixture';
  const knownLeak = event.request.url === fixture.rpcUrl && request.id === `leak_${fixture.seed}`
    && request.method === 'eth_getTransactionReceipt'
    && canonical === JSON.stringify([`0x${'00'.repeat(32)}`])
    && source?.file === 'leak-widget.ts' && source.function === 'leakingReceipt';
  const directControl = directControlAllowed && !directControlUsed && event.request.url === fixture.rpcUrl
    && event.request.method === 'POST' && request.id === `control_${fixture.seed}` && request.method === 'eth_getBalance'
    && canonical === JSON.stringify([`0x${'00'.repeat(20)}`, 'latest'])
    && source?.file === 'main.ts' && source.function === 'explicitDirectControl';
  return { kind: bootstrap ? 'bootstrap' : directControl ? 'direct-control' : 'direct', method: request.method, source,
    ref: bootstrap ? { readId: 'bootstrap_fixture_001', attempt: 1 }
      : directControl ? { readId: 'fixture_control_001', attempt: 1 }
      : knownLeak ? { readId: 'fixture_receipt_001', attempt: 1 } : undefined };
}

export function createEgressCollector(fixture, options = {}) {
  const allowedOrigins = new Set([new URL(fixture.rpcUrl).origin, new URL(fixture.bootstrapUrl).origin]);
  const requests = new Map();
  const captured = [];
  let identityConflict = false;
  let overflow = 0;
  let bootstrapUsed = false;
  let directControlUsed = false;
  let malformed = 0;
  let sequence = 0;
  return {
    request(event) {
      if (!allowedOrigins.has(new URL(event.request.url).origin)) return;
      // Browser CORS preflights carry no JSON-RPC payload and are disclosed metadata contacts.
      if (event.request.method === 'OPTIONS' && !event.request.postData) return;
      if (captured.length >= 128) { overflow++; return; }
      if (requests.has(event.requestId)) identityConflict = true;
      const classified = classifyCapturedRequest(event, fixture, bootstrapUsed, options.allowDirectControl === true, directControlUsed);
      if (classified.kind === 'bootstrap') bootstrapUsed = true;
      if (classified.kind === 'direct-control') directControlUsed = true;
      if (classified.kind === 'unparsed') malformed++;
      const row = { ...classified, eventId: `network_event_${++sequence}`,
        originAlias: new URL(event.request.url).origin === new URL(fixture.rpcUrl).origin ? 'rpc' : 'bootstrap',
        started: event.timestamp, status: null, completed: false, finalized: false, durationMs: 0 };
      captured.push(row);
      requests.set(event.requestId, row);
    },
    response(event) { const row = requests.get(event.requestId); if (row) row.status = event.response.status; },
    finished(event) {
      const row = requests.get(event.requestId);
      if (row) { row.finalized = true; row.completed = row.status >= 200 && row.status < 300; row.durationMs = Math.max(0, (event.timestamp - row.started) * 1000); }
    },
    failed(event) { const row = requests.get(event.requestId); if (row) { row.finalized = true; row.durationMs = Math.max(0, (event.timestamp - row.started) * 1000); } },
    finish(snapshot, captureComplete = true) {
      const network = captured;
      const captureIssues = [
        ...(!captureComplete ? ['COLLECTOR_NOT_COMPLETE'] : []),
        ...(identityConflict ? ['NETWORK_ID_REUSED'] : []), ...(overflow ? ['NETWORK_CAPTURE_OVERFLOW'] : []),
        ...(malformed ? ['UNPARSED_NETWORK_REQUEST'] : []),
        ...(network.some((row) => !row.finalized) ? ['NETWORK_COMPLETION_MISSING'] : []),
      ];
      captureComplete = captureComplete && !identityConflict && !overflow && network.every((row) => row.finalized);
      const attempts = [...snapshot.attempts];
      for (const row of network) {
        if (row.kind === 'unparsed') continue;
        attempts.push({ eventId: row.eventId, ...(row.ref ? { ref: row.ref } : {}),
          endpointId: row.kind === 'bootstrap' ? 'bootstrap_endpoint_001' : 'fixture_endpoint_001',
          chainId: '1', method: row.method, originAlias: row.originAlias,
          ...(row.kind === 'bootstrap' ? { callsiteAlias: 'fixture.bootstrap' }
            : row.kind === 'direct-control' ? { callsiteAlias: 'fixture.control' }
            : row.ref ? { callsiteAlias: 'fixture.receipt' } : {}),
          route: row.kind === 'bootstrap' ? 'direct-bootstrap' : 'direct-debug',
          sent: true, completed: row.completed, durationMs: row.durationMs, workerVerified: false, evidence: 'SIMULATED' });
      }
      const scope = {
        reportRunId: 'public_mn012_fixture', application: 'Monolith fixture', captureComplete: captureComplete && malformed === 0,
        origins: [{ alias: 'rpc', origin: new URL(fixture.rpcUrl).origin }, { alias: 'bootstrap', origin: new URL(fixture.bootstrapUrl).origin }],
        callsites: ['fixture.balance', 'fixture.receipt', 'fixture.control', 'transport.chain-probe', 'fixture.bootstrap'].map((alias) => ({ alias, label: alias })),
        scenarios: [{ alias: 'fixture', label: 'software regression' }],
        bootstrapRules: bootstrapUsed ? [{ readId: 'bootstrap_fixture_001', endpointId: 'bootstrap_endpoint_001', chainId: '1',
          method: 'eth_call', callsiteAlias: 'fixture.bootstrap', originAlias: 'bootstrap', label: 'Exact fixture specifier lookup; non-anonymous' }] : [],
      };
      const input = { schemaVersion: 1, runId: 'internal_mn012_fixture', evidence: 'SIMULATED',
        reads: snapshot.reads, traces: snapshot.traces, attempts };
      const analyzed = analyzePrivacyRun(input, scope);
      const exported = exportPrivacyReport(input, scope);
      if (!analyzed.ok || !exported.ok) throw new Error('Collector/analyzer contract rejected.');
      if (JSON.stringify(JSON.parse(exported.value)) !== JSON.stringify(analyzed.value.report)) throw new Error('Public report export disagrees.');
      const unexpected = network.filter((row) => !['bootstrap', 'direct-control'].includes(row.kind));
      const unresolved = analyzed.value.report.findings.some((finding) => !['BLOCKED_READ', 'DIRECT_CONTROL'].includes(finding.code));
      const privacyPass = captureComplete && malformed === 0 && unexpected.length === 0 && !unresolved;
      const measuredUsefulReadsComplete = fixture.requiredUsefulReads.every((expected) => {
        const bound = attempts.filter((attempt) => attempt.ref?.readId === expected.readId && attempt.method === expected.method
          && attempt.endpointId === 'fixture_endpoint_001' && attempt.chainId === '1');
        const last = Math.max(0, ...bound.map((attempt) => attempt.ref.attempt));
        const terminal = bound.filter((attempt) => attempt.ref.attempt === last);
        return terminal.length === 1 && terminal[0].sent && terminal[0].completed;
      });
      const functionalPass = snapshot.usefulReadSucceeded === true && measuredUsefulReadsComplete;
      return { evidence: 'SIMULATED', seed: snapshot.seed, privacyPass, functionalPass,
        gatePassed: privacyPass && functionalPass, unexpectedDirectRequests: unexpected.length,
        unparsedRequests: malformed, captureIssues, requestsBeyondCaptureLimit: overflow,
        report: analyzed.value.report, summary: analyzed.value.summary,
        networkCaptures: network.map((row) => ({ kind: row.kind, method: row.method ?? 'unparsed',
          completed: row.completed, status: row.status, source: row.source })),
        violations: unexpected.map((row) => ({ method: row.method ?? 'unparsed', callsite: row.source, seed: snapshot.seed })),
        scope: 'Ordinary Chromium page HTTP at the two configured fixture RPC origins. Controlled fixture driver; no live worker/WebRTC/wallet/extension claim.' };
    },
  };
}
