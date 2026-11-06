import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { parsePublicEnv } from './config/public-env.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Dashboard root element is missing.');
}

const config = parsePublicEnv({
  MONOLITH_PUBLIC_OBSERVER_URL: import.meta.env.MONOLITH_PUBLIC_OBSERVER_URL,
});

createRoot(root).render(
  <StrictMode>
    <App {...config} />
  </StrictMode>,
);
