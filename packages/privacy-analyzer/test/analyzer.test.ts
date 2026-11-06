import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeError, privacyReportSchema } from '@monolith/shared';
import type { Result } from '@monolith/shared';
import { analyzePrivacyRun, exportPrivacyReport } from '../src/index.js';
import type { AnalyzerInput, AnalyzerScope, PrivacyAnalysis } from '../src/types.js';
import { attempt, fixture, read, trace } from './fixtures.js';

function value(result: Result<PrivacyAnalysis>): PrivacyAnalysis {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected a successful synthetic analysis.');
  expect(privacyReportSchema.safeParse(result.value.report).success).toBe(true);
  expect(result.value.report.evidence).toBe('SIMULATED');
  return result.value;
}
function counts(result: Result<PrivacyAnalysis>) {
  const { report } = value(result);
  return [report.eligibleReads, report.protectedReads, report.successfulReads, report.protectedCoverage];
}
function invalid(input: unknown, scope: unknown) {
  expect(analyzePrivacyRun(input, scope)).toEqual({ ok: false, error: makeError('INVALID_INPUT') });
}

describe('measured logical-read accounting (all evidence is SIMULATED)', () => {
  it('exports a schema-valid report with declared application, capture scope and public aliases', () => {
    const { input, scope } = fixture();
    const output = value(analyzePrivacyRun(input, scope));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 1, 1, 1]);
    expect(output.report.runId).toBe(scope.reportRunId);
    expect(output.report.scope).toEqual({
      rpcOrigins: ['https://rpc.example.com'], scenarios: ['leak-lab:read'], bootstrapExclusions: [],
    });
    expect(output.summary.completionRate).toBe(1);
    expect(output.summary.functionalAcceptance).toBe('pass');
    expect(output.summary.application).toBe('leak-lab');
    const encoded = exportPrivacyReport(input, scope);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      expect(JSON.parse(encoded.value)).toEqual(output.report);
      for (const privateId of [input.runId, input.reads[0]!.readId, input.reads[0]!.endpointId,
        input.attempts[0]!.eventId]) expect(encoded.value).not.toContain(privateId);
    }
  });

  it('keeps an empty denominator unavailable and fails useful-read acceptance', () => {
    const { input, scope } = fixture();
    input.reads = []; input.traces = []; input.attempts = [];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([0, 0, 0, null]);
    expect(value(analyzePrivacyRun(input, scope)).summary).toMatchObject({
      completionRate: null, functionalAcceptance: 'fail', latency: [],
    });
  });

  it('retains declared reads that never executed in the denominator', () => {
    const { input, scope } = fixture();
    input.traces = []; input.attempts = [];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 0, 0]);
    expect(value(analyzePrivacyRun(input, scope)).report.findings.length).toBeGreaterThan(0);
  });

  it('does not let a repair that blocks every read pass functional acceptance', () => {
    const { input, scope } = fixture();
    input.reads.push(read({ readId: 'private-read-seed-002' }));
    input.traces = [trace({ route: 'blocked', success: false, errorCode: 'WORKER_UNAVAILABLE' })];
    input.attempts = [attempt({ route: 'blocked', sent: false, completed: false, workerVerified: false })];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([2, 0, 0, 0]);
    expect(value(analyzePrivacyRun(input, scope)).summary.functionalAcceptance).toBe('fail');
  });

  it.each(['direct-debug', 'passthrough'] as const)('counts a useful %s read without protection credit', (route) => {
    const { input, scope } = fixture();
    input.reads[0]!.privacyRequired = false;
    input.traces = [trace({ route })];
    input.attempts = [attempt({ route, workerVerified: false })];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
  });

  it('separates a verified protected timeout from completion', () => {
    const { input, scope } = fixture();
    input.traces = [trace({ success: false, errorCode: 'UPSTREAM_TIMEOUT', durationMs: 100 })];
    input.attempts = [attempt({ completed: false, durationMs: 100 })];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 1, 0, 1]);
    expect(value(analyzePrivacyRun(input, scope)).summary.functionalAcceptance).toBe('fail');
  });

  it.each([
    'WORKER_INTEGRITY_FAILED', 'WORKER_UNAVAILABLE', 'POLICY_DENIED', 'TARGET_DENIED', 'REGISTRY_EXPIRED',
  ] as const)('withholds protection when %s contradicts a verified-send claim', (errorCode) => {
    const { input, scope } = fixture();
    input.traces = [trace({ success: false, errorCode })];
    input.attempts = [attempt({ completed: false })];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 0, 0]);
    expect(value(analyzePrivacyRun(input, scope)).report.findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EVIDENCE_CONFLICT' })]));
  });

  it('retains protected-route credit for an actual verified probe that finds the wrong chain', () => {
    const { input, scope } = fixture();
    input.traces = [trace({ success: false, errorCode: 'CHAIN_MISMATCH' })];
    input.attempts = [attempt({ completed: false })];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 1, 0, 1]);
  });

  it('counts protected retries as one logical read and retains their actual timing samples', () => {
    const { input, scope } = fixture();
    input.traces = [trace({ success: false, errorCode: 'UPSTREAM_TIMEOUT', durationMs: 100 }), trace({ attempt: 2 })];
    input.attempts = [attempt({ completed: false, durationMs: 100 }),
      attempt({ eventId: 'private-event-seed-002', ref: { readId: 'private-read-seed-001', attempt: 2 } })];
    const output = value(analyzePrivacyRun(input, scope));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 1, 1, 1]);
    expect(output.summary.latency).toEqual([expect.objectContaining({
      method: 'eth_chainId', chainId: '1', route: 'anon-nym', sampleCount: 2,
      successfulSamples: 1, p50Ms: 25, p95Ms: 100,
    })]);
  });

  it.each(['direct-debug', 'passthrough', 'unknown'] as const)(
    'does not let a later protected retry erase an earlier %s send', (route) => {
      const { input, scope } = fixture();
      input.traces = [trace({ route: route === 'unknown' ? 'anon-nym' : route, success: false,
        errorCode: 'UPSTREAM_TIMEOUT' }), trace({ attempt: 2 })];
      input.attempts = [attempt({ route, workerVerified: false, completed: false }),
        attempt({ eventId: 'private-event-seed-002', ref: { readId: 'private-read-seed-001', attempt: 2 } })];
      expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
    },
  );

  it('trusts matched direct egress over a wrapper claim of an anonymous route', () => {
    const { input, scope } = fixture();
    input.attempts = [attempt({ route: 'direct-debug', workerVerified: false })];
    const output = value(analyzePrivacyRun(input, scope));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
    expect(output.report.findings.some((finding) => finding.callsite === 'lab.balance')).toBe(true);
  });

  it('adds an independent unbound bypass without a wrapper trace to the denominator', () => {
    const { input, scope } = fixture();
    const leak = attempt({ eventId: 'private-event-leak-001', route: 'direct-debug', workerVerified: false });
    delete leak.ref; delete leak.callsiteAlias;
    input.attempts.push(leak);
    const output = value(analyzePrivacyRun(input, scope));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([2, 1, 2, 0.5]);
    expect(output.report.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toContain(leak.eventId);
  });

  it('keeps two distinct unbound requests separate even when all RPC metadata is identical', () => {
    const { input, scope } = fixture();
    input.reads = []; input.traces = [];
    const first = attempt({ route: 'direct-debug', workerVerified: false });
    delete first.ref;
    input.attempts = [first, { ...first, eventId: 'private-event-seed-002' }];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([2, 0, 2, 0]);
  });

  it('withholds protection for a completed measured send missing its wrapper trace', () => {
    const { input, scope } = fixture();
    input.traces = [];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
  });

  it('does not infer execution, verification or completion from a route trace alone', () => {
    const { input, scope } = fixture();
    input.attempts = [];
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 0, 0]);
  });

  it('withholds protection when worker verification is unavailable', () => {
    const { input, scope } = fixture();
    input.attempts[0]!.workerVerified = false;
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
  });

  it('withholds protection for incomplete independent capture while preserving useful completion', () => {
    const { input, scope } = fixture();
    scope.captureComplete = false;
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
    expect(value(analyzePrivacyRun(input, scope)).summary.functionalAcceptance).toBe('unresolved');
  });
});

