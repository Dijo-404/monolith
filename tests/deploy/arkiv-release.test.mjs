import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSwarmRelease } from '@monolith/registry/swarm-release';
import { parseReleaseArguments, runSwarmRelease } from '../../scripts/deploy/arkiv-release.ts';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal(), execFileSync: vi.fn(),
}));

const { execFileSync: realExecFileSync } = await vi.importActual('node:child_process');
const directories = [];
const checkoutRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
let gitRepository;
let sourceCommit;
let descriptor;
const publisher = `0x${'1'.repeat(40)}`;
const entityKey = `0x${'2'.repeat(64)}`;
const sentinel = 'SYNTHETIC_PRIVATE_VALUE_NOT_A_REAL_SIGNING_KEY';
const now = '2026-11-07T01:00:00.000Z';
const files = ['index.html', 'assets/worker-host.html', 'assets/THIRD-PARTY-NOTICES.txt'].map((path) => ({
  path, bytes: 1, sha256: createHash('sha256').update(path).digest('hex'),
}));

// Real Git operates only in a disposable repository, without inherited Git configuration or hooks.
function fixtureGit(args, options = {}) {
  return realExecFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    ...options, cwd: gitRepository,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Monolith test fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Monolith test fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: now, GIT_COMMITTER_DATE: now },
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'monolith-release-cli-test-'));
  directories.push(directory);
  const inventory = join(directory, 'inventory.json');
  const input = join(directory, 'descriptor.json');
  await writeFile(inventory, JSON.stringify({ sourceCommit, files }));
  await writeFile(input, JSON.stringify(descriptor));
  return { directory, inventory, input };
}

function execution(overrides = {}) {
  return {
    now: () => now,
    loadSigningKey: vi.fn(async () => sentinel),
    publish: vi.fn(async () => ({ entityKey, transactionHash: `0x${'3'.repeat(64)}`,
      expiresAtBlock: '1000', descriptor, maximumFeeWei: '2000000000000000', evidence: 'SIMULATED' })),
    read: vi.fn(async () => ({ entityKey, publisher, descriptor, files, evidence: 'SIMULATED' })),
    ...overrides,
  };
}

function publishArgs(f, output = 'publish') {
  return ['publish', '--descriptor', f.input, '--publisher', publisher,
    '--key-file', join(f.directory, 'explicit-operator-key'), '--max-total-fee-wei', '2000000000000000',
    '--state', join(f.directory, 'state'), '--out', join(f.directory, output)];
}

function previewArgs(f, commit = sourceCommit, output = 'preview') {
  return ['preview', '--inventory', f.inventory, '--reference', 'a'.repeat(64),
    '--source', commit, '--expires-at', descriptor.expiresAt, '--out', join(f.directory, output)];
}

