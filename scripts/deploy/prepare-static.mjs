import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = '24.22.2';
export const PNPM_VERSION = '12.18.0';
const REPOSITORY = 'Dijo-404/monolith';
const SOURCE_LIMIT = 64 * 1024 * 1024;
const FILE_LIMIT = 24 * 1024 * 1024;
const ENTRY_LIMIT = 20_000;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function publicObserverOrigin(value) {
  requireValue(typeof value === 'string' && value.length <= 2048 && value === value.trim(),
    'An explicit public HTTPS observer origin is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid observer origin.'); }
  requireValue(url.protocol === 'https:' && url.username === '' && url.password === '' &&
    url.pathname === '/' && url.search === '' && url.hash === '' && url.port === '' &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname) &&
    url.hostname.includes('.') && !url.hostname.endsWith('.') &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(url.hostname) &&
    !/^[0-9.]+$/.test(url.hostname),
  'Observer must be a public HTTPS origin without credentials, port, path, query or fragment.');
  return url.origin;
}

export function buildEnvironment(nodePath, buildStateDirectory, observerUrl, pnpmPath) {
  return {
    PATH: [dirname(nodePath), dirname(pnpmPath), '/usr/bin', '/bin'].join(sep === '/' ? ':' : ';'),
    XDG_CONFIG_HOME: join(buildStateDirectory, 'config'),
    XDG_CACHE_HOME: join(buildStateDirectory, 'cache'),
    XDG_STATE_HOME: join(buildStateDirectory, 'state'),
    TMPDIR: join(buildStateDirectory, 'tmp'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: '/dev/null',
    NPM_CONFIG_CACHE: join(buildStateDirectory, 'npm-cache'),
    CI: '1', LANG: 'C.UTF-8', TZ: 'UTC',
    MONOLITH_PUBLIC_OBSERVER_URL: publicObserverOrigin(observerUrl),
  };
}

function safePath(path) {
  requireValue(typeof path === 'string' && path.length > 0 && path.length <= 1024 &&
    !path.startsWith('/') && !path.includes('\\') &&
    ![...path].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  'Source contains an unsafe path.');
  const parts = path.toLowerCase().split('/');
  requireValue(!parts.some((part) => [
    '.git', 'node_modules', 'vendor', 'dist', '.pnpm-store', 'coverage',
    'playwright-report', 'test-results', '.cache',
  ].includes(part)), 'Source contains a generated or private directory.');
  requireValue(!parts.some((part) =>
    (part === '.env' || part.startsWith('.env.')) && part !== '.env.example'),
  'Source contains a real environment file.');
  requireValue(!parts.some((part) =>
    /^(?:\.npmrc|\.netrc|\.git-credentials|id_rsa|id_ed25519|credentials)$/.test(part) ||
    /\.(?:pem|key|p12|pfx|keystore)$/.test(part)), 'Source contains a credential-like file.');
  return path;
}

export function parseGitTree(buffer) {
  const entries = buffer.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const match = /^([0-9]{6}) (blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
    requireValue(match && ['100644', '100755'].includes(match[1]) && match[2] === 'blob',
      'Only regular Git-tracked source files are allowed; symlinks and submodules are rejected.');
    return { path: safePath(match[4]), blob: match[3] };
  });
  requireValue(entries.length > 0 && entries.length <= ENTRY_LIMIT, 'Source file count is out of bounds.');
  requireValue(new Set(entries.map((entry) => entry.path)).size === entries.length,
    'Source contains duplicate paths.');
  return entries;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function run(command, args, { cwd, env, capture = false, timeout = 600_000 } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd, env, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    });
    const chunks = [];
    let size = 0;
    let expired = false;
    const stop = () => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
      catch { /* Process group has already exited. */ }
    };
    const timer = setTimeout(() => { expired = true; stop(); }, timeout);
    if (capture) {
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (data) => {
          size += data.length;
          if (size > SOURCE_LIMIT) { expired = true; stop(); }
          else chunks.push(data);
        });
      }
    }
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('A required build command could not start.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      stop();
      if (expired || code !== 0) reject(new Error('A required command failed or exceeded its bound.'));
      else accept(Buffer.concat(chunks));
    });
  });
}

