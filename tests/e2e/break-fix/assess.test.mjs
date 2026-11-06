import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessMatrix } from './assess.mjs';

// Historic SIMULATED captures test this consumer's fail-closed checks; new evidence comes from run.mjs.
const original = JSON.parse(readFileSync(new URL('../privacy/recorded-simulated/matrix-2026-11-06.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/leak-widget/manifest.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(original);
const select = (matrix, mode) => matrix.cases.find((item) => item.mode === mode);

describe('same-operation break/fix capture acceptance', () => {
  it('accepts useful leak/fixed operations and a blocked outage without claiming live proof', () => {
    const summary = assessMatrix(copy(), fixture);
    expect(summary.evidence).toBe('SIMULATED');
    expect(summary.liveAcceptance).toBe('UNTESTED');
    expect(summary.outcomes.find((item) => item.mode === 'leak').gatePassed).toBe(false);
    expect(summary.outcomes.find((item) => item.mode === 'fixed').gatePassed).toBe(true);
    expect(summary.outcomes.find((item) => item.mode === 'outage').functionalPass).toBe(false);
  });
  it.each([
    ['a changed scenario seed', (value) => { select(value, 'fixed').seed = 'a-different-operation'; }],
    ['blocking all useful reads as a repair', (value) => { select(value, 'fixed').functionalPass = false; }],
    ['an empty repaired denominator', (value) => { select(value, 'fixed').report.eligibleReads = 0; }],
    ['a hidden extra repaired read', (value) => { select(value, 'fixed').report.eligibleReads++; }],
    ['a successful privacy badge without independent leak capture', (value) => { select(value, 'leak').networkCaptures = []; }],
    ['leak capture without missing-wrapper evidence', (value) => { select(value, 'leak').report.findings = []; }],
    ['a changed capture scope', (value) => { select(value, 'fixed').report.scope.scenarios = ['different']; }],
    ['a direct fallback on worker outage', (value) => { select(value, 'outage').networkCaptures.push({ kind: 'direct', completed: true, status: 200 }); }],
    ['a stale or incomplete capture', (value) => { select(value, 'fixed').captureIssues.push('NETWORK_COMPLETION_MISSING'); }],
    ['a duplicated case replacing required coverage', (value) => { value.cases[0] = structuredClone(select(value, 'fixed')); }],
    ['an external request', (value) => { value.externalRequests.push('outside-configured-fixture-origins'); }],
    ['promoting simulated results to live', (value) => { select(value, 'fixed').report.evidence = 'OBSERVED_LIVE'; }],
    ['runtime inputs changing during capture', (value) => { value.sourceUnchangedAfterRun = false; }],
  ])('rejects %s', (_label, mutate) => {
    const matrix = copy(); mutate(matrix);
    expect(() => assessMatrix(matrix, fixture)).toThrow();
  });
});