describe('correlation and duplicate delivery', () => {
  it('deduplicates exact delivery of a trace, measured event and declared read', () => {
    const { input, scope } = fixture();
    input.traces.push(structuredClone(input.traces[0]!));
    input.attempts.push(structuredClone(input.attempts[0]!));
    input.reads.push(structuredClone(input.reads[0]!));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 1, 1, 1]);
  });

  it.each(['route', 'success', 'method'] as const)('rejects conflicting duplicate traces (%s)', (field) => {
    const { input, scope } = fixture();
    const duplicate = trace();
    if (field === 'route') duplicate.route = 'direct-debug';
    if (field === 'success') duplicate.success = false;
    if (field === 'method') duplicate.method = 'eth_blockNumber';
    input.traces.push(duplicate);
    invalid(input, scope);
  });

  it('rejects conflicting observations under one event identity', () => {
    const { input, scope } = fixture();
    input.attempts.push(attempt({ route: 'direct-debug', workerVerified: false }));
    invalid(input, scope);
  });

  it('does not silently collapse two separate sends sharing the same attempt binding', () => {
    const { input, scope } = fixture();
    input.attempts.push(attempt({ eventId: 'private-event-seed-002' }));
    const output = value(analyzePrivacyRun(input, scope));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
    expect(output.report.findings.some((finding) => finding.code === 'DUPLICATE_SEND')).toBe(true);
  });

  it('withholds protection when attempt two appears without attempt one', () => {
    const { input, scope } = fixture();
    input.traces = [trace({ attempt: 2 })];
    input.attempts[0]!.ref!.attempt = 2;
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
  });

  it.each(['endpoint', 'chain', 'method', 'callsite'] as const)(
    'rejects a reused logical ID with conflicting %s identity', (field) => {
      const { input, scope } = fixture();
      const second = read();
      if (field === 'endpoint') second.endpointId = 'private-endpoint-002';
      if (field === 'chain') second.chainId = '2';
      if (field === 'method') second.method = 'eth_blockNumber';
      if (field === 'callsite') second.callsiteAlias = 'worker-bootstrap';
      input.reads.push(second);
      invalid(input, scope);
    },
  );

  it('does not infer correlation from a shared method, endpoint or duration', () => {
    const { input, scope } = fixture();
    const unbound = attempt();
    delete unbound.ref;
    input.attempts = [unbound];
    const output = value(analyzePrivacyRun(input, scope));
    expect(output.report.eligibleReads).toBe(2);
    expect(output.report.protectedReads).toBe(0);
  });

  it('rejects conflicting measured-only callsites rather than merging them by a reused read ID', () => {
    const { input, scope } = fixture();
    input.reads = []; input.traces = [];
    scope.callsites.push({ alias: 'status-widget', label: 'lab.status' });
    input.attempts = [
      attempt({ route: 'direct-debug', workerVerified: false }),
      attempt({ eventId: 'private-event-seed-002', ref: { readId: 'private-read-seed-001', attempt: 2 },
        route: 'direct-debug', workerVerified: false, callsiteAlias: 'status-widget' }),
    ];
    invalid(input, scope);
    input.attempts.reverse();
    invalid(input, scope);
  });

  it('uses an explicit measured-only callsite consistently when another attempt omits the alias', () => {
    const { input, scope } = fixture();
    input.reads = []; input.traces = [];
    const absent = attempt({ route: 'direct-debug', workerVerified: false });
    delete absent.callsiteAlias;
    input.attempts = [absent,
      attempt({ eventId: 'private-event-seed-002', ref: { readId: 'private-read-seed-001', attempt: 2 },
        route: 'direct-debug', workerVerified: false }),
    ];
    const output = value(analyzePrivacyRun(input, scope));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
    expect(output.summary.functionalAcceptance).toBe('unresolved');
    expect(output.report.findings.every((finding) => finding.callsite === 'lab.balance')).toBe(true);
    input.attempts.reverse();
    expect(value(analyzePrivacyRun(input, scope))).toEqual(output);
  });

  it('is deterministic under input and catalog permutations and does not mutate caller objects', () => {
    const { input, scope } = fixture();
    input.reads.push(read({ readId: 'private-read-seed-002' }));
    input.traces.push(trace({ readId: 'private-read-seed-002' }));
    input.attempts.push(attempt({ eventId: 'private-event-seed-002', ref: { readId: 'private-read-seed-002', attempt: 1 } }));
    const before = structuredClone({ input, scope });
    const original = analyzePrivacyRun(input, scope);
    const permutation = structuredClone(before);
    permutation.input.reads.reverse(); permutation.input.traces.reverse(); permutation.input.attempts.reverse();
    permutation.scope.callsites.reverse();
    expect(analyzePrivacyRun(permutation.input, permutation.scope)).toEqual(original);
    expect({ input, scope }).toEqual(before);
  });
});