async function regularFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safePath(path);
    requireValue(!entry.isSymbolicLink(), 'Artifact or source contains a symlink.');
    if (entry.isDirectory()) files.push(...await regularFiles(root, path));
    else {
      requireValue(entry.isFile(), 'Only regular files are allowed.');
      files.push(path);
    }
    requireValue(files.length <= ENTRY_LIMIT, 'Artifact file count is out of bounds.');
  }
  return files.sort();
}

async function verifyExtractedSource(root, entries) {
  const files = await regularFiles(root);
  requireValue(files.length === entries.length, 'Git archive omitted or added source files.');
  let bytes = 0;
  for (const entry of entries) {
    const info = await stat(join(root, entry.path));
    bytes += info.size;
    requireValue(info.size <= FILE_LIMIT && bytes <= SOURCE_LIMIT, 'Source size is out of bounds.');
    const data = await readFile(join(root, entry.path));
    const gitBlob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    requireValue(gitBlob === entry.blob, 'Git archive changed tracked source bytes.');
    requireValue(!/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(data.toString('utf8')),
      'Source contains private key material.');
  }
}

export async function inspectDistribution(root) {
  const files = await regularFiles(root);
  requireValue(files.includes('index.html') && files.some((path) => path.startsWith('assets/')) &&
    files.every((path) => path === 'index.html' || path.startsWith('assets/')),
  'Expected a fresh Vite index.html and assets directory only.');
  let bytes = 0;
  const artifacts = [];
  for (const path of files) {
    const info = await stat(join(root, path));
    bytes += info.size;
    requireValue(info.size > 0 && info.size <= FILE_LIMIT && bytes <= SOURCE_LIMIT,
      'Static output is empty or too large.');
    const data = await readFile(join(root, path));
    artifacts.push({ path: `dist/${path}`, bytes: data.length, sha256: sha256(data) });
  }
  const html = await readFile(join(root, 'index.html'), 'utf8');
  requireValue(/<html(?:\s|>)/i.test(html) && /<script\b[^>]*src=["']\/assets\/[^"']+["']/i.test(html),
    'Vite HTML must reference a generated local asset.');
  return artifacts;
}

