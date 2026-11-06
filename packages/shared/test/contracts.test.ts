import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  addressSchema,
  chainIdSchema,
  endpointCandidateSchema,
  httpResultSchema,
  jsonValueSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  observerRunSchema,
  makeError,
  parseContract,
  privacyReportSchema,
  publicHttpsUrlSchema,
  readRequestSchema,
  registryManifestSchema,
  resultSchema,
  routePolicySchema,
  rpcTraceSchema,
  safeErrorSchema,
  timestampSchema,
  validateRegistryManifest,
  validateRpcResponse,
  verificationManifestSchema,
  workerStateSchema,
} from '@monolith/shared';
import type {
  Clock,
  EndpointCandidate,
  JsonValue,
  MonolithTransport,
  ProvisionalPayIntent,
  ReadRequest,
  Result,
  RpcTrace,
  TraceSink,
  WorkerState,
} from '@monolith/shared';

const directory = new URL('../../../tests/fixtures/contracts/', import.meta.url);
const schemas = {
  endpointCandidateSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  observerRunSchema,
  privacyReportSchema,
  readRequestSchema,
  registryManifestSchema,
  routePolicySchema,
  rpcTraceSchema,
  safeErrorSchema,
  verificationManifestSchema,
  workerStateSchema,
};

type Fixture = {
  file: string;
  fixtureVersion: 1;
  evidence: 'SIMULATED';
  description: string;
  contract: keyof typeof schemas;
  expected: 'valid' | 'invalid' | 'UNSUPPORTED_VERSION' | 'REGISTRY_EXPIRED';
  payload: unknown;
};

const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as {
  fixtureVersion: number;
  evidence: string;
  evaluationTime: string;
  fixtures: string[];
};
const fixtures = manifest.fixtures.map((file) => ({
  ...JSON.parse(readFileSync(new URL(file, directory), 'utf8')),
  file,
})) as Fixture[];

function fixture(name: string): Fixture {
  const value = fixtures.find((entry) => entry.file === name);
  if (!value) throw new Error(`Missing synthetic fixture: ${name}`);
  return value;
}