describe('narrow bootstrap accounting', () => {
  function bootstrapFixture() {
    const { input, scope } = fixture();
    scope.bootstrapRules = [{
      readId: 'private-bootstrap-001', endpointId: 'private-bootstrap-endpoint', chainId: '1',
      method: 'eth_call', callsiteAlias: 'worker-bootstrap', originAlias: 'rpc-primary',
      label: 'worker.specifier-lookup',
    }];
    input.traces.push(trace({
      readId: 'private-bootstrap-001', endpointId: 'private-bootstrap-endpoint', method: 'eth_call',
      callsite: 'worker-bootstrap', route: 'direct-bootstrap', bootstrap: true,
    }));
    input.attempts.push(attempt({
      eventId: 'private-bootstrap-event', ref: { readId: 'private-bootstrap-001', attempt: 1 },
      endpointId: 'private-bootstrap-endpoint', method: 'eth_call', callsiteAlias: 'worker-bootstrap',
      route: 'direct-bootstrap', workerVerified: false,
    }));
    return { input, scope };
  }

  it('excludes only the declared exact lookup binding and discloses its label', () => {
    const { input, scope } = bootstrapFixture();
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 1, 1, 1]);
    expect(value(analyzePrivacyRun(input, scope)).report.scope.bootstrapExclusions)
      .toEqual(['worker.specifier-lookup']);
  });

  it('keeps an approved-bootstrap-only run unavailable for functional acceptance', () => {
    const { input, scope } = bootstrapFixture();
    input.reads = []; input.traces.shift(); input.attempts.shift();
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([0, 0, 0, null]);
  });

  it('counts a direct chain probe that falsely claims the bootstrap flag', () => {
    const { input, scope } = fixture();
    input.traces[0] = trace({ route: 'direct-bootstrap', bootstrap: true });
    input.attempts[0] = attempt({ route: 'direct-bootstrap', workerVerified: false });
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([1, 0, 1, 0]);
    expect(value(analyzePrivacyRun(input, scope)).report.findings.length).toBeGreaterThan(0);
  });

  it('never excludes a declared app read merely because its ID appears in a bootstrap rule', () => {
    const { input, scope } = bootstrapFixture();
    input.reads.push(read({
      readId: 'private-bootstrap-001', endpointId: 'private-bootstrap-endpoint', method: 'eth_call',
      callsiteAlias: 'worker-bootstrap',
    }));
    expect(counts(analyzePrivacyRun(input, scope))).toEqual([2, 1, 2, 0.5]);
  });

  it('counts an unmatched bootstrap send rather than hiding it under an origin exemption', () => {
    const { input, scope } = bootstrapFixture();
    input.attempts[1]!.endpointId = 'private-unapproved-endpoint';
    const output = analyzePrivacyRun(input, scope);
    // A contradictory binding is either rejected safely or retained without protection.
    if (!output.ok) expect(output.error).toEqual(makeError('INVALID_INPUT'));
    else {
      expect(output.value.report.eligibleReads).toBeGreaterThan(1);
      expect(output.value.report.protectedReads).toBeLessThan(output.value.report.eligibleReads);
    }
  });
});

