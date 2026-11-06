import { mkdir, writeFile, readdir, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { createSession, applyCandidate, verifyBindings, closeSession, assertCanonical, boundedRead, sha256 } from './controller.mjs';
import { HarnessError, LIMITS, DIAGNOSTICS } from './policy.mjs';

const artifactNames = new Set(['baseline.json', 'candidate.json', 'candidate.diff', 'source-bindings.json', 'result.json']);
const failure = (code) => new HarnessError(code);
const within = (parent, path) => { const value = relative(parent, path); return !value.startsWith('..') && !isAbsolute(value); };

/** Run the existing installed CLI; its offline output never authenticates a collector. */
export async function cliCheck(repository, file, signal) {
  return new Promise((resolveCheck, reject) => {
    if (signal?.aborted) { reject(failure('CANCELLED')); return; }
    const child = spawn(process.execPath, [join(repository, 'packages/cli/dist/monolith.mjs'),
      'check', '--input', file, '--json'], { cwd: repository, shell: false,
      stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
    let output = ''; let overflow = false;
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(abort, 10_000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(output) + chunk.length > LIMITS.outputBytes) { overflow = true; abort(); }
      else output += chunk.toString('utf8');
    });
    child.once('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(failure('CLI_UNAVAILABLE')); });
    child.once('close', (code) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) { reject(failure('CANCELLED')); return; }
      try {
        const parsed = JSON.parse(output);
        if (overflow || ![0, 1].includes(code) || parsed.schemaVersion !== 1 || parsed.command !== 'check'
          || parsed.status !== (code === 0 ? 'pass' : 'fail') || !parsed.data) throw new Error();
        resolveCheck({ exitCode: code, data: parsed.data });
      } catch { reject(failure('CLI_UNAVAILABLE')); }
    });
  });
}

function safeCapture(raw, mode) {
  if (!raw || raw.schemaVersion !== 1 || raw.collectorVersion !== 'monolith-agent-browser-v1') throw failure('INVALID_CAPTURE');
  if (raw.unavailable === true) return null;
  if (raw.evidence !== (mode === 'simulated' ? 'SIMULATED' : 'OBSERVED_LIVE')
    || raw.input?.evidence !== raw.evidence || raw.scope?.captureComplete !== raw.captureComplete
    || !Array.isArray(raw.input?.reads) || !Array.isArray(raw.input?.traces) || !Array.isArray(raw.input?.attempts)
    || !Number.isSafeInteger(raw.unexpectedDirectRequests) || raw.unexpectedDirectRequests < 0
    || typeof raw.functionalPass !== 'boolean' || typeof raw.privacyPass !== 'boolean') throw failure('INVALID_CAPTURE');
  // Producers are trusted, fixed code. Reject oversized inputs before writing or invoking CLI.
  const envelope = { schemaVersion: 1, input: raw.input, scope: raw.scope };
  if (Buffer.byteLength(JSON.stringify(envelope)) > LIMITS.outputBytes) throw failure('INVALID_CAPTURE');
  return envelope;
}

function usefulProtected(raw) {
  return raw.input.reads.some((read) => read.method === 'eth_getBalance' && read.privacyRequired
    && raw.input.attempts.some((attempt) => attempt.ref?.readId === read.readId && attempt.ref.attempt === 1
      && attempt.method === read.method && attempt.endpointId === read.endpointId && attempt.chainId === read.chainId
      && ['anon-nym', 'anon-tor'].includes(attempt.route) && attempt.sent && attempt.completed && attempt.workerVerified));
}