describe('published synthetic contract catalog', () => {
  it('labels every fixture as simulated and lists every JSON case exactly once', () => {
    expect(manifest.fixtureVersion).toBe(1);
    expect(manifest.evidence).toBe('SIMULATED');
    expect(manifest.evaluationTime).toBe('2030-01-01T00:01:00Z');
    expect(new Set(manifest.fixtures).size).toBe(manifest.fixtures.length);
    expect(readdirSync(directory).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort())
      .toEqual([...manifest.fixtures].sort());

    for (const entry of fixtures) {
      expect(entry.fixtureVersion).toBe(1);
      expect(entry.evidence).toBe('SIMULATED');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(Object.hasOwn(schemas, entry.contract)).toBe(true);
      expect(['valid', 'invalid', 'UNSUPPORTED_VERSION', 'REGISTRY_EXPIRED']).toContain(entry.expected);
    }
  });

  it.each(fixtures)('$file: $description', (entry) => {
    if (entry.expected === 'UNSUPPORTED_VERSION') {
      const result = parseContract(registryManifestSchema, entry.payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_VERSION');
      return;
    }
    if (entry.expected === 'REGISTRY_EXPIRED') {
      // The payload is structurally valid; expiry is evaluated against an explicit clock.
      expect(registryManifestSchema.safeParse(entry.payload).success).toBe(true);
      const result = validateRegistryManifest(entry.payload, manifest.evaluationTime);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('REGISTRY_EXPIRED');
      return;
    }

    expect(schemas[entry.contract].safeParse(entry.payload).success).toBe(entry.expected === 'valid');
  });
});

describe('JSON-RPC response boundary', () => {
  it('returns the original success envelope only for the expected request ID', () => {
    const payload = fixture('rpc-response-valid.json').payload;
    expect(validateRpcResponse(payload, 'fixture-rpc-001')).toEqual({ ok: true, value: payload });
    const mismatch = validateRpcResponse(payload, 'fixture-rpc-other');
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe('RPC_RESPONSE_INVALID');
  });

  it.each(['rpc-response-missing-result.json', 'rpc-response-result-and-error.json', 'rpc-response-batch.json'])(
    'rejects the malformed %s envelope',
    (name) => {
      const result = validateRpcResponse(fixture(name).payload, 'fixture-rpc-001');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('RPC_RESPONSE_INVALID');
    },
  );

  it('sanitizes a valid upstream RPC error without returning its supplied message', () => {
    const result = validateRpcResponse(fixture('rpc-error-valid.json').payload, 'fixture-rpc-001');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RPC_ERROR');
    expect(JSON.stringify(result)).not.toContain('synthetic-upstream-sensitive-sentinel');
    expect(JSON.stringify(result)).not.toContain('synthetic-error-data-sentinel');
  });

  it('rejects a null-ID error instead of matching it to an arbitrary request', () => {
    const result = validateRpcResponse({
      jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Synthetic parsing error' },
    }, 'fixture-rpc-001');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RPC_RESPONSE_INVALID');
  });
});

describe('versioned registry and sanitized failures', () => {
  it('accepts the synthetic manifest at the supplied clock without claiming live provenance', () => {
    const result = validateRegistryManifest(fixture('registry-manifest-valid.json').payload, manifest.evaluationTime);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.origin).toBe('fixture');
      expect(result.value.evidence).toBe('SIMULATED');
    }
  });

  it('rejects a manifest at the exact expiry boundary', () => {
    const payload = fixture('registry-manifest-valid.json').payload;
    const result = validateRegistryManifest(payload, '2030-01-01T01:00:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REGISTRY_EXPIRED');
  });

  it('returns a fixed invalid-input error without raw payload values', () => {
    const result = parseContract(rpcTraceSchema, {
      rawIp: '192.0.2.123',
      privateOrder: 'synthetic-order-sensitive-sentinel',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    expect(JSON.stringify(result)).not.toContain('192.0.2.123');
    expect(JSON.stringify(result)).not.toContain('synthetic-order-sensitive-sentinel');
  });

  it.each(['2', 0, -1, 1.5, null])('classifies malformed schemaVersion %s as invalid input', (version) => {
    const payload = registryManifestSchema.parse(fixture('registry-manifest-valid.json').payload);
    expect(parseContract(registryManifestSchema, { ...payload, schemaVersion: version }))
      .toEqual({ ok: false, error: makeError('INVALID_INPUT') });
  });

  it('classifies a well-formed future contract version as unsupported', () => {
    const payload = registryManifestSchema.parse(fixture('registry-manifest-valid.json').payload);
    expect(parseContract(registryManifestSchema, { ...payload, schemaVersion: 2 }))
      .toEqual({ ok: false, error: makeError('UNSUPPORTED_VERSION') });
  });

  it('does not infer a current clock or accept an invalid or earlier evaluation time', () => {
    const payload = fixture('registry-manifest-valid.json').payload;
    for (const now of ['not-a-time', '2029-12-31T23:59:59Z']) {
      expect(validateRegistryManifest(payload, now)).toEqual({ ok: false, error: makeError('INVALID_INPUT') });
    }
  });
});

describe('canonical primitives and lexical endpoint screening', () => {
  it.each(['01', '-1', '+1', '1.0', '1e3', '0x1', ' 1'])('rejects a noncanonical chain ID %s', (value) => {
    expect(chainIdSchema.safeParse(value).success).toBe(false);
  });

  it('accepts canonical decimal IDs and validates address shape without an SDK', () => {
    expect(chainIdSchema.parse('0')).toBe('0');
    expect(chainIdSchema.parse('11155111')).toBe('11155111');
    expect(addressSchema.safeParse(`0x${'11'.repeat(20)}`).success).toBe(true);
    expect(addressSchema.safeParse(`0x${'11'.repeat(19)}`).success).toBe(false);
    expect(timestampSchema.safeParse('2030-01-01T00:00:00+01:00').success).toBe(false);
  });

  it.each([
    'http://rpc.example.com',
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://[::1]',
    'https://rpc.localhost',
    'https://rpc.internal',
    'https://rpc.example.com:8443',
    'https://user:password@rpc.example.com',
    'https://rpc.example.com/%24%7BAPI_KEY%7D',
    'https://rpc.example.com#private',
    'https://rpc.example.com\\@127.0.0.1',
  ])('rejects an unsafe lexical candidate %s without fetching it', (value) => {
    expect(publicHttpsUrlSchema.safeParse(value).success).toBe(false);
  });

  it('accepts a public HTTPS candidate without treating that as publisher or DNS trust', () => {
    const candidate = 'https://rpc.example.com/public-path?network=mainnet';
    expect(publicHttpsUrlSchema.parse(candidate)).toBe(candidate);
  });
});

describe('read-only RPC request parameters', () => {
  const request = { jsonrpc: '2.0', id: 'fixture-rpc-001' };
  const address = `0x${'11'.repeat(20)}`;

  it.each([
    { method: 'eth_chainId', params: ['unexpected'] },
    { method: 'eth_getBalance', params: [address] },
    { method: 'eth_getBalance', params: [address, '0x01'] },
    { method: 'eth_getTransactionReceipt', params: ['not-a-transaction-hash'] },
    { method: 'eth_call', params: [{ to: address, data: '0x' }, 'latest'] },
    { method: 'eth_call', params: [{ to: address, data: '0x12345678', value: '0x1' }, 'latest'] },
    { method: 'eth_sendTransaction', params: [] },
  ])('rejects $method with invalid parameter shape or an unsupported method', (input) => {
    expect(jsonRpcRequestSchema.safeParse({ ...request, ...input }).success).toBe(false);
  });

  it('accepts a bounded call shape while leaving target and selector authorization to policy', () => {
    expect(jsonRpcRequestSchema.safeParse({
      ...request, method: 'eth_call', params: [{ to: address, data: '0x12345678' }, 'latest'],
    }).success).toBe(true);
  });

  it('rejects notifications, non-JSON results and unexpected observer fields', () => {
    expect(jsonRpcRequestSchema.safeParse({ jsonrpc: '2.0', method: 'eth_chainId', params: [] }).success).toBe(false);
    expect(jsonRpcResponseSchema.safeParse({ ...request, result: Number.NaN }).success).toBe(false);
    const observer = observerRunSchema.parse(fixture('observer-run-valid.json').payload);
    expect(observerRunSchema.safeParse({
      ...observer, observations: observer.observations.map((entry) => ({ ...entry, requestBody: 'synthetic-private-payload' })),
    }).success).toBe(false);
  });
});

describe('privacy/evidence invariants and result envelopes', () => {
  it('requires the bootstrap route to be explicit and refuses a successful blocked trace', () => {
    const trace = rpcTraceSchema.parse(fixture('rpc-trace-valid.json').payload);
    expect(rpcTraceSchema.safeParse({ ...trace, bootstrap: true }).success).toBe(false);
    expect(rpcTraceSchema.safeParse({ ...trace, bootstrap: true, route: 'direct-bootstrap' }).success).toBe(true);
    expect(rpcTraceSchema.safeParse({ ...trace, route: 'blocked', success: true }).success).toBe(false);
    expect(rpcTraceSchema.safeParse({ ...trace, errorCode: 'WORKER_UNAVAILABLE' }).success).toBe(false);
  });

  it('requires privacy-required policies to exclude direct-debug control', () => {
    const policy = routePolicySchema.parse(fixture('route-policy-valid.json').payload);
    expect(routePolicySchema.safeParse({ ...policy, allowDirectDebugControl: true }).success).toBe(false);
    expect(routePolicySchema.safeParse({ ...policy, allowedChains: ['1', '1'] }).success).toBe(false);
  });

  it('rejects impossible report counts and private fields even when coverage appears plausible', () => {
    const report = privacyReportSchema.parse(fixture('privacy-report-valid.json').payload);
    expect(privacyReportSchema.safeParse({ ...report, successfulReads: 3 }).success).toBe(false);
    expect(privacyReportSchema.safeParse({ ...report, protectedReads: 3 }).success).toBe(false);
    expect(privacyReportSchema.safeParse({ ...report, privateOrder: 'synthetic-order' }).success).toBe(false);
  });

  it('rejects duplicate artifact paths, future artifacts and mixed simulated/live claims', () => {
    const manifest = verificationManifestSchema.parse(fixture('verification-manifest-valid.json').payload);
    const artifact = manifest.artifacts[0];
    expect(artifact).toBeDefined();
    if (!artifact) throw new Error('Synthetic verification artifact is missing.');
    expect(verificationManifestSchema.safeParse({ ...manifest, artifacts: [artifact, artifact] }).success).toBe(false);
    expect(verificationManifestSchema.safeParse({
      ...manifest, artifacts: [{ ...artifact, generatedAt: '2030-01-01T00:03:00Z' }],
    }).success).toBe(false);
    expect(verificationManifestSchema.safeParse({
      ...manifest, artifacts: [{ ...artifact, evidence: 'OBSERVED_LIVE' }],
    }).success).toBe(false);
  });

  it('keeps success and failure fields exclusive and validates versioned HTTP envelopes', () => {
    const error = makeError('WORKER_UNAVAILABLE');
    const result = resultSchema(jsonValueSchema);
    const httpResult = httpResultSchema(jsonValueSchema);
    expect(result.safeParse({ ok: false, error }).success).toBe(true);
    expect(result.safeParse({ ok: true, value: '0x1', error }).success).toBe(false);
    expect(httpResult.safeParse({ schemaVersion: 1, ok: true, value: '0x1' }).success).toBe(true);
    expect(httpResult.safeParse({ schemaVersion: 2, ok: false, error }).success).toBe(false);
    expect(safeErrorSchema.safeParse({ ...error, retryable: false }).success).toBe(false);
  });
});

describe('bounded JSON payload handling', () => {
  function rejectsWithoutThrow(payload: unknown) {
    expect(() => parseContract(jsonValueSchema, payload)).not.toThrow();
    expect(parseContract(jsonValueSchema, payload)).toEqual({ ok: false, error: makeError('INVALID_INPUT') });
    expect(() => validateRpcResponse({ jsonrpc: '2.0', id: 'fixture-rpc-001', result: payload }, 'fixture-rpc-001'))
      .not.toThrow();
    expect(validateRpcResponse({ jsonrpc: '2.0', id: 'fixture-rpc-001', result: payload }, 'fixture-rpc-001'))
      .toEqual({ ok: false, error: makeError('RPC_RESPONSE_INVALID') });
  }

  it('rejects extreme nesting through safe boundary results instead of a stack overflow', () => {
    let payload: unknown = null;
    for (let depth = 0; depth < Math.max(MAX_JSON_DEPTH + 1, 5_000); depth += 1) payload = [payload];
    rejectsWithoutThrow(payload);
  });

  it('rejects a payload that exceeds the declared node budget', () => {
    rejectsWithoutThrow(Array.from({ length: MAX_JSON_NODES + 1 }, () => null));
  });

  it('rejects a cyclic local object through the same sanitized failure path', () => {
    const payload: Record<string, unknown> = {};
    payload['self'] = payload;
    rejectsWithoutThrow(payload);
  });

  it('accepts ordinary JSON and shared-but-acyclic local values', () => {
    const shared = { enabled: true, count: 3, label: 'synthetic' };
    const payload = { left: shared, right: shared, values: [null, false, 0, 'fixture'] };
    expect(parseContract(jsonValueSchema, payload)).toEqual({ ok: true, value: payload });
    expect(validateRpcResponse({ jsonrpc: '2.0', id: 'fixture-rpc-001', result: payload }, 'fixture-rpc-001'))
      .toEqual({ ok: true, value: { jsonrpc: '2.0', id: 'fixture-rpc-001', result: payload } });
  });
});

describe('SDK-free public consumer interfaces', () => {
  it('freezes transport and provisional intent signatures at the public package boundary', () => {
    expectTypeOf<ReturnType<MonolithTransport['initialize']>>().toEqualTypeOf<Promise<Result<void>>>();
    expectTypeOf<ReturnType<MonolithTransport['read']>>().toEqualTypeOf<Promise<Result<JsonValue>>>();
    expectTypeOf<Parameters<MonolithTransport['read']>>().toEqualTypeOf<[ReadRequest]>();
    expectTypeOf<ReturnType<MonolithTransport['validateEndpoint']>>()
      .toEqualTypeOf<Promise<Result<EndpointCandidate>>>();
    expectTypeOf<ReturnType<MonolithTransport['getState']>>().toEqualTypeOf<WorkerState>();
    expectTypeOf<ReturnType<MonolithTransport['close']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<TraceSink['emit']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<Clock['now']>>().toEqualTypeOf<string>();
    expectTypeOf<ProvisionalPayIntent>().toEqualTypeOf<{
      payer: string; merchant: string; amount: string; orderId: string; nonce: string; deadline: string;
    }>();
  });

  it('lets a consumer inject a blocked transport, trace sink and clock without importing SDKs', async () => {
    const traces: RpcTrace[] = [];
    const sink = { emit: (trace: RpcTrace) => { traces.push(trace); } } satisfies TraceSink;
    const clock = { now: () => manifest.evaluationTime } satisfies Clock;
    const unavailable = { ok: false, error: makeError('WORKER_UNAVAILABLE') } as const;
    const transport = {
      initialize: async () => unavailable,
      validateEndpoint: async (_candidate: EndpointCandidate) => unavailable,
      read: async (_request: ReadRequest) => {
        sink.emit(rpcTraceSchema.parse(fixture('rpc-trace-worker-unavailable.json').payload));
        return unavailable;
      },
      getState: () => 'BLOCKED' as const,
      close: async () => undefined,
    } satisfies MonolithTransport;

    expect(await transport.initialize()).toEqual(unavailable);
    expect(await transport.read(readRequestSchema.parse(fixture('read-request-valid.json').payload)))
      .toEqual(unavailable);
    expect(transport.getState()).toBe('BLOCKED');
    expect(traces).toHaveLength(1);
    expect(traces[0]?.evidence).toBe('SIMULATED');
    expect(traces[0]?.route).toBe('blocked');
    expect(clock.now()).toBe(manifest.evaluationTime);
    await transport.close();
  });
});
