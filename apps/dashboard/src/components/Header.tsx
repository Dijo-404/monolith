import { Mark } from './Icon.js';

export function Header({ section }: { readonly section: 'demo' | 'details' }) {
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
      <p className="sim-pill" title="Nothing on this page comes from a live network. It uses fixture data until the transport, observer and registry are connected.">
        <span className="dot dot--sim" aria-hidden="true" />
        Simulated data
      </p>
    </header>
  );
}
