import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRpcEgress, inspectBrowserSource } from './static.mjs';

const temporaryRoots = [];
const sourceRoots = ['apps/dashboard/src', 'packages/transport/src/adapters/browser'];
const extensions = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'];
const newlyIncludedExtensions = ['jsx', 'cjs', 'mts', 'cts'];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files = {}, pins = {}) {
  const root = await mkdtemp(join(tmpdir(), 'monolith-egress-files-'));
  temporaryRoots.push(root);
  for (const directory of [...sourceRoots, 'tests/privacy/egress']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  for (const [path, source] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), source);
  }
  await writeFile(join(root, 'tests/privacy/egress/reviewed-adapters.json'),
    JSON.stringify({ schemaVersion: 1, files: pins }));
  return root;
}

function adapterPin(source) {
  return { sha256: createHash('sha256').update(source).digest('hex'), purpose: 'Synthetic reviewed adapter fixture.' };
}

describe('browser source discovery, SIMULATED filesystem fixtures', () => {
  for (const sourceRoot of sourceRoots) {
    it.each(extensions)('rejects nested .%s network and SDK sources under '+sourceRoot, async (extension) => {
      const networkFile = `${sourceRoot}/nested/widget.${extension}`;
      const sdkFile = `${sourceRoot}/nested/adapters/client.${extension}`;
      const root = await fixture({
        [networkFile]: 'const response = fetch("https://rpc.example.com", { method: "POST" });',
        [sdkFile]: 'const sdk = import("viem");',
      });

      const result = await checkRpcEgress(root);

      expect(result.passed).toBe(false);
      expect(result.files).toBe(2);
      expect(result.violations).toHaveLength(2);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: networkFile, reason: 'Browser network primitive requires a reviewed adapter.' }),
        expect.objectContaining({ file: sdkFile, reason: 'Dynamic direct RPC SDK import requires a reviewed adapter.' }),
      ]));
    });
  }
});

describe('JSX syntax preserves the network review boundary', () => {
  it.each(['jsx', 'tsx'])('treats .%s text, comments and strings as harmless', (extension) => {
    const source = [
      '// fetch("https://rpc.example.com")',
      'const explanation = "WebSocket and viem";',
      'const view = (',
      '  <main title="fetch">',
      '    <span>fetch</span>',
      '    <p>WebSocket</p>',
      '    {/* fetch(explanation) */}',
      '    <code>{"fetch"}</code>',
      '  </main>',
      ');',
    ].join('\n');

    expect(inspectBrowserSource(source, `apps/dashboard/src/widget.${extension}`)).toEqual([]);
  });

  it.each(['jsx', 'tsx'])('finds executable fetch within a .%s child expression', (extension) => {
    const file = `apps/dashboard/src/widget.${extension}`;
    const source = [
      'const view = (',
      '  <main>',
      '    <span>{fetch("https://rpc.example.com")}</span>',
      '  </main>',
      ');',
    ].join('\n');

    expect(inspectBrowserSource(source, file)).toEqual([
      { file, line: 3, column: 12, reason: 'Browser network primitive requires a reviewed adapter.' },
    ]);
  });

  it.each(['jsx', 'tsx'])('retains a call after nested .%s elements', (extension) => {
    const file = `apps/dashboard/src/widget.${extension}`;
    const source = [
      'const view = <main><span>safe</span><section><em>rpc</em></section></main>;',
      'fetch("https://rpc.example.com");',
    ].join('\n');

    expect(inspectBrowserSource(source, file)).toEqual([
      { file, line: 2, column: 1, reason: 'Browser network primitive requires a reviewed adapter.' },
    ]);
  });
});

describe('reviewed adapter pins cover newly discovered source formats', () => {
  it.each(newlyIncludedExtensions)('accepts exact .%s adapter bytes, then rejects a changed file', async (extension) => {
    const file = `packages/transport/src/adapters/browser/nested/reviewed.${extension}`;
    const source = 'const response = fetch("https://rpc.example.com");\n';
    const root = await fixture({ [file]: source }, { [file]: adapterPin(source) });

    const exact = await checkRpcEgress(root);
    expect(exact.files).toBe(1);
    expect(exact.passed).toBe(true);
    expect(exact.violations).toEqual([]);

    await writeFile(join(root, file), source+'// changed adapter bytes\n');
    const changed = await checkRpcEgress(root);
    expect(changed.passed).toBe(false);
    expect(changed.violations).toEqual([
      { file, line: 1, column: 1, reason: 'Reviewed network adapter changed; explicit boundary re-review and pin update required.' },
    ]);
  });

  it.each(newlyIncludedExtensions)('rejects a missing pinned .%s adapter', async (extension) => {
    const file = `apps/dashboard/src/nested/reviewed.${extension}`;
    const root = await fixture({}, { [file]: adapterPin('const response = fetch("https://rpc.example.com");\n') });

    const missing = await checkRpcEgress(root);
    expect(missing.passed).toBe(false);
    expect(missing.violations).toEqual([
      { file, line: 1, column: 1, reason: 'Reviewed adapter missing from scanned scope.' },
    ]);
  });
});
