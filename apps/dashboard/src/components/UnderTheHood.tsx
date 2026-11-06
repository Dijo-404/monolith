import { useId, type Ref } from 'react';
import { SCENARIOS } from '../app/lab-fixtures.js';
import type { CheckView, LabState, ReadRow, ScenarioId } from '../app/lab-model.js';
import { tallyRun } from '../app/lab-reducer.js';
import { useCoarseNow } from '../app/use-lab.js';
import { relativeMinutes, seconds, shortHex } from './format.js';
import { Icon, type IconName } from './Icon.js';
import { Switch } from './Switch.js';
import { SimulatedTag, Tag } from './Tag.js';

export interface UnderTheHoodProps {
  readonly state: LabState;
  readonly checks: readonly CheckView[];
  readonly observerUrl: string;
  readonly transportRef?: Ref<HTMLElement>;
  readonly onScenario: (scenario: ScenarioId) => void;
  readonly onPrivateMode: (on: boolean) => void;
  readonly onLeak: (on: boolean) => void;
  readonly onDirect: () => void;
  readonly onRetry: () => void;
  readonly onNewRun: () => void;
}

const CHECK_ICON: Record<CheckView['status'], IconName> = { pass: 'check', fail: 'cross', 'not-run': 'dash' };
const CHECK_WORD: Record<CheckView['status'], string> = { pass: 'Passed', fail: 'Failed', 'not-run': 'Not run' };

