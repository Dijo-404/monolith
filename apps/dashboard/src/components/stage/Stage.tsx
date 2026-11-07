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
  app: { id: 'app', label: 'Your app', detail: 'Builds the request', icon: 'app' },
  policy: { id: 'policy', label: 'Monolith policy', detail: 'Admits or blocks it', icon: 'gate' },
  worker: { id: 'worker', label: 'Private worker', detail: 'Changes the path', icon: 'mix' },
  endpoint: { id: 'endpoint', label: 'RPC endpoint', detail: 'Reads the payload', icon: 'node' },
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
        body: `A ${receipt ? 'receipt lookup' : 'balance lookup'} puts a ${identifier} inside its JSON-RPC request. Routing changes how the request travels; it never removes its parameters.`,
        facts: [
          ['Request contains', `Method + ${identifier}`],
          ['Next stop', route === 'private' ? 'Monolith checks the privacy policy.' : 'The app connects straight to the endpoint.'],
        ],
        target: 'transport' as const,
      };
    case 'policy':
      return {
        title: 'Check privacy before a read leaves.',
        body: 'When privacy is required, ordinary reads must use a verified private worker and a trusted endpoint. If either check fails, Monolith blocks the read.',
        facts: [
          ['Required boundary', 'Verified worker + trusted endpoint'],
          ['On failure', 'Blocked, with no direct fallback'],
        ],
        target: 'transport' as const,
      };
    case 'worker':
      return {
        title: 'Change the network path.',
        body: 'The private worker carries the request through its network. The destination still receives the method and parameters. Starting the worker is a separate, non-anonymous lookup.',
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
          ? 'A private route is meant to separate your app’s network source from the read. It does not hide the request body. Confirm the source difference with a real comparison.'
          : 'A direct read lets the endpoint link your network source to the method and the identifier. This explanation does not send a direct read.',
        facts: [
          ['Method', `${rpcMethod} is readable.`],
          [receipt ? 'Transaction hash' : 'Wallet address', 'Visible in the request body'],
          ['Network source', route === 'private' ? 'A different origin must be independently verified.' : 'Your app’s direct network source'],
        ],
        target: 'endpoint' as const,
      };
  }
}

