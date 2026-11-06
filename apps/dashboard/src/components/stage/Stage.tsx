import { useId, useState, type ReactNode, type RefObject } from 'react';
import { Icon, type IconName } from '../Icon.js';
import type { StageFlight, StageInsets, StageScene } from './renderer.js';

export type StageTarget = 'transport' | 'endpoint';

export interface StageProps {
  readonly scene: StageScene;
  /** Retained for callers; examples never play back or infer actual request traffic. */
  readonly flights: readonly StageFlight[];
  readonly reducedMotion: boolean;
  readonly overlays?: ReadonlyArray<RefObject<HTMLElement | null>>;
  readonly plaque?: RefObject<HTMLElement | null>;
  readonly frame?: StageInsets;
  readonly onSelect: (target: StageTarget) => void;
  readonly children?: ReactNode;
  readonly live?: boolean;
}

type ExplanationRoute = 'private' | 'direct';
type StopId = 'app' | 'policy' | 'worker' | 'endpoint';
type ExampleMethod = 'balance' | 'receipt';

interface Stop {
  readonly id: StopId;
  readonly label: string;
  readonly detail: string;
  readonly icon: IconName;
}

const STOPS: Record<StopId, Stop> = {
  app: { id: 'app', label: 'Your app', detail: 'Creates the request', icon: 'bolt' },
  policy: { id: 'policy', label: 'Monolith policy', detail: 'Checks the route', icon: 'shield' },
  worker: { id: 'worker', label: 'Private worker', detail: 'Routes the read', icon: 'lock' },
  endpoint: { id: 'endpoint', label: 'RPC endpoint', detail: 'Reads the payload', icon: 'eye' },
};

const PRIVATE_STOPS: readonly StopId[] = ['app', 'policy', 'worker', 'endpoint'];
const DIRECT_STOPS: readonly StopId[] = ['app', 'endpoint'];

const WORKER_WORDS: Record<StageScene['workerState'], string> = {
  BOOTSTRAPPING: 'Starting',
  READY: 'Ready',
  DEGRADED: 'Degraded',
  BLOCKED: 'Blocked',
  CLOSED: 'Closed',
};

const EXAMPLE_ADDRESS = `0x${'0'.repeat(40)}`;
const EXAMPLE_HASH = `0x${'0'.repeat(64)}`;

function explain(stop: StopId, route: ExplanationRoute, method: ExampleMethod, scene: StageScene) {
  const receipt = method === 'receipt';
  const identifier = receipt ? 'transaction hash' : 'wallet address';
  const rpcMethod = receipt ? 'eth_getTransactionReceipt' : 'eth_getBalance';
  switch (stop) {
    case 'app':
      return {
        title: 'Your app creates the question.',
        body: `A ${receipt ? 'receipt lookup' : 'balance lookup'} includes a ${identifier} in its JSON-RPC request. Routing changes how that request travels; it does not remove its parameters.`,
        facts: [
          ['Request contains', `Method + ${identifier}`],
          ['Next stop', route === 'private' ? 'Monolith checks the privacy policy.' : 'The app connects directly to the endpoint.'],
        ],
        target: 'transport' as const,
      };
    case 'policy':
      return {
        title: 'Check privacy before a read leaves.',
        body: 'When privacy is required, ordinary reads must use a verified private worker and a trusted endpoint. If those checks fail, Monolith blocks the read.',
        facts: [
          ['Required boundary', 'Verified worker + trusted endpoint'],
          ['On failure', 'Blocked, with no direct fallback'],
        ],
        target: 'transport' as const,
      };
    case 'worker':
      return {
        title: 'Change the network path.',
        body: 'The private worker routes the request through its network. The destination still receives the method and parameters. Worker bootstrap is a separate, non-anonymous contact.',
        facts: [
          ['Worker state', scene.passthrough ? 'Passthrough · not anonymized' : WORKER_WORDS[scene.workerState]],
          ['Request body', `${rpcMethod} + ${identifier} remain readable.`],
        ],
        target: 'transport' as const,
      };
    case 'endpoint':
      return {
        title: route === 'private' ? 'The endpoint still sees the question.' : 'A direct endpoint sees more.',
        body: route === 'private'
          ? 'A private route is intended to separate the app’s network source from the read. It does not hide the request body. Verify the source difference with a real comparison.'
          : 'A direct read can associate its network source with the method and supplied identifier. This explanation does not send a direct read.',
        facts: [
          ['Method', `${rpcMethod} is readable.`],
          [receipt ? 'Transaction hash' : 'Wallet address', 'Visible in the request body'],
          ['Network source', route === 'private' ? 'A different origin must be independently verified.' : 'The app’s direct network source'],
        ],
        target: 'endpoint' as const,
      };
  }
}

