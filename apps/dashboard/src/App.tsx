import type { PublicConfig } from './config/public-env.js';

export function App({ observerUrl }: PublicConfig) {
  return (
    <main className="workspace">
      <header>
        <p className="eyebrow">Monolith</p>
        <h1>The privacy crash-test lab for Web3 checkout.</h1>
        <p className="intro">
          The workspace foundation is ready. The privacy lab is the next step.
        </p>
      </header>

      <section aria-labelledby="status-heading" className="status-panel">
        <p className="status-label">Workspace scaffold</p>
        <h2 id="status-heading">No live integration is connected.</h2>
        <p>
          This build provides the dashboard and observer scaffolds. It has not run a privacy
          test, imported an Arkiv dataset, or settled a payment.
        </p>
        <dl>
          <div>
            <dt>Anon-RPC routing</dt>
            <dd>Not implemented</dd>
          </div>
          <div>
            <dt>Arkiv registry</dt>
            <dd>Not implemented</dd>
          </div>
          <div>
            <dt>Whitechain checkout</dt>
            <dd>Conditional · not enabled</dd>
          </div>
        </dl>
      </section>

      <footer>
        <p>
          Configured observer origin: <code>{observerUrl}</code>
        </p>
        <p>No network requests or blockchain reads are made by this scaffold.</p>
      </footer>
    </main>
  );
}