function ChecksCard({ checks }: { readonly checks: readonly CheckView[] }) {
  const passed = checks.filter((check) => check.status === 'pass').length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  return (
    <section className="card" aria-labelledby="checks-title">
      <header className="card__head">
        <h3 id="checks-title">Privacy checks</h3>
        <SimulatedTag />
      </header>
      <p className="summary-line">
        {passed} of {checks.length} passing{failed > 0 ? ` · ${failed} failing` : ''}
      </p>
      <ul className="checks">
        {checks.map((check) => (
          <li key={check.id} className={`check check--${check.status}`}>
            <span className="check__icon" aria-hidden="true">
              <Icon name={CHECK_ICON[check.status]} size={14} />
            </span>
            <span>
              <span className="check__title">
                {check.title}
                <span className="check__id mono">{check.id}</span>
              </span>
              <span className="visually-hidden"> {CHECK_WORD[check.status]}.</span>
              <span className="check__detail">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function routeTag(read: ReadRow) {
  if (read.bypass) return <Tag tone="exposed">Bypass</Tag>;
  if (read.route === 'anon-tor' || read.route === 'anon-nym') return <Tag tone="protected">Anon-RPC</Tag>;
  if (read.route === 'blocked') return <Tag>Blocked</Tag>;
  if (read.route === 'passthrough') return <Tag>Passthrough</Tag>;
  return <Tag tone="exposed">{read.kind === 'direct-comparison' ? 'Direct control' : 'Direct'}</Tag>;
}

function outcome(read: ReadRow): string {
  switch (read.outcome) {
    case 'in-flight':
      return 'On its way…';
    case 'arrived':
      return read.durationMs === null ? 'Arrived' : `${read.durationMs} ms`;
    case 'blocked':
      return `Blocked · ${read.errorCode ?? ''}`;
    case 'failed':
      return `Failed · ${read.errorCode ?? ''}`;
  }
}

function ActivityCard({ reads, onNewRun }: { readonly reads: readonly ReadRow[]; readonly onNewRun: () => void }) {
  const first = reads[0]?.requestedAt ?? 0;
  return (
    <section className="card card--wide" aria-labelledby="activity-title">
      <header className="card__head">
        <h3 id="activity-title">Activity</h3>
        <SimulatedTag />
        <button type="button" className="btn btn--secondary btn--small" onClick={onNewRun} disabled={reads.length === 0}>
          <Icon name="reset" size={16} />
          New run
        </button>
      </header>
      {reads.length === 0 ? (
        <p className="empty">No reads in this run yet. The guided demo above sends the first one.</p>
      ) : (
        <ol className="activity" aria-label="Reads in this run">
          {reads.map((read) => (
            <li key={read.id} className={`activity__row is-${read.outcome}${read.bypass ? ' is-bypass' : ''}`}>
              <span className="activity__time mono">+{seconds(read.requestedAt + read.startDelayMs - first)}</span>
              {routeTag(read)}
              <span className="activity__method mono">{read.method}</span>
              <span className="activity__callsite mono">{read.callsite}</span>
              <span className="activity__outcome">{outcome(read)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const WORKER_WORDS: Record<LabState['worker']['state'], string> = {
  BOOTSTRAPPING: 'Starting',
  READY: 'Ready',
  DEGRADED: 'Degraded',
  BLOCKED: 'Offline',
  CLOSED: 'Closed',
};

function TransportCard({
  state,
  onRetry,
  ref,
}: {
  readonly state: LabState;
  readonly onRetry: () => void;
  readonly ref?: Ref<HTMLElement> | undefined;
}) {
  const { worker } = state;
  const passthrough = worker.network === 'Passthrough';
  const offline = worker.state === 'BLOCKED' || worker.state === 'CLOSED';
  const leadTone = passthrough || offline ? 'card__lead--blocked' : 'card__lead--protected';
  return (
    <section ref={ref} id="transport" className="card" aria-labelledby="transport-title" data-focused={state.focus === 'transport'}>
      <header className="card__head">
        <h3 id="transport-title">Transport</h3>
        <SimulatedTag />
      </header>
      <p className={`card__lead ${leadTone}`}>{passthrough ? 'Not anonymized' : WORKER_WORDS[worker.state]}</p>
      <p className="card__sub">
        {worker.network} worker{passthrough ? '' : ` · ${worker.hopsReady} of 3 relays ready`}
      </p>
      <ol className="lifecycle" aria-label="Worker lifecycle">
        {(['BOOTSTRAPPING', 'READY', 'DEGRADED', 'BLOCKED', 'CLOSED'] as const).map((name) => (
          <li key={name} aria-current={name === worker.state ? 'step' : undefined}>
            {WORKER_WORDS[name]}
          </li>
        ))}
      </ol>
      {worker.note !== null && <p className="card__note">{worker.note}</p>}
      {offline && (
        <div className="card__actions">
          <button type="button" className="btn btn--secondary btn--small" onClick={onRetry}>
            <Icon name="retry" size={16} />
            Retry the worker
          </button>
        </div>
      )}
      <dl className="facts">
        <div>
          <dt>Specifier</dt>
          <dd className="mono" title={worker.specifier}>
            {shortHex(worker.specifier, 8, 6)}
          </dd>
        </div>
        <div>
          <dt>Bundle hash</dt>
          <dd>Not verified in this build</dd>
        </div>
        <div>
          <dt>Privacy required</dt>
          <dd>{state.privateMode ? 'Yes. Reads use the worker or are blocked.' : 'No. Reads go straight to the endpoint.'}</dd>
        </div>
      </dl>
      <p className="card__note card__note--exposed">
        <strong>The bootstrap lookup is not anonymous.</strong> The worker's specifier is read before the worker exists. Monolith reports it on its own and never counts it as a protected read.
      </p>
    </section>
  );
}

function probeCopy(probe: LabState['registry']['chainProbe'], chainId: string): string {
  switch (probe) {
    case 'not-run':
      return 'Not run yet';
    case 'pending':
      return 'Checking through the worker…';
    case 'match':
      return `Returned ${chainId}, as expected`;
    case 'rejected':
      return 'Mismatch. Endpoint rejected.';
  }
}

function RegistryCard({ state }: { readonly state: LabState }) {
  const now = useCoarseNow();
  const { registry } = state;
  const { endpoint } = registry;
  const fresh = registry.status === 'fresh';
  return (
    <section className="card" aria-labelledby="registry-title">
      <header className="card__head">
        <h3 id="registry-title">Endpoint registry</h3>
        <SimulatedTag />
      </header>
      <p className={`card__lead ${fresh ? 'card__lead--protected' : 'card__lead--blocked'}`}>{fresh ? 'Fresh' : 'Expired'}</p>
      <p className="card__sub">
        Arkiv snapshot {registry.revision} · {fresh ? 'expires' : 'expired'} {relativeMinutes(registry.expiresAt, now)}
      </p>
      {!fresh && <p className="card__note">The endpoint is refused. Stale registry data never picks a route.</p>}
      <dl className="facts">
        <div>
          <dt>Endpoint</dt>
          <dd>
            {endpoint.chainName} · <span className="mono">{endpoint.chainId}</span>
            <span className="facts__sub mono">{endpoint.rpcOrigin.replace(/^https:\/\//, '')}</span>
          </dd>
        </div>
        <div>
          <dt>Chain-ID check</dt>
          <dd>{probeCopy(registry.chainProbe, endpoint.chainId)}</dd>
        </div>
        <div>
          <dt>Arkiv entity</dt>
          <dd>
            <span className="mono" title={endpoint.entityKey}>{shortHex(endpoint.entityKey)}</span>
            <span className="facts__sub">
              by <span className="mono" title={endpoint.publisher.creator}>{shortHex(endpoint.publisher.creator)}</span> · {endpoint.schema}
            </span>
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {endpoint.source.repository.replace(/^github\.com\//, '')} · {endpoint.source.license}
            <span className="facts__sub">
              rev <span className="mono">{endpoint.source.revision}</span>
            </span>
          </dd>
        </div>
      </dl>
      <p className="card__note">
        Trust comes from the publisher, the expiry, the HTTPS origin and a live <code>eth_chainId</code> check. A schema tag alone proves nothing.
      </p>
    </section>
  );
}

type ControlsProps = Pick<UnderTheHoodProps, 'state' | 'onScenario' | 'onPrivateMode' | 'onLeak' | 'onDirect'>;

function ControlsCard(props: ControlsProps) {
  const { state } = props;
  const ids = { scenario: useId(), privateMode: useId(), privateHelp: useId(), leak: useId(), leakHelp: useId() };
  const summary = SCENARIOS.find((item) => item.id === state.scenario)?.summary ?? '';
  return (
    <section className="card" aria-labelledby="controls-title">
      <header className="card__head">
        <h3 id="controls-title">Lab controls</h3>
      </header>
      <div className="control-list">
        <div className="control">
          <div className="control__text">
            <label className="control__label" htmlFor={ids.scenario}>
              Scenario
            </label>
            <p className="control__help">{summary}</p>
          </div>
          <select
            id={ids.scenario}
            className="select"
            value={state.scenario}
            onChange={(event) => props.onScenario(event.target.value as ScenarioId)}
          >
            {SCENARIOS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="control">
          <div className="control__text">
            <p id={ids.privateMode} className="control__label">
              Private mode
            </p>
            <p id={ids.privateHelp} className="control__help">
              Every read uses the worker or is blocked.
            </p>
          </div>
          <Switch checked={state.privateMode} onChange={props.onPrivateMode} labelledBy={ids.privateMode} describedBy={ids.privateHelp} />
        </div>
        <div className="control">
          <div className="control__text">
            <p id={ids.leak} className="control__label">
              Leaky checkout widget
            </p>
            <p id={ids.leakHelp} className="control__help">
              A sandbox widget that calls the RPC directly.
            </p>
          </div>
          <Switch checked={state.leakInjected} onChange={props.onLeak} labelledBy={ids.leak} describedBy={ids.leakHelp} tone="exposed" />
        </div>
        <div className="control">
          <div className="control__text">
            <p className="control__label">Direct comparison</p>
            <p className="control__help">Sends one read that shows the endpoint your network origin.</p>
          </div>
          <button type="button" className="btn btn--secondary btn--small" onClick={props.onDirect}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

function CoverageCard({ reads }: { readonly reads: readonly ReadRow[] }) {
  const tally = tallyRun(reads);
  return (
    <section className="card" aria-labelledby="coverage-title">
      <header className="card__head">
        <h3 id="coverage-title">Protected coverage</h3>
      </header>
      <p className="card__lead card__lead--muted">Not measured yet</p>
      <p className="card__sub">
        Coverage comes from a measured run by the privacy analyzer, never from fixture data. This simulated run sent {tally.eligible}{' '}
        privacy-required {tally.eligible === 1 ? 'read' : 'reads'}: {tally.viaWorker} through the worker, {tally.blocked} blocked, {tally.bypassed}{' '}
        bypassed.
      </p>
    </section>
  );
}

function CheckoutCard() {
  return (
    <section className="card" aria-labelledby="checkout-title">
      <header className="card__head">
        <h3 id="checkout-title">Whitechain checkout</h3>
        <Tag>Not enabled</Tag>
      </header>
      <p className="card__lead card__lead--muted">Coming later</p>
      <p className="card__sub">
        A gasless test-USDT checkout is planned once its preflight passes. No payment has been made. Onchain transfers stay public; Anon-RPC does not hide
        them.
      </p>
      <div className="card__actions">
        <button type="button" className="btn btn--secondary btn--small" disabled>
          Pay 1 test-USDT
        </button>
      </div>
    </section>
  );
}

function SourcesCard({ observerUrl }: { readonly observerUrl: string }) {
  const rows: Array<[string, string]> = [
    ['Anon-RPC worker', 'Simulated'],
    ['RPC observer', `Not contacted · ${observerUrl.replace(/^https?:\/\//, '')}`],
    ['Arkiv registry', 'Fixture snapshot'],
    ['Whitechain', 'Not enabled'],
  ];
  return (
    <section className="card" aria-labelledby="sources-title">
      <header className="card__head">
        <h3 id="sources-title">What is real here</h3>
      </header>
      <p className="card__sub">Nothing on this page was observed on a network yet. Each source switches to live data as it is connected.</p>
      <dl className="facts">
        {rows.map(([name, status]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{status}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function UnderTheHood({
  state,
  checks,
  observerUrl,
  transportRef,
  onScenario,
  onPrivateMode,
  onLeak,
  onDirect,
  onRetry,
  onNewRun,
}: UnderTheHoodProps) {
  return (
    <section id="under-the-hood" className="details" aria-labelledby="details-title">
      <div className="details__head">
        <div>
          <h2 id="details-title">Under the hood</h2>
          <p>The checks, reads, worker and registry behind the demo, with every control in one place.</p>
        </div>
      </div>
      <div className="details__grid">
        <ChecksCard checks={checks} />
        <ActivityCard reads={state.reads} onNewRun={onNewRun} />
        <TransportCard state={state} onRetry={onRetry} ref={transportRef} />
        <RegistryCard state={state} />
        <ControlsCard state={state} onScenario={onScenario} onPrivateMode={onPrivateMode} onLeak={onLeak} onDirect={onDirect} />
        <CoverageCard reads={state.reads} />
        <CheckoutCard />
        <SourcesCard observerUrl={observerUrl} />
      </div>
    </section>
  );
}
