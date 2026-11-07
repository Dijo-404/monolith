import { useEffect, useRef, useState } from 'react';
import { WalletButton } from '../features/wallet/WalletButton.js';
import { Icon, Mark } from './Icon.js';

export type Page = 'lab' | 'docs';

export function Header({ section, dataMode = 'simulated', page = 'lab' }: {
  readonly section: 'demo' | 'details';
  readonly dataMode?: 'simulated' | 'live';
  readonly page?: Page;
}) {
  const [visibleSection, setVisibleSection] = useState(section);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const details = document.getElementById('under-the-hood');
        setVisibleSection(details !== null && details.getBoundingClientRect().top <= window.innerHeight * 0.45
          ? 'details' : 'demo');
      });
    };
    const measureHeader = () => {
      const header = headerRef.current;
      if (header !== null) {
        document.documentElement.style.setProperty('--lab-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
      }
      update();
    };
    const resize = new ResizeObserver(measureHeader);
    if (headerRef.current !== null) resize.observe(headerRef.current);
    measureHeader();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.documentElement.style.removeProperty('--lab-header-height');
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const lab = page === 'lab';
  const labBase = dataMode === 'simulated' && lab ? '?mode=simulated' : './';
  const current = (name: 'demo' | 'details' | 'docs') =>
    (name === 'docs' ? !lab : lab && visibleSection === name) ? (lab ? 'location' : 'page') : undefined;

  return (
    <>
    <a className="skip-link" href={lab ? '#demo' : '#docs-content'}>{lab ? 'Skip to the lab' : 'Skip to the documentation'}</a>
    <header ref={headerRef} className="site-header">
      <a className="brand" href={lab ? '#demo' : './'}>
        <Mark />
        <span className="brand__name">Monolith</span>
        <span className="brand__product mono">{lab ? 'Leak Lab' : 'Docs'}</span>
      </a>
      <nav className="site-nav" aria-label="Primary">
        <a href={lab ? '#demo' : `${labBase}#demo`} aria-current={current('demo')}>Lab</a>
        <a href={lab ? '#under-the-hood' : `${labBase}#under-the-hood`} aria-current={current('details')}>Evidence</a>
        <a href="?page=docs" aria-current={current('docs')}>Docs</a>
      </nav>
      <div className="header-tools">
        {lab && <>
          <p className="mode-badge" data-mode={dataMode} title={dataMode === 'live'
            ? 'Real network reads, independent observer receipts and explicit fail-closed errors. No success is assumed.'
            : 'This walkthrough uses local fixture data. Its results are simulated and no blockchain reads are sent.'}>
            <span className={`dot dot--${dataMode === 'live' ? 'protected' : 'sim'}`} aria-hidden="true" />
            {dataMode === 'live' ? 'Live network' : 'Simulated data'}
          </p>
          <a className="mode-switch" href={dataMode === 'live' ? '?mode=simulated#demo' : './#demo'}
            aria-label={dataMode === 'live' ? 'Try the simulated lab offline, without blockchain reads' : 'Switch to the live network lab'}>
            {dataMode === 'live' ? 'Try offline' : 'Go live'}<Icon name="arrow-right" size={14} />
          </a>
        </>}
        <WalletButton />
      </div>
    </header>
    {lab && <div className="lab-intro">
      <p className="lab-intro__meta mono">
        <span>Privacy crash-test</span><span aria-hidden="true">/</span>
        <span>{dataMode === 'live' ? 'Live network report' : 'Simulated report'}</span>
      </p>
      <p className="lab-intro__title">Find the leak. <span>Prove the fix.</span></p>
      <p className="lab-intro__body">A hands-on privacy lab for blockchain reads. Follow the route, catch a bypass, and see exactly what the endpoint learns.</p>
      <dl className="lab-intro__spec" aria-label="How this lab behaves">
        <div><dt>Mode</dt><dd>{dataMode === 'live' ? 'Live network' : 'Offline fixtures'}</dd></div>
        <div><dt>Reads sent</dt><dd>{dataMode === 'live' ? 'Only when you run a step' : 'None, every result is simulated'}</dd></div>
        <div><dt>Wallet</dt><dd>Optional, never used for lab reads</dd></div>
      </dl>
    </div>}
    </>
  );
}
