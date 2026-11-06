import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createProductionLiveLab } from '../../composition/lab.js';
import { Header } from '../../components/Header.js';
import { Icon } from '../../components/Icon.js';
import { Tag } from '../../components/Tag.js';
import { Stage } from '../../components/stage/Stage.js';
import type { StageScene } from '../../components/stage/renderer.js';
import { usePrefersReducedMotion } from '../../app/use-lab.js';
import type { LiveMode, LiveSnapshot, LiveWireRead } from './live-types.js';
import './live.css';

const PHASES: Record<LiveSnapshot['phase'], string> = {
  IDLE: 'Ready when you are', WARMING: 'Starting the private network…', ALLOCATING: 'Opening a fresh observer run…',
  REGISTRY: 'Reading trusted Arkiv metadata…', SELECTING: 'Checking the chain through Nym…', READING: 'Reading the synthetic balance…',
  REGISTRY_RETRY: 'Rechecking public registry metadata…',
  VERIFYING: 'Matching independent observer receipts…', READY: 'Run recorded', BLOCKED: 'The run is blocked', CLOSED: 'Worker closed',
};
const short = (value: string, width = 12) => value.length <= width + 6 ? value : `${value.slice(0, width)}…${value.slice(-5)}`;
const milliseconds = (value: number) => `${Math.round(value).toLocaleString()} ms`;

