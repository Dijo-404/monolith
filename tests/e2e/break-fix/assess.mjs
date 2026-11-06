import assert from 'node:assert/strict';

const MODES = ['leak', 'fixed', 'retry', 'outage', 'block-all', 'unexplained', 'missing-trace', 'direct-control'];

/** Check the independent collector's outcomes, rather than trusting its top-level pass badge. */
export function assessMatrix(matrix, fixture) {
  assert.equal(matrix.evidence, 'SIMULATED');
  assert.equal(matrix.seed, fixture.seed, 'The scenario seed must stay fixed');
  assert.equal(matrix.passed, true);
  assert.equal(matrix.sourceUnchangedAfterRun, true);
  assert.deepEqual(matrix.externalRequests, []);
  assert.deepEqual(matrix.pageErrors, []);
  assert.equal(new Date(matrix.generatedAt).toISOString(), matrix.generatedAt);
  assert(Object.keys(matrix.sourceHashes).length > 0, 'Runtime inputs must be bound');
  assert(Object.values(matrix.sourceHashes).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
  assert.deepEqual(matrix.cases.map((item) => item.mode).sort(), [...MODES].sort());
  const cases = Object.fromEntries(matrix.cases.map((item) => [item.mode, item]));
  for (const item of matrix.cases) {
    assert.equal(item.evidence, 'SIMULATED');
    assert.equal(item.seed, fixture.seed);
    assert.equal(item.report.evidence, 'SIMULATED');
    if (item.captureIssues.length > 0 || item.networkCaptures.some((entry) => !entry.completed)) {
      assert.equal(item.gatePassed, false, 'Incomplete negative-control capture cannot pass');
      assert.equal(item.privacyPass, false);
    }
    assert.equal(item.unparsedRequests, 0);
    assert.equal(item.requestsBeyondCaptureLimit, 0);
    assert(item.report.eligibleReads > 0, 'An empty denominator cannot pass');
    assert.deepEqual(item.report.scope.rpcOrigins, cases.fixed.report.scope.rpcOrigins, 'Capture origins cannot change');
    assert.deepEqual(item.report.scope.scenarios, cases.fixed.report.scope.scenarios, 'The declared scenario cannot change');
  }
  const { leak, fixed, outage } = cases;
  for (const item of [leak, fixed, outage]) {
    assert.deepEqual(item.captureIssues, [], 'Required walkthrough observations must be complete');
    assert(item.networkCaptures.every((entry) => entry.completed && entry.status >= 200 && entry.status < 300));
  }
  assert.deepEqual(leak.report.scope, fixed.report.scope, 'Capture scope cannot change across the repair');
  const usefulCount = fixture.requiredUsefulReads.length + 1; // Two useful operations plus the eligible protected chain probe.
  assert.equal(leak.functionalPass, true, 'Useful reads must work even in the failing privacy case');
  assert.equal(leak.privacyPass, false);
  assert.equal(leak.gatePassed, false);
  assert.equal(leak.unexpectedDirectRequests, 1);
  assert.equal(leak.report.eligibleReads, usefulCount);
  assert.equal(leak.report.successfulReads, usefulCount);
  assert.equal(leak.report.protectedReads, usefulCount - 1);
  assert.equal(leak.report.protectedCoverage, (usefulCount - 1) / usefulCount);
  assert(leak.report.findings.some((entry) => entry.code === 'DIRECT_BYPASS'));
  assert(leak.report.findings.some((entry) => entry.code === 'MISSING_TRACE'));
  const bypass = leak.networkCaptures.filter((entry) => entry.kind === 'direct');
  assert.equal(bypass.length, 1, 'Capture the untraced bypass independently');
  assert.equal(bypass[0].method, 'eth_getTransactionReceipt');
  assert.equal(bypass[0].source?.file, 'leak-widget.ts');
  assert.equal(bypass[0].source?.function, 'leakingReceipt');
  assert.equal(fixed.functionalPass, true, 'Blocking the operation is not a repair');
  assert.equal(fixed.privacyPass, true);
  assert.equal(fixed.gatePassed, true);
  assert.equal(fixed.unexpectedDirectRequests, 0);
  assert.equal(fixed.report.eligibleReads, usefulCount);
  assert.equal(fixed.report.successfulReads, usefulCount);
  assert.equal(fixed.report.protectedReads, usefulCount);
  assert.equal(fixed.report.protectedCoverage, 1);
  assert.deepEqual(fixed.report.findings, []);
  assert(fixed.networkCaptures.every((entry) => entry.kind === 'bootstrap'));
  for (const item of [leak, fixed]) {
    assert.equal(item.networkCaptures.filter((entry) => entry.kind === 'bootstrap').length, 1,
      'The non-anonymous bootstrap remains independently captured');
  }
  assert.equal(outage.privacyPass, true);
  assert.equal(outage.functionalPass, false);
  assert.equal(outage.gatePassed, false, 'An unavailable worker must fail functional acceptance');
  assert.equal(outage.unexpectedDirectRequests, 0);
  assert.equal(outage.report.successfulReads, 0);
  assert.equal(outage.report.protectedReads, 0);
  assert.deepEqual(outage.networkCaptures, [], 'Worker outage must not send a direct fallback');
  return {
    schemaVersion: 1, evidence: 'SIMULATED', seed: fixture.seed,
    generatedAt: matrix.generatedAt, softwareRegressionPassed: true, liveAcceptance: 'UNTESTED',
    usefulOperations: fixture.requiredUsefulReads,
    outcomes: matrix.cases.map((item) => ({
      mode: item.mode, privacyPass: item.privacyPass, functionalPass: item.functionalPass,
      gatePassed: item.gatePassed, eligibleReads: item.report.eligibleReads,
      protectedReads: item.report.protectedReads, successfulReads: item.report.successfulReads,
      unexpectedDirectRequests: item.unexpectedDirectRequests,
    })),
    bypass: { method: bypass[0].method, callsite: bypass[0].source, wrapperTracePresent: false },
    limitations: [
      'Chromium and independent CDP interception actually ran; worker responses and blockchain results are authored test fixtures.',
      'Each matrix case uses a new browser context; fixed fixture IDs and the same seed intentionally identify the same operation. Live observer runs need fresh server-generated identities.',
      'Protected coverage here measures the simulated transport policy, not real Tor/Nym anonymity. The separately configured live workflow remains untested by this command.',
      'The destination can read RPC payloads. The exact non-anonymous fixture bootstrap is excluded from eligible reads and retained in capture-matrix.json.',
    ],
  };
}
