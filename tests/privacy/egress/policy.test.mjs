import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { classifyCapturedRequest, createEgressCollector } from './collector.mjs';
import { checkRpcEgress, inspectBrowserSource } from './static.mjs';

const fixture = JSON.parse(await readFile(new URL('../../fixtures/leak-widget/manifest.json', import.meta.url), 'utf8'));
function event(change = {}) {
  return { requestId: 'cdp-1', timestamp: 1, request: { url: fixture.bootstrapUrl, method: 'POST',
    postData: JSON.stringify({ jsonrpc: '2.0', id: 'bootstrap_fixture_001', method: 'eth_call',
      params: [{ to: fixture.bootstrapContract, data: fixture.bootstrapSelector }, 'latest'] }) },
    initiator: { stack: { callFrames: [{ url: 'http://127.0.0.1/main.ts', functionName: 'bootstrapFixture', lineNumber: 1, columnNumber: 2 }] } }, ...change };
}

describe('independent browser request policy, SIMULATED inputs', () => {
  it('exempts only the exact one-send bootstrap operation and actual initiator', () => {
    expect(classifyCapturedRequest(event(), fixture).kind).toBe('bootstrap');
    expect(classifyCapturedRequest(event(), fixture, true).kind).toBe('direct');
    const changed = event();
    const body = JSON.parse(changed.request.postData); body.params[0].data = '0xbbbbbbbb';
    changed.request.postData = JSON.stringify(body);
    expect(classifyCapturedRequest(changed, fixture).kind).toBe('direct');
    expect(classifyCapturedRequest(event({ initiator: {} }), fixture).kind).toBe('direct');
    expect(classifyCapturedRequest(event({ request: { ...event().request, url: fixture.rpcUrl } }), fixture).kind).toBe('direct');
  });
  it('does not turn a client route label into an exception', () => {
    const claimed = event({ initiator: {}, request: { ...event().request, headers: { 'x-route': 'bootstrap', 'x-anonymous': 'true' } } });
    expect(classifyCapturedRequest(claimed, fixture).kind).toBe('direct');
  });
  it('rejects batches, malformed bodies and unsupported read methods conservatively', () => {
    for (const postData of ['not-json', '[]', '{"jsonrpc":"2.0","id":"a","method":"eth_sendTransaction","params":[]}']) {
      expect(classifyCapturedRequest(event({ request: { ...event().request, postData } }), fixture).kind).toBe('unparsed');
    }
  });
  it('stores source from the actual initiator stack, not a payload callsite', () => {
    const captured = event({ request: { url: fixture.rpcUrl, method: 'POST', postData: JSON.stringify({ jsonrpc: '2.0',
      id: `leak_${fixture.seed}`, method: 'eth_getTransactionReceipt', params: [`0x${'00'.repeat(32)}`] }) },
    initiator: { stack: { callFrames: [{ url: 'http://127.0.0.1/leak-widget.ts', functionName: 'leakingReceipt', lineNumber: 9, columnNumber: 3 }] } } });
    expect(classifyCapturedRequest(captured, fixture)).toMatchObject({ kind: 'direct', method: 'eth_getTransactionReceipt',
      ref: { readId: 'fixture_receipt_001', attempt: 1 }, source: { file: 'leak-widget.ts', line: 10, column: 4 } });
  });
  it('creates a fresh capture scope per browser context', () => {
    expect(createEgressCollector(fixture)).not.toBe(createEgressCollector(fixture));
  });
  it('permits an exact one-send direct control only under a separate runner capability', () => {
    const control = event({ request: { url: fixture.rpcUrl, method: 'POST', postData: JSON.stringify({ jsonrpc: '2.0',
      id: `control_${fixture.seed}`, method: 'eth_getBalance', params: [`0x${'00'.repeat(20)}`, 'latest'] }) },
    initiator: { stack: { callFrames: [{ url: 'http://127.0.0.1/main.ts', functionName: 'explicitDirectControl', lineNumber: 1, columnNumber: 1 }] } } });
    expect(classifyCapturedRequest(control, fixture).kind).toBe('direct');
    expect(classifyCapturedRequest(control, fixture, false, true).kind).toBe('direct-control');
    expect(classifyCapturedRequest(control, fixture, false, true, true).kind).toBe('direct');
    expect(classifyCapturedRequest({ ...control, initiator: {} }, fixture, false, true).kind).toBe('direct');
  });
  it('counts an unexplained request without a declaration or application trace', () => {
    const collector = createEgressCollector(fixture);
    collector.request(event({ request: { url: fixture.rpcUrl, method: 'POST', postData: JSON.stringify({ jsonrpc: '2.0',
      id: 'unknown-wire', method: 'eth_blockNumber', params: [] }) } }));
    collector.response({ requestId: 'cdp-1', response: { status: 200 } });
    collector.finished({ requestId: 'cdp-1', timestamp: 2 });
    const result = collector.finish({ attempts: [], reads: [], traces: [], seed: fixture.seed, usefulReadSucceeded: true });
    expect(result.report.eligibleReads).toBe(1);
    expect(result.report.findings.some((finding) => finding.code === 'UNEXPLAINED_EGRESS')).toBe(true);
    expect(result.gatePassed).toBe(false);
  });
  it('retains reused network identities and fails incomplete capture', () => {
    const collector = createEgressCollector(fixture);
    collector.request(event()); collector.request(event());
    const result = collector.finish({ attempts: [], reads: [], traces: [], seed: fixture.seed, usefulReadSucceeded: true });
    expect(result.networkCaptures).toHaveLength(2);
    expect(result.captureIssues).toContain('NETWORK_ID_REUSED');
    expect(result.captureIssues).toContain('NETWORK_COMPLETION_MISSING');
    expect(result.gatePassed).toBe(false);
  });
  it('does not let an incorrect useful-result flag upgrade fully blocked measurements', () => {
    const collector = createEgressCollector(fixture);
    const reads = fixture.requiredUsefulReads.map((entry) => ({ ...entry, endpointId: 'fixture_endpoint_001', chainId: '1',
      callsiteAlias: entry.method === 'eth_getBalance' ? 'fixture.balance' : 'fixture.receipt', scenarioAlias: 'fixture', privacyRequired: true }));
    const traces = reads.map((read) => ({ schemaVersion: 1, readId: read.readId, attempt: 1,
      endpointId: read.endpointId, chainId: '1', method: read.method, callsite: read.callsiteAlias, route: 'blocked',
      durationMs: 0, success: false, bootstrap: false, evidence: 'SIMULATED', payloadVisibility: 'rpc-endpoint-can-read', errorCode: 'WORKER_UNAVAILABLE' }));
    const attempts = reads.map((read, index) => ({ eventId: `blocked_event_${index}`, ref: { readId: read.readId, attempt: 1 },
      endpointId: read.endpointId, chainId: '1', method: read.method, originAlias: 'rpc', callsiteAlias: read.callsiteAlias,
      route: 'blocked', sent: false, completed: false, durationMs: 0, workerVerified: false, evidence: 'SIMULATED' }));
    const result = collector.finish({ reads, traces, attempts, seed: fixture.seed, usefulReadSucceeded: true });
    expect(result.privacyPass).toBe(true);
    expect(result.functionalPass).toBe(false);
    expect(result.gatePassed).toBe(false);
  });
});

describe('browser static network boundary', () => {
  it.each([
    'fetch(url)', 'const request = globalThis.fetch; request(url)', 'window["fetch"](url)',
    'self["fe" + "tch"](url)', 'const { fetch: send } = globalThis; send(url)',
    'const {["fe"+"tch"]:send}=globalThis;send(url)', 'Reflect.get(globalThis, "fetch")(url)',
    'new XMLHttpRequest()', 'new WebSocket(url)', 'navigator.sendBeacon(url)',
    'import { http as rpcHttp } from "viem"; rpcHttp(url)', 'const sdk = await import("viem");',
  ])('requires review for %s', (source) => {
    expect(inspectBrowserSource(source, 'apps/dashboard/src/injected.ts').length).toBeGreaterThan(0);
  });
  it('does not mistake comments or strings for a network call', () => {
    expect(inspectBrowserSource('// fetch(url)\nconst explanation = "fetch and viem http";', 'app.ts')).toEqual([]);
  });
  it('accepts the actual current reviewed repository boundaries', async () => {
    expect((await checkRpcEgress()).violations).toEqual([]);
  });
});