function readInventory(raw) {
  return raw.input.reads.map(({ endpointId, chainId, method, callsiteAlias, scenarioAlias, privacyRequired }) =>
    ({ endpointId, chainId, method, callsiteAlias, scenarioAlias, privacyRequired }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function verifyEvidenceBundle(directory) {
  try {
    await assertCanonical(directory);
    const manifest = JSON.parse((await boundedRead(join(directory, 'manifest.json'), LIMITS.outputBytes)).toString('utf8'));
    if (manifest.schemaVersion !== 1 || manifest.sourceTask !== 'MN-029' || !Array.isArray(manifest.artifacts)) throw new Error();
    const names = new Set();
    for (const row of manifest.artifacts) {
      if (!row || !artifactNames.has(row.path) || names.has(row.path) || !/^[0-9a-f]{64}$/.test(row.sha256)) throw new Error();
      names.add(row.path);
      if ((await lstat(join(directory, row.path))).isSymbolicLink()
        || sha256(await boundedRead(join(directory, row.path), LIMITS.outputBytes)) !== row.sha256) throw new Error();
    }
    if (!names.has('result.json') || !names.has('source-bindings.json')
      || (await readdir(directory)).sort().join(',') !== [...names, 'manifest.json'].sort().join(',')) throw new Error();
    return true;
  } catch { throw failure('EVIDENCE_CHANGED'); }
}

export async function executeTrial(options, { runScenario, check = cliCheck } = {}) {
  const { repository, mode, browserTools, backendOrigin, patch, allowDirectRegression = false,
    workerUnavailable = false, signal, timeoutMs = LIMITS.timeoutMs } = options;
  if (!['live', 'simulated'].includes(mode) || !allowDirectRegression || typeof repository !== 'string'
    || typeof options.outputDirectory !== 'string' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
    || timeoutMs > LIMITS.timeoutMs || patch !== undefined && typeof patch !== 'string') throw failure('INVALID_INPUT');
  const outputDirectory = resolve(options.outputDirectory);
  await assertCanonical(dirname(outputDirectory));
  if (within(resolve(repository), outputDirectory)) throw failure('INVALID_INPUT');
  try { await mkdir(outputDirectory, { mode: 0o700 }); } catch { throw failure('OUTPUT_UNAVAILABLE'); }
  const artifacts = [];
  async function save(path, value, literal = false) {
    const bytes = literal ? value : JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > LIMITS.outputBytes) throw failure('INVALID_CAPTURE');
    await writeFile(join(outputDirectory, path), bytes, { flag: 'wx', mode: 0o400 });
    artifacts.push({ path, sha256: sha256(bytes) });
  }
  const startedAt = new Date().toISOString();
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort('CANCELLED');
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; lifetime.abort('TIMEOUT'); }, timeoutMs);
  let session; let baseline; let candidate; let errorCode; let cleanup;
  let runnerResourcesClosed = true;
  let baselineDetected = false;
  try {
    if (lifetime.signal.aborted) throw failure('CANCELLED');
    session = await createSession({ repository });
    await save('source-bindings.json', { schemaVersion: 1, sourceRevision: session.sourceRevision,
      originalSourceSha256: session.originalSourceHash, files: session.bindings });
    if (patch !== undefined) {
      // Validate the patch before any browser/network work; application follows baseline capture.
      const { decodePatch } = await import('./controller.mjs');
      decodePatch(patch);
    }
    const invoke = runScenario ?? (await import('./browser-runner.mjs')).runBrowserScenario;
    async function collect(scenario, name) {
      await verifyBindings(session);
      if (lifetime.signal.aborted) throw failure('CANCELLED');
      runnerResourcesClosed = false;
      const operation = Promise.resolve().then(() => invoke({ repository, exampleDirectory: session.exampleDirectory, mode, scenario,
        signal: lifetime.signal, browserTools, backendOrigin }));
      let abort;
      const aborted = new Promise((_, reject) => {
        abort = () => reject(failure(timedOut ? 'TIMEOUT' : 'CANCELLED'));
        lifetime.signal.addEventListener('abort', abort, { once: true });
        if (lifetime.signal.aborted) abort();
      });
      let raw;
      try { raw = await Promise.race([operation, aborted]); }
      catch (error) {
        if (lifetime.signal.aborted) {
          let grace;
          const settled = await Promise.race([operation.catch(() => null), new Promise((resolveGrace) => {
            grace = setTimeout(() => resolveGrace(null), 5000);
          })]);
          clearTimeout(grace);
          runnerResourcesClosed = settled?.cleanup?.browserClosed === true && settled?.cleanup?.serverClosed === true;
          if (!runnerResourcesClosed) throw failure('CLEANUP_FAILED');
        }
        throw error;
      } finally { lifetime.signal.removeEventListener('abort', abort); }
      await verifyBindings(session);
      if (raw?.cleanup?.browserClosed !== true || raw?.cleanup?.serverClosed !== true) throw failure('CLEANUP_FAILED');
      runnerResourcesClosed = true;
      if (lifetime.signal.aborted) throw failure(timedOut ? 'TIMEOUT' : 'CANCELLED');
      const envelope = safeCapture(raw, mode);
      if (!envelope) throw failure('EXECUTION_UNAVAILABLE');
      await save(name, envelope);
      const checked = await check(repository, join(outputDirectory, name), lifetime.signal);
      return { evidence: raw.evidence, captureComplete: raw.captureComplete,
        functionalPass: raw.functionalPass, privacyPass: raw.privacyPass,
        unexpectedDirectRequests: raw.unexpectedDirectRequests, cli: checked,
        usefulProtected: usefulProtected(raw), readInventory: readInventory(raw),
        tools: { playwright: raw.tool?.playwright === '1.65.0' ? '1.65.0' : 'UNTESTED',
          browser: typeof raw.tool?.browser === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(raw.tool.browser) ? raw.tool.browser : 'UNTESTED' },
        worker: { ready: raw.worker?.ready === true,
          kind: raw.worker?.kind === 'SIMULATED_TEST_DRIVER' ? 'SIMULATED_TEST_DRIVER' : 'UNTESTED' } };
    }
    baseline = await collect(workerUnavailable ? 'worker-unavailable' : 'regression', 'baseline.json');
    baselineDetected = baseline.captureComplete === true && baseline.functionalPass === true && baseline.usefulProtected
      && baseline.readInventory.filter((read) => read.method === 'eth_getBalance' && read.privacyRequired).length === 2
      && baseline.unexpectedDirectRequests > 0 && baseline.cli.exitCode === 1;
    if (workerUnavailable) throw failure('EXECUTION_UNAVAILABLE');
    if (!baselineDetected) throw failure('BASELINE_NOT_DETECTED');
    if (patch !== undefined) {
      await applyCandidate(session, patch);
      await save('candidate.diff', patch, true);
      candidate = await collect('repaired', 'candidate.json');
    }
    await verifyBindings(session);
  } catch (error) {
    errorCode = error instanceof HarnessError ? error.code : 'EXECUTION_UNAVAILABLE';
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    if (session) {
      try { await closeSession(session); cleanup = true; } catch { cleanup = false; errorCode = 'CLEANUP_FAILED'; }
    } else cleanup = true;
  }
  const passed = !errorCode && cleanup && baselineDetected && candidate?.captureComplete === true
    && candidate?.functionalPass === true && candidate?.privacyPass === true && candidate?.usefulProtected === true
    && candidate?.unexpectedDirectRequests === 0 && candidate?.cli.exitCode === 0;
  const sameScenario = candidate && JSON.stringify(candidate.readInventory) === JSON.stringify(baseline?.readInventory);
  const unavailable = ['EXECUTION_UNAVAILABLE', 'CLI_UNAVAILABLE', 'CLEANUP_FAILED', 'TIMEOUT'].includes(errorCode);
  const invalid = ['INVALID_PATCH', 'INVALID_SOURCE', 'BINDING_CHANGED', 'INVALID_CAPTURE'].includes(errorCode);
  const status = errorCode === 'CANCELLED' ? 'cancelled' : unavailable ? 'unavailable' : invalid ? 'invalid' : passed && sameScenario ? 'pass' : 'fail';
  const summary = { schemaVersion: 1, sourceTask: 'MN-029', startedAt, generatedAt: new Date().toISOString(),
    status, exitCode: status === 'cancelled' ? 130 : invalid ? 2 : unavailable ? 3 : status === 'pass' ? 0 : 1,
    evidence: mode === 'simulated' ? 'SIMULATED' : status === 'pass' ? 'OBSERVED_LIVE' : 'BLOCKED',
    baseline: baseline ?? null, candidate: candidate ?? null, errorCode: errorCode ?? null,
    diagnostics: baselineDetected ? [{ code: 'DIRECT_BYPASS', ...DIAGNOSTICS.DIRECT_BYPASS }] : [],
    bindings: session ? { sourceRevision: session.sourceRevision, originalSourceSha256: session.originalSourceHash,
      candidate: session.candidate } : null,
    tools: { node: process.version, collector: 'monolith-agent-browser-v1',
      cliSha256: session?.bindings['packages/cli/dist/monolith.mjs'] ?? null },
    cleanup: { workspaceRemoved: cleanup, runnerResourcesClosed },
    agentTrial: 'UNTESTED: a candidate diff alone does not identify its author or prove an external-agent trial.',
    limitations: ['Fixed example and one structurally enforced repair pattern; no arbitrary hostile-code sandbox.',
      'SIMULATED tests do not establish worker anonymity. CLI input labels are unverified local claims.',
      'Live acceptance and dependency evidence require separate review; no source merge or deployment is performed.'] };
  await save('result.json', summary);
  // A failed setup still produces a reviewable bundle with an explicit empty binding set.
  if (!artifacts.some((row) => row.path === 'source-bindings.json')) await save('source-bindings.json', { schemaVersion: 1, files: {}, evidence: 'UNTESTED' });
  await writeFile(join(outputDirectory, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
    sourceTask: 'MN-029', evidence: summary.evidence, generatedAt: summary.generatedAt, artifacts }, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  await verifyEvidenceBundle(outputDirectory);
  return summary;
}
