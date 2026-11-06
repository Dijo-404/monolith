import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'vitest';
import { applyCandidate, closeSession, createSession, verifyBindings } from '../../../scripts/agent-harness/controller.mjs';
import { APP_PATH, APPROVED_PATCH, ORIGINAL_APP, REPAIRED_APP, TRUSTED_PATHS } from '../../../scripts/agent-harness/policy.mjs';
import { cliCheck, executeTrial, verifyEvidenceBundle } from '../../../scripts/agent-harness/runner.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'monolith-agent-harness-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function fixtureRepository() {
  const directory = await temporaryDirectory();
  for (const path of TRUSTED_PATHS) {
    if (path.endsWith('/')) {
      await mkdir(join(directory, path), { recursive: true });
    } else {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), '{}\n');
    }
  }
  await writeFile(join(directory, APP_PATH), ORIGINAL_APP);
  // The CLI is a standalone bundle. Copy actual built bytes so integration tests
  // exercise its public command without snapshotting a concurrently edited tree.
  await cp(join(repository, 'packages/cli/dist/monolith.mjs'), join(directory, 'packages/cli/dist/monolith.mjs'));
  return directory;
}

function capture(scenario = 'regression') {
  const repaired = scenario === 'repaired';
  const blocked = scenario === 'worker-unavailable';
  const reads = ['witness', 'application'].map((kind) => ({
    readId: `read-${kind}-synthetic-001`, endpointId: 'endpoint-synthetic-001',
    chainId: '1', method: 'eth_getBalance', callsiteAlias: kind,
    scenarioAlias: 'useful-read', privacyRequired: true,
  }));
  const attempts = reads.map((read, index) => ({
    eventId: `event-synthetic-${index}-001`, ref: { readId: read.readId, attempt: 1 },
    endpointId: read.endpointId, chainId: read.chainId, method: read.method,
    originAlias: 'rpc-primary', callsiteAlias: read.callsiteAlias,
    route: blocked ? 'blocked' : repaired || index === 0 ? 'anon-nym' : 'direct-debug',
    sent: !blocked, completed: !blocked, durationMs: 10,
    workerVerified: !blocked && (repaired || index === 0), evidence: 'SIMULATED',
  }));
  const traces = attempts.flatMap((attempt, index) => {
    // The regression deliberately emits no wrapper trace. Its independent
    // observation must still enter the CLI denominator and fail the gate.
    if (!repaired && !blocked && index === 1) return [];
    return [{ schemaVersion: 1, readId: attempt.ref.readId, attempt: 1,
      endpointId: attempt.endpointId, chainId: attempt.chainId, method: attempt.method,
      callsite: attempt.callsiteAlias, route: attempt.route, durationMs: 10,
      success: !blocked, bootstrap: false, evidence: 'SIMULATED',
      payloadVisibility: 'rpc-endpoint-can-read',
      ...(blocked ? { errorCode: 'WORKER_UNAVAILABLE' } : {}) }];
  });
  return {
    schemaVersion: 1, collectorVersion: 'monolith-agent-browser-v1',
    evidence: 'SIMULATED', captureComplete: true, unexpectedDirectRequests: repaired || blocked ? 0 : 1,
    functionalPass: !blocked, privacyPass: repaired, gatePassed: repaired,
    worker: { evidence: 'SIMULATED', verified: !blocked },
    cleanup: { browserClosed: true, serverClosed: true },
    input: { schemaVersion: 1, runId: 'run-agent-synthetic-001', evidence: 'SIMULATED', reads, attempts, traces },
    scope: {
      reportRunId: 'report-agent-synthetic-001', application: 'agent-harness-fixture',
      origins: [{ alias: 'rpc-primary', origin: 'https://rpc.example.com' }],
      callsites: [{ alias: 'witness', label: 'example.witness' }, { alias: 'application', label: 'example.balance' }],
      scenarios: [{ alias: 'useful-read', label: 'read' }], bootstrapRules: [], captureComplete: true,
    },
  };
}

async function trial(overrides = {}, dependencies = {}) {
  const temporary = await temporaryDirectory();
  const source = await fixtureRepository();
  const options = { repository: source, outputDirectory: join(temporary, 'result'), mode: 'simulated',
    allowDirectRegression: true, patch: APPROVED_PATCH, ...overrides };
  const result = await executeTrial(options, {
    runScenario: async ({ scenario }) => capture(scenario), ...dependencies,
  });
  return { result, options };
}

