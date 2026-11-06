import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

it('exposes only the allowlisted public origin through the actual Vite build configuration', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'monolith-public-bundle-'));
  const publicUrl = 'https://observer.example.com';
  const secrets = ['server-private-sentinel-mn001', 'vite-private-sentinel-mn001', 'unknown-public-sentinel-mn001'];
  vi.stubEnv('MONOLITH_PUBLIC_OBSERVER_URL', publicUrl);
  vi.stubEnv('MONOLITH_RELAYER_PRIVATE_KEY', secrets[0]);
  vi.stubEnv('VITE_PRIVATE_KEY', secrets[1]);
  vi.stubEnv('MONOLITH_PUBLIC_PRIVATE_KEY', secrets[2]);

  try {
    await writeFile(path.join(temp, 'index.html'), '<script type="module" src="/probe.js"></script>');
    await writeFile(path.join(temp, 'probe.js'), `globalThis.monolithEnvProbe = {
      configured: import.meta.env.MONOLITH_PUBLIC_OBSERVER_URL,
      unknownPublic: import.meta.env.MONOLITH_PUBLIC_PRIVATE_KEY,
      genericVite: import.meta.env.VITE_PRIVATE_KEY,
      server: import.meta.env.MONOLITH_RELAYER_PRIVATE_KEY,
      snapshot: import.meta.env,
    };`);
    await mkdir(path.join(temp, 'dist'));
    await build({
      configFile: path.join(root, 'apps/dashboard/vite.config.ts'),
      root: temp,
      logLevel: 'silent',
      build: { outDir: path.join(temp, 'dist'), emptyOutDir: true },
    });
    const assetDir = path.join(temp, 'dist/assets');
    const files = await readdir(assetDir);
    const bundle = (await Promise.all(files.map((name) => readFile(path.join(assetDir, name), 'utf8')))).join('\n');
    expect(bundle).toContain(publicUrl);
    for (const secret of secrets) expect(bundle).not.toContain(secret);
  } finally {
    vi.unstubAllEnvs();
    await rm(temp, { recursive: true, force: true });
  }
}, 20_000);
