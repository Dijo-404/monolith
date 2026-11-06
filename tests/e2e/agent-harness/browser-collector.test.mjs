import { describe, expect, it } from 'vitest';
import { agentAnalyzerScope, classifyAgentRequest, runBrowserScenario } from '../../../scripts/agent-harness/browser-runner.mjs';

const request = () => ({ request: { url: 'https://rpc.mn029.example/', method: 'POST',
  postData: JSON.stringify({ jsonrpc: '2.0', id: 'mn029_example_001', method: 'eth_getBalance',
    params: [`0x${'0'.repeat(40)}`, 'latest'] }) } });

describe('fixed independent agent HTTP capture policy', () => {
  it('binds the exact fixed direct request without trusting a supplied route label', () => {
    expect(classifyAgentRequest(request())).toEqual({ ref: { readId: 'mn029_example_001', attempt: 1 },
      method: 'eth_getBalance', callsiteAlias: 'agent.example' });
    const labelled = request();
    labelled.request.headers = { 'x-monolith-route': 'anon-nym' };
    expect(classifyAgentRequest(labelled)).toEqual(classifyAgentRequest(request()));
  });
  it.each([
    ['wrong origin', (event) => { event.request.url = 'https://other.example/'; }],
    ['query escape', (event) => { event.request.url += '?url=https://other.example'; }],
    ['credentials', (event) => { event.request.url = 'https://key@rpc.mn029.example/'; }],
    ['write method', (event) => { const body = JSON.parse(event.request.postData); body.method = 'eth_sendRawTransaction'; event.request.postData = JSON.stringify(body); }],
    ['unreviewed payload', (event) => { const body = JSON.parse(event.request.postData); body.params[0] = `0x${'1'.repeat(40)}`; event.request.postData = JSON.stringify(body); }],
    ['extra fields', (event) => { const body = JSON.parse(event.request.postData); body.route = 'anon-nym'; event.request.postData = JSON.stringify(body); }],
    ['wrong read identity', (event) => { const body = JSON.parse(event.request.postData); body.id = 'mn029_witness_001'; event.request.postData = JSON.stringify(body); }],
    ['batch', (event) => { event.request.postData = `[${event.request.postData}]`; }],
    ['notification', (event) => { const body = JSON.parse(event.request.postData); delete body.id; event.request.postData = JSON.stringify(body); }],
    ['non-json', (event) => { event.request.postData = '<html>untrusted</html>'; }],
  ])('rejects %s without exporting supplied content', (_label, mutate) => {
    const event = request(); mutate(event); expect(classifyAgentRequest(event)).toBeNull();
  });
  it('has a fixed reviewed scope with no bootstrap exclusions or caller-selected origins', () => {
    const first = agentAnalyzerScope(true);
    const second = agentAnalyzerScope(false);
    expect(second).toEqual({ ...first, captureComplete: false });
    expect(first.bootstrapRules).toEqual([]);
    expect(first.origins).toEqual([{ alias: 'rpc', origin: 'https://rpc.mn029.example' }]);
    first.origins.push({ alias: 'untrusted', origin: 'https://other.example' });
    expect(agentAnalyzerScope(true).origins).toHaveLength(1);
  });
  it('keeps pending live acceptance unavailable without opening a browser', async () => {
    const result = await runBrowserScenario({ mode: 'live', browserTools: '/not/a/tool/directory' });
    expect(result.evidence).toBe('BLOCKED'); expect(result.unavailable).toBe(true);
    expect(result.diagnostics).toEqual(['LIVE_ACCEPTANCE_PENDING']);
    expect(result.input).toBeNull(); expect(result.scope).toBeNull();
    expect(result.gatePassed).toBe(false);
    expect(result.cleanup).toEqual({ browserClosed: true, serverClosed: true });
  });
  it('distinguishes cancellation before setup from unavailable execution', async () => {
    const signal = AbortSignal.abort();
    const result = await runBrowserScenario({ signal, mode: 'simulated' });
    expect(result.cancelled).toBe(true); expect(result.unavailable).toBe(false);
    expect(result.diagnostics).toEqual(['CANCELLED']); expect(result.gatePassed).toBe(false);
  });
});