const hasCode = (code) => (error) => error?.code === code;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('agent harness fixed patch and source boundary, SIMULATED only', () => {
  test('has a reviewed exact repair rather than a general patch interpreter', () => {
    assert.notEqual(ORIGINAL_APP, REPAIRED_APP);
    assert.equal(ORIGINAL_APP.replace('return regressionRead();', 'return privateRead();'), REPAIRED_APP);
    assert.match(APPROVED_PATCH, /-.*return regressionRead\(\);/);
    assert.match(APPROVED_PATCH, /\+.*return privateRead\(\);/);
    assert.equal(APP_PATH, 'examples/agent-harness/app.mjs');
  });

  test('applies the repair only in the disposable copy and cleans it up twice safely', async () => {
    const source = await fixtureRepository();
    const session = await createSession({ repository: source });
    assert.equal(await verifyBindings(session), true);
    const candidate = await applyCandidate(session, APPROVED_PATCH);
    assert.equal(await readFile(join(source, APP_PATH), 'utf8'), ORIGINAL_APP);
    assert.equal(await readFile(join(session.directory, 'original.mjs'), 'utf8'), ORIGINAL_APP);
    assert.equal(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8'), REPAIRED_APP);
    assert.match(candidate.sha256, /^[0-9a-f]{64}$/);
    assert.match(candidate.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(await verifyBindings(session), true);
    await assert.rejects(applyCandidate(session, APPROVED_PATCH), hasCode('CANDIDATE_ALREADY_APPLIED'));
    await closeSession(session);
    await closeSession(session);
    await assert.rejects(lstat(session.directory), { code: 'ENOENT' });
  });

  test.each([
    ['traversal', APPROVED_PATCH.replaceAll(APP_PATH, '../outside.mjs')],
    ['absolute path', APPROVED_PATCH.replaceAll(APP_PATH, '/tmp/private-source.mjs')],
    ['protected runner', APPROVED_PATCH.replaceAll(APP_PATH, 'scripts/agent-harness/runner.mjs')],
    ['file creation', APPROVED_PATCH.replace(`--- a/${APP_PATH}`, '--- /dev/null')],
    ['second file', APPROVED_PATCH + '--- a/extra.mjs\n+++ b/extra.mjs\n@@ -1 +1 @@\n-before\n+after\n'],
    ['observation suppression', APPROVED_PATCH.replace('+  return privateRead();', '+  return Promise.resolve("passed");')],
    ['stale source context', APPROVED_PATCH.replace('-  return regressionRead();', '-  return earlierRead();')],
    ['malformed hunk length', APPROVED_PATCH.replace('@@ -1,7 +1,7 @@', '@@ -1,6 +1,7 @@')],
    ['binary marker', 'GIT binary patch\nliteral 3\nabc\n'],
    ['NUL', APPROVED_PATCH + '\0'],
    ['CRLF', APPROVED_PATCH.replaceAll('\n', '\r\n')],
    ['unbounded patch', 'x'.repeat(8193)],
  ])('rejects %s candidate before changing original or copy', async (_name, patch) => {
    const source = await fixtureRepository();
    const session = await createSession({ repository: source });
    try {
      await assert.rejects(applyCandidate(session, patch), hasCode('INVALID_PATCH'));
      assert.equal(await readFile(join(source, APP_PATH), 'utf8'), ORIGINAL_APP);
      assert.equal(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8'), ORIGINAL_APP);
      assert.equal(await verifyBindings(session), true);
    } finally { await closeSession(session); }
  });

  test.each(['source', 'policy', 'added trusted file', 'candidate', 'original', 'extra candidate file', 'metadata'])('detects %s tampering before another run', async (kind) => {
    const source = await fixtureRepository();
    const session = await createSession({ repository: source });
    try {
      if (kind === 'source') await writeFile(join(source, APP_PATH), REPAIRED_APP);
      if (kind === 'policy') await writeFile(join(source, 'scripts/agent-harness/policy.mjs'), 'export const failClosed = false;\n');
      if (kind === 'added trusted file') await writeFile(join(source, 'tests/privacy/egress/extra.mjs'), 'changed\n');
      if (kind === 'candidate') await writeFile(join(session.exampleDirectory, 'app.mjs'), REPAIRED_APP);
      if (kind === 'original') {
        await chmod(join(session.directory, 'original.mjs'), 0o600);
        await writeFile(join(session.directory, 'original.mjs'), REPAIRED_APP);
      }
      if (kind === 'extra candidate file') await writeFile(join(session.exampleDirectory, 'ignore-observations.mjs'), 'changed\n');
      if (kind === 'metadata') session.bindings = {};
      await assert.rejects(verifyBindings(session), hasCode('BINDING_CHANGED'));
    } finally { await closeSession(session); }
  });

  test('rejects a symlinked repository, ancestor and candidate file without touching the target', async () => {
    const source = await fixtureRepository();
    const links = await temporaryDirectory();
    await symlink(source, join(links, 'alias'), 'dir');
    await assert.rejects(createSession({ repository: join(links, 'alias') }), hasCode('INVALID_SOURCE'));
    await mkdir(join(source, 'nested'));
    await assert.rejects(createSession({ repository: join(links, 'alias/nested') }), hasCode('INVALID_SOURCE'));
    const session = await createSession({ repository: source });
    const outside = join(links, 'outside.mjs');
    await writeFile(outside, ORIGINAL_APP);
    await rm(join(session.exampleDirectory, 'app.mjs'));
    await symlink(outside, join(session.exampleDirectory, 'app.mjs'));
    await assert.rejects(applyCandidate(session, APPROVED_PATCH), hasCode('BINDING_CHANGED'));
    await closeSession(session);
    assert.equal(await readFile(outside, 'utf8'), ORIGINAL_APP);
  });
});

describe('agent harness controller with actual public CLI and controlled measurements', () => {
  test('detects an untraced direct bypass then preserves two useful reads through the candidate', async () => {
    const { result, options } = await trial();
    assert.equal(result.status, 'pass');
    assert.equal(result.exitCode, 0);
    assert.equal(result.evidence, 'SIMULATED');
    assert.equal(result.baseline.cli.exitCode, 1);
    assert.equal(result.baseline.cli.data.eligibleReads, 2);
    assert.equal(result.baseline.cli.data.protectedReads, 1);
    assert.equal(result.baseline.cli.data.successfulReads, 2);
    assert.equal(result.candidate.cli.data.eligibleReads, 2);
    assert.equal(result.candidate.cli.data.protectedReads, 2);
    assert.equal(result.candidate.cli.data.successfulReads, 2);
    assert.deepEqual(result.baseline.readInventory, result.candidate.readInventory);
    assert.deepEqual(result.cleanup, { workspaceRemoved: true, runnerResourcesClosed: true });
    assert.equal(await verifyEvidenceBundle(options.outputDirectory), true);
    assert.match(result.agentTrial, /UNTESTED/);
    assert.equal(await readFile(join(options.repository, APP_PATH), 'utf8'), ORIGINAL_APP);
  });

  test('baseline-only invocation fails acceptance and supplies only a static reviewed diagnostic', async () => {
    const { result } = await trial({ patch: undefined });
    assert.equal(result.status, 'fail');
    assert.equal(result.exitCode, 1);
    assert.equal(result.candidate, null);
    assert.deepEqual(result.diagnostics.map(({ code, path, line }) => ({ code, path, line })), [
      { code: 'DIRECT_BYPASS', path: APP_PATH, line: 6 },
    ]);
  });

  test('rejects a candidate before any browser work when its patch is outside policy', async () => {
    let runs = 0;
    const { result } = await trial({ patch: APPROVED_PATCH.replaceAll(APP_PATH, '../outside.mjs') }, {
      runScenario: async () => { runs++; return capture(); },
    });
    assert.equal(result.status, 'invalid');
    assert.equal(result.errorCode, 'INVALID_PATCH');
    assert.equal(runs, 0);
    assert.equal(result.cleanup.workspaceRemoved, true);
  });

  test.each(['empty reads', 'incomplete capture', 'candidate booleans', 'extra direct attempt', 'changed scenario', 'missing worker credit'])('does not accept %s as a useful private repair', async (kind) => {
    const { result } = await trial({}, { runScenario: async ({ scenario }) => {
      const raw = capture(scenario);
      if (scenario !== 'repaired') return raw;
      if (kind === 'empty reads') { raw.input.reads = []; raw.input.traces = []; raw.input.attempts = []; }
      if (kind === 'incomplete capture') { raw.captureComplete = false; raw.scope.captureComplete = false; }
      if (kind === 'candidate booleans') return { ...capture('regression'), functionalPass: true, privacyPass: true, gatePassed: true };
      if (kind === 'extra direct attempt') {
        raw.unexpectedDirectRequests = 1;
        raw.input.attempts.push({ ...raw.input.attempts[1], eventId: 'event-extra-direct-001', route: 'direct-debug', workerVerified: false });
      }
      if (kind === 'changed scenario') {
        raw.input.reads[1].scenarioAlias = 'changed';
        raw.scope.scenarios.push({ alias: 'changed', label: 'other' });
      }
      if (kind === 'missing worker credit') raw.input.attempts.forEach((attempt) => { attempt.workerVerified = false; });
      return raw;
    } });
    assert.equal(result.status, 'fail');
    assert.equal(result.exitCode, 1);
    assert.equal(result.evidence, 'SIMULATED');
  });

  test('a worker-unavailable case stays blocked with no sent direct or useful reads', async () => {
    const { result, options } = await trial({ workerUnavailable: true });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.exitCode, 3);
    assert.equal(result.errorCode, 'EXECUTION_UNAVAILABLE');
    assert.equal(result.baseline.cli.data.successfulReads, 0);
    assert.equal(result.baseline.cli.data.protectedReads, 0);
    const baseline = JSON.parse(await readFile(join(options.outputDirectory, 'baseline.json'), 'utf8'));
    assert.equal(baseline.input.attempts.every(({ sent, route }) => !sent && route === 'blocked'), true);
    assert.equal(result.candidate, null);
  });

  test('retains the fixed inventory even when a compromised check claims a one-read candidate passed', async () => {
    const { result } = await trial({}, {
      runScenario: async ({ scenario }) => {
        const raw = capture(scenario);
        if (scenario === 'repaired') {
          raw.input.reads.pop(); raw.input.attempts.pop(); raw.input.traces.pop();
        }
        return raw;
      },
      check: async (_source, path) => ({ exitCode: path.endsWith('baseline.json') ? 1 : 0, data: {} }),
    });
    assert.equal(result.status, 'fail');
    assert.equal(result.exitCode, 1);
    assert.equal(result.baseline.readInventory.length, 2);
    assert.equal(result.candidate.readInventory.length, 1);
  });

  test.each(['wrong collector', 'wrong provenance', 'mismatched capture', 'negative direct count', 'failed cleanup'])('refuses %s evidence', async (kind) => {
    const { result } = await trial({}, { runScenario: async () => {
      const raw = capture();
      if (kind === 'wrong collector') raw.collectorVersion = 'untrusted-agent-collector';
      if (kind === 'wrong provenance') raw.evidence = 'OBSERVED_LIVE';
      if (kind === 'mismatched capture') raw.captureComplete = false;
      if (kind === 'negative direct count') raw.unexpectedDirectRequests = -1;
      if (kind === 'failed cleanup') raw.cleanup.browserClosed = false;
      return raw;
    } });
    assert.equal(result.status, kind === 'failed cleanup' ? 'unavailable' : 'invalid');
    assert.equal(result.exitCode, kind === 'failed cleanup' ? 3 : 2);
  });

  test('detects source changes made while a scenario executes', async () => {
    const { result } = await trial({}, { runScenario: async ({ repository: source }) => {
      await writeFile(join(source, 'scripts/agent-harness/policy.mjs'), 'tampered\n');
      return capture();
    } });
    assert.equal(result.status, 'invalid');
    assert.equal(result.errorCode, 'BINDING_CHANGED');
  });

  test.each(['cancel', 'timeout'])('waits for runner cleanup and removes workspace after %s', async (kind) => {
    const lifetime = new AbortController();
    let cleaned = false;
    let started;
    const ready = new Promise((resolveReady) => { started = resolveReady; });
    const running = trial({ signal: lifetime.signal, timeoutMs: kind === 'timeout' ? 500 : 2000 }, {
      runScenario: ({ signal }) => new Promise((resolveRun) => {
        const finish = () => { cleaned = true; resolveRun(capture()); };
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
        started();
      }),
    });
    await Promise.race([ready, running.then(() => { throw new Error('scenario did not start'); })]);
    if (kind === 'cancel') lifetime.abort();
    const { result } = await running;
    assert.equal(cleaned, true);
    assert.equal(result.status, kind === 'cancel' ? 'cancelled' : 'unavailable');
    assert.equal(result.exitCode, kind === 'cancel' ? 130 : 3);
    assert.equal(result.errorCode, kind === 'cancel' ? 'CANCELLED' : 'TIMEOUT');
    assert.deepEqual(result.cleanup, { workspaceRemoved: true, runnerResourcesClosed: true });
  });

  test('refuses pre-cancelled work without starting a browser', async () => {
    const lifetime = new AbortController(); lifetime.abort();
    let runs = 0;
    const { result } = await trial({ signal: lifetime.signal }, { runScenario: async () => { runs++; return capture(); } });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.exitCode, 130);
    assert.equal(runs, 0);
    assert.equal(result.cleanup.workspaceRemoved, true);
  });

  test('live execution remains explicitly blocked before any browser or provider setup', async () => {
    const source = await fixtureRepository();
    const output = join(await temporaryDirectory(), 'live-blocked');
    const result = await executeTrial({ repository: source, mode: 'live',
      allowDirectRegression: true, outputDirectory: output,
      browserTools: '/missing-browser-tools-private-sentinel',
      backendOrigin: 'https://private-token-sentinel.invalid',
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.exitCode, 3);
    assert.equal(result.evidence, 'BLOCKED');
    assert.equal(result.baseline, null);
    assert.equal(result.candidate, null);
    assert.deepEqual(result.cleanup, { workspaceRemoved: true, runnerResourcesClosed: true });
    assert.equal(JSON.stringify(result).includes('private-token-sentinel'), false);
    assert.equal(await verifyEvidenceBundle(output), true);
  });

  test.each(['edited artifact', 'extra artifact', 'manifest traversal', 'symlink artifact'])('detects %s in a retained bundle', async (kind) => {
    const { options } = await trial();
    const directory = options.outputDirectory;
    if (kind === 'edited artifact') {
      await chmod(join(directory, 'baseline.json'), 0o600);
      await writeFile(join(directory, 'baseline.json'), '{}\n');
    }
    if (kind === 'extra artifact') await writeFile(join(directory, 'unlisted.json'), '{}\n');
    if (kind === 'manifest traversal') {
      const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
      manifest.artifacts[0].path = '../outside.json';
      await chmod(join(directory, 'manifest.json'), 0o600);
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    }
    if (kind === 'symlink artifact') {
      const outside = join(await temporaryDirectory(), 'outside.json');
      await cp(join(directory, 'baseline.json'), outside);
      await rm(join(directory, 'baseline.json'));
      await symlink(outside, join(directory, 'baseline.json'));
    }
    await assert.rejects(verifyEvidenceBundle(directory), hasCode('EVIDENCE_CHANGED'));
  });

  test('never overwrites an existing output or accepts a path inside maintained source', async () => {
    const source = await fixtureRepository();
    const options = { repository: source, mode: 'simulated', allowDirectRegression: true };
    await assert.rejects(executeTrial({ ...options, outputDirectory: join(source, 'output') }), hasCode('INVALID_INPUT'));
    const existing = await temporaryDirectory();
    await assert.rejects(executeTrial({ ...options, outputDirectory: existing }), hasCode('OUTPUT_UNAVAILABLE'));
  });

  test('the public CLI check is a required gate rather than trusting collector booleans', async () => {
    let checks = 0;
    const { result } = await trial({}, { check: async (source, path, signal) => {
      checks++;
      const actual = await cliCheck(source, path, signal);
      if (checks === 2) return { ...actual, exitCode: 1 };
      return actual;
    } });
    assert.equal(checks, 2);
    assert.equal(result.status, 'fail');
  });

  test('CLI invalid input stays machine-readable and omits supplied private text', () => {
    for (const args of [
      ['unknown', 'private-token-sentinel'],
      ['run', '--mode', 'simulated', '--output', '/tmp/private-wallet-sentinel', '--unknown', 'private-token-sentinel'],
      ['run', '--mode', 'simulated', '--mode', 'live'],
      ['verify', '--input', '/tmp/private-wallet-sentinel'],
    ]) {
      const child = spawnSync(process.execPath, ['scripts/agent-harness/main.mjs', ...args], {
        cwd: repository, encoding: 'utf8', timeout: 5000,
      });
      assert.equal(child.status, 2, child.stderr);
      assert.equal(child.stderr, '');
      const value = JSON.parse(child.stdout);
      assert.equal(value.schemaVersion, 1);
      assert.equal(value.status, 'invalid');
      assert.equal(value.evidence, 'UNTESTED');
      assert.equal(child.stdout.includes('private-token-sentinel'), false);
      assert.equal(child.stdout.includes('private-wallet-sentinel'), false);
    }
  });
});
