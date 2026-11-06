import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserDriver, createDirectDebugDriver } from '@monolith/transport/browser';
import type { BrowserDriverOptions } from '@monolith/transport/browser';

afterEach(() => vi.unstubAllGlobals());
const rpc = { jsonrpc: '2.0' as const, id: 'test-rpc', method: 'eth_chainId' as const, params: [] };
const options: BrowserDriverOptions = {
  hostUrl: '/transport-host.html', network: 'nym', bootstrapRpcUrl: 'https://bootstrap.example/',
  approvedOrigins: ['https://rpc.example'],
  traceSink: { emit: () => undefined },
};
function fakeDocument() {
  const frame = {
    hidden: false, title: '', src: '', onload: null as null | (() => void),
    onerror: null as null | (() => void), remove: vi.fn(),
    contentWindow: { postMessage: vi.fn() },
  };
  const append = vi.fn();
  const create = vi.fn(() => frame);
  vi.stubGlobal('location', { href: 'https://lab.example/', origin: 'https://lab.example' });
  vi.stubGlobal('document', { createElement: create, body: { appendChild: append } });
  return { frame, append, create };
}

const workerMetadata = {
  network: 'nym',
  specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
  workerHash: `0x${'a1'.repeat(32)}`,
  harnessVersion: '0.4.0',
  verification: 'harness-ready-after-specifier-lookup',
  bootstrap: 'NON_ANONYMOUS_SPECIFIER_LOOKUP',
  bootstrapCalls: 2,
  privacyLabel: 'ANONYMIZING_WORKER',
  observedAt: '2030-01-01T00:00:00.000Z',
};

function replyingHost(initializationResult: unknown, exchangeResult?: unknown) {
  const { frame } = fakeDocument();
  let hostPort: MessagePort | undefined;
  frame.contentWindow.postMessage.mockImplementation((_message: unknown, _origin: string, ports: MessagePort[]) => {
    hostPort = ports[0];
    if (!hostPort) throw new Error('Missing test host capability');
    const currentPort = hostPort;
    currentPort.onmessage = ({ data }: MessageEvent<{ kind: string; id: number }>) => {
      if (data.kind === 'initialize' || data.kind === 'exchange') {
        currentPort.postMessage({ kind: 'result', id: data.id,
          result: data.kind === 'initialize' ? initializationResult : exchangeResult });
      }
    };
    currentPort.start();
  });
  const driver = createBrowserDriver(options);
  const boot = driver.initialize(AbortSignal.timeout(1_000));
  frame.onload?.();
  return { driver, frame, boot, close: async () => { await driver.close(); hostPort?.close(); } };
}