/** A local, accessible explanation. It never dispatches reads or changes routing policy. */
export function Stage({ scene, onSelect, children }: StageProps) {
  const [route, setRoute] = useState<ExplanationRoute>('private');
  const [selected, setSelected] = useState<StopId>('endpoint');
  const [method, setMethod] = useState<ExampleMethod>('balance');
  const instance = useId();
  const titleId = `${instance}-title`;
  const disclosureId = `${instance}-disclosure`;
  const inspectorId = `${instance}-inspector`;
  const methodId = `${instance}-method`;
  const methodNoteId = `${instance}-method-note`;
  const stops = route === 'private' ? PRIVATE_STOPS : DIRECT_STOPS;
  const index = Math.max(0, stops.indexOf(selected));
  const explanation = explain(selected, route, method, scene);
  const rpcMethod = method === 'receipt' ? 'eth_getTransactionReceipt' : 'eth_getBalance';

  const selectRoute = (next: ExplanationRoute) => {
    setRoute(next);
    if (next === 'direct' && selected !== 'app' && selected !== 'endpoint') setSelected('endpoint');
  };

  return (
    <section className="request-explorer" data-route={route} aria-labelledby={titleId} aria-describedby={disclosureId}>
      <header className="request-explorer__head">
        <div>
          <h2 id={titleId}>Follow a request</h2>
          <p>Select a route, then a stop. See what changes and what stays visible.</p>
        </div>
        <p id={disclosureId} className="request-explorer__disclosure"><Icon name="info" size={16} />Example only · no requests sent</p>
      </header>

      <div className="request-explorer__routes" role="group" aria-label="Route explanations">
        <button type="button" className="request-explorer__route" aria-pressed={route === 'private'} onClick={() => selectRoute('private')}>
          <Icon name="shield" size={18} /><span>Private path</span>
        </button>
        <button type="button" className="request-explorer__route" aria-pressed={route === 'direct'} onClick={() => selectRoute('direct')}>
          <Icon name="eye" size={18} /><span>Direct path</span>
        </button>
      </div>

      <div className="request-explorer__map-wrap">
        <ol className="request-explorer__map" aria-label={`${route === 'private' ? 'Private' : 'Direct'} route, example only`}>
          {stops.map((stopId, stopIndex) => {
            const stop = STOPS[stopId];
            return <li className="request-explorer__map-item" key={stopId}>
              <button type="button" className="request-explorer__stop" data-stop={stopId} data-selected={selected === stopId}
                aria-pressed={selected === stopId} aria-controls={inspectorId} onClick={() => setSelected(stopId)}>
                <span className="request-explorer__stop-icon"><Icon name={stop.icon} size={22} /></span>
                <span className="request-explorer__stop-name">{stop.label}</span>
                <span className="request-explorer__stop-detail">{stop.detail}</span>
              </button>
              {stopIndex < stops.length - 1 && <span className="request-explorer__connector" aria-hidden="true"><Icon name="arrow-right" size={20} /></span>}
            </li>;
          })}
        </ol>
        <p className="request-explorer__map-note">{route === 'private'
          ? 'The policy requires a verified worker. Its network hops are not shown here.'
          : 'The direct route skips the private worker. Selecting it here only changes this explanation.'}</p>
      </div>

      <section id={inspectorId} className="request-explorer__inspector" aria-label="Selected stop explanation">
        <div className="request-explorer__inspector-copy" aria-live="polite" aria-atomic="true">
          <div className="request-explorer__inspector-heading"><Icon name={STOPS[selected].icon} size={20} /><h3>{explanation.title}</h3></div>
          <p className="request-explorer__body">{explanation.body}</p>
          <dl className="request-explorer__facts">{explanation.facts.map(([label, detail]) =>
            <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
        </div>
      </section>

      <div className="request-explorer__example">
        <div className="request-explorer__example-control"><label htmlFor={methodId}>Example request</label>
          <select id={methodId} value={method} aria-describedby={methodNoteId} onChange={(event) => setMethod(event.target.value as ExampleMethod)}>
            <option value="balance">Balance lookup</option><option value="receipt">Receipt lookup</option>
          </select>
        </div>
        <p id={methodNoteId} className="request-explorer__note">Changing the example sends nothing.</p>
        <details className="request-explorer__fields">
          <summary><span>Show example fields</span><Icon name="arrow-down" size={17} /></summary>
          <div className="request-explorer__fields-body">
            <p>These zeroed values are examples, never sent.</p>
            <dl className="request-explorer__field-list">
              <div><dt>Method</dt><dd><code>{rpcMethod}</code></dd></div>
              <div><dt>{method === 'receipt' ? 'Transaction hash' : 'Wallet address'}</dt><dd><code>{method === 'receipt' ? EXAMPLE_HASH : EXAMPLE_ADDRESS}</code></dd></div>
              {method === 'balance' && <div><dt>Block tag</dt><dd><code>latest</code></dd></div>}
            </dl>
          </div>
        </details>
      </div>

      <footer className="request-explorer__footer">
        <div className="request-explorer__step-nav" role="group" aria-label="Move between example stops">
          <button type="button" className="request-explorer__previous" disabled={index === 0} onClick={() => setSelected(stops[index - 1] ?? 'app')}>Previous stop</button>
          <span className="request-explorer__step-position">{index + 1} of {stops.length}</span>
          <button type="button" className="request-explorer__next" disabled={index === stops.length - 1} onClick={() => setSelected(stops[index + 1] ?? 'endpoint')}>Next stop<Icon name="arrow-right" size={16} /></button>
        </div>
        <a className="request-explorer__results-link" href="#route-results">See run results<Icon name="arrow-down" size={16} /></a>
        <button type="button" className="request-explorer__details-link" onClick={() => onSelect(explanation.target)}>
          {explanation.target === 'transport' ? 'View transport details' : 'View endpoint details'}<Icon name="arrow-down" size={16} />
        </button>
      </footer>
      {children}
    </section>
  );
}
