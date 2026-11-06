import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, test } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packageRoot = join(root, 'packages/cli');
const fixture = JSON.parse(await readFile(new URL('./fixtures/simulated-pass.json', import.meta.url), 'utf8'));
let temp;
let app;
let bin;
let pack;
let environment;

function run(command, args, options = {}) {
  const child = spawnSync(command, args, {
    cwd: app,
    env: environment,
    encoding: 'utf8',
    timeout: 20_000,
    ...options,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  return child;
}

function jsonCommand(args, expectedExit = 0) {
  const result = run(bin, [...args, '--json']);
  assert.equal(result.status, expectedExit, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout);
  assert.equal(value.schemaVersion, 1);
  return value;
}

async function inputFile(name, value) {
  const path = join(app, name);
  await writeFile(path, JSON.stringify(value));
  return path;
}

async function stopFixture(pidFile, executable) {
  const pid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  // Never signal an unrelated reused PID: confirm this exact temporary
  // opener script is still the running process before cleaning it up.
  const identity = run('ps', ['-p', String(pid), '-o', 'command=']);
  if (identity.stdout.includes(executable)) {
    try { process.kill(pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'monolith-cli-portable-'));
  app = join(temp, 'outside-checkout');
  await mkdir(app);
  await writeFile(join(temp, 'user.npmrc'), '');
  await writeFile(join(temp, 'global.npmrc'), '');
  environment = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    NPM_CONFIG_USERCONFIG: join(temp, 'user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: join(temp, 'global.npmrc'),
    NPM_CONFIG_CACHE: join(temp, 'npm-cache'),
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_ENGINE_STRICT: 'true',
  };
  const build = run(process.execPath, ['build.mjs'], { cwd: packageRoot });
  assert.equal(build.status, 0, build.stderr);
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: packageRoot });
  assert.equal(packed.status, 0, packed.stderr);
  [pack] = JSON.parse(packed.stdout);
  await writeFile(join(app, 'package.json'), '{"private":true,"name":"external-cli-consumer","version":"0.0.0"}\n');
  const installed = run('npm', [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    join(temp, pack.filename),
  ]);
  assert.equal(installed.status, 0, installed.stderr);
  bin = join(app, 'node_modules/.bin/monolith');
}, 60_000);

afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe('standalone npm CLI, synthetic measurements only', () => {
  test('packs only declared distributable files and runs the installed bin outside the checkout', async () => {
    assert.equal(resolve(app).startsWith(`${resolve(root)}/`), false);
    assert.equal((await realpath(bin)).startsWith(`${app}/node_modules/@monolith/cli/`), true);
    assert.equal(pack.files.some(({ path }) => path === 'dist/monolith.mjs'), true);
    assert.equal(pack.files.every(({ path }) => /^(?:dist\/|package\.json$|README\.md$|LICENSE$)/.test(path)), true);
    assert.equal(pack.files.some(({ path }) => /(?:\.env|node_modules|src\/|\.map$|fixtures\/)/.test(path)), false);
    const manifest = JSON.parse(await readFile(join(app, 'node_modules/@monolith/cli/package.json'), 'utf8'));
    assert.equal(manifest.name, '@monolith/cli');
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.equal(JSON.stringify(manifest.dependencies ?? {}).includes('workspace:'), false);
    const version = run(bin, ['--version']);
    assert.equal(version.status, 0);
    assert.match(version.stdout, /0\.1\.0/);
    const help = run(bin, ['--help']);
    assert.equal(help.status, 0);
    for (const command of ['doctor', 'check', 'report', 'lab', 'tui']) assert.match(help.stdout, new RegExp(command));
  });

  test('analyzes portable synthetic input with stable JSON and no internal correlation data', async () => {
    const path = await inputFile('synthetic.json', fixture);
    const result = jsonCommand(['check', '--input', path]);
    assert.equal(result.command, 'check');
    assert.equal(result.status, 'pass');
    assert.equal(result.data.evidence, 'SIMULATED');
    assert.equal(result.data.inputTrust, 'unverified-local-input');
    assert.equal(result.data.eligibleReads, 1);
    assert.equal(result.data.protectedReads, 1);
    assert.equal(result.data.successfulReads, 1);
    assert.equal(result.data.protectedCoverage, 1);
    assert.equal(result.data.functionalAcceptance, 'pass');
    assert.equal(JSON.stringify(result).includes('internal-'), false);
    assert.equal(JSON.stringify(result).includes('public-run-synthetic'), false);
  });

  test('checks runtime/configuration offline without claiming a worker or exposing its URL', () => {
    const checked = run(bin, ['doctor', '--json'], {
      env: { ...environment, MONOLITH_LAB_URL: 'https://configured.example.com/lab' },
    });
    assert.equal(checked.status, 0, checked.stderr);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.command, 'doctor');
    assert.equal(result.data.labConfigured, true);
    assert.equal(result.data.networkContacted, false);
    assert.equal(result.data.protectedReadsAvailableInNode, false);
    assert.equal(result.data.evidence, 'UNTESTED');
    assert.equal(checked.stdout.includes('configured.example.com'), false);
    const rejected = run(bin, ['doctor', '--json'], {
      env: { ...environment, MONOLITH_LAB_URL: 'https://user:private-token-sentinel@example.com' },
    });
    assert.equal(rejected.status, 2);
    assert.equal(rejected.stdout.includes('private-token-sentinel'), false);
  });

  test('returns failure for a direct bypass, an empty denominator and entirely blocked reads', async () => {
    const bypass = structuredClone(fixture);
    bypass.input.traces[0].route = 'direct-debug';
    bypass.input.attempts[0].route = 'direct-debug';
    bypass.input.attempts[0].workerVerified = false;
    const leaked = jsonCommand(['check', '--input', await inputFile('bypass.json', bypass)], 1);
    assert.equal(leaked.status, 'fail');
    assert.equal(leaked.data.protectedReads, 0);
    assert.equal(leaked.data.eligibleReads, 1);
    assert.equal(JSON.stringify(leaked.data.findings).includes('DIRECT_BYPASS'), true);

    const empty = structuredClone(fixture);
    empty.input.reads = []; empty.input.traces = []; empty.input.attempts = [];
    const noReads = jsonCommand(['check', '--input', await inputFile('empty.json', empty)], 1);
    assert.equal(noReads.data.protectedCoverage, null);
    assert.equal(noReads.data.functionalAcceptance, 'fail');

    const blocked = structuredClone(fixture);
    blocked.input.traces[0] = { ...blocked.input.traces[0], route: 'blocked', success: false, errorCode: 'WORKER_UNAVAILABLE' };
    blocked.input.attempts[0] = { ...blocked.input.attempts[0], route: 'blocked', workerVerified: false, sent: false, completed: false };
    const denied = jsonCommand(['check', '--input', await inputFile('blocked.json', blocked)], 1);
    assert.equal(denied.data.successfulReads, 0);
    assert.equal(denied.data.functionalAcceptance, 'fail');
  });

  test('keeps invalid/missing input and parser errors sanitized and machine-readable', async () => {
    const path = join(app, 'private-wallet-192.0.2.70.json');
    const malformed = join(app, 'invalid-json.json');
    await writeFile(malformed, '{"private-key-sentinel":');
    for (const args of [
      ['check', '--input', path],
      ['check', '--input', malformed],
      ['check', '--input', await inputFile('extra.json', { ...fixture, privateKey: 'private-key-sentinel' })],
      ['check', '--input', await inputFile('malformed.json', { schemaVersion: 2 })],
      ['check', '--input', await inputFile('invalid-scope.json', { ...fixture, scope: null })],
      ['doctor', '--unknown', 'private-token-sentinel'],
    ]) {
      const result = jsonCommand(args, 2);
      assert.equal(result.status, 'error');
      assert.equal(typeof result.error.code, 'string');
      const serialized = JSON.stringify(result);
      for (const value of [app, '192.0.2.70', 'private-key-sentinel', 'private-token-sentinel']) assert.equal(serialized.includes(value), false);
    }
  });

  test('views report counts without echoing free text or asserting artifact authenticity', async () => {
    const report = {
      schemaVersion: 1,
      runId: 'private-run-id-sentinel',
      evidence: 'SIMULATED',
      eligibleReads: 1, protectedReads: 0, successfulReads: 1, protectedCoverage: 0,
      findings: [{ code: 'DIRECT_BYPASS', readId: 'private-read-sentinel', callsite: '192.0.2.70', message: 'private-wallet-sentinel' }],
      scope: { rpcOrigins: ['https://rpc.example.com'], scenarios: ['private-scenario-sentinel'], bootstrapExclusions: [] },
    };
    const result = jsonCommand(['report', await inputFile('report.json', report)]);
    assert.equal(result.command, 'report');
    assert.equal(result.status, 'viewed');
    assert.equal(result.data.evidence, 'SIMULATED');
    assert.equal(result.data.inputTrust, 'unverified-local-input');
    for (const value of ['private-', '192.0.2.70', 'rpc.example.com']) assert.equal(JSON.stringify(result).includes(value), false);
  });

  test('refuses interactive TUI use through pipes and rejects unsafe lab destinations', () => {
    const result = run(bin, ['tui']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout.includes('\u001b['), false);
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com/?token=secret']) {
      const rejected = jsonCommand(['lab', '--url', url], 2);
      assert.equal(rejected.status, 'error');
      assert.equal(JSON.stringify(rejected).includes('secret'), false);
    }
  });

  test.skipIf(process.platform === 'win32')('launches only the explicit URL via an offline operating-system opener fixture', async () => {
    const openerDirectory = join(temp, 'fake-opener');
    await mkdir(openerDirectory);
    const opener = join(openerDirectory, process.platform === 'darwin' ? 'open' : 'xdg-open');
    const log = join(temp, 'opened-arguments.json');
    await writeFile(opener, `#!${process.execPath}\n` +
      `const fs = require('node:fs');\n` +
      `fs.writeFileSync(process.env.MONOLITH_TEST_OPEN_LOG, JSON.stringify(process.argv.slice(2)));\n`);
    await chmod(opener, 0o755);
    const env = {
      ...environment,
      PATH: `${openerDirectory}${delimiter}${environment.PATH}`,
      MONOLITH_LAB_URL: 'https://configured.example.com/lab',
      MONOLITH_TEST_OPEN_LOG: log,
    };
    const configured = run(bin, ['lab', '--json'], { env });
    assert.equal(configured.status, 0, configured.stderr);
    const result = JSON.parse(configured.stdout);
    assert.equal(result.status, 'launched');
    assert.equal(result.data.evidence, 'UNTESTED');
    assert.equal(result.data.runPerformed, false);
    assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['https://configured.example.com/lab']);
    const explicit = run(bin, ['lab', '--url', 'http://127.0.0.1:4173/lab', '--json'], { env });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['http://127.0.0.1:4173/lab']);
  });

  test.skipIf(process.platform === 'win32')('exits with a safe unavailable result when an opener stalls and ignores termination', async () => {
    const openerDirectory = join(temp, 'stalled-opener');
    await mkdir(openerDirectory);
    const opener = join(openerDirectory, process.platform === 'darwin' ? 'open' : 'xdg-open');
    const pidFile = join(temp, 'stalled-opener.pid');
    await writeFile(opener, `#!${process.execPath}\n` +
      `const fs = require('node:fs');\n` +
      `fs.writeFileSync(process.env.MONOLITH_TEST_OPEN_PID, String(process.pid));\n` +
      `process.on('SIGTERM', () => {});\n` +
      `setInterval(() => {}, 1000);\n` +
      `setTimeout(() => process.exit(0), 15000);\n`);
    await chmod(opener, 0o755);
    const env = {
      ...environment,
      PATH: `${openerDirectory}${delimiter}${environment.PATH}`,
      MONOLITH_TEST_OPEN_PID: pidFile,
    };
    try {
      const started = performance.now();
      // An awaited openLab promise alone misses a live child retaining Node's
      // event loop. Exercise the installed executable through actual process exit.
      const stalled = run(bin, ['lab', '--url', 'https://fixture.example.com/lab', '--json'], { env, timeout: 8_000 });
      const elapsed = performance.now() - started;
      assert.equal(stalled.status, 2, stalled.stderr);
      assert.equal(stalled.stderr, '');
      const result = JSON.parse(stalled.stdout);
      assert.equal(result.command, 'lab');
      assert.equal(result.status, 'error');
      assert.equal(result.error.code, 'LAB_UNAVAILABLE');
      assert.equal(stalled.stdout.includes(opener), false);
      assert.equal(stalled.stdout.includes('fixture.example.com'), false);
      assert.ok(elapsed >= 4_500 && elapsed < 8_000, `Expected bounded opener timeout, got ${elapsed}ms`);
      assert.ok(Number(await readFile(pidFile, 'utf8')) > 1, 'The stalled fixture really started');
    } finally { await stopFixture(pidFile, opener); }
  }, 12_000);

  test.skipIf(process.platform === 'win32')('restores a real terminal and exits on Ctrl-C', () => {
    const result = run('python3', [fileURLToPath(new URL('./pty-smoke.py', import.meta.url)), bin]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      exitCode: 130, cancelSent: true, terminalRestored: true, cursorRestored: true, rendered: true,
    });
  });
});