describe('evidence and public export boundary', () => {
  it('keeps simulated modeled coverage explicitly simulated', () => {
    const { input, scope } = fixture();
    const output = value(analyzePrivacyRun(input, scope));
    expect(output.report.evidence).toBe('SIMULATED');
    expect(JSON.stringify(output)).not.toContain('OBSERVED_LIVE');
  });

  it('rejects a live report assembled with simulated traces or attempts', () => {
    const { input, scope } = fixture();
    input.evidence = 'OBSERVED_LIVE';
    invalid(input, scope);
  });

  it.each(['UNTESTED', 'BLOCKED'] as const)('rejects completed measurements labeled %s', (evidence) => {
    const { input, scope } = fixture();
    input.evidence = evidence;
    input.traces[0]!.evidence = evidence;
    input.attempts[0]!.evidence = evidence;
    invalid(input, scope);
  });

  it('keeps an honestly untested failed run unresolved without protection credit', () => {
    const { input, scope } = fixture();
    input.evidence = 'UNTESTED';
    input.traces = [trace({ evidence: 'UNTESTED', success: false, route: 'blocked', errorCode: 'WORKER_UNAVAILABLE' })];
    input.attempts = [attempt({ evidence: 'UNTESTED', route: 'blocked', sent: false, completed: false, workerVerified: false })];
    const output = analyzePrivacyRun(input, scope);
    expect(output.ok).toBe(true);
    if (output.ok) {
      expect(output.value.report.evidence).toBe('UNTESTED');
      expect(output.value.report.protectedReads).toBe(0);
      expect(output.value.report.successfulReads).toBe(0);
      expect(output.value.summary.functionalAcceptance).toBe('unresolved');
    }
  });

  it('never copies input identifiers that happen to contain a private-looking value', () => {
    const { input, scope } = fixture();
    const sentinels = ['0x' + 'a'.repeat(64), '0x' + 'b'.repeat(40), '0x' + 'c'.repeat(40), '0x' + 'd'.repeat(64)];
    input.runId = sentinels[0]!;
    input.reads[0]!.readId = sentinels[1]!; input.traces[0]!.readId = sentinels[1]!;
    input.attempts[0]!.ref!.readId = sentinels[1]!;
    input.reads[0]!.endpointId = sentinels[2]!; input.traces[0]!.endpointId = sentinels[2]!;
    input.attempts[0]!.endpointId = sentinels[2]!; input.attempts[0]!.eventId = sentinels[3]!;
    const output = analyzePrivacyRun(input, scope);
    expect(output.ok).toBe(true);
    for (const sentinel of sentinels) expect(JSON.stringify(output)).not.toContain(sentinel);
  });

  it.each([
    '198.51.100.61', '2001:db8::61', '0x' + 'a'.repeat(40),
    'invoice-private-customer-123', 'https://rpc.example.com/?api_key=secret-fixture-canary',
    'provider failed with signature=secret-fixture-canary',
  ])('does not export an unapproved callsite value: %s', (sentinel) => {
    const { input, scope } = fixture();
    input.traces[0]!.callsite = sentinel;
    const output = analyzePrivacyRun(input, scope);
    expect(JSON.stringify(output)).not.toContain(sentinel);
    if (!output.ok) expect(output.error).toEqual(makeError('INVALID_INPUT'));
    else expect(output.value.report.protectedReads).toBe(0);
  });

  it('rejects raw body/header/error additions with a fixed safe Result', () => {
    const { input, scope } = fixture();
    const canary = 'secret-fixture-canary';
    const tampered = { ...input, traces: [{ ...input.traces[0], rawIp: '198.51.100.61',
      headers: { authorization: canary }, params: [canary], error: canary }] };
    invalid(tampered, scope);
    expect(JSON.stringify(analyzePrivacyRun(tampered, scope))).not.toContain(canary);
    expect(exportPrivacyReport(tampered, scope)).toEqual({ ok: false, error: makeError('INVALID_INPUT') });
  });

  it.each([
    'https://name:secret@rpc.example.com', 'https://rpc.example.com/private-path',
    'https://rpc.example.com?key=secret', 'https://rpc.example.com#secret',
    'https://198.51.100.61', 'https://localhost', 'http://rpc.example.com',
  ])('rejects a scope origin that could expose private data: %s', (origin) => {
    const { input, scope } = fixture();
    scope.origins[0]!.origin = origin;
    invalid(input, scope);
  });

  it('rejects unknown catalog aliases instead of printing them', () => {
    const { input, scope } = fixture();
    input.attempts[0]!.originAlias = 'private-customer-origin';
    invalid(input, scope);
  });
});

