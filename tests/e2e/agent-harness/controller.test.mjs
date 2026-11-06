import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCandidate, closeSession, createSession, verifyBindings } from '../../../scripts/agent-harness/controller.mjs';
import { APP_PATH, APPROVED_PATCH, ORIGINAL_APP, REPAIRED_APP, TRUSTED_PATHS } from '../../../scripts/agent-harness/policy.mjs';

const temporary = new Set();
const sessions = new Set();
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'monolith-agent-boundary-'));
  temporary.add(directory);
  const repository = join(directory, 'repository');
  const workspaceRoot = join(directory, 'workspaces');
  await mkdir(repository);
  await mkdir(workspaceRoot);
  // Build a deliberately tiny independent repository. Trusted directories contain
  // sentinels so their contents and additions, rather than only names, are bound.
  for (const path of TRUSTED_PATHS) {
    const target = join(repository, path);
    if (path.endsWith('/')) {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'bound-sentinel.txt'), `SIMULATED trusted root ${path}\n`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `SIMULATED trusted file ${path}\n`);
    }
  }
  await mkdir(dirname(join(repository, APP_PATH)), { recursive: true });
  await writeFile(join(repository, APP_PATH), ORIGINAL_APP);
  return { directory, repository, workspaceRoot };
}

async function start(options) {
  const context = options ?? await fixture();
  const session = await createSession({ repository: context.repository, workspaceRoot: context.workspaceRoot });
  sessions.add(session);
  return { ...context, session };
}

