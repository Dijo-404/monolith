import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Provider output can contain administrative URLs. Only accepted public registration is projected. */
export function tunnelOutput(onOrigin) {
  let pending = ''; let emitted = false;
  return (chunk) => {
    if (emitted) return;
    pending += chunk.toString();
    for (;;) {
      const newline = pending.indexOf('\n'); if (newline < 0) break;
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (line.length > 16_384) continue;
      try {
        const entry = JSON.parse(line);
        const match = /^localhost\/([a-z0-9]{8,63}\.lhr\.life)$/.exec(entry.id ?? '');
        if (entry.type === 'v1.tcpip_forward.register.accepted' && match) { emitted = true; onOrigin(`https://${match[1]}`); }
      } catch { /* Discard raw provider logs. */ }
    }
    if (pending.length > 16_384) pending = pending.slice(-16_384);
  };
}

export async function waitUntilReady(origin, signal, fetchHealth = fetch) {
  for (let attempt = 0; attempt < 12 && !signal.aborted; attempt++) {
    try {
      const response = await fetchHealth(`${origin}/api/health`, { credentials: 'omit', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) });
      const valid = response.status === 200 && response.headers.get('content-type')?.includes('application/json');
      let body = null;
      if (valid && response.body) {
        const reader = response.body.getReader(); const chunks = []; let bytes = 0;
        try { for (;;) { const next = await reader.read(); if (next.done) break;
          bytes += next.value.length; if (bytes > 4096) { await reader.cancel(); throw new Error('Health response exceeded its bound.'); }
          chunks.push(next.value);
        } body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        finally { reader.releaseLock(); }
      }
      await response.body?.cancel().catch(() => {});
      if (body?.schemaVersion === 1 && body.ok === true && body.value?.service === 'observer' && body.value?.status === 'configured') return;
    } catch { /* Bounded readiness only; no RPC or fallback is attempted. */ }
    if (!signal.aborted) await new Promise((accept) => { const timer = setTimeout(accept, 1000); signal.addEventListener('abort', () => { clearTimeout(timer); accept(); }, { once: true }); });
  }
  throw new Error('Public demo readiness failed.');
}

export async function startPublicTunnel(options) {
  const ssh = await realpath(options.ssh); const knownHosts = await realpath(options.knownHosts);
  if (!isAbsolute(options.status) || !isAbsolute(options.ssh) || !isAbsolute(options.knownHosts)) throw new Error('Use explicit absolute operator paths.');
  const statusPath = resolve(options.status);
  const startedAt = new Date().toISOString();
  const hashes = {};
  for (const [name, path] of Object.entries({ ssh, knownHosts, launcher: fileURLToPath(import.meta.url) })) hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
  // Reserve a new operator status path without following or overwriting an old file.
  await writeFile(statusPath, '{}\n', { flag: 'wx', mode: 0o600 });
  const createDemo = options.createDemo ?? (await import('../../apps/observer/dist/composition/public-demo.js')).createPublicDemo;
  const demo = await createDemo();
  const shutdown = new AbortController(); let child; let origin; let closed = false; let closePromise;
  let statusQueue = Promise.resolve();
  const writeStatus = (state) => { statusQueue = statusQueue.then(async () => {
    const temporary = `${statusPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, state: closed ? 'CLOSED' : state, startedAt,
    observedAt: new Date().toISOString(), ...(origin ? { origin } : {}), hashes, counters: demo.counters(),
    limits: ['TRUSTED_PROVIDER', 'SINGLE_USER_LOCALHOST', 'INITIAL_SSH_TOFU', 'WORKSTATION_UPTIME', 'ROTATING_HOSTNAME', 'PROVIDER_RETENTION_UNVERIFIED'] }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, statusPath);
  }); return statusQueue; };
  const close = () => {
    closePromise ??= (async () => { closed = true; shutdown.abort(); options.signal?.removeEventListener('abort', aborted);
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise((accept) => { const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
          child.once('close', () => { clearTimeout(timer); accept(); }); child.kill('SIGTERM'); });
      }
      await demo.close(); await writeStatus('CLOSED');
    })(); return closePromise;
  };
  const aborted = () => { void close(); };
  options.signal?.addEventListener('abort', aborted, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('Public demo startup cancelled.');
    await writeStatus('STARTING');
    if (closed) throw new Error('Public demo startup cancelled.');
    const registered = new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Public tunnel registration failed.')), 25_000);
      child = spawn(ssh, ['-F', '/dev/null', '-T', '-p', '22', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'IdentityFile=/dev/null', '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-R', `80:127.0.0.1:${demo.edgePort}`, 'nokey@localhost.run', '--', '--output', 'json', '--proxy-protocol-v2'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
      child.stdout.on('data', tunnelOutput((value) => { origin = value; clearTimeout(timer); accept(value); }));
      child.stderr.on('data', () => {});
      child.once('error', () => { clearTimeout(timer); reject(new Error('Public tunnel could not start.')); });
      child.once('close', () => { clearTimeout(timer); reject(new Error('Public tunnel closed.')); if (!closed) void close(); });
    });
    await registered; await waitUntilReady(origin, shutdown.signal, options.fetchHealth);
    if (closed) throw new Error('Public tunnel closed.');
    await writeStatus('READY');
    if (closed || shutdown.signal.aborted) throw new Error('Public tunnel closed.');
    return { origin, close, counters: demo.counters };
  } catch { await close(); throw new Error('Public demo could not start.'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--ssh': 'ssh', '--known-hosts': 'knownHosts', '--status': 'status' }[args[index]];
    if (!key || values[key] || !args[index + 1]) throw new Error('Use --ssh, --known-hosts and --status exactly once.');
    values[key] = args[index + 1];
  }
  let runtime;
  const lifetime = new AbortController();
  const stop = () => { lifetime.abort(); void runtime?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  startPublicTunnel({ ...values, signal: lifetime.signal }).then((value) => { runtime = value; process.stdout.write(`${JSON.stringify({ state: 'READY', origin: value.origin })}\n`); })
    .catch(() => { process.stderr.write('Public demo failed; inspect sanitized status.\n'); process.exitCode = 1; });
}