async function collectNotices(source, entries) {
  const notices = [];
  let totalBytes = 0;
  const add = async (path, destination) => {
    requireValue((await stat(path)).size <= 1024 * 1024, 'A license notice exceeded its size bound.');
    const bytes = await readFile(path);
    totalBytes += bytes.length;
    requireValue(totalBytes <= 16 * 1024 * 1024, 'License notices exceeded their size bound.');
    notices.push({ path: destination, bytes, sha256: sha256(bytes) });
  };
  const isNotice = (name) => /^(?:licen[cs]e(?:-(?:MIT|APACHE|BSD))?|notice|ofl)(?:\.(?:txt|md|rst))?$/i.test(name);
  for (const entry of entries) {
    if ((entry.path.startsWith('apps/dashboard/') && isNotice(entry.path.split('/').at(-1))) ||
      entry.path === 'packages/registry/src/adapters/source/LICENSE.ethereum-lists-chains') {
      await add(join(source, entry.path), `notices/source/${entry.path}`);
    }
  }
  const visited = new Set();
  const visit = async (packageRoot) => {
    const root = await realpath(packageRoot);
    requireValue(root.startsWith(`${source}/`), 'A package license escaped the isolated source tree.');
    if (visited.has(root)) return;
    visited.add(root);
    requireValue(visited.size <= 2000, 'Package notice traversal exceeded its bound.');
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (!packageJson.name?.startsWith('@monolith/')) {
      const label = sha256(Buffer.from(relative(source, root))).slice(0, 16);
      for (const name of (await readdir(root)).filter(isNotice).sort()) {
        const path = join(root, name);
        requireValue((await lstat(path)).isFile(), 'Package notices must be regular files.');
        await add(path, `notices/packages/${label}/${name}`);
      }
    }
    for (const name of Object.keys(packageJson.dependencies ?? {}).sort()) {
      requireValue(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name), 'Invalid dependency name.');
      let cursor = root;
      let dependency;
      while (cursor === source || cursor.startsWith(`${source}/`)) {
        const candidate = join(cursor, 'node_modules', name);
        try { dependency = await realpath(candidate); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        cursor = dirname(cursor);
      }
      requireValue(dependency, 'A runtime dependency is unavailable for retained license notices.');
      await visit(dependency);
    }
  };
  const dashboard = join(source, 'apps/dashboard/package.json');
  try { await stat(dashboard); await visit(dirname(dashboard)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return notices;
}

async function validateOutput(repo, output) {
  requireValue(typeof output === 'string' && isAbsolute(output) &&
    !output.split(sep).some((part) => part === '..' || part === '.'),
  'Output must be an absolute, new directory path without traversal.');
  const parent = dirname(output);
  requireValue(await realpath(parent) === parent, 'Output parent must exist without symlink aliases.');
  const fromRepo = relative(repo, output);
  requireValue(fromRepo.startsWith(`..${sep}`), 'Output must be outside the repository.');
  let exists = true;
  try { await lstat(output); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
  requireValue(!exists, 'Output already exists; it will not be overwritten.');
}

/** Produces build artifacts only. It does not publish or establish runtime/sponsor acceptance. */
export async function prepareStatic(options) {
  const repo = await realpath(options.repo);
  const output = options.out;
  const observerUrl = publicObserverOrigin(options.observerUrl);
  requireValue(/^[0-9a-f]{40}$/.test(options.commit ?? ''), 'A full lowercase Git commit SHA is required.');
  await validateOutput(repo, output);
  requireValue(isAbsolute(options.node) && isAbsolute(options.pnpm), 'Tool paths must be absolute.');
  const node = await realpath(options.node);
  const pnpm = await realpath(options.pnpm);
  const temp = await mkdtemp(join(tmpdir(), 'monolith-static-'));
  let outputCreated = false;
  try {
    const buildStateDirectory = join(temp, 'build-state');
    await mkdir(join(buildStateDirectory, 'tmp'), { recursive: true });
    const env = buildEnvironment(node, buildStateDirectory, observerUrl, pnpm);
    const git = (args) => run('git', ['-C', repo, ...args], { env, capture: true, timeout: 30_000 });
    const head = (await git(['rev-parse', '--verify', 'HEAD'])).toString('utf8').trim();
    requireValue(head === options.commit, 'Requested source must match the clean HEAD captured before building.');
    const dirty = await git(['status', '--porcelain=v1', '--untracked-files=normal']);
    requireValue(dirty.length === 0, 'Commit all source changes before preparing a release.');
    const origin = (await git(['remote', 'get-url', 'origin'])).toString('utf8').trim();
    requireValue(origin === `https://github.com/${REPOSITORY}.git` || origin === `git@github.com:${REPOSITORY}.git`,
      'Source origin must be the expected Monolith repository without embedded credentials.');
    const entries = parseGitTree(await git(['ls-tree', '-rz', options.commit]));
    const tar = join(temp, 'source.tar');
    await git(['archive', '--format=tar', '--output', tar, options.commit]);
    requireValue((await stat(tar)).size <= SOURCE_LIMIT, 'Source archive is too large.');
    const source = join(temp, 'source');
    await mkdir(source);
    await run('tar', ['-xf', tar, '-C', source], { env, timeout: 30_000 });
    await verifyExtractedSource(source, entries);
    requireValue((await run(node, ['--version'], { env, capture: true })).toString('utf8').trim() === `v${NODE_VERSION}`,
      `Use the pinned Node ${NODE_VERSION}.`);
    requireValue((await run(pnpm, ['--version'], { env, capture: true })).toString('utf8').trim() === PNPM_VERSION,
      `Use the pinned pnpm ${PNPM_VERSION}.`);
    const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    requireValue(packageJson.name === 'monolith' && packageJson.packageManager === `pnpm@${PNPM_VERSION}`,
      'Source package manager does not match the pinned Monolith build.');
    await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile',
      '--store-dir', join(temp, 'store')], { cwd: source, env });
    await run(pnpm, ['build'], { cwd: source, env });
    const dist = join(source, 'apps/dashboard/dist');
    const artifacts = await inspectDistribution(dist);
    const archiveSha256 = sha256(await readFile(tar));
    const license = await readFile(join(source, 'LICENSE'));
    requireValue(license.length > 0, 'A retained source license is required.');
    const notices = await collectNotices(source, entries);
    const provenance = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'ARTIFACTS_PREPARED_ONLY',
      sourceRepositoryVisibility: 'private',
      sourceDisclosure: 'compiled-static-artifact-only',
      source: {
        repository: `https://github.com/${REPOSITORY}`,
        commit: options.commit,
        url: `https://github.com/${REPOSITORY}/tree/${options.commit}`,
        visibilityNote: 'Recorded private during MN-023 using gh repo view --json isPrivate; not re-queried by the packager.',
        archiveFormat: 'git-tar', archiveSha256, archiveRetained: false,
        trackedFiles: entries.length,
      },
      build: {
        node: NODE_VERSION, pnpm: PNPM_VERSION,
        commands: ['pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --store-dir <isolated>', 'pnpm build'],
        publicEnvironment: { MONOLITH_PUBLIC_OBSERVER_URL: observerUrl },
        ambientEnvironmentForwarded: false,
      },
      artifacts,
      retainedNotices: notices.map(({ path, bytes, sha256: hash }) => ({ path, bytes: bytes.length, sha256: hash })),
      limits: [
        'Build preparation is not a deployment or runtime verification.',
        'No assertion of anonymity, live integration, payment settlement or sponsor acceptance.',
        'No observer/backend process is included in static hosting.',
      ],
    };
    // mkdir is exclusive: a concurrent preparer cannot replace an existing release.
    await mkdir(output);
    outputCreated = true;
    await cp(dist, join(output, 'dist'), { recursive: true, force: false, errorOnExist: true });
    await writeFile(join(output, 'LICENSE'), license, { flag: 'wx' });
    for (const notice of notices) {
      await mkdir(dirname(join(output, notice.path)), { recursive: true });
      await writeFile(join(output, notice.path), notice.bytes, { flag: 'wx' });
    }
    await writeFile(join(output, 'README.md'),
      `# Monolith static snapshot\n\nBuilt from [${options.commit}](${provenance.source.url}).\n\n` +
      'Serve only `dist/`. This project retains compiled static artifacts, provenance and required license notices.\n' +
      'The private Git source archive is used temporarily for the build and is not included in this snapshot.\n\n' +
      'This snapshot prepares artifacts; it does not prove live privacy, backend availability or sponsor acceptance.\n',
    { flag: 'wx' });
    await writeFile(join(output, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
    return provenance;
  } catch (error) {
    if (outputCreated) await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export function parseArguments(args) {
  const values = {};
  const keys = new Map([
    ['--repo', 'repo'], ['--out', 'out'], ['--commit', 'commit'],
    ['--node', 'node'], ['--pnpm', 'pnpm'], ['--observer-url', 'observerUrl'],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = keys.get(args[index]);
    requireValue(key && !Object.hasOwn(values, key) && args[index + 1] && !args[index + 1].startsWith('--'),
      'Use each documented flag once with an explicit value.');
    values[key] = args[index + 1];
  }
  values.repo ??= resolve(fileURLToPath(new URL('../..', import.meta.url)));
  values.node ??= process.execPath;
  requireValue(values.out && values.commit && values.pnpm && values.observerUrl,
    'Required: --commit <full SHA> --out <new absolute path> --pnpm <absolute binary> --observer-url <HTTPS origin>.');
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const provenance = await prepareStatic(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: provenance.status, commit: provenance.source.commit, files: provenance.artifacts.length })}\n`);
  } catch (error) {
    process.stderr.write(`Static preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
