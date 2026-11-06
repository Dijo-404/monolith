import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { publicEnvDefinitions } from './src/config/public-env.js';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const dashboardRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, repositoryRoot, '');

  return {
    root: dashboardRoot,
    plugins: [react()],
    envDir: repositoryRoot,
    // Browser configuration is an explicit allowlist, not a prefix-based export.
    envPrefix: [],
    define: publicEnvDefinitions({
      MONOLITH_PUBLIC_OBSERVER_URL:
        process.env['MONOLITH_PUBLIC_OBSERVER_URL'] ?? fileEnv['MONOLITH_PUBLIC_OBSERVER_URL'],
    }),
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  };
});
