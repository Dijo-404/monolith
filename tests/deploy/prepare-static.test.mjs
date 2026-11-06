import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  buildEnvironment, inspectDistribution, parseArguments, parseGitTree,
  prepareStatic, publicObserverOrigin,
} from '../../scripts/deploy/prepare-static.mjs';

const OBSERVER = 'https://observer.monolith-app.org';
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'monolith-deploy-test-'));
  onTestFinished(() => rm(temp, { recursive: true, force: true }));
  const repo = join(temp, 'repo');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('remote', 'add', 'origin', 'https://github.com/Dijo-404/monolith.git');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'monolith', packageManager: 'pnpm@12.18.0' }));
  await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await writeFile(join(repo, 'LICENSE'), 'MIT test fixture license\n');
  await writeFile(join(repo, 'README.md'), 'Source captured from Git, not the working directory.\n');
  await writeFile(join(repo, '.gitignore'), '.env\n');
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Monolith Test', '-c', 'user.email=test@monolith.invalid', 'commit', '--quiet', '-m', 'Fixture');
    return git('rev-parse', 'HEAD');
  };
  const sha = commit();
  const pnpm = join(temp, 'pnpm-fixture');
  await writeFile(pnpm, `#!${process.execPath}\n` +
    `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';\n` +
    `if (process.argv[2] === '--version') { process.stdout.write('12.18.0\\n'); }\n` +
    `else if (process.argv[2] === 'install') {\n` +
    `  if (!process.argv.includes('--frozen-lockfile') || !process.argv.includes('--ignore-scripts') || !process.argv.includes('--ignore-pnpmfile')) process.exit(9);\n` +
    `  if (existsSync('notice-fixture.json')) {\n` +
    `    mkdirSync('apps/dashboard/node_modules/fixture-runtime', { recursive: true });\n` +
    `    writeFileSync('apps/dashboard/node_modules/fixture-runtime/package.json', '{"name":"fixture-runtime","version":"1.0.0"}');\n` +
    `    writeFileSync('apps/dashboard/node_modules/fixture-runtime/LICENSE', 'Fixture runtime MIT notice');\n` +
    `  }\n` +
    `} else if (process.argv[2] === 'build') {\n` +
    `  mkdirSync('apps/dashboard/dist/assets', { recursive: true });\n` +
    `  writeFileSync('apps/dashboard/dist/index.html', '<html><script type="module" src="/assets/main.js"></script></html>');\n` +
    `  writeFileSync('apps/dashboard/dist/assets/main.js', 'globalThis.fixtureEnv=' + JSON.stringify(process.env) + ';');\n` +
    `} else process.exit(8);\n`, { mode: 0o755 });
  return { temp, repo, git, commit, options: {
    repo, out: join(temp, 'snapshot'), commit: sha, node: process.execPath,
    pnpm, observerUrl: OBSERVER,
  } };
}

test('public configuration rejects credential-bearing and non-origin URLs before building', () => {
  assert.equal(publicObserverOrigin(`${OBSERVER}/`), OBSERVER);
  for (const url of [undefined, '', ' https://good.org', 'http://good.org', 'https://u:p@good.org',
    'https://good.org/api', 'https://good.org/?key=secret', 'https://good.org/#secret',
    'https://localhost', 'https://127.1', 'https://[::1]', 'https://private.internal',
    'https://good.org:8443']) {
    assert.throws(() => publicObserverOrigin(url));
  }
  assert.throws(() => parseArguments(['--out', '/tmp/test', '--out', '/tmp/other']));
  assert.throws(() => parseArguments(['--unknown', 'value']));
});

test('build environment is an explicit projection without ambient secrets or Node injection', () => {
  const env = buildEnvironment('/pinned/node', '/isolated/build-state', OBSERVER);
  assert.deepEqual(Object.keys(env).sort(), [
    'CI', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'LANG', 'MONOLITH_PUBLIC_OBSERVER_URL',
    'NPM_CONFIG_CACHE', 'NPM_CONFIG_GLOBALCONFIG', 'NPM_CONFIG_USERCONFIG', 'PATH', 'TMPDIR', 'TZ',
    'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME',
  ].sort());
  assert.equal(env.MONOLITH_PUBLIC_OBSERVER_URL, OBSERVER);
  assert.equal(env.HOME, undefined);
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/dev/null');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
});

test('source export rejects symlinks, submodules, env files, credentials and generated paths', () => {
  const blob = 'a'.repeat(40);
  assert.equal(parseGitTree(Buffer.from(`100644 blob ${blob}\t.env.example\0`))[0].path, '.env.example');
  for (const record of [
    `120000 blob ${blob}\tlink`, `160000 commit ${blob}\tsubmodule`,
    ...['../escape', '/absolute', 'a/../escape', '.env', 'a/.env.production',
      'a/node_modules/package.json', 'apps/dashboard/dist/index.html', 'signer.pem',
      '.npmrc', '.git/HEAD', 'vendor/code.js', 'a\\escape'].map((path) => `100644 blob ${blob}\t${path}`),
  ]) assert.throws(() => parseGitTree(Buffer.from(`${record}\0`)));
});

