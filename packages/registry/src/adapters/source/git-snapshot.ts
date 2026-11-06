import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { timestampSchema } from '@monolith/shared';
import { APPROVED_LICENSE_SHA256, SOURCE_REPOSITORY } from '../../domain/source-policy.js';
import type { SourceSnapshot } from '../../ports/source-snapshot.js';

export const sha256Text = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Local-only loader: no fetch, clone, endpoint probe, signing or automatic Git mutation. */
export async function loadGitSourceSnapshot(directory: string, revision: string, retrievedAt: string): Promise<SourceSnapshot> {
  try {
    if (!/^[a-f0-9]{40}$/.test(revision) || !timestampSchema.safeParse(retrievedAt).success) throw new Error();
    const root = realpathSync(resolve(directory));
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (git('rev-parse', 'HEAD').trim() !== revision || git('cat-file', '-t', revision).trim() !== 'commit') throw new Error();
    const origin = git('remote', 'get-url', 'origin').trim().replace(/\.git$/, '');
    if (origin !== SOURCE_REPOSITORY) throw new Error();
    if (git('status', '--porcelain=v1', '--untracked-files=all', '--', 'LICENSE', 'README.md', '_data/chains').trim()) throw new Error();
    const entries = git('ls-tree', '-r', '-z', revision, '--', 'LICENSE', 'README.md', '_data/chains')
      .split('\0').filter(Boolean).map((entry) => {
        const parsed = /^(100644|100755) blob ([a-f0-9]{40})\t(LICENSE|README\.md|_data\/chains\/eip155-(?:0|[1-9][0-9]*)\.json)$/.exec(entry);
        if (!parsed?.[2] || !parsed[3]) throw new Error();
        return { blob: parsed[2], path: parsed[3] };
      }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (entries.length < 3 || entries.length > 50_000 || !entries.some((entry) => entry.path === 'LICENSE') || !entries.some((entry) => entry.path === 'README.md')) throw new Error();
    const expectedChainFiles = entries.filter((entry) => entry.path.startsWith('_data/chains/')).map((entry) => entry.path.slice('_data/chains/'.length)).sort();
    // Also catches ignored/untracked files that a porcelain status may omit.
    const chainFiles = readdirSync(join(root, '_data/chains')).sort();
    if (JSON.stringify(chainFiles) !== JSON.stringify(expectedChainFiles)) throw new Error();
    let totalBytes = 0;
    const files = entries.map((entry) => {
      const path = join(root, entry.path);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.size > 2_000_000) throw new Error();
      const bytes = readFileSync(path);
      totalBytes += bytes.length;
      if (totalBytes > 64_000_000) throw new Error();
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error();
      const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (gitBlob !== entry.blob) throw new Error();
      return { path: entry.path, sha256: hashBytes(bytes), byteLength: bytes.length, text };
    });
    const catalog = JSON.stringify({ sourceSha: revision, files: files.map((file) => ({ path: file.path, bytes: file.byteLength, sha256: file.sha256 })) }) + '\n';
    const license = files.find((file) => file.path === 'LICENSE');
    if (!license || license.sha256 !== APPROVED_LICENSE_SHA256) throw new Error();
    return {
      schemaVersion: 1, repository: SOURCE_REPOSITORY, revision, retrievedAt,
      snapshotSha256: sha256Text(catalog), catalog,
      license: { url: `${SOURCE_REPOSITORY}/blob/${revision}/LICENSE`, sha256: license.sha256, text: license.text }, files,
    };
  } catch {
    throw new Error('SOURCE_SNAPSHOT_INVALID');
  }
}