describe('disposable host lifecycle (SIMULATED DOM controls)', () => {
  it('settles initialize and removes the host when closed before document load', async () => {
    const { frame, append } = fakeDocument();
    const driver = createBrowserDriver(options);
    const boot = driver.initialize(new AbortController().signal);
    expect(append).toHaveBeenCalledOnce();
    await driver.close();
    expect(await boot).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
    expect(frame.remove).toHaveBeenCalled();
    expect(frame.onload).toBeNull();
    expect(driver.getMetadata()).toBeNull();
    expect(await driver.initialize(new AbortController().signal)).toMatchObject({ ok: false });
    expect(await driver.exchange('https://rpc.example/', rpc, new AbortController().signal)).toMatchObject({ ok: false });
  });
  it('destroys a loading host on abort and cannot adopt its late load', async () => {
    const { frame } = fakeDocument();
    const signal = new AbortController();
    const driver = createBrowserDriver(options);
    const boot = driver.initialize(signal.signal);
    const lateLoad = frame.onload;
    signal.abort();
    lateLoad?.();
    expect(await boot).toMatchObject({ ok: false });
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    expect(frame.remove).toHaveBeenCalled();
  });
  it('settles an initialized channel awaiting host boot when closed', async () => {
    const { frame } = fakeDocument();
    const driver = createBrowserDriver(options);
    const boot = driver.initialize(new AbortController().signal);
    frame.onload?.();
    await Promise.resolve();
    expect(frame.contentWindow.postMessage).toHaveBeenCalledOnce();
    // The synthetic frame never replies; close must still settle the pending operation.
    const port = frame.contentWindow.postMessage.mock.calls[0]?.[2]?.[0] as MessagePort | undefined;
    await driver.close();
    expect(await boot).toMatchObject({ ok: false });
    port?.close();
  });
  it.each([
    { hostUrl: 'https://untrusted.example/host.html' },
    { hostUrl: '/host.html?token=private' },
    { hostUrl: '/host.html#private' },
    { bootstrapRpcUrl: 'http://bootstrap.example/' },
    { approvedOrigins: ['https://rpc.example/private'] },
    { approvedOrigins: [] },
  ])('rejects invalid host/bootstrap/origin configuration before creating a frame: %j', async (override) => {
    const { create } = fakeDocument();
    const driver = createBrowserDriver({ ...options, ...override });
    expect(await driver.initialize(new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'POLICY_DENIED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('adopts only fixed metadata and returns a defensive public projection', async () => {
    const host = replyingHost({ ok: true, value: workerMetadata });
    try {
      expect(await host.boot).toEqual({ ok: true, value: undefined });
      expect(host.driver.getMetadata()).toEqual(workerMetadata);
      const returned = host.driver.getMetadata()!;
      returned.specifier = 'private mutation';
      expect(host.driver.getMetadata()).toEqual(workerMetadata);
    } finally { await host.close(); }
  });

  it.each([
    null,
    [],
    'not-metadata',
    { ...workerMetadata, privateDiagnostic: 'private value' },
    { ...workerMetadata, network: 'tor' },
    { ...workerMetadata, specifier: 'wrong-specifier' },
    { ...workerMetadata, specifier: '0x4fd77be300f31c5fe6ab266d35d27750a3478d27' },
    { ...workerMetadata, workerHash: '0x1234' },
    { ...workerMetadata, workerHash: `0x${'aa'.repeat(33)}` },
    { ...workerMetadata, harnessVersion: '0.3.0' },
    { ...workerMetadata, bootstrapCalls: 1 },
    { ...workerMetadata, bootstrapCalls: '2' },
    { ...workerMetadata, bootstrap: 'ANONYMOUS' },
    { ...workerMetadata, verification: 'assumed' },
    { ...workerMetadata, privacyLabel: 'NOT_ANONYMIZED' },
    { ...workerMetadata, observedAt: 'private timestamp' },
    { ...workerMetadata, observedAt: '2030-01-01T00:00:00+01:00' },
    { ...workerMetadata, observedAt: '2030-01-01T00:00:00Z' },
    Object.fromEntries(Object.entries(workerMetadata).filter(([key]) => key !== 'bootstrap')),
    Object.fromEntries(Object.entries(workerMetadata).filter(([key]) => key !== 'verification')),
    Object.fromEntries(Object.entries(workerMetadata).filter(([key]) => key !== 'privacyLabel')),
    Object.fromEntries(Object.entries(workerMetadata).filter(([key]) => key !== 'observedAt')),
  ])('rejects malformed or disallowed metadata %# and destroys the host', async (value) => {
    const host = replyingHost({ ok: true, value });
    try {
      expect(await host.boot).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
      expect(host.driver.getMetadata()).toBeNull();
      expect(host.frame.remove).toHaveBeenCalled();
      expect(await host.driver.exchange('https://rpc.example/', rpc, new AbortController().signal)).toMatchObject({ ok: false });
    } finally { await host.close(); }
  });

  it.each([
    null,
    'invalid result',
    { ok: true, value: workerMetadata, private: 'extra envelope field' },
    { ok: false, error: { code: 'WORKER_UNAVAILABLE', message: 'private raw error', retryable: true } },
  ])('settles a malformed initialization result %# as a safe failure', async (result) => {
    const host = replyingHost(result);
    try {
      expect(await host.boot).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
      expect(host.driver.getMetadata()).toBeNull();
    } finally { await host.close(); }
  });

  it('settles a malformed exchange result without exporting raw error details', async () => {
    const host = replyingHost({ ok: true, value: workerMetadata },
      { ok: false, error: { code: 'RPC_ERROR', message: 'private upstream error', retryable: false } });
    try {
      expect(await host.boot).toMatchObject({ ok: true });
      const result = await host.driver.exchange('https://rpc.example/', rpc, new AbortController().signal);
      expect(result).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } });
      expect(JSON.stringify(result)).not.toContain('private');
    } finally { await host.close(); }
  });
});

describe('separate direct comparison capability', () => {
  it('only sends to explicitly configured public HTTPS origins', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: '0x1' }),
      { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const driver = createDirectDebugDriver({ enabled: true, approvedOrigins: ['https://rpc.example'] });
    expect(driver.route).toBe('direct-debug');
    expect(await driver.exchange('http://rpc.example/', rpc, new AbortController().signal)).toMatchObject({ ok: false });
    expect(await driver.exchange('https://other.example/', rpc, new AbortController().signal)).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await driver.initialize(new AbortController().signal)).toEqual({ ok: true, value: undefined });
    expect(await driver.exchange('https://rpc.example/', rpc, new AbortController().signal)).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledWith('https://rpc.example/', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    await driver.close();
    expect(await driver.exchange('https://rpc.example/', rpc, new AbortController().signal)).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('aborts an in-flight ordinary comparison when closed', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('private upstream detail')), { once: true });
    })));
    const driver = createDirectDebugDriver({ enabled: true, approvedOrigins: ['https://rpc.example'] });
    const read = driver.exchange('https://rpc.example/', rpc, new AbortController().signal);
    await driver.close();
    expect(await read).toMatchObject({ ok: false, error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(JSON.stringify(await read)).not.toContain('private upstream detail');
  });
});
