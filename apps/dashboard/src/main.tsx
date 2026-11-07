import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabApp } from './app/LabApp.js';
import { resolveView } from './app/route.js';
import { DocsPage } from './features/docs/DocsPage.js';
import { LiveLabApp } from './features/lab/LiveLabApp.js';
import { parsePublicEnv } from './config/public-env.js';
import './styles/lab.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Dashboard root element is missing.');
}

const config = parsePublicEnv({
  MONOLITH_PUBLIC_OBSERVER_URL: import.meta.env.MONOLITH_PUBLIC_OBSERVER_URL,
});

// The documentation view mounts no lab controller, so reading it sends no network requests.
const view = resolveView(location.search);
if (view === 'docs') document.title = 'Monolith Docs';

createRoot(root).render(
  <StrictMode>
    {view === 'docs' ? <DocsPage />
      : view === 'simulated' ? <LabApp observerUrl={config.observerUrl} /> : <LiveLabApp observerUrl={config.observerUrl} />}
  </StrictMode>,
);
