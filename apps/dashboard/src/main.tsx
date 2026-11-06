import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabApp } from './app/LabApp.js';
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

createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('mode') === 'simulated'
      ? <LabApp observerUrl={config.observerUrl} /> : <LiveLabApp observerUrl={config.observerUrl} />}
  </StrictMode>,
);