test('artifact boundary rejects absent/empty output, symlink assets and copied server files', async () => {
  const { temp } = await fixture();
  const dist = join(temp, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<html><script src="/assets/main.js"></script></html>');
  await assert.rejects(inspectDistribution(dist), /Expected a fresh/);
  await writeFile(join(dist, 'assets/main.js'), '');
  await assert.rejects(inspectDistribution(dist), /empty/);
  await writeFile(join(dist, 'assets/main.js'), 'console.log("fixture");');
  await writeFile(join(dist, 'server.env'), 'TEST_SECRET=not-real');
  await assert.rejects(inspectDistribution(dist), /index.html and assets/);
  await rm(join(dist, 'server.env'));
  await symlink('/etc/passwd', join(dist, 'assets/leak.js'));
  await assert.rejects(inspectDistribution(dist), /symlink/);
});

test('existing and repository-local output paths never overwrite files', async () => {
  const { temp, repo, options } = await fixture();
  const sentinel = join(temp, 'existing');
  await mkdir(sentinel);
  await writeFile(join(sentinel, 'keep.txt'), 'keep');
  for (const out of [sentinel, join(repo, 'output'), `${temp}/../escape`]) {
    await assert.rejects(prepareStatic({ ...options, out }));
  }
  assert.equal(await readFile(join(sentinel, 'keep.txt'), 'utf8'), 'keep');
});

test('dirty/stale source and Git export substitutions are refused without creating output', async () => {
  const f = await fixture();
  await writeFile(join(f.repo, 'README.md'), 'Uncommitted change');
  await assert.rejects(prepareStatic(f.options), /Commit all source/);
  const next = f.commit();
  await assert.rejects(prepareStatic(f.options), /clean HEAD/);
  await writeFile(join(f.repo, '.gitattributes'), 'README.md export-ignore\n');
  const ignored = f.commit();
  assert.notEqual(next, ignored);
  await assert.rejects(prepareStatic({ ...f.options, commit: ignored }), /omitted/);
  assert.equal((await readdir(f.temp)).includes('snapshot'), false);
});

test('private committed source produces bound assets; source archive and ignored env are excluded', async () => {
  const f = await fixture();
  await writeFile(join(f.repo, '.env'), 'PRIVATE_SENTINEL=private-sentinel-should-not-be-exported\n');
  const oldSecret = process.env.MONOLITH_PRIVATE_TEST_SENTINEL;
  const oldOptions = process.env.NODE_OPTIONS;
  process.env.MONOLITH_PRIVATE_TEST_SENTINEL = 'private-sentinel-should-not-be-exported';
  process.env.NODE_OPTIONS = '--untrusted-node-injection';
  onTestFinished(() => {
    if (oldSecret === undefined) delete process.env.MONOLITH_PRIVATE_TEST_SENTINEL;
    else process.env.MONOLITH_PRIVATE_TEST_SENTINEL = oldSecret;
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldOptions;
  });
  const provenance = await prepareStatic(f.options);
  assert.equal(provenance.status, 'ARTIFACTS_PREPARED_ONLY');
  assert.equal(provenance.source.commit, f.options.commit);
  assert.equal(provenance.build.ambientEnvironmentForwarded, false);
  assert.deepEqual(await readdir(f.options.out), ['LICENSE', 'README.md', 'dist', 'provenance.json']);
  assert.equal(provenance.sourceRepositoryVisibility, 'private');
  assert.equal(provenance.sourceDisclosure, 'compiled-static-artifact-only');
  assert.equal(provenance.source.archiveRetained, false);
  for (const artifact of provenance.artifacts) {
    const bytes = await readFile(join(f.options.out, artifact.path));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
    assert.equal(bytes.includes(Buffer.from('private-sentinel-should-not-be-exported')), false);
  }
  const tar = execFileSync('git', ['-C', f.repo, 'archive', '--format=tar', f.options.commit]);
  assert.equal(provenance.source.archiveSha256, createHash('sha256').update(tar).digest('hex'));
  const bundle = await readFile(join(f.options.out, 'dist/assets/main.js'), 'utf8');
  assert.equal(bundle.includes('NODE_OPTIONS'), false);
  assert.equal(bundle.includes('MONOLITH_PRIVATE_TEST_SENTINEL'), false);
  assert.equal(bundle.includes(OBSERVER), true);
});

test('required font/runtime notices are retained without copying similarly named private source', async () => {
  const f = await fixture();
  await mkdir(join(f.repo, 'apps/dashboard/src/fonts'), { recursive: true });
  await writeFile(join(f.repo, 'apps/dashboard/package.json'), JSON.stringify({
    name: '@monolith/dashboard', dependencies: { 'fixture-runtime': '1.0.0' },
  }));
  await writeFile(join(f.repo, 'apps/dashboard/src/fonts/OFL.txt'), 'Fixture font license notice');
  await writeFile(join(f.repo, 'apps/dashboard/src/LICENSE.ts'), 'private-source-sentinel-never-disclose');
  await writeFile(join(f.repo, 'notice-fixture.json'), '{}');
  const provenance = await prepareStatic({ ...f.options, commit: f.commit() });
  assert.equal(provenance.retainedNotices.length, 2);
  assert.equal(provenance.retainedNotices.some((entry) => entry.path.endsWith('/OFL.txt')), true);
  assert.equal(provenance.retainedNotices.some((entry) => entry.path.endsWith('/LICENSE.ts')), false);
  for (const entry of provenance.retainedNotices) {
    const bytes = await readFile(join(f.options.out, entry.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.includes(Buffer.from('private-source-sentinel-never-disclose')), false);
  }
});
