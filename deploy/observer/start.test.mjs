// SIMULATED provider subprocesses; no SSH, external HTTP, chain or worker contact.
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, onTestFinished, vi } from 'vitest';
import { readServerAccessKey, startPublicTunnel, tunnelOutput, waitUntilReady } from './start.mjs';

const origin = 'https://123456abcdef.lhr.life';
const registered = JSON.stringify({ type: 'v1.tcpip_forward.register.accepted', id: 'localhost/123456abcdef.lhr.life' });
const health = () => Promise.resolve(new Response(JSON.stringify({ schemaVersion: 1, ok: true, value: { service: 'observer', status: 'configured' } }),
  { status: 200, headers: { 'content-type': 'application/json' } }));
async function fixture(script = '') {
  const directory = await mkdtemp(join(tmpdir(), 'monolith-public-launcher-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const ssh = join(directory, 'ssh'); const knownHosts = join(directory, 'known_hosts'); const status = join(directory, 'status.json');
  await writeFile(ssh, `#!${process.execPath}\n` + (script ||
    `process.stdout.write(${JSON.stringify(registered + '\n')}); setInterval(() => {}, 1000);\n`), { mode: 0o700 });
  await writeFile(knownHosts, 'SIMULATED PUBLIC HOST PIN\n');
  const close = vi.fn(async () => {});
  return { directory, ssh, knownHosts, status, close, createDemo: async () => ({ edgePort: 12345, counters: () => ({ activeConnections: 0 }), close }) };
}

test('bounded provider classifier ignores marketing/admin output and accepts only exact registration', () => {
  const accepted = []; const project = tunnelOutput((value) => accepted.push(value));
  for (const line of [JSON.stringify({ url: 'https://admin.private.invalid', token: 'private-sentinel' }),
    JSON.stringify({ type: 'other', id: 'localhost/123456abcdef.lhr.life' }),
    JSON.stringify({ type: 'v1.tcpip_forward.register.accepted', id: 'localhost/evil.example.org' })]) project(line + '\n');
  project('x'.repeat(100_000) + '\n');
  project(registered.slice(0, 15)); project(registered.slice(15) + '\n'); project(registered + '\n');
  expect(accepted).toEqual([origin]);
});

test('readiness permits only bounded health GET and pre-aborted startup does not fetch', async () => {
  const fetchHealth = vi.fn(health);
  await waitUntilReady(origin, new AbortController().signal, fetchHealth);
  expect(fetchHealth.mock.calls).toHaveLength(1);
  expect(fetchHealth.mock.calls[0][0]).toBe(`${origin}/api/health`);
  expect(fetchHealth.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  const abort = new AbortController(); abort.abort();
  await expect(waitUntilReady(origin, abort.signal, fetchHealth)).rejects.toThrow('readiness failed');
  expect(fetchHealth.mock.calls).toHaveLength(1);
});

test('launcher pins the sole SSH identity path and shuts child/backend down idempotently', async () => {
  const f = await fixture(); const argv = join(f.directory, 'args.json');
  await writeFile(f.ssh, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\n` +
    `writeFileSync(${JSON.stringify(argv)},JSON.stringify(process.argv.slice(2)));\n` +
    `process.stderr.write('private-sentinel admin URL must be discarded');\n` +
    `process.stdout.write(${JSON.stringify(registered + '\n')});setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const runtime = await startPublicTunnel({ ...f, fetchHealth: health });
  onTestFinished(runtime.close);
  expect(runtime.origin).toBe(origin);
  const args = JSON.parse(await readFile(argv, 'utf8'));
  for (const flag of ['StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null', `UserKnownHostsFile=${f.knownHosts}`,
    'IdentityFile=/dev/null', 'IdentitiesOnly=yes', 'BatchMode=yes', 'ExitOnForwardFailure=yes', '--proxy-protocol-v2']) expect(args).toContain(flag);
  expect(args.slice(0, 2)).toEqual(['-F', '/dev/null']);
  expect(args[args.indexOf('-p') + 1]).toBe('22');
  expect(args).toContain('80:127.0.0.1:12345');
  expect(JSON.parse(await readFile(f.status, 'utf8')).state).toBe('READY');
  await Promise.all([runtime.close(), runtime.close()]);
  const status = await readFile(f.status, 'utf8');
  expect(JSON.parse(status).state).toBe('CLOSED'); expect(status).not.toContain('private-sentinel');
  expect(f.close).toHaveBeenCalledTimes(1);
});

test('existing status is not overwritten and no backend starts', async () => {
  const f = await fixture(); await writeFile(f.status, 'keep-sentinel');
  const createDemo = vi.fn(f.createDemo);
  await expect(startPublicTunnel({ ...f, createDemo, fetchHealth: health })).rejects.toThrow();
  expect(await readFile(f.status, 'utf8')).toBe('keep-sentinel'); expect(createDemo).not.toHaveBeenCalled();
});

test('provider exit and startup cancellation close backend without a ready publication', async () => {
  for (const cancelled of [false, true]) {
    const f = await fixture('process.exit(1);'); const controller = new AbortController();
    if (cancelled) controller.abort();
    await expect(startPublicTunnel({ ...f, signal: controller.signal, fetchHealth: health })).rejects.toThrow('could not start');
    expect(JSON.parse(await readFile(f.status, 'utf8')).state).toBe('CLOSED'); expect(f.close).toHaveBeenCalledTimes(1);
  }
});

test('cancellation during the final asynchronous READY write cannot resolve a closed runtime', async () => {
  const f = await fixture(); const controller = new AbortController(); let writes = 0;
  const createDemo = async () => ({ edgePort: 12345, close: f.close, counters: () => {
    if (++writes === 2) queueMicrotask(() => controller.abort());
    return { activeConnections: 0 };
  } });
  await expect(startPublicTunnel({ ...f, createDemo, signal: controller.signal, fetchHealth: health })).rejects.toThrow('could not start');
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(f.status, 'utf8')).state).toBe('CLOSED');
});

test('only the selected literal key is loaded; unrelated environment values are never exported', async () => {
  const f = await fixture(); const file = join(f.directory, 'server.env');
  const key = 'SIMULATED_FILE_ONLY_KEY_12345';
  await writeFile(file, `OTHER_SECRET=SIMULATED_UNRELATED_SECRET\nexport ARKIV_ACCESS_KEY="${key}" # selected only\n`, { mode: 0o600 });
  expect(await readServerAccessKey(file)).toBe(key);
  const createDemo = vi.fn(async (options) => { expect(options).toEqual({ accessKey: key });
    return { edgePort: 12345, counters: () => ({ activeConnections: 0 }), close: f.close }; });
  const runtime = await startPublicTunnel({ ...f, arkivEnvFile: file, createDemo, fetchHealth: health });
  onTestFinished(runtime.close);
  const status = await readFile(f.status, 'utf8');
  expect(JSON.parse(status).serverAccessKeyConfigured).toBe(true);
  expect(Object.keys(JSON.parse(status).hashes).sort()).toEqual(['knownHosts', 'launcher', 'ssh']);
  expect(status).not.toContain(key); expect(status).not.toContain('SIMULATED_UNRELATED_SECRET'); expect(status).not.toContain(file);
  await runtime.close();
});

test('explicit absent, malformed, duplicate, unsafe-mode or linked key files fail before creating a backend or status', async () => {
  const f = await fixture(); const file = join(f.directory, 'server.env');
  const createDemo = vi.fn(f.createDemo);
  for (const contents of ['', 'OTHER_KEY=SIMULATED_IGNORED', 'ARKIV_ACCESS_KEY=',
    'ARKIV_ACCESS_KEY=one\nARKIV_ACCESS_KEY=two', 'ARKIV_ACCESS_KEY="line break"', 'ARKIV_ACCESS_KEY="unterminated']) {
    await writeFile(file, contents, { mode: 0o600 });
    await expect(startPublicTunnel({ ...f, arkivEnvFile: file, createDemo, fetchHealth: health })).rejects.toThrow('missing or invalid');
  }
  await writeFile(file, 'ARKIV_ACCESS_KEY=SIMULATED_VALID_KEY', { mode: 0o600 });
  await chmod(file, 0o644); await expect(readServerAccessKey(file)).rejects.toThrow('missing or invalid');
  await chmod(file, 0o600); const linked = join(f.directory, 'linked.env'); await symlink(file, linked);
  for (const path of [linked, join(f.directory, 'absent.env'), 'relative.env', f.directory]) await expect(readServerAccessKey(path)).rejects.toThrow('missing or invalid');
  expect(createDemo).not.toHaveBeenCalled(); await expect(readFile(f.status)).rejects.toThrow();
});

test('ambient credentials are ignored unless a file is explicitly selected', async () => {
  const f = await fixture(); vi.stubEnv('ARKIV_ACCESS_KEY', 'SIMULATED_AMBIENT_KEY');
  onTestFinished(() => vi.unstubAllEnvs());
  const createDemo = vi.fn(async (options) => { expect(options).toEqual({}); return f.createDemo(); });
  const runtime = await startPublicTunnel({ ...f, createDemo, fetchHealth: health }); onTestFinished(runtime.close);
  expect(JSON.parse(await readFile(f.status, 'utf8')).serverAccessKeyConfigured).toBe(false);
  await runtime.close();
});