async function rejection(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

afterEach(async () => {
  for (const session of sessions) await closeSession(session).catch(() => {});
  sessions.clear();
  for (const directory of temporary) await rm(directory, { recursive: true, force: true });
  temporary.clear();
});

describe('MN-029 disposable candidate controller, SIMULATED file inputs', () => {
  it('copies the supported example into a new disposable directory and binds its source', async () => {
    const { repository, workspaceRoot, session } = await start();
    expect(session.repository).toBe(repository);
    expect(relative(workspaceRoot, session.directory)).not.toMatch(/^\.\./);
    expect(session.directory).not.toBe(workspaceRoot);
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(ORIGINAL_APP);
    expect(session.originalSourceHash).toBe(hash(ORIGINAL_APP));
    expect(await verifyBindings(session)).toBe(true);
  });

  it('applies a real unified candidate diff only in the disposable example', async () => {
    const { repository, session } = await start();
    const result = await applyCandidate(session, APPROVED_PATCH);
    expect(result).toMatchObject({ path: APP_PATH, sha256: hash(APPROVED_PATCH), sourceSha256: hash(REPAIRED_APP) });
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(REPAIRED_APP);
    expect(await readFile(join(repository, APP_PATH), 'utf8')).toBe(ORIGINAL_APP);
    expect(await verifyBindings(session)).toBe(true);
  });

  it('accepts an ordinary Git prefix while preserving the exact admitted output', async () => {
    const { session } = await start();
    const patch = `diff --git a/${APP_PATH} b/${APP_PATH}\nindex 123abcd..456def0 100644\n${APPROVED_PATCH}`;
    await applyCandidate(session, patch);
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(REPAIRED_APP);
    expect(await verifyBindings(session)).toBe(true);
  });

  it('accepts a minimal exact hunk without trusting omitted unchanged context', async () => {
    const { session } = await start();
    const patch = `--- a/${APP_PATH}\n+++ b/${APP_PATH}\n@@ -6 +6 @@\n-  return regressionRead();\n+  return privateRead();\n`;
    await applyCandidate(session, patch);
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(REPAIRED_APP);
  });

  it('rejects a second candidate without altering the first candidate result', async () => {
    const { session } = await start();
    await applyCandidate(session, APPROVED_PATCH);
    await rejection(applyCandidate(session, APPROVED_PATCH), 'CANDIDATE_ALREADY_APPLIED');
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(REPAIRED_APP);
  });

  it('serializes concurrent candidate admission so one session cannot apply twice', async () => {
    const { session } = await start();
    const outcomes = await Promise.allSettled([
      applyCandidate(session, APPROVED_PATCH), applyCandidate(session, APPROVED_PATCH),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 'rejected').reason.code).toBe('CANDIDATE_ALREADY_APPLIED');
  });

  it.each([
    ['empty', () => ''],
    ['non-string', () => ({ patch: APPROVED_PATCH })],
    ['oversize', () => 'x'.repeat(128 * 1024)],
    ['NUL', () => `${APPROVED_PATCH}\0`],
    ['extra file', () => `${APPROVED_PATCH}\n--- a/scripts/agent-harness/policy.mjs\n+++ b/scripts/agent-harness/policy.mjs\n@@ -1 +1 @@\n-safe\n+weakened\n`],
    ['traversal', () => APPROVED_PATCH.replaceAll(APP_PATH, '../app.mjs')],
    ['nested traversal', () => APPROVED_PATCH.replaceAll(APP_PATH, 'examples/agent-harness/../agent-harness/app.mjs')],
    ['absolute path', () => APPROVED_PATCH.replaceAll(APP_PATH, '/tmp/app.mjs')],
    ['Windows path', () => APPROVED_PATCH.replaceAll(APP_PATH, 'examples\\agent-harness\\app.mjs')],
    ['encoded path', () => APPROVED_PATCH.replaceAll(APP_PATH, 'examples/agent-harness/%2e%2e/app.mjs')],
    ['protected runner', () => APPROVED_PATCH.replaceAll(APP_PATH, 'scripts/agent-harness/browser-runner.mjs')],
    ['protected test', () => APPROVED_PATCH.replaceAll(APP_PATH, 'tests/e2e/agent-harness/controller.test.mjs')],
    ['renamed path', () => `${APPROVED_PATCH}\nrename from ${APP_PATH}\nrename to scripts/agent-harness/policy.mjs\n`],
    ['binary patch', () => `GIT binary patch\nliteral 1\nA\n${APPROVED_PATCH}`],
    ['suppressed useful read', () => APPROVED_PATCH.replace('return privateRead();', 'return undefined;')],
    ['additional execution', () => APPROVED_PATCH.replace('return privateRead();', 'globalThis.fetch = undefined; return privateRead();')],
    ['unchanged regression', () => APPROVED_PATCH.replace('return privateRead();', 'return regressionRead();')],
    ['trailing script', () => `${APPROVED_PATCH}\nprocess.exit(0);\n`],
  ])('rejects %s before modifying either source tree', async (_name, candidate) => {
    const { repository, session } = await start();
    await rejection(applyCandidate(session, candidate()), 'INVALID_PATCH');
    expect(await readFile(join(repository, APP_PATH), 'utf8')).toBe(ORIGINAL_APP);
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(ORIGINAL_APP);
    expect(session.candidate).toBeNull();
    expect(await verifyBindings(session)).toBe(true);
  });

  it('rejects a missing trusted source root', async () => {
    const context = await fixture();
    await rm(join(context.repository, TRUSTED_PATHS[0]), { recursive: true, force: true });
    await rejection(createSession(context), 'INVALID_SOURCE');
  });

  it('rejects an unrecognized original example instead of trusting a new baseline', async () => {
    const context = await fixture();
    await writeFile(join(context.repository, APP_PATH), REPAIRED_APP);
    await rejection(createSession(context), 'INVALID_SOURCE');
  });

  it('detects changes to the maintained original example while preserving its disposable copy', async () => {
    const { repository, session } = await start();
    await writeFile(join(repository, APP_PATH), `${ORIGINAL_APP}// unexpected edit\n`);
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
    await rejection(applyCandidate(session, APPROVED_PATCH), 'BINDING_CHANGED');
    expect(await readFile(join(session.exampleDirectory, 'app.mjs'), 'utf8')).toBe(ORIGINAL_APP);
  });

  it('detects additions to an unchanged trusted root before candidate execution', async () => {
    const { repository, session } = await start();
    await writeFile(join(repository, 'scripts/agent-harness/unreviewed.mjs'), 'export const changed = true;\n');
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
    await rejection(applyCandidate(session, APPROVED_PATCH), 'BINDING_CHANGED');
  });

  it('detects deletion of a trusted input instead of accepting fewer hashes', async () => {
    const { repository, session } = await start();
    const path = TRUSTED_PATHS.find((entry) => entry.endsWith('pnpm-lock.yaml'));
    expect(path).toBeDefined();
    await rm(join(repository, path));
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
  });

  it('rejects a trusted input exceeding the file-byte bound', async () => {
    const context = await fixture();
    await writeFile(join(context.repository, 'package.json'), Buffer.alloc(4 * 1024 * 1024 + 1));
    await rejection(createSession(context), 'INVALID_SOURCE');
  });

  it('detects tampering with the stored original even if its permissions are changed', async () => {
    const { session } = await start();
    const original = join(session.directory, 'original.mjs');
    await chmod(original, 0o600);
    await writeFile(original, REPAIRED_APP);
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
  });

  it('rejects replacement bindings supplied by a caller instead of trusting new hashes', async () => {
    const { session } = await start();
    session.bindings = { ...session.bindings };
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
  });

  it('rejects forged candidate acceptance metadata', async () => {
    const { session } = await start();
    session.candidate = { path: APP_PATH, sha256: hash(APPROVED_PATCH), sourceSha256: hash(REPAIRED_APP) };
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
  });

  it('uses the internally bound directory for cleanup after a caller changes public paths', async () => {
    const { directory, session } = await start();
    const originalDirectory = session.directory;
    const outsider = join(directory, 'unrelated');
    await mkdir(outsider);
    await writeFile(join(outsider, 'keep.txt'), 'Preserve unrelated files\n');
    session.directory = outsider;
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
    await closeSession(session);
    await expect(lstat(originalDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(outsider, 'keep.txt'), 'utf8')).toBe('Preserve unrelated files\n');
  });

  it('rejects a symlink in an intermediate package ancestor', async () => {
    const context = await fixture();
    const external = join(context.directory, 'outside-package');
    await mkdir(external);
    await rm(join(context.repository, 'packages/transport'), { recursive: true });
    await symlink(external, join(context.repository, 'packages/transport'), 'dir');
    await rejection(createSession(context), 'INVALID_SOURCE');
  });

  it('rejects a symlink in the source example without reading or changing its target', async () => {
    const context = await fixture();
    const external = join(context.directory, 'outside.mjs');
    await writeFile(external, ORIGINAL_APP);
    await rm(join(context.repository, APP_PATH));
    await symlink(external, join(context.repository, APP_PATH));
    await rejection(createSession(context), 'INVALID_SOURCE');
    expect(await readFile(external, 'utf8')).toBe(ORIGINAL_APP);
  });

  it('rejects a symlink nested in a protected source directory', async () => {
    const context = await fixture();
    const external = join(context.directory, 'outside-policy.mjs');
    await writeFile(external, 'PRIVATE TARGET MUST STAY UNREAD\n');
    await symlink(external, join(context.repository, 'scripts/agent-harness/policy-link.mjs'));
    await rejection(createSession(context), 'INVALID_SOURCE');
  });

  it('rejects an alias through a symlinked workspace parent', async () => {
    const context = await fixture();
    const alias = join(context.directory, 'workspace-alias');
    await symlink(context.workspaceRoot, alias, 'dir');
    await rejection(createSession({ repository: context.repository, workspaceRoot: alias }), 'INVALID_SOURCE');
  });

  it('rejects a symlinked repository root rather than recording an alias as provenance', async () => {
    const context = await fixture();
    const alias = join(context.directory, 'repository-alias');
    await symlink(context.repository, alias, 'dir');
    await rejection(createSession({ repository: alias, workspaceRoot: context.workspaceRoot }), 'INVALID_SOURCE');
  });

  it('rejects replacing the disposable candidate file with a symlink before patch application', async () => {
    const { directory, session } = await start();
    const external = join(directory, 'outside-candidate.mjs');
    await writeFile(external, ORIGINAL_APP);
    await rm(join(session.exampleDirectory, 'app.mjs'));
    await symlink(external, join(session.exampleDirectory, 'app.mjs'));
    await expect(applyCandidate(session, APPROVED_PATCH)).rejects.toThrow();
    expect(await readFile(external, 'utf8')).toBe(ORIGINAL_APP);
    expect(session.candidate).toBeNull();
  });

  it('detects a candidate source edited outside the admitted patch', async () => {
    const { session } = await start();
    await applyCandidate(session, APPROVED_PATCH);
    await writeFile(join(session.exampleDirectory, 'app.mjs'), `${REPAIRED_APP}// tampered\n`);
    await rejection(verifyBindings(session), 'BINDING_CHANGED');
  });

  it('cleans only its disposable directory and is safe to close repeatedly', async () => {
    const { repository, workspaceRoot, session } = await start();
    const sibling = join(workspaceRoot, 'retained.txt');
    await writeFile(sibling, 'Keep sibling\n');
    await closeSession(session);
    await closeSession(session);
    await expect(lstat(session.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sibling, 'utf8')).toBe('Keep sibling\n');
    expect(await readFile(join(repository, APP_PATH), 'utf8')).toBe(ORIGINAL_APP);
    await expect(applyCandidate(session, APPROVED_PATCH)).rejects.toThrow();
  });
});
