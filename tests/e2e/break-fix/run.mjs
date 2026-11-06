// An offline acceptance wrapper around MN-012's existing independent Chromium collector.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessMatrix } from './assess.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--output' && args[1], 'Use --output <new-directory>');
assert(process.env.MONOLITH_BROWSER_TOOLS, 'Set MONOLITH_BROWSER_TOOLS to isolated Playwright 1.65.0 tools');
const output = resolve(args[1]);
const fixturePath = 'tests/fixtures/leak-widget/manifest.json';
const fixture = JSON.parse(await readFile(join(repository, fixturePath), 'utf8'));
const extraInputs = ['tests/e2e/break-fix/run.mjs', 'tests/e2e/break-fix/assess.mjs'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputHashes = Object.fromEntries(await Promise.all(extraInputs.map(async (file) => [file, sha256(await readFile(join(repository, file)))])));
await mkdir(output); // Exclusive new directory: never rewrite earlier captures or reports.
const capturePath = join(output, 'capture-matrix.json');
const childStatus = await new Promise((resolveStatus, reject) => {
  const child = spawn(process.execPath, [join(repository, 'tests/e2e/privacy/run.mjs'), '--output', capturePath],
    { cwd: repository, stdio: 'inherit', timeout: 120_000 });
  child.once('error', reject);
  child.once('exit', (code, signal) => resolveStatus({ code, signal }));
});
assert.deepEqual(childStatus, { code: 0, signal: null }, 'The independent Chromium matrix must finish successfully');
const captureBytes = await readFile(capturePath);
const matrix = JSON.parse(captureBytes);
const summary = assessMatrix(matrix, fixture);
for (const [file, expected] of Object.entries({ ...matrix.sourceHashes, ...inputHashes })) {
  const path = resolve(repository, file);
  const within = relative(repository, path);
  assert(within && !within.startsWith(`..${sep}`) && within !== '..' && !within.startsWith(sep), 'Input hash paths must stay inside this checkout');
  assert.equal(sha256(await readFile(path)), expected, `Runtime input changed: ${file}`);
}
const source = await readFile(join(repository, 'tests/fixtures/leak-widget/main.ts'), 'utf8');
const before = source.match(/const leaked = await leakingReceipt[^\n]+\n\s+receiptSucceeded = [^\n]+;/)?.[0];
const after = source.match(/receipt = await transport.read\(\{ readId: 'fixture_receipt_001'[\s\S]+?receiptSucceeded = receipt.ok;/)?.[0];
assert(before && after, 'The supported before/after branches must exist in the captured fixture source');
const repairDiff = [
  '# SIMULATED fixture branch selection preview; no production source is edited.',
  '# The existing runner selects leak, then fixed, with the same seed and useful intent.',
  '--- a/tests/fixtures/leak-widget/main.ts (leak branch)',
  '+++ b/tests/fixtures/leak-widget/main.ts (fixed branch)',
  '@@ supported receipt fixture branch @@',
  ...before.split('\n').map((line) => `- ${line.trim()}`),
  ...after.split('\n').map((line) => `+ ${line.trim()}`), '',
].join('\n');
await writeFile(join(output, 'repair.diff'), repairDiff, { flag: 'wx' });
await writeFile(join(output, 'summary.json'), `${JSON.stringify({
  ...summary, sourceHashes: { ...matrix.sourceHashes, ...inputHashes },
  artifacts: [
    { path: 'capture-matrix.json', sha256: sha256(captureBytes) },
    { path: 'repair.diff', sha256: sha256(repairDiff) },
  ],
}, null, 2)}\n`, { flag: 'wx' });
console.info(JSON.stringify({ evidence: 'SIMULATED', softwareRegressionPassed: true, liveAcceptance: 'UNTESTED', output }));