function useLiveLab(observerUrl: string) {
  const controller = useMemo(() => createProductionLiveLab(observerUrl), [observerUrl]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const life = useRef({ controller, ticket: 0 });
  useEffect(() => {
    const ticket = life.current.controller === controller ? life.current.ticket + 1 : 1;
    life.current = { controller, ticket };
    // StrictMode's immediate effect replay must not close its replacement owner.
    return () => { queueMicrotask(() => {
      if (life.current.controller !== controller || life.current.ticket === ticket) void controller.close();
    }); };
  }, [controller]);
  return { controller, snapshot };
}

const STEPS: Array<{ mode: LiveMode; short: string; title: string; body: string; action: string; milestone: keyof LiveSnapshot['milestones'] }> = [
  { mode: 'private', short: 'Read privately', title: 'Read through a real private network.',
    body: 'Start a verified Nym worker, discover an endpoint from Arkiv, and make a useful blockchain read. The destination can still read the synthetic address.',
    action: 'Run private read', milestone: 'privateRead' },
  { mode: 'compare', short: 'Compare origins', title: 'See what the endpoint learns.',
    body: 'Explicitly send one direct control, then repeat through Nym. The direct control exposes your network source. Independent observer receipts must confirm the difference.',
    action: 'Compare direct and private', milestone: 'comparison' },
  { mode: 'leak', short: 'Catch a leak', title: 'Let one widget bypass the policy.',
    body: 'This sandbox sends a direct comparison and a deliberately leaky status widget. The observer must see the extra direct read, even though it has no transport trace.',
    action: 'Send the leaky widget', milestone: 'leak' },
  { mode: 'repair', short: 'Repair and rerun', title: 'Change the route. Keep the useful read.',
    body: 'Reroute the sandbox widget through the worker and rerun the same checks in a fresh run. The intentional direct control stays visible in the report.',
    action: 'Reroute widget and rerun', milestone: 'repair' },
];

function LiveGuide({ state, active, onSelect, onRun }: {
  state: LiveSnapshot; active: number; onSelect: (value: number) => void; onRun: (mode: LiveMode) => void;
}) {
  const step = STEPS[active] ?? STEPS[0]!;
  return <section className="guide" aria-labelledby="guide-title">
    <div className="guide__progress" aria-hidden="true">{STEPS.map((item, index) =>
      <span key={item.mode} data-state={active === index ? 'current' : state.milestones[item.milestone] ? 'done' : 'todo'} />)}</div>
    <p className="guide__count">Step {active + 1} of {STEPS.length}</p>
    <h2 id="guide-title" className="guide__title">{step.title}</h2>
    <p className="guide__body">{step.body}</p>
    <div className="guide__actions">
      <button type="button" className="btn btn--primary" disabled={state.busy} onClick={() => onRun(step.mode)}>
        {state.busy ? 'Run in progress…' : step.action}<Icon name="arrow-right" />
      </button>
      {state.milestones[step.milestone] && active < STEPS.length - 1 &&
        <button type="button" className="btn btn--secondary" disabled={state.busy} onClick={() => onSelect(active + 1)}>Next step</button>}
    </div>
    <p className="guide__status" aria-live="polite" data-tone={state.error ? 'exposed' : state.busy ? 'wait' : 'good'}>
      <Icon name={state.error ? 'alert' : state.busy ? 'clock' : 'check'} />{PHASES[state.phase]}
    </p>
    {state.busy && state.phase === 'WARMING' && <p className="live-hint">Nym may take a minute to start. A timeout blocks the read; it never switches to a direct route.</p>}
    {state.busy && state.phase === 'REGISTRY_RETRY' && <p className="live-hint">Trying public registry metadata again, up to three attempts. Your balance read stays blocked until trust checks pass.</p>}
    <ol className="steps" aria-label="Live lab steps">{STEPS.map((item, index) => <li key={item.mode}>
      <button type="button" className="step" aria-current={active === index ? 'step' : undefined}
        data-done={state.milestones[item.milestone]} onClick={() => onSelect(index)}>
        <span className="step__marker" aria-hidden="true">{state.milestones[item.milestone] ? <Icon name="check" size={14} /> : index + 1}</span>
        {item.short}{state.milestones[item.milestone] && <span className="step__state">Observed</span>}
      </button>
    </li>)}</ol>
  </section>;
}

function SourceComparison({ state }: { state: LiveSnapshot }) {
  const direct = state.reads.find((read) => read.role === 'direct-control' && read.success);
  const protectedRead = [...state.reads].reverse().find((read) => ['private', 'repair'].includes(read.role) && read.success);
  const confirmed = state.correlation?.sourceComparison === 'confirmed';
  const directConfirmed = direct && state.correlation?.exactInventory
    && state.correlation.diagnostics?.observations.find((row) => row.rpcId === direct.rpcId)?.sourceClass === 'baseline';
  return <div className="compare" aria-label="Independent observed network sources">
    <article className={`route-card route-card--direct${direct ? '' : ' is-empty'}`}>
      <header className="route-card__head"><span className="dot dot--exposed" />Direct control</header>
      <p className="route-card__label">The observer saw</p>
      <p className="route-card__value">{directConfirmed ? 'Your direct baseline' : direct ? 'Source inconclusive' : 'Not compared yet'}</p>
      <p className="route-card__meta">{direct ? 'eth_getBalance · synthetic address readable' : 'Only sent by an explicit comparison action.'}</p>
    </article>
    <article className={`route-card route-card--anon${protectedRead ? '' : ' is-empty'}`}>
      <header className="route-card__head"><span className="dot dot--protected" />Through Nym</header>
      <p className="route-card__label">The observer saw</p>
      <p className="route-card__value">{confirmed ? 'A different network source' : state.correlation?.sourceComparison === 'inconclusive'
        ? 'Source comparison inconclusive' : protectedRead ? 'Source comparison not run' : 'No read recorded'}</p>
      <p className="route-card__meta">{protectedRead ? 'eth_getBalance · payload still readable' : 'Private reads use the worker or fail closed.'}</p>
    </article>
  </div>;
}

function LiveChecks({ state }: { state: LiveSnapshot }) {
  const correlation = state.correlation;
  const checks = [
    { label: 'Trusted Arkiv endpoint selected', status: state.selection ? 'pass' : state.error ? 'fail' : 'not-run',
      detail: state.selection ? 'Pinned publisher, source, origin and protected chain check agree.' : 'A schema tag alone is not trusted.' },
    { label: 'Independent wire inventory matches', status: correlation ? correlation.exactInventory ? 'pass' : 'fail' : 'not-run',
      detail: 'Every issued wire ID must match exactly one observer receipt, including method and address visibility.' },
    { label: 'Protected source differs from the direct control', status: correlation?.sourceComparison === 'confirmed' ? 'pass'
      : correlation?.sourceComparison === 'inconclusive' ? 'fail' : 'not-run',
      detail: correlation?.sourceComparison === 'not-run' ? 'Choose the explicit comparison to measure this.' : 'Forwarding labels do not establish origin.' },
    { label: 'Sandbox widget obeys the privacy policy', status: correlation?.widgetPrivacy ?? 'not-run',
      detail: correlation?.widgetPrivacy === 'fail' ? 'Independent receipts expose a direct bypass without a wrapper trace.'
        : correlation?.widgetPrivacy === 'pass' ? 'The repaired widget completed a real worker read.' : 'Inject the widget, then reroute and rerun.' },
  ];
  return <section className="card" aria-labelledby="checks-title"><header className="card__head"><h3 id="checks-title">Privacy checks</h3><EvidenceTag state={state} /></header>
    <ul className="checks">{checks.map((check) => <li key={check.label} className={`check check--${check.status}`}>
      <span className="check__icon"><Icon name={check.status === 'pass' ? 'check' : check.status === 'fail' ? 'cross' : 'dash'} size={14} /></span>
      <span><span className="check__title">{check.label}<span className="visually-hidden"> {check.status}.</span></span><span className="check__detail">{check.detail}</span></span>
    </li>)}</ul>
  </section>;
}

function EvidenceTag({ state }: { state: LiveSnapshot }) {
  const simulated = state.reads.some((row) => row.evidence === 'SIMULATED');
  return <Tag tone={simulated ? 'sim' : state.error ? 'exposed' : state.observedAt ? 'protected' : 'neutral'}>
    {simulated ? 'SIMULATED' : state.error ? 'BLOCKED' : state.observedAt ? 'OBSERVED LIVE' : 'UNTESTED'}
  </Tag>;
}

function Activity({ state }: { state: LiveSnapshot }) {
  const route = (read: LiveWireRead) => read.role === 'leak' ? 'Direct bypass' : read.role === 'direct-control' ? 'Direct control' : 'Nym worker';
  const balance = [...state.reads].reverse().find((read) => ['private', 'repair'].includes(read.role) && read.success && read.result);
  return <section className="card card--wide" aria-labelledby="activity-title"><header className="card__head"><h3 id="activity-title">Activity</h3><EvidenceTag state={state} /></header>
    {state.reads.length ? <ol className="activity">{state.reads.map((read) => <li key={read.rpcId}
      data-rpc-id={read.rpcId} data-read-id={read.logicalReadId} data-role={read.role}
      data-trace-read-id={read.trace?.readId} data-route={read.trace?.route}
      className={`activity__row ${read.role === 'leak' ? 'is-bypass' : ''}`}>
      <span className="activity__time mono">{read.completedAt ? milliseconds(read.durationMs) : 'Waiting…'}</span>
      <Tag tone={read.role === 'leak' || read.role === 'direct-control' ? 'exposed' : 'protected'}>{route(read)}</Tag>
      <span className="activity__method mono">{read.method}</span>
      <span className="activity__callsite mono" title={read.rpcId}>{short(read.rpcId)}</span>
      <span className="activity__outcome">{read.completedAt ? read.success ? 'Returned' : 'Failed' : 'In flight'}</span>
    </li>)}</ol> : <p className="empty">No blockchain read has been sent. Start a private read to begin.</p>}
    {balance && typeof balance.result === 'string' && <p className="card__note">Returned synthetic balance (wei, hexadecimal): <code className="mono live-wrap" data-testid="live-balance">{short(balance.result, 26)}</code></p>}
    {state.observedAt && <p className="card__note">Recorded {new Date(state.observedAt).toLocaleTimeString()}. Durations are actual browser round trips, not animation timings.</p>}
    {Boolean(state.correlation?.unmatchedObservations) && <p className="card__note card__note--exposed">
      {state.correlation?.unmatchedObservations} unexpected observer receipt(s) are also counted in the report. The run cannot pass.
    </p>}
  </section>;
}

function RegistryCard({ state }: { state: LiveSnapshot }) {
  const endpoint = state.selection?.endpoint ?? state.manifest?.endpoints[0];
  const manifest = state.selection?.manifest ?? state.manifest;
  return <section className="card" aria-labelledby="registry-title"><header className="card__head"><h3 id="registry-title">Arkiv endpoint registry</h3><Tag>{manifest ? state.busy ? 'Validated snapshot' : 'Recorded snapshot' : 'Not queried'}</Tag></header>
    <p className="card__lead">{endpoint ? endpoint.chainName : 'No endpoint selected'}</p>
    <p className="card__sub">{endpoint ? `${endpoint.rpcUrl} · chain ${endpoint.chainId}` : 'Metadata is read from the real Arkiv-backed service after the worker starts.'}</p>
    {endpoint && <dl className="facts">
      <div><dt>Protected chain check</dt><dd>{state.selection ? 'Returned 0xa · chain 10 confirmed' : 'Not accepted yet'}</dd></div>
      <div><dt>Arkiv entity</dt><dd className="mono live-wrap" title={endpoint.entityKey}>{short(endpoint.entityKey, 18)}</dd></div>
      <div><dt>Trusted publisher</dt><dd className="mono live-wrap" title={endpoint.publisher.creator}>{short(endpoint.publisher.creator, 18)}</dd></div>
      <div><dt>Source revision</dt><dd className="mono live-wrap">{endpoint.source.revision}</dd></div>
      <div><dt>Source SHA-256</dt><dd className="mono live-wrap">{endpoint.source.snapshotSha256}</dd></div>
      <div><dt>Manifest expires</dt><dd>{manifest?.expiresAt}{!state.busy && ' · every new run revalidates metadata'}</dd></div>
    </dl>}
    <p className="card__note">Arkiv supplies the candidate. Publisher, provenance and expiry checks plus a protected chain probe authorize its use. The observer forwards only this pinned URL.</p>
  </section>;
}

function WorkerCard({ state }: { state: LiveSnapshot }) {
  return <section id="transport" className="card" aria-labelledby="transport-title"><header className="card__head"><h3 id="transport-title">Private transport</h3><EvidenceTag state={state} /></header>
    <p className="card__lead card__lead--protected">{state.worker ? 'Nym worker ready' : state.phase === 'WARMING' ? 'Starting Nym…' : 'Not initialized'}</p>
    <p className="card__sub">Privacy is required for ordinary reads. A network failure blocks the read without a direct fallback.</p>
    {state.worker && <dl className="facts">
      <div><dt>Specifier</dt><dd className="mono live-wrap">{state.worker.specifier}</dd></div>
      <div><dt>Verified bundle hash</dt><dd className="mono live-wrap">{state.worker.workerHash}</dd></div>
      <div><dt>Harness</dt><dd>{state.worker.harnessVersion} · verified by the official harness</dd></div>
      <div><dt>Worker observed</dt><dd>{state.worker.observedAt}</dd></div>
    </dl>}
    <p className="card__note card__note--exposed"><strong>Bootstrap is not anonymous.</strong> Two allowlisted specifier lookups happen before the worker exists. They are disclosed separately and excluded from application-read coverage.</p>
    <p className="card__note">The hosted page and any Cloudflare security bootstrap are ordinary, non-anonymous contacts. They are outside protected RPC coverage.</p>
  </section>;
}

export function LiveLabApp({ observerUrl }: { observerUrl: string }) {
  const { controller, snapshot: state } = useLiveLab(observerUrl);
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const scene = useMemo<StageScene>(() => ({ workerState: state.workerState, hopsReady: state.worker ? 3 : 0,
    passthrough: false, privateMode: true, leakInjected: state.mode === 'leak' && state.reads.some((read) => read.role === 'leak'),
    observerUp: state.correlation?.exactInventory === true }), [state.workerState, state.worker, state.mode, state.reads, state.correlation]);
  const report = state.correlation?.analysis?.report;
  const measured = state.correlation?.sourceComparison === 'confirmed' && report;
  const exportReport = () => {
    const json = controller.exportReport();
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'monolith-measured-report.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <Header section="demo" dataMode="live" />
    <main className="live-lab" data-live-phase={state.phase} data-live-run={state.allocation?.runId}>
      <h1 className="visually-hidden">Monolith live privacy lab</h1>
      <section id="demo" className="hero" aria-label="Live privacy lab">
        <LiveGuide state={state} active={active} onSelect={setActive} onRun={(mode) => void controller.run(mode)} />
        <div className="stage-col">
          <section className="stage-card" aria-label="Illustrative live route stage">
            <Stage scene={scene} flights={[]} reducedMotion={reducedMotion} live onSelect={(target) =>
              document.getElementById(target === 'transport' ? 'transport' : 'registry-title')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })} />
            <p className="hud hud--tl"><span className={`dot dot--state-${state.workerState.toLowerCase()}`} />Nym transport<strong>{state.worker ? 'Worker ready' : state.busy ? 'Starting' : 'Not started'}</strong></p>
            <p className="hud hud--tr">{state.selection?.endpoint.chainName ?? 'Trusted endpoint pending'}</p>
            <p className="hud hud--bl">Illustrative paths · hop count is not measured</p>
            <p className="hud hud--br">{state.observedAt ? 'Recorded live run' : 'Awaiting a run'}</p>
          </section>
          <SourceComparison state={state} />
        </div>
      </section>
      {state.error && <section className="live-error" role="alert"><Icon name="alert" /><div><h2>The run could not be verified.</h2>
        <p>{state.error === 'POLICY_DENIED' && !state.allocation ? 'A required privacy configuration check denied this run.'
          : state.error === 'RATE_LIMITED' ? 'The public lab has reached its request limit. Wait a minute, then start a fresh run.'
            : state.error === 'REGISTRY_EXPIRED' ? 'The registry snapshot expired before this run was accepted. Start a fresh run; stale data is refused.'
              : 'A required network, registry or observer check did not complete. No direct fallback was used.'}</p>
        <p className="mono">{state.error}</p><button className="btn btn--secondary btn--small" disabled={state.busy} onClick={() => void controller.run('private')}>Retry private read</button>
      </div></section>}
      <section id="under-the-hood" className="details" aria-labelledby="details-title"><div className="details__head"><div><h2 id="details-title">The evidence behind this run.</h2>
        <p>Measured receipts, useful reads and explicit limits. Every action starts a fresh bounded run.</p></div>
        <button className="btn btn--secondary btn--small" disabled={!report || state.busy} onClick={exportReport}>Export measured report</button>
      </div><div className="details__grid">
        <LiveChecks state={state} /><Activity state={state} /><WorkerCard state={state} /><RegistryCard state={state} />
        <section className="card" aria-labelledby="coverage-title"><header className="card__head"><h3 id="coverage-title">Protected coverage</h3><EvidenceTag state={state} /></header>
          <p className="card__lead" data-testid="live-coverage">{measured ? `${report.protectedReads}/${report.eligibleReads}` : 'Source comparison not measured'}</p>
          <p className="card__sub">{measured ? `${Math.round((report.protectedCoverage ?? 0) * 100)}% of this run's reads earned protected credit. Explicit direct controls are counted and earn none.`
            : 'A worker result alone does not establish an independent origin comparison. Choose the explicit comparison to measure it.'}</p>
          {report && <p className="card__note">{report.successfulReads}/{report.eligibleReads} useful reads returned. Two bootstrap operations and ordinary public metadata contacts are disclosed outside this denominator.</p>}
          {state.previousLeakReport && state.mode === 'repair' && <p className="card__note">Earlier leaky run: {state.previousLeakReport.protectedReads}/{state.previousLeakReport.eligibleReads} protected, with a direct bypass. The repaired run is independently measured above.</p>}
        </section>
        <section className="card" aria-labelledby="limits-title"><header className="card__head"><h3 id="limits-title">What remains visible</h3></header>
          <p className="card__sub">The RPC endpoint and observer can read the method and synthetic address. Public chain data and transfers stay public.</p>
          <dl className="facts"><div><dt>Observer</dt><dd className="live-wrap">{observerUrl}</dd></div>
            <div><dt>Ordinary contacts</dt><dd>Run allocation, public registry metadata, diagnostics and worker bootstrap.</dd></div>
            <div><dt>Origin trust</dt><dd>The configured observer trusts its reviewed source-reporting edge. Header labels are not evidence.</dd></div>
            <div><dt>Capture scope</dt><dd>Only the fixed synthetic observer workflow. Extensions, unrelated pages and other wallet traffic are not covered.</dd></div>
          </dl>
        </section>
      </div></section>
      <footer className="live-footer"><p>Private by policy. Measured where demonstrated.</p><a href="?mode=simulated#demo">Open the clearly simulated walkthrough</a></footer>
    </main>
  </>;
}