describe('bounded validation and comparable attempt latency', () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 3_600_001])('rejects invalid measured duration %s', (durationMs) => {
    const { input, scope } = fixture();
    input.attempts[0]!.durationMs = durationMs;
    invalid(input, scope);
  });

  it.each([0, -1, 1.5, 1_001, Number.POSITIVE_INFINITY])('rejects invalid attempt index %s', (index) => {
    const { input, scope } = fixture();
    input.attempts[0]!.ref!.attempt = index;
    invalid(input, scope);
  });

  it('rejects excess total records rather than truncating a denominator', () => {
    const { input, scope } = fixture();
    input.attempts = Array.from({ length: 1_001 }, (_, index) => attempt({ eventId: `event-number-${index.toString().padStart(6, '0')}` }));
    invalid(input, scope);
  });

  it('distinguishes an unsupported positive version from malformed input', () => {
    const { input, scope } = fixture();
    expect(analyzePrivacyRun({ ...input, schemaVersion: 2 }, scope))
      .toEqual({ ok: false, error: makeError('UNSUPPORTED_VERSION') });
    invalid({ ...input, schemaVersion: 0 }, scope);
    invalid({ ...input, schemaVersion: '2' }, scope);
    expect(analyzePrivacyRun({ schemaVersion: 2 }, scope))
      .toEqual({ ok: false, error: makeError('UNSUPPORTED_VERSION') });
    const missingVersion: Record<string, unknown> = { ...input };
    delete missingVersion['schemaVersion'];
    invalid(missingVersion, scope);
  });

  it('handles hostile getters without throwing or serializing their exception', () => {
    const { input, scope } = fixture();
    Object.defineProperty(input, 'reads', { get() { throw new Error('secret-fixture-canary'); } });
    expect(() => analyzePrivacyRun(input, scope)).not.toThrow();
    invalid(input, scope);
  });

  it('rejects sparse arrays, symbolic extras and prototype surprises without partial accounting', () => {
    const { input, scope } = fixture();
    const sparse = structuredClone(input);
    delete sparse.attempts[0];
    invalid(sparse, scope);
    const symbols = { ...input, [Symbol('private')]: 'secret-fixture-canary' };
    invalid(symbols, scope);
    const inherited = Object.assign(Object.create({ private: 'secret-fixture-canary' }) as object, input);
    invalid(inherited, scope);
  });

  it('rejects impossible blocked/verified/completed combinations', () => {
    const { input, scope } = fixture();
    input.attempts[0]!.sent = false;
    invalid(input, scope);
    input.attempts[0] = attempt({ route: 'blocked' });
    invalid(input, scope);
    input.attempts[0] = attempt({ route: 'direct-debug', workerVerified: true });
    invalid(input, scope);
  });

  it('never combines latency across different methods, chains, endpoints or routes', () => {
    const { input, scope } = fixture();
    const variants = [
      { readId: 'private-read-seed-002', endpointId: 'private-endpoint-002', chainId: '1', method: 'eth_chainId' as const },
      { readId: 'private-read-seed-003', endpointId: 'private-endpoint-001', chainId: '2', method: 'eth_chainId' as const },
      { readId: 'private-read-seed-004', endpointId: 'private-endpoint-001', chainId: '1', method: 'eth_blockNumber' as const },
      { readId: 'private-read-seed-005', endpointId: 'private-endpoint-001', chainId: '1', method: 'eth_chainId' as const },
    ];
    for (const [index, variant] of variants.entries()) {
      const route = index === 3 ? 'direct-debug' as const : 'anon-nym' as const;
      input.reads.push(read({ ...variant, privacyRequired: index !== 3 }));
      input.traces.push(trace({ ...variant, route, durationMs: 50 + index }));
      input.attempts.push(attempt({
        endpointId: variant.endpointId, chainId: variant.chainId, method: variant.method,
        eventId: `private-event-${index.toString().padStart(8, '0')}`,
        ref: { readId: variant.readId, attempt: 1 }, route,
        workerVerified: index !== 3, durationMs: 50 + index,
      }));
    }
    const output = value(analyzePrivacyRun(input, scope));
    expect(output.summary.latency).toHaveLength(5);
    expect(output.summary.latency.every((entry) => entry.sampleCount === 1)).toBe(true);
    expect(output.summary.latency.every((entry) => entry.p50Ms === entry.p95Ms)).toBe(true);
    expect(JSON.stringify(output.summary.latency)).not.toContain('private-endpoint');
  });
});

