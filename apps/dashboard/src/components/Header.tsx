import { useEffect, useRef, useState } from 'react';
import { Icon, Mark } from './Icon.js';

export function Header({ section, dataMode = 'simulated' }: {
  readonly section: 'demo' | 'details'; readonly dataMode?: 'simulated' | 'live';
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

  return (
    <>
    <a className="skip-link" href="#demo">Skip to the lab</a>
    <header ref={headerRef} className="site-header">
      <a className="brand" href="#demo">
        <Mark />
        <span className="brand__name">Monolith</span>
        <span className="brand__product">Leak Lab</span>
      </a>
      <nav className="pill-nav" aria-label="Sections">
        <a href="#demo" aria-current={visibleSection === 'demo' ? 'location' : undefined}>
          The lab
        </a>
        <a href="#under-the-hood" aria-current={visibleSection === 'details' ? 'location' : undefined}>
          Evidence
        </a>
      </nav>
      <div className="header-mode">
      <p className="sim-pill" title={dataMode === 'live'
        ? 'Real network reads, independent observer receipts and explicit fail-closed errors. No success is assumed.'
        : 'This walkthrough uses local fixture data. Its results are simulated and no blockchain reads are sent.'}>
        <span className={`dot dot--${dataMode === 'live' ? 'protected' : 'sim'}`} aria-hidden="true" />
        {dataMode === 'live' ? 'Live network' : 'Simulated data'}
      </p>
      <a className="mode-switch" href={dataMode === 'live' ? '?mode=simulated#demo' : './#demo'}
        aria-label={dataMode === 'live' ? 'Try the simulated lab offline, without blockchain reads' : 'Switch to the live network lab'}>
        {dataMode === 'live' ? 'Try offline' : 'Go live'}<Icon name="arrow-right" size={16} />
      </a>
      </div>
    </header>
    <div className="lab-intro">
      <p className="lab-intro__title">Find the leak. <span>Prove the fix.</span></p>
      <p className="lab-intro__body">A hands-on privacy lab for blockchain reads. Follow the route, catch a bypass, and see what the endpoint learns.</p>
      <p className="lab-intro__mode">{dataMode === 'live'
        ? 'Live mode sends real requests only when you run a step. No wallet needed.'
        : 'Offline practice. Every result is simulated; no network reads are sent.'}</p>
    </div>
    </>
  );
}
