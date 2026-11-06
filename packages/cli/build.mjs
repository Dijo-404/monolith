import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDirectory = join(packageRoot, 'dist');
const outputFile = join(outputDirectory, 'monolith.mjs');

// Workspace packages stay private. Bundle only their public exports and Zod;
// the installed executable has no dependency on a checkout or dependency tree.
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const built = await build({
  absWorkingDir: packageRoot,
  entryPoints: ['src/main.ts'],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'eof',
  metafile: true,
  sourcemap: false,
  logLevel: 'warning',
});

for (const output of Object.values(built.metafile.outputs)) {
  if (output.imports.some((entry) => entry.external && !isBuiltin(entry.path))) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw new Error('The CLI bundle contains an unresolved runtime dependency.');
  }
}

const sharedRequire = createRequire(import.meta.resolve('@monolith/shared'));
const zodManifestPath = sharedRequire.resolve('zod/package.json');
const zodManifest = JSON.parse(await readFile(zodManifestPath, 'utf8'));
if (zodManifest.name !== 'zod' || zodManifest.version !== '4.6.7' || zodManifest.license !== 'MIT') {
  await rm(outputDirectory, { recursive: true, force: true });
  throw new Error('Review the bundled Zod version and license before packaging.');
}
const zodLicense = await readFile(join(dirname(zodManifestPath), 'LICENSE'), 'utf8');
await writeFile(join(outputDirectory, 'THIRD_PARTY_NOTICES.txt'),
  `Monolith CLI bundles Zod ${zodManifest.version} (MIT).\nhttps://github.com/colinhacks/zod\n\n${zodLicense}`);
await chmod(outputFile, 0o755);
