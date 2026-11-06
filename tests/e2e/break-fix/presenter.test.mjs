import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SandboxWalkthrough, deriveSandboxWalkthrough } from '../../../apps/dashboard/src/features/sandbox/SandboxWalkthrough.tsx';

const dashboardRequire = createRequire(new URL('../../../apps/dashboard/package.json', import.meta.url));
const { createElement } = dashboardRequire('react');
const { renderToStaticMarkup } = dashboardRequire('react-dom/server');

const now = '2030-01-01T00:00:01.000Z';
const leakReport = {
  schemaVersion: 1, runId: 'report_leak', evidence: 'SIMULATED', eligibleReads: 4,
  protectedReads: 2, successfulReads: 4, protectedCoverage: 0.5,
  findings: [{ code: 'DIRECT_BYPASS', callsite: 'Sandbox status widget', message: 'Synthetic bypass.' }],
  scope: { rpcOrigins: ['https://observer.example'], scenarios: ['Live privacy regression'], bootstrapExclusions: [] },
};
function snapshot(mode = 'leak') {
  const report = mode === 'leak' ? structuredClone(leakReport) : {
    ...structuredClone(leakReport), runId: 'report_repaired', protectedReads: 3, protectedCoverage: 0.75,
    findings: [{ code: 'DIRECT_CONTROL', callsite: 'Explicit direct comparison', message: 'No protected credit.' }],
  };
  return {
    version: 1, phase: 'READY', mode, busy: false, workerState: 'READY', worker: null,
    allocation: { runId: 'run_fresh', expiresAt: '2030-01-01T00:05:00.000Z' }, selection: null, manifest: null,
    reads: [{ completedAt: now, success: true, evidence: 'SIMULATED' }], traces: [],
    correlation: { exactInventory: true, unmatchedObservations: 0, sourceComparison: 'confirmed', codes: [],
      diagnostics: { runId: 'run_fresh' }, analysis: { report, summary: { functionalAcceptance: 'pass' } },
      widgetPrivacy: mode === 'leak' ? 'fail' : 'pass' },
    error: null, observedAt: now, previousLeakReport: structuredClone(leakReport),
    milestones: { privateRead: true, comparison: true, leak: true, repair: mode === 'repair' },
  };
}

describe('sandbox walkthrough presentation boundary', () => {
  it('retains the failing report and requires a distinct recomputed successful report', () => {
    const before = snapshot();
    expect(deriveSandboxWalkthrough(before).outcome).toBe('leak-observed');
    const after = snapshot('repair');
    expect(deriveSandboxWalkthrough(after).outcome).toBe('repaired');
    after.correlation.analysis.report.runId = after.previousLeakReport.runId;
    expect(deriveSandboxWalkthrough(after).outcome).toBe('incomplete');
    expect(before.previousLeakReport.findings[0].code).toBe('DIRECT_BYPASS');
  });

  it('shows the measured bypass when its absent wrapper trace makes analysis unresolved', () => {
    const state = snapshot();
    state.correlation.analysis.summary.functionalAcceptance = 'unresolved';
    state.correlation.analysis.report.findings.push({ code: 'MISSING_TRACE', callsite: 'Sandbox status widget', message: 'Expected bypass.' });
    expect(deriveSandboxWalkthrough(state).outcome).toBe('leak-observed');
  });

  it('does not enable repair from milestones, an empty report or failed useful reads', () => {
    const state = snapshot('repair');
    state.previousLeakReport = null;
    expect(deriveSandboxWalkthrough(state)).toMatchObject({ canRepair: false, outcome: 'incomplete' });
    state.previousLeakReport = { ...leakReport, eligibleReads: 0, successfulReads: 0 };
    expect(deriveSandboxWalkthrough(state).canRepair).toBe(false);
    state.previousLeakReport = { ...leakReport, successfulReads: 0 };
    expect(deriveSandboxWalkthrough(state).canRepair).toBe(false);
  });

  it.each([
    ['functional outage', (state) => { state.correlation.analysis.summary.functionalAcceptance = 'fail'; }],
    ['missing independent inventory', (state) => { state.correlation.exactInventory = false; }],
    ['unmatched receipt', (state) => { state.correlation.unmatchedObservations = 1; }],
    ['inconclusive source', (state) => { state.correlation.sourceComparison = 'inconclusive'; }],
    ['late diagnostics from another run', (state) => { state.correlation.diagnostics.runId = 'run_old'; }],
    ['failed useful read', (state) => { state.reads[0].success = false; }],
    ['unfinished read', (state) => { state.reads[0].completedAt = null; }],
    ['empty useful denominator', (state) => { state.correlation.analysis.report.eligibleReads = 0; }],
    ['new bypass finding', (state) => { state.correlation.analysis.report.findings.push(leakReport.findings[0]); }],
    ['mixed old and new evidence', (state) => { state.previousLeakReport.evidence = 'OBSERVED_LIVE'; }],
  ])('cannot display a repaired pass after %s', (_name, change) => {
    const state = snapshot('repair');
    change(state);
    expect(deriveSandboxWalkthrough(state).outcome).toBe('incomplete');
  });

  it('suppresses completed outcomes and actions during rerun or after close', () => {
    const state = snapshot('repair');
    state.busy = true;
    expect(deriveSandboxWalkthrough(state)).toMatchObject({ outcome: 'running', canInject: false, canRepair: false });
    state.busy = false;
    state.phase = 'CLOSED';
    expect(deriveSandboxWalkthrough(state)).toMatchObject({ outcome: 'blocked', canInject: false, canRepair: false });
  });

  it('renders the route-only fixture diff, common seed, original failure and measured counts', () => {
    const markup = renderToStaticMarkup(createElement(SandboxWalkthrough, { state: snapshot('repair'), onRun: () => {} }));
    expect(markup).toContain('SIMULATED');
    expect(markup).toContain('monolith-zero-address-balance-v1');
    expect(markup).toContain('direct-debug');
    expect(markup).toContain('anon-nym');
    expect(markup).toContain('report_leak');
    expect(markup).toContain('report_repaired');
    expect(markup).toContain('DIRECT_BYPASS');
    expect(markup).toContain('3/4');
    expect(markup).toContain('does not edit arbitrary production code');
    expect(markup).toContain('ordinary non-anonymous contacts');
    expect(markup).not.toContain('OBSERVED LIVE');
  });
});
