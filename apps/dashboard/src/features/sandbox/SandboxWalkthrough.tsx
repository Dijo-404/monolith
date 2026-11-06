import type { PrivacyReport } from '@monolith/shared';
import type { LiveSnapshot } from '../lab/live-types.js';
import { LIVE_FIXTURE_PATCH, LIVE_SCENARIO } from '../lab/scenario.js';

export type SandboxOutcome = 'untested' | 'running' | 'leak-observed' | 'repaired' | 'blocked' | 'incomplete';

function measuredLeak(report: PrivacyReport | null): report is PrivacyReport {
  return report !== null && ['SIMULATED', 'OBSERVED_LIVE'].includes(report.evidence)
    && report.eligibleReads > 0 && report.successfulReads === report.eligibleReads
    && report.protectedReads < report.eligibleReads
    && report.findings.some((finding) => finding.code === 'DIRECT_BYPASS');
}

/** Present completed controller measurements; milestones alone never establish a result. */
export function deriveSandboxWalkthrough(state: LiveSnapshot) {
  const report = state.correlation?.analysis?.report ?? null;
  const previousLeak = measuredLeak(state.previousLeakReport) ? state.previousLeakReport : null;
  const correlation = state.correlation;
  const currentMeasured = !state.busy && state.phase === 'READY' && state.error === null
    && state.workerState === 'READY' && state.observedAt !== null
    && state.allocation !== null && correlation !== null && correlation.diagnostics?.runId === state.allocation.runId
    && correlation.exactInventory && correlation.unmatchedObservations === 0
    && correlation.codes.length === 0 && correlation.sourceComparison === 'confirmed'
    && state.reads.length > 0 && state.reads.every((read) => read.completedAt !== null && read.success)
    && report !== null && report.eligibleReads > 0 && report.successfulReads === report.eligibleReads
    && ['SIMULATED', 'OBSERVED_LIVE'].includes(report.evidence);
  const hasLeak = currentMeasured && state.mode === 'leak' && correlation?.widgetPrivacy === 'fail'
    && measuredLeak(report);
  const repaired = currentMeasured && state.mode === 'repair' && correlation?.widgetPrivacy === 'pass'
    && correlation.analysis?.summary.functionalAcceptance === 'pass'
    && previousLeak !== null && report !== null && report.runId !== previousLeak.runId
    && previousLeak.evidence === report.evidence
    && report.findings.every((finding) => finding.code === 'DIRECT_CONTROL');
  const closed = state.phase === 'CLOSED';
  const outcome: SandboxOutcome = state.busy ? 'running' : closed || state.phase === 'BLOCKED' || state.error
    ? 'blocked' : repaired ? 'repaired' : hasLeak ? 'leak-observed' : report ? 'incomplete' : 'untested';
  const evidence = state.reads.some((read) => read.evidence === 'SIMULATED') || report?.evidence === 'SIMULATED'
    ? 'SIMULATED' : outcome === 'blocked' ? 'BLOCKED'
      : currentMeasured && report?.evidence === 'OBSERVED_LIVE' ? 'OBSERVED LIVE' : 'UNTESTED';
  return { outcome, evidence, report, previousLeak,
    canInject: !state.busy && !closed,
    canRepair: !state.busy && !closed && previousLeak !== null,
  };
}

const OUTCOMES: Record<SandboxOutcome, string> = {
  untested: 'No measured sandbox result yet', running: 'Running the same useful read again…',
  'leak-observed': 'Direct bypass detected; useful reads still returned',
  repaired: 'Fresh rerun passed; useful reads still returned',
  blocked: 'Run blocked; no successful repair is claimed',
  incomplete: 'Measurements do not establish a successful walkthrough',
};

function ReportCounts({ report }: { report: PrivacyReport }) {
  return <dl className="facts">
    <div><dt>Report run</dt><dd className="mono live-wrap">{report.runId}</dd></div>
    <div><dt>Useful reads returned</dt><dd>{report.successfulReads}/{report.eligibleReads}</dd></div>
    <div><dt>Protected reads</dt><dd>{report.protectedReads}/{report.eligibleReads}</dd></div>
    <div><dt>Findings</dt><dd>{report.findings.map((finding) => finding.code).join(', ') || 'None'}</dd></div>
  </dl>;
}

/** Controlled presentation only: the existing controller owns every run and its cancellation. */
export function SandboxWalkthrough({ state, onRun }: {
  state: LiveSnapshot;
  onRun: (mode: 'leak' | 'repair') => void;
}) {
  const view = deriveSandboxWalkthrough(state);
  return <section className="card card--wide" aria-labelledby="sandbox-title" data-testid="sandbox-walkthrough">
    <header className="card__head"><h3 id="sandbox-title">Break, repair and rerun</h3>
      <span data-testid="sandbox-evidence">{view.evidence}</span></header>
    <p className="card__sub">This changes one fixed sandbox fixture. It does not edit arbitrary production code.</p>
    <p className="mono live-wrap">Scenario: {LIVE_SCENARIO.scenarioId}<br />Seed: {LIVE_SCENARIO.seed}</p>
    <p className="card__sub">Keep chain {LIVE_SCENARIO.chainId}, {LIVE_SCENARIO.method}, the synthetic address and the block tag unchanged. Only the widget route changes.</p>
    <pre className="mono live-wrap" aria-label="Supported sandbox fixture diff" data-testid="sandbox-patch">
      {`- route: '${LIVE_FIXTURE_PATCH.before.route}'\n+ route: '${LIVE_FIXTURE_PATCH.after.route}'`}
    </pre>
    <div className="guide__actions">
      <button type="button" className="btn btn--secondary" disabled={!view.canInject} onClick={() => onRun('leak')}>Run leaky fixture</button>
      <button type="button" className="btn btn--primary" disabled={!view.canRepair} onClick={() => onRun('repair')}>Run repaired fixture</button>
    </div>
    <p aria-live="polite" data-testid="sandbox-outcome" data-outcome={view.outcome}>{OUTCOMES[view.outcome]}</p>
    {!view.previousLeak && <p className="card__note">Capture the failing run before repair. Choosing a fixture never changes an earlier report into a pass.</p>}
    {view.previousLeak && <details open><summary>Retained failing report · {view.previousLeak.evidence}</summary>
      <ReportCounts report={view.previousLeak} /></details>}
    {view.report && <details open><summary>Current measured report · {view.report.evidence}</summary>
      <ReportCounts report={view.report} /></details>}
    {state.observedAt && <p className="card__note">Recorded {state.observedAt}. Each action allocates a fresh run and recomputes its measurements.</p>}
    <p className="card__note">Explicit direct controls stay in the denominator and earn no protected credit. The RPC endpoint still sees the method and synthetic address. Worker bootstrap, public registry metadata, allocation and diagnostics are ordinary non-anonymous contacts.</p>
    <p className="card__note">SIMULATED results demonstrate software behavior only. Live workflow and release acceptance require their separate observed evidence. No payment or settlement is demonstrated here.</p>
  </section>;
}
