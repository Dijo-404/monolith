import { Icon } from './Icon.js';

/** Safe metadata from the selected read; never renders raw RPC parameters. */
export function ReadInspector({ method, route, evidence, outcome, durationMs, readId, callsite }: {
  readonly method: string;
  readonly route: string;
  readonly evidence: string;
  readonly outcome: string;
  readonly durationMs: number | null;
  readonly readId: string;
  readonly callsite?: string | undefined;
}) {
  return <details className="read-inspector">
    <summary>Inspect read <Icon name="arrow-down" size={16} /></summary>
    <dl>
      <div><dt>Method</dt><dd className="mono">{method}</dd></div>
      <div><dt>Route</dt><dd>{route}</dd></div>
      <div><dt>Evidence</dt><dd>{evidence}</dd></div>
      <div><dt>Outcome</dt><dd>{outcome}</dd></div>
      <div><dt>Round trip</dt><dd>{durationMs === null ? 'Pending' : `${Math.round(durationMs).toLocaleString()} ms`}</dd></div>
      {callsite && <div><dt>Callsite</dt><dd className="mono">{callsite}</dd></div>}
      <div><dt>Read ID</dt><dd className="mono">{readId}</dd></div>
    </dl>
  </details>;
}
