import type { ReadRow } from '../app/lab-model.js';

function RouteCard({
  route,
  read,
  empty,
}: {
  readonly route: 'direct' | 'anon';
  readonly read: ReadRow | null;
  readonly empty: string;
}) {
  const name = route === 'direct' ? 'Direct route' : 'Through Anon-RPC';
  return (
    <article className={`route-card route-card--${route}${read === null ? ' is-empty' : ''}`} aria-live="polite">
      <header className="route-card__head">
        <span className={`dot dot--${route === 'direct' ? 'exposed' : 'protected'}`} aria-hidden="true" />
        {name}
      </header>
      <p className="route-card__label">The endpoint saw a request from</p>
      <p className="route-card__value">
        {read === null ? 'Not sent yet' : read.originSeen === 'your-network' ? 'Your network' : 'An exit relay'}
      </p>
      <p className="route-card__meta">
        {read === null ? (
          empty
        ) : (
          <>
            <span className="mono">{read.method}</span>
            {read.addressInPayload && (
              <>
                {' · '}
                <span className="readable">address readable</span>
              </>
            )}
            {read.method === 'eth_getTransactionReceipt' && <> · transaction hash readable</>}
            {read.bypass && <> · bypassed the transport</>}
          </>
        )}
      </p>
    </article>
  );
}

/** The one comparison the lab exists to show: same request, different origin. */
export function Comparison({ direct, anon }: { readonly direct: ReadRow | null; readonly anon: ReadRow | null }) {
  return (
    <div className="compare" aria-label="What the RPC endpoint saw">
      <RouteCard route="direct" read={direct} empty="Step 1 sends one." />
      <RouteCard route="anon" read={anon} empty="Step 2 sends one." />
    </div>
  );
}