/** The example JSON-RPC body, with the parts the endpoint can read marked. Zeroed; never sent. */
function Packet({ method }: { readonly method: ExampleMethod }) {
  const receipt = method === 'receipt';
  return <pre className="packet" aria-label="Example request body, never sent">
    <span className="packet__punct">{'{ '}</span><span className="packet__key">"method"</span>
    <span className="packet__punct">: </span><mark className="packet__seen">"{receipt ? 'eth_getTransactionReceipt' : 'eth_getBalance'}"</mark>
    <span className="packet__punct">,{'\n  '}</span><span className="packet__key">"params"</span><span className="packet__punct">: [</span>
    <mark className="packet__seen">"{receipt ? EXAMPLE_HASH : EXAMPLE_ADDRESS}"</mark>
    {!receipt && <><span className="packet__punct">, </span><span className="packet__value">"latest"</span></>}
    <span className="packet__punct">{'] }'}</span>
  </pre>;
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
  const stops = route === 'private' ? PRIVATE_STOPS : DIRECT_STOPS;
  const index = Math.max(0, stops.indexOf(selected));
  const explanation = explain(selected, route, method, scene);

  const selectRoute = (next: ExplanationRoute) => {
    setRoute(next);
    if (next === 'direct' && selected !== 'app' && selected !== 'endpoint') setSelected('endpoint');
  };

  return (
    <section className="request-explorer" data-route={route} aria-labelledby={titleId} aria-describedby={disclosureId}>
      <header className="request-explorer__head">
        <p className="fig-label">Fig. 1 <span aria-hidden="true">—</span> Request route</p>
        <div className="request-explorer__title-row">
          <h2 id={titleId}>Follow a request</h2>
          <p id={disclosureId} className="example-chip">Example only · nothing is sent</p>
        </div>
        <p className="request-explorer__lede">Pick a route, then a stop. See what changes and what stays readable.</p>
      </header>

      <div className="segmented" role="group" aria-label="Route explanations">
        <button type="button" className="segmented__option" data-tone="protected" aria-pressed={route === 'private'} onClick={() => selectRoute('private')}>
          <Icon name="mix" size={16} /><span>Private route</span>
        </button>
        <button type="button" className="segmented__option" data-tone="exposed" aria-pressed={route === 'direct'} onClick={() => selectRoute('direct')}>
          <Icon name="arrow-right" size={16} /><span>Direct route</span>
        </button>
      </div>

      <ol className="trace" data-count={stops.length} aria-label={`${route === 'private' ? 'Private' : 'Direct'} route, example only`}>
        {stops.map((stopId, stopIndex) => {
          const stop = STOPS[stopId];
          return <li className="trace__item" key={stopId}>
            <button type="button" className="trace__stop" data-stop={stopId} data-selected={selected === stopId}
              aria-pressed={selected === stopId} aria-controls={inspectorId} onClick={() => setSelected(stopId)}>
              <span className="trace__index mono" aria-hidden="true">{String(stopIndex + 1).padStart(2, '0')}</span>
              <span className="trace__node"><Icon name={stop.icon} size={26} /></span>
              <span className="trace__name">{stop.label}</span>
              <span className="trace__detail">{stop.detail}</span>
            </button>
          </li>;
        })}
      </ol>
      <p className="request-explorer__map-note">{route === 'private'
        ? 'The policy requires a verified worker. Its internal network hops are not drawn.'
        : 'The direct route skips the worker. Choosing it here only changes this explanation.'}</p>

      <div id={inspectorId} className="request-explorer__inspector" aria-label="Selected stop explanation">
        <div className="request-explorer__inspector-copy" aria-live="polite" aria-atomic="true">
          <p className="request-explorer__stop-tag mono">Stop {String(index + 1).padStart(2, '0')} · {STOPS[selected].label}</p>
          <h3>{explanation.title}</h3>
          <p className="request-explorer__body">{explanation.body}</p>
        </div>
        <dl className="ledger" aria-label="What is true at this stop">{explanation.facts.map(([label, detail]) =>
          <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
      </div>

      <div className="request-explorer__payload">
        <div className="request-explorer__payload-head">
          <label htmlFor={methodId} className="fig-label">Example body</label>
          <select id={methodId} className="select select--compact" value={method} onChange={(event) => setMethod(event.target.value as ExampleMethod)}>
            <option value="balance">Balance lookup</option><option value="receipt">Receipt lookup</option>
          </select>
        </div>
        <Packet method={method} />
        <p className="packet-legend"><mark className="packet__seen">marked</mark> Readable by the endpoint on either route. Zeroed example values; changing the example sends nothing.</p>
      </div>

      <footer className="request-explorer__footer">
        <div className="stepper" role="group" aria-label="Move between example stops">
          <button type="button" className="stepper__button" disabled={index === 0} onClick={() => setSelected(stops[index - 1] ?? 'app')}>
            <span className="stepper__arrow" aria-hidden="true"><Icon name="arrow-right" size={14} /></span>Previous stop
          </button>
          <span className="stepper__position mono">{index + 1}/{stops.length}</span>
          <button type="button" className="stepper__button" disabled={index === stops.length - 1} onClick={() => setSelected(stops[index + 1] ?? 'endpoint')}>
            Next stop<Icon name="arrow-right" size={14} />
          </button>
        </div>
        <div className="request-explorer__links">
          <a className="text-link" href="#route-results">See run results<Icon name="arrow-down" size={14} /></a>
          <button type="button" className="text-link" onClick={() => onSelect(explanation.target)}>
            {explanation.target === 'transport' ? 'Transport details' : 'Endpoint details'}<Icon name="arrow-down" size={14} />
          </button>
        </div>
      </footer>
      {children}
    </section>
  );
}
