export type SwarmReleaseFile = Readonly<{ path: string; bytes: number; sha256: string }>;
export type SwarmReleaseInput = Readonly<{
  sourceCommit: string; swarmReference: string; publishedAt: string; expiresAt: string;
  files: readonly SwarmReleaseFile[];
}>;
export type SwarmRelease = SwarmReleaseInput & Readonly<{
  schemaVersion: 1; releaseId: string; inventorySha256: string;
}>;
export type TextDigest = (text: string) => string;
export const SWARM_RELEASE_MAX_FILES = 20;
export const SWARM_RELEASE_MAX_BYTES = 1024 * 1024;
const hex32 = /^[0-9a-f]{64}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function failure(): never { throw new Error('SWARM_RELEASE_INVALID'); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function iso(value: unknown): value is string {
  if (typeof value !== 'string' || !timestamp.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
export function canonicalSwarmInventory(input: unknown): string {
  if (!Array.isArray(input) || input.length < 3 || input.length > SWARM_RELEASE_MAX_FILES) failure();
  const seen = new Set<string>(); let total = 0;
  const files: SwarmReleaseFile[] = input.map((file: unknown) => {
    if (!exact(file, ['path', 'bytes', 'sha256']) || typeof file['path'] !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(file['path'])
      || file['path'].split('/').some((part) => !part || part === '.' || part === '..'
        || /^(?:\.env.*|\.git|\.npmrc|\.netrc|\.git-credentials|\.ssh|node_modules|credentials|id_rsa|id_ed25519)$/i.test(part)
        || /\.(?:pem|key|p12|pfx|keystore|map)$/i.test(part))
      || seen.has(file['path']) || !Number.isSafeInteger(file['bytes'])
      || (file['bytes'] as number) < 1 || typeof file['sha256'] !== 'string' || !hex32.test(file['sha256'])) failure();
    total += file['bytes'] as number;
    if (total > SWARM_RELEASE_MAX_BYTES) failure();
    seen.add(file['path']);
    return { path: file['path'], bytes: file['bytes'] as number, sha256: file['sha256'] };
  });
  if (!seen.has('index.html') || !seen.has('assets/worker-host.html') || !seen.has('assets/THIRD-PARTY-NOTICES.txt')) failure();
  return JSON.stringify(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
/** Pure canonicalization; infrastructure supplies SHA-256 without importing Node into domain code. */
export function prepareSwarmRelease(input: unknown, digest: TextDigest): SwarmRelease {
  if (!exact(input, ['sourceCommit', 'swarmReference', 'publishedAt', 'expiresAt', 'files'])
    || typeof input['sourceCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(input['sourceCommit'])
    || typeof input['swarmReference'] !== 'string' || !hex32.test(input['swarmReference'])
    || !iso(input['publishedAt']) || !iso(input['expiresAt'])) failure();
  const lifetime = Date.parse(input['expiresAt']) - Date.parse(input['publishedAt']);
  if (lifetime < 60_000 || lifetime > 7 * 86_400_000) failure();
  const inventory = canonicalSwarmInventory(input['files']);
  const inventorySha256 = digest(inventory);
  if (!hex32.test(inventorySha256)) failure();
  const content = { schemaVersion: 1 as const, sourceCommit: input['sourceCommit'], swarmReference: input['swarmReference'],
    publishedAt: input['publishedAt'], expiresAt: input['expiresAt'], inventorySha256 };
  const releaseId = digest(JSON.stringify(content));
  if (!hex32.test(releaseId)) failure();
  const files = (JSON.parse(inventory) as SwarmReleaseFile[]).map((file) => Object.freeze(file));
  return Object.freeze({ ...content, releaseId, files: Object.freeze(files) });
}
export function assessSwarmRelease(value: unknown, digest: TextDigest): SwarmRelease {
  if (!exact(value, ['schemaVersion', 'releaseId', 'sourceCommit', 'swarmReference', 'publishedAt', 'expiresAt', 'inventorySha256', 'files'])
    || value['schemaVersion'] !== 1) failure();
  const expected = prepareSwarmRelease({ sourceCommit: value['sourceCommit'], swarmReference: value['swarmReference'],
    publishedAt: value['publishedAt'], expiresAt: value['expiresAt'], files: value['files'] }, digest);
  if (value['releaseId'] !== expected.releaseId || value['inventorySha256'] !== expected.inventorySha256) failure();
  return expected;
}
export function assertSwarmReleaseFresh(descriptor: SwarmRelease, now: string): void {
  if (!iso(now) || Date.parse(descriptor.publishedAt) > Date.parse(now)
    || Date.parse(descriptor.expiresAt) <= Date.parse(now)) throw new Error('SWARM_RELEASE_EXPIRED');
}
