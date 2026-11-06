import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGitSourceSnapshot, sha256Text } from '../../src/adapters/source/git-snapshot.js';
import { normalizeSourceSnapshot } from '../../src/domain/source-policy.js';

const directories: string[] = [];
const now = '2026-11-06T13:30:00.000Z';
const license = readFileSync(new URL('../../src/adapters/source/LICENSE.ethereum-lists-chains', import.meta.url), 'utf8');
const git = (directory: string, ...args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'monolith-source-test-'));
  directories.push(directory);
  mkdirSync(join(directory, '_data/chains'), { recursive: true });
  writeFileSync(join(directory, 'LICENSE'), license);
  writeFileSync(join(directory, 'README.md'), 'Synthetic Git source fixture.\n');
  writeFileSync(join(directory, '_data/chains/eip155-1.json'), JSON.stringify({ chainId: 1, name: 'Synthetic chain', rpc: ['https://rpc.example.org'] }) + '\n');
  git(directory, 'init', '-q');
  git(directory, 'config', 'user.name', 'Synthetic source test');
  git(directory, 'config', 'user.email', 'source-fixture@example.invalid');
  git(directory, 'remote', 'add', 'origin', 'https://github.com/ethereum-lists/chains.git');
  git(directory, 'add', '.');
  git(directory, 'commit', '-qm', 'Synthetic immutable source fixture');
  return { directory, revision: git(directory, 'rev-parse', 'HEAD') };
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('Git source adapter: local SIMULATED repositories only', () => {
  it('verifies canonical bytes and license and keeps snapshot identity independent of retrieval time', async () => {
    const fixture = repository();
    const first = await loadGitSourceSnapshot(fixture.directory, fixture.revision, now);
    const second = await loadGitSourceSnapshot(fixture.directory, fixture.revision, '2026-11-06T14:00:00.000Z');
    expect(first.snapshotSha256).toBe(second.snapshotSha256);
    expect(first.catalog).toBe(second.catalog);
    expect(first.license.text).toBe(license);
    expect(first.files).toHaveLength(3);
    expect(first.catalog.endsWith('\n')).toBe(true);
    expect(sha256Text(first.catalog)).toBe(first.snapshotSha256);
    expect(normalizeSourceSnapshot(first, sha256Text).ok).toBe(true);
    // Unrelated scratch files are outside the selected source surface.
    writeFileSync(join(fixture.directory, 'operator-notes.txt'), 'local scratch');
    await expect(loadGitSourceSnapshot(fixture.directory, fixture.revision, now)).resolves.toMatchObject({ snapshotSha256: first.snapshotSha256 });
  });

  it.each(['dirty', 'untracked', 'ignored', 'symlink', 'wrong-origin', 'wrong-revision', 'wrong-license', 'bad-utf8'] as const)('rejects %s without leaking Git/provider details', async (caseName) => {
    const fixture = repository();
    let revision = fixture.revision;
    if (caseName === 'dirty') writeFileSync(join(fixture.directory, '_data/chains/eip155-1.json'), '{}');
    if (caseName === 'untracked') writeFileSync(join(fixture.directory, '_data/chains/eip155-2.json'), '{}');
    if (caseName === 'ignored') {
      writeFileSync(join(fixture.directory, '.git/info/exclude'), '_data/chains/hidden.json\n');
      writeFileSync(join(fixture.directory, '_data/chains/hidden.json'), '{}');
    }
    if (caseName === 'symlink') {
      rmSync(join(fixture.directory, '_data/chains/eip155-1.json'));
      symlinkSync('../../README.md', join(fixture.directory, '_data/chains/eip155-1.json'));
      git(fixture.directory, 'add', '.'); git(fixture.directory, 'commit', '-qm', 'Synthetic rejected symlink');
      revision = git(fixture.directory, 'rev-parse', 'HEAD');
    }
    if (caseName === 'wrong-origin') git(fixture.directory, 'remote', 'set-url', 'origin', 'https://example.invalid/source.git');
    if (caseName === 'wrong-revision') revision = 'f'.repeat(40);
    if (caseName === 'wrong-license') {
      writeFileSync(join(fixture.directory, 'LICENSE'), 'Permission to redistribute is not established.\n');
      git(fixture.directory, 'add', '.'); git(fixture.directory, 'commit', '-qm', 'Synthetic rejected license');
      revision = git(fixture.directory, 'rev-parse', 'HEAD');
    }
    if (caseName === 'bad-utf8') {
      writeFileSync(join(fixture.directory, '_data/chains/eip155-1.json'), Buffer.from([0xff]));
      git(fixture.directory, 'add', '.'); git(fixture.directory, 'commit', '-qm', 'Synthetic invalid UTF-8');
      revision = git(fixture.directory, 'rev-parse', 'HEAD');
    }
    await expect(loadGitSourceSnapshot(fixture.directory, revision, now)).rejects.toThrow(/^SOURCE_SNAPSHOT_INVALID$/);
  });

  it('catches changed selected bytes even when Git marks a file assume-unchanged', async () => {
    const fixture = repository();
    git(fixture.directory, 'update-index', '--assume-unchanged', '_data/chains/eip155-1.json');
    writeFileSync(join(fixture.directory, '_data/chains/eip155-1.json'), '{}');
    await expect(loadGitSourceSnapshot(fixture.directory, fixture.revision, now)).rejects.toThrow('SOURCE_SNAPSHOT_INVALID');
  });
});
