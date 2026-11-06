import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// Explicitly invoked live metadata check. No test automatically executes this file.
// The child receives only public configuration and cannot inherit signing keys.
const root = new URL('../../../../', import.meta.url);
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--run' || args[1] !== '--output' || !args[2]) {
  throw new Error('Usage: node packages/registry/test/reader/observe-api.mjs --run --output <artifact.json>');
}
const output = args[2];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const imported = await readJson('packages/registry/test/importer/observed-live-2026-11-06/import-full100.json');
const records = await readJson('packages/registry/test/importer/observed-live-2026-11-06/selected-records.json');
const selected = records.find((record) => record.chain_id === '10');
if (!selected || imported.status !== 'COMPLETE') throw new Error('Accepted public import fixture is missing.');
const policy = {
  creator: imported.publisher, owner: imported.publisher,
  sourceRevision: imported.source.revision, snapshotSha256: imported.source.snapshotSha256,
  licenseSha256: imported.source.licenseSha256, allowedOrigins: [new URL(selected.rpc_host).origin],
};
const sources = [
  'packages/registry/src/index.ts', 'packages/registry/src/adapters/arkiv/schema.ts',
  'packages/registry/src/adapters/arkiv/reader.ts', 'packages/registry/src/ports/entity-reader.ts',
  'packages/registry/src/ports/source-snapshot.ts', 'packages/registry/src/domain/source-policy.ts',
  'packages/registry/src/domain/publisher-policy.ts', 'packages/registry/src/domain/freshness.ts',
  'packages/registry/src/domain/endpoint-policy.ts', 'packages/registry/src/application/query-registry.ts',
  'apps/observer/src/composition/registry.ts', 'apps/observer/src/composition/server.ts',
  'apps/observer/src/composition/start.ts', 'apps/observer/src/composition/env.ts',
  'apps/observer/src/adapters/http/registry.ts', 'apps/observer/src/adapters/upstream/public-address.ts',
  'apps/observer/src/adapters/upstream/dns-resolver.ts',
  ...['transport', 'rpc', 'report', 'registry', 'primitives', 'payment', 'observer', 'index', 'evidence', 'errors']
    .map((name) => `packages/shared/src/${name}.ts`),
];
const inventory = async () => Object.fromEntries(await Promise.all(sources.flatMap((path) => [path,
  path.replace('/src/', '/dist/').replace(/\.ts$/, '.js'),
]).map(async (path) => [path, hash(await readFile(new URL(path, root)))])));
const before = await inventory();
const lockSha256 = hash(await readFile(new URL('pnpm-lock.yaml', root)));
const nodeVersion = process.version;
const listeningPort = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') { server.close(); reject(new Error('No local port.')); return; }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const child = spawn(process.execPath, [fileURLToPath(new URL('apps/observer/dist/composition/start.js', root))], {
  cwd: fileURLToPath(root), stdio: 'ignore',
  env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'test',
    MONOLITH_OBSERVER_HOST: '127.0.0.1', MONOLITH_OBSERVER_PORT: String(listeningPort),
    MONOLITH_REGISTRY_CONFIG: JSON.stringify(policy) },
});
let childExited = false;
const exited = new Promise((resolve) => {
  child.once('exit', () => { childExited = true; resolve(); });
  child.once('error', () => { childExited = true; resolve(); });
});
const artifact = {
  schemaVersion: 1, task: 'MN-010', evidence: 'BLOCKED', generatedAt: new Date().toISOString(),
  environment: { nodeVersion, sdk: '1.0.1', chain: 'Arkiv Rabdi', chainId: '7794095',
    signingEnvironmentInherited: false, candidateRpcContact: false, observerEndpointMapConfigured: false },
  policy, sourceBinding: { files: before, lockSha256 }, reason: 'LIVE_API_NOT_COMPLETED',
};
try {
  let ready = false;
  for (let count = 0; count < 100 && !childExited; count++) {
    try {
      const response = await fetch(`http://127.0.0.1:${listeningPort}/api/health`, { signal: AbortSignal.timeout(100) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* Only loopback startup is retried, never an RPC or Arkiv query. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error('STARTUP_BLOCKED');
  const request = async (path, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${listeningPort}${path}`, {
      headers, signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error('RESPONSE_TOO_LARGE');
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: JSON.parse(text) };
  };
  const first = await request('/api/registry/chains?chainId=10');
  const second = await request('/api/registry/chains?chainId=10', {
    'x-forwarded-for': 'synthetic-untrusted', 'x-monolith-route': 'synthetic-untrusted', cookie: 'synthetic=ignored',
  });
  const privateQuery = await request('/api/registry/chains?chainId=10&wallet=synthetic');
  const rpcMap = await fetch(`http://127.0.0.1:${listeningPort}/api/observer/read?endpointId=rpc_${selected.record_id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 'synthetic-map-check', method: 'eth_chainId', params: [] }),
  });
  artifact.results = { first, second, clientBodiesIdentical: JSON.stringify(first.body) === JSON.stringify(second.body),
    privateQuery, observerRpcMapStatus: rpcMap.status };
  const endpoint = first.body?.value?.endpoints?.[0];
  if (first.status !== 200 || second.status !== 200
    || first.body.value?.evidence !== 'OBSERVED_LIVE' || second.body.value?.evidence !== 'OBSERVED_LIVE'
    || first.body.value?.origin !== 'arkiv-query' || first.body.value?.endpoints?.length !== 1
    || endpoint?.chainId !== '10' || endpoint?.endpointId !== `rpc_${selected.record_id}`
    || endpoint?.rpcUrl !== selected.rpc_host || endpoint?.source?.snapshotSha256 !== policy.snapshotSha256
    || endpoint?.publisher?.creator !== policy.creator.toLowerCase()
    || endpoint?.publisher?.owner !== policy.owner.toLowerCase()
    || !artifact.results.clientBodiesIdentical || first.cacheControl !== 'no-store'
    || privateQuery.status !== 400 || rpcMap.status !== 403) throw new Error('LIVE_API_ASSERTION_FAILED');
  const after = await inventory();
  if (JSON.stringify(after) !== JSON.stringify(before)
    || hash(await readFile(new URL('pnpm-lock.yaml', root))) !== lockSha256) throw new Error('SOURCE_CHANGED_DURING_RUN');
  artifact.evidence = 'OBSERVED_LIVE'; artifact.reason = 'PUBLIC_METADATA_API_VERIFIED';
} catch (error) {
  const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_API_FAILED';
  artifact.reason = reason;
} finally {
  child.kill('SIGTERM');
  let timer;
  await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, 3_000); })]);
  if (timer !== undefined) clearTimeout(timer);
  if (!childExited) { child.kill('SIGKILL'); await exited; }
  artifact.shutdown = { observerStopped: childExited };
}
await writeFile(output, JSON.stringify(artifact, null, 2) + '\n');
console.info(JSON.stringify({ evidence: artifact.evidence, reason: artifact.reason, artifact: output }));
if (artifact.evidence !== 'OBSERVED_LIVE') process.exitCode = 1;