beforeEach(async () => {
  vi.stubEnv('DEBUG', '');
  vi.mocked(execFileSync).mockReset();
  gitRepository = await mkdtemp(join(tmpdir(), 'monolith-release-git-fixture-'));
  directories.push(gitRepository);
  fixtureGit(['init', '--initial-branch=main']);
  fixtureGit(['commit', '--allow-empty', '-m', 'Accepted fixture source']);
  sourceCommit = fixtureGit(['rev-parse', 'HEAD']).trim();
  fixtureGit(['update-ref', 'refs/remotes/origin/main', sourceCommit]);
  descriptor = createSwarmRelease({ sourceCommit, swarmReference: 'a'.repeat(64),
    publishedAt: now, expiresAt: '2026-11-08T01:00:00.000Z', files });
  // Only the production CLI import uses this mock; its source policy still executes real Git.
  vi.mocked(execFileSync).mockImplementation((command, args, options) => {
    expect(command).toBe('git'); expect(options.cwd).toBe(checkoutRoot);
    return fixtureGit(args, options);
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Swarm release operator boundary (SIMULATED)', () => {
  it('previews the exact inventory and accepted source without reading a signer or making a network call', async () => {
    const f = await fixture(); const dependencies = execution();
    const result = await runSwarmRelease(previewArgs(f), dependencies);
    expect(result.status).toBe('DESCRIPTOR_PREVIEW_ONLY');
    expect(result.evidence).toBe('UNTESTED');
    expect(result.descriptor).toEqual(descriptor);
    expect(dependencies.loadSigningKey).not.toHaveBeenCalled();
    expect(dependencies.publish).not.toHaveBeenCalled(); expect(dependencies.read).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(f.directory, 'preview/descriptor.json'), 'utf8'))).toEqual(descriptor);
    expect(execFileSync).toHaveBeenCalledWith('git', ['cat-file', '-t', sourceCommit], expect.any(Object));
    expect(execFileSync).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', sourceCommit, 'origin/main'], expect.any(Object));
  });

  it('rejects keys on preview/read, duplicate flags, missing values and relative output before execution', () => {
    const base = ['read', '--entity', entityKey, '--publisher', publisher, '--out', '/tmp/new-report'];
    for (const args of [[...base, '--key-file', '/tmp/key'], [...base, '--out', '/tmp/other'],
      ['preview', '--inventory'], ['read', '--entity', entityKey, '--publisher', publisher, '--out', 'relative']]) {
      expect(() => parseReleaseArguments(args)).toThrow('SWARM_RELEASE_FAILED');
    }
  });

  it('durably reserves a publisher/release journal before the single create, then confirms and independently reads', async () => {
    const f = await fixture(); const state = join(f.directory, 'state');
    const dependencies = execution({ publish: vi.fn(async (options) => {
      const entries = await readdir(state); expect(entries).toHaveLength(1);
      const reserved = JSON.parse(await readFile(join(state, entries[0]), 'utf8'));
      expect(reserved.phase).toBe('SUBMISSION_UNCERTAIN');
      expect(reserved.automaticRetryAllowed).toBe(false);
      expect(options.privateKey).toBe(sentinel);
      return { entityKey, transactionHash: `0x${'3'.repeat(64)}`, expiresAtBlock: '1000', descriptor,
        maximumFeeWei: '2000000000000000', evidence: 'SIMULATED' };
    }) });
    const result = await runSwarmRelease(publishArgs(f), dependencies);
    expect(result.status).toBe('RELEASE_ENTITY_AND_CONTENT_VERIFIED'); expect(result.evidence).toBe('SIMULATED');
    expect(dependencies.publish).toHaveBeenCalledTimes(1); expect(dependencies.read).toHaveBeenCalledTimes(1);
    const journal = await readFile(join(state, (await readdir(state))[0]), 'utf8');
    expect(JSON.parse(journal).phase).toBe('CONFIRMED'); expect(journal).not.toContain(sentinel);
    const receipt = await readFile(join(f.directory, 'publish/publication.json'), 'utf8');
    expect(receipt).not.toContain(sentinel); expect(receipt).not.toContain('explicit-operator-key');
  });

  it('retains uncertainty and rejects a new-output replay of the same publisher/release', async () => {
    const f = await fixture();
    const dependencies = execution({ publish: vi.fn(async () => { throw new Error(sentinel); }) });
    await expect(runSwarmRelease(publishArgs(f), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    const blocked = await readFile(join(f.directory, 'publish/blocked.json'), 'utf8');
    expect(blocked).not.toContain(sentinel); expect(JSON.parse(blocked).automaticRetryAllowed).toBe(false);
    const state = join(f.directory, 'state');
    expect(JSON.parse(await readFile(join(state, (await readdir(state))[0]), 'utf8')).phase).toBe('SUBMISSION_UNCERTAIN');
    await expect(runSwarmRelease(publishArgs(f, 'second-output'), dependencies)).rejects.toThrow();
    await writeFile(f.input, JSON.stringify(createSwarmRelease({ sourceCommit,
      swarmReference: descriptor.swarmReference, publishedAt: '2026-11-07T01:01:00.000Z',
      expiresAt: descriptor.expiresAt, files })));
    await expect(runSwarmRelease(publishArgs(f, 'fresh-timestamps'), dependencies)).rejects.toThrow();
    expect(dependencies.publish).toHaveBeenCalledTimes(1);
  });

  it('does not turn a failed content read-back into permission to publish again', async () => {
    const f = await fixture();
    const dependencies = execution({ read: vi.fn(async () => { throw new Error('CONTENT_MISMATCH'); }) });
    await expect(runSwarmRelease(publishArgs(f), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    const state = join(f.directory, 'state');
    expect(JSON.parse(await readFile(join(state, (await readdir(state))[0]), 'utf8')).phase).toBe('CONFIRMED');
    expect(JSON.parse(await readFile(join(f.directory, 'publish/publication.json'), 'utf8')).status).toBe('RELEASE_ENTITY_CONFIRMED');
    await expect(runSwarmRelease(publishArgs(f, 'second-output'), dependencies)).rejects.toThrow();
    expect(dependencies.publish).toHaveBeenCalledTimes(1);
  });

  it('retains known entity and transaction IDs before a later receipt or read-back failure', async () => {
    const f = await fixture();
    const created = { entityKey, transactionHash: `0x${'3'.repeat(64)}`, expiresAtBlock: '1000' };
    const dependencies = execution({ publish: vi.fn(async (options) => {
      await options.onCreated(created);
      const state = join(f.directory, 'state');
      const journal = JSON.parse(await readFile(join(state, (await readdir(state))[0]), 'utf8'));
      expect(journal.phase).toBe('SUBMISSION_KNOWN'); expect(journal.publication).toEqual(created);
      throw new Error('LATER_READ_BACK_FAILED');
    }) });
    await expect(runSwarmRelease(publishArgs(f), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    const state = join(f.directory, 'state');
    const retained = JSON.parse(await readFile(join(state, (await readdir(state))[0]), 'utf8'));
    expect(retained.phase).toBe('SUBMISSION_KNOWN'); expect(retained.publication).toEqual(created);
    await expect(runSwarmRelease(publishArgs(f, 'second-output'), dependencies)).rejects.toThrow();
    expect(dependencies.publish).toHaveBeenCalledTimes(1);
  });

  it('keeps read key-free and rejects unsafe explicitly selected access files without falling back', async () => {
    const f = await fixture(); const dependencies = execution();
    const args = ['read', '--entity', entityKey, '--publisher', publisher, '--out', join(f.directory, 'read')];
    const result = await runSwarmRelease(args, dependencies);
    expect(result.status).toBe('TRUSTED_RELEASE_CONTENT_VERIFIED'); expect(result.signingKeyLoaded).toBe(false);
    expect(dependencies.loadSigningKey).not.toHaveBeenCalled(); expect(dependencies.publish).not.toHaveBeenCalled();
    const selected = join(f.directory, 'access.env');
    await writeFile(selected, `ARKIV_ACCESS_KEY=${sentinel}\n`, { mode: 0o644 });
    await chmod(selected, 0o644);
    await expect(runSwarmRelease([...args.slice(0, -1), join(f.directory, 'unsafe-read'),
      '--access-key-file', selected], dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    expect(dependencies.read).toHaveBeenCalledTimes(1);
  });

  it('refuses unknown source provenance, existing outputs and debug mode before a signing call', async () => {
    const f = await fixture(); const dependencies = execution();
    await writeFile(f.input, JSON.stringify(createSwarmRelease({ sourceCommit: 'f'.repeat(40),
      swarmReference: descriptor.swarmReference, publishedAt: descriptor.publishedAt,
      expiresAt: descriptor.expiresAt, files })));
    await expect(runSwarmRelease(publishArgs(f), dependencies)).rejects.toThrow();
    expect(dependencies.loadSigningKey).not.toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledWith('git', ['cat-file', '-t', 'f'.repeat(40)], expect.any(Object));
    await mkdir(join(f.directory, 'already'));
    await expect(runSwarmRelease(['read', '--entity', entityKey, '--publisher', publisher,
      '--out', join(f.directory, 'already')], dependencies)).rejects.toThrow();
    vi.stubEnv('DEBUG', '1');
    await expect(runSwarmRelease(['read', '--entity', entityKey, '--publisher', publisher,
      '--out', join(f.directory, 'debug')], dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    expect(dependencies.loadSigningKey).not.toHaveBeenCalled();
  });

  it('rejects a real commit outside origin/main ancestry on preview and publish before signing', async () => {
    const f = await fixture(); const dependencies = execution();
    fixtureGit(['commit', '--allow-empty', '-m', 'Unaccepted fixture descendant']);
    const unaccepted = fixtureGit(['rev-parse', 'HEAD']).trim();
    expect(fixtureGit(['cat-file', '-t', unaccepted]).trim()).toBe('commit');
    await writeFile(f.inventory, JSON.stringify({ sourceCommit: unaccepted, files }));
    await writeFile(f.input, JSON.stringify(createSwarmRelease({ sourceCommit: unaccepted,
      swarmReference: descriptor.swarmReference, publishedAt: descriptor.publishedAt,
      expiresAt: descriptor.expiresAt, files })));
    await expect(runSwarmRelease(previewArgs(f, unaccepted), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    await expect(runSwarmRelease(publishArgs(f), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    expect(execFileSync).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', unaccepted, 'origin/main'], expect.any(Object));
    expect(dependencies.loadSigningKey).not.toHaveBeenCalled();
    expect(dependencies.publish).not.toHaveBeenCalled(); expect(dependencies.read).not.toHaveBeenCalled();
  });

  it('fails closed when origin/main is missing even for a valid local commit before signing', async () => {
    const f = await fixture(); const dependencies = execution();
    fixtureGit(['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(fixtureGit(['cat-file', '-t', sourceCommit]).trim()).toBe('commit');
    await expect(runSwarmRelease(previewArgs(f), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    await expect(runSwarmRelease(publishArgs(f), dependencies)).rejects.toThrow('SWARM_RELEASE_FAILED');
    expect(execFileSync).toHaveBeenCalledTimes(4);
    expect(execFileSync).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', sourceCommit, 'origin/main'], expect.any(Object));
    expect(dependencies.loadSigningKey).not.toHaveBeenCalled();
    expect(dependencies.publish).not.toHaveBeenCalled(); expect(dependencies.read).not.toHaveBeenCalled();
  });
});
