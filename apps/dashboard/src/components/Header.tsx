import { Mark } from './Icon.js';

export function Header({ section, dataMode = 'simulated' }: {
  readonly section: 'demo' | 'details'; readonly dataMode?: 'simulated' | 'live';
}) {
  return (
    <header className="site-header">
      <a className="brand" href="#demo">
        <Mark />
        <span className="brand__name">Monolith</span>
        <span className="brand__product">Leak Lab</span>
      </a>
      <nav className="pill-nav" aria-label="Sections">
        <a href="#demo" aria-current={section === 'demo'}>
          Demo
        </a>
        <a href="#under-the-hood" aria-current={section === 'details'}>
          Under the hood
        </a>
      </nav>
      <p className="sim-pill" title={dataMode === 'live'
        ? 'Real network reads, independent observer receipts and explicit fail-closed errors. No success is assumed.'
        : 'Nothing on this page comes from a live network. It uses fixture data until the transport, observer and registry are connected.'}>
        <span className={`dot dot--${dataMode === 'live' ? 'protected' : 'sim'}`} aria-hidden="true" />
        {dataMode === 'live' ? 'Live lab' : 'Simulated data'}
      </p>
    </header>
  );
}