describe('published simulated leak/repair fixture', () => {
  const fixturePath = new URL('../../../tests/fixtures/privacy/leak-repair.json', import.meta.url);
  const document = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    fixtureVersion: number;
    evidence: string;
    description: string;
    scope: AnalyzerScope;
    cases: Array<{ name: string; input: AnalyzerInput; expected: [number, number, number, number | null] }>;
  };

  it('labels the entire fixture and every run simulated', () => {
    expect(document.fixtureVersion).toBe(1);
    expect(document.evidence).toBe('SIMULATED');
    expect(document.description).toContain('synthetic');
    for (const entry of document.cases) expect(entry.input.evidence).toBe('SIMULATED');
  });

  it.each(document.cases)('$name preserves useful reads and the expected measured denominator', (entry) => {
    expect(counts(analyzePrivacyRun(entry.input, document.scope))).toEqual(entry.expected);
  });

  it('matches the actual versioned simulated export artifacts', () => {
    const paths = ['leak.report-simulated.json', 'repair.report-simulated.json'];
    for (const [index, entry] of document.cases.entries()) {
      const exported = exportPrivacyReport(entry.input, document.scope);
      expect(exported.ok).toBe(true);
      if (exported.ok) {
        const recorded = readFileSync(new URL(paths[index]!, fixturePath), 'utf8');
        expect(recorded).toBe(exported.value);
        expect(privacyReportSchema.safeParse(JSON.parse(recorded)).success).toBe(true);
        expect(JSON.parse(recorded)).toMatchObject({ schemaVersion: 1, evidence: 'SIMULATED' });
      }
    }
  });
});
