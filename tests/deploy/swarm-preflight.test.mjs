import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { onTestFinished, test } from 'vitest';
import { parseArguments, runCli, runPreflight, swarmManifestCid, writeReport } from '../../deploy/swarm/preflight.mjs';

const BATCH = 'a'.repeat(64);
const REF = 'bc9b942212421e2a19fe1ffdf0add641ae530923041ea8f549381747b14b2f2d';
const execute = promisify(execFile);

async function fixture(overrides = {}) {
  const requests = [];
  const handlers = {
    '/health': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('OK\n'),
    '/readiness': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: 'ready', version: 'SIMULATED', apiVersion: 'SIMULATED' })),
    '/gateway': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"gateway":true}'),
    '/metrics': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
      .end('# SIMULATED aggregate fixtures\nstamp_usable_count_gauge 1\nstamp_ttl_gauge 118444\nstamp_usage_gauge 0.015625\nsecret_peer_label{ip="192.0.2.8"} 7\n'),
    [`/stamps/${BATCH}`]: (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(batch())),
    '/api/health': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ schemaVersion: 1, ok: true, value: { service: 'observer', status: 'configured' } })),
    ...overrides,
  };
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, headers: req.headers });
    (handlers[req.url] ?? ((_req, response) => response.writeHead(404).end('PRIVATE_ERROR_SENTINEL')))(req, res);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  onTestFinished(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const temp = await mkdtemp(join(tmpdir(), 'monolith-swarm-preflight-'));
  onTestFinished(() => rm(temp, { recursive: true, force: true }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, handlers, temp };
}

function batch(fields = {}) {
  return { batchID: BATCH, utilization: 1, utilizationRatio: 0.01, usable: true, exists: true,
    depth: 20, bucketDepth: 16, amount: '100', blockNumber: 1, immutableFlag: true,
    batchTTL: 7200, label: 'PRIVATE_BATCH_LABEL_SENTINEL', ...fields };
}

const finding = (report, name) => report.observations.find((entry) => entry.name === name);

test('manifest CID uses swarm-manifest multicodec and the independent known website vector', () => {
  assert.equal(swarmManifestCid(REF), 'bah5acgzaxsnziiqsiipcugp6d767blowigxfgcjdaqpkr5kjhalupmklf4wq');
  assert.equal(swarmManifestCid(REF.toUpperCase()), swarmManifestCid(REF));
  assert.throws(() => swarmManifestCid(`0x${REF}`));
  assert.throws(() => swarmManifestCid('z'.repeat(64)));
});

test('real loopback requests are GET-only fixed probes without ambient proxy, cookie or authorization', async () => {
  const f = await fixture();
  const old = process.env.HTTP_PROXY;
  const oldToken = process.env.ARKIV_ACCESS_KEY;
  process.env.HTTP_PROXY = 'http://127.0.0.1:1';
  process.env.ARKIV_ACCESS_KEY = 'PRIVATE_AMBIENT_SENTINEL';
  onTestFinished(() => {
    if (old === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = old;
    if (oldToken === undefined) delete process.env.ARKIV_ACCESS_KEY; else process.env.ARKIV_ACCESS_KEY = oldToken;
  });
  const report = await runPreflight({ beeUrl: f.url, observerUrl: f.url, batchId: BATCH });
  assert.equal(report.summary.attempted, 6);
  assert.equal(report.summary.passed, 6);
  assert.deepEqual(f.requests.map((entry) => entry.path).sort(),
    ['/health', '/readiness', '/gateway', '/metrics', `/stamps/${BATCH}`, '/api/health'].sort());
  for (const req of f.requests) {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers['swarm-postage-batch-id'], undefined);
    assert.equal(req.headers['x-forwarded-for'], undefined);
  }
  assert.equal(report.deploymentReady, false);
  assert.equal(report.gates.uploadEntitlement, 'UNKNOWN');
  assert.equal(report.gates.postageProvenance, 'UNKNOWN');
  assert.equal(report.gates.browser, 'UNTESTED');
  assert.equal(finding(report, 'bee-gateway').gatewayModeReported, true);
  assert.equal(finding(report, 'observer-health').configuredReported, true);
  assert.equal(finding(report, 'observer-health').registryAvailabilityTested, false);
  assert.equal(report.observations.every((entry) => entry.evidence === 'SIMULATED'), true);
  const serialized = JSON.stringify(report);
  for (const secret of ['PRIVATE_AMBIENT_SENTINEL', 'PRIVATE_BATCH_LABEL_SENTINEL', '192.0.2.8', '127.0.0.1']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.deepEqual(finding(report, 'bee-metrics').aggregateMetrics,
    { stamp_usable_count_gauge: 1, stamp_ttl_gauge: 118444, stamp_usage_gauge: 0.015625 });
});

test('credential-bearing, ambiguous and non-origin URLs fail before any sends', async () => {
  const f = await fixture();
  for (const beeUrl of [`http://secret:secret@${new URL(f.url).host}`, `${f.url}/path`, `${f.url}?key=secret`,
    `${f.url}#secret`, ` ${f.url}`, 'http://localhost:1633', 'http://127.1:1633',
    'http://2130706433:1633', 'http://example.com', 'file:///tmp/test']) {
    await assert.rejects(runPreflight({ beeUrl }));
  }
  await assert.rejects(runPreflight({ beeUrl: f.url, observerUrl: `${f.url}/api/health` }));
  await assert.rejects(runPreflight({ beeUrl: f.url, batchId: `0x${BATCH}` }));
  assert.equal(f.requests.length, 0);
});

test('redirects never reach their destination or leak Location/body text', async () => {
  const f = await fixture({ '/health': (_req, res) => res.writeHead(307, { location: '/redirect-target?secret=PRIVATE_SENTINEL' })
    .end('PRIVATE_REDIRECT_BODY') });
  const report = await runPreflight({ beeUrl: f.url });
  assert.equal(finding(report, 'bee-health').resultCode, 'REDIRECT_BLOCKED');
  assert.equal(f.requests.some((entry) => entry.path.startsWith('/redirect-target')), false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
});

test('untrusted malformed JSON, wrong MIME, invalid UTF8 and oversized declared/streaming bodies remain blocked', async () => {
  const f = await fixture({
    '/health': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('OK'),
    '/readiness': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end(Buffer.from([0xff, 0xfe])),
    '/gateway': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{PRIVATE_MALFORMED'),
    '/metrics': (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('x'.repeat(65536)); res.end('x'); },
    [`/stamps/${BATCH}`]: (_req, res) => res.writeHead(200, { 'content-type': 'application/json', 'content-length': '65537' }).end(),
  });
  const report = await runPreflight({ beeUrl: f.url, batchId: BATCH });
  assert.equal(finding(report, 'bee-health').resultCode, 'RESPONSE_INVALID');
  assert.equal(finding(report, 'bee-readiness').resultCode, 'UTF8_REJECTED');
  assert.equal(finding(report, 'bee-gateway').resultCode, 'RESPONSE_INVALID');
  assert.equal(finding(report, 'bee-metrics').resultCode, 'BODY_LIMIT');
  assert.equal(finding(report, 'selected-batch').resultCode, 'BODY_LIMIT');
  assert.equal(report.summary.passed, 0);
  assert.equal(JSON.stringify(report).includes('PRIVATE_MALFORMED'), false);
});

test('absolute deadline bounds even a response that keeps sending bytes', async () => {
  const f = await fixture({ '/health': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    const timer = setInterval(() => res.write('O'), 5);
    res.once('close', () => clearInterval(timer));
  } });
  const started = Date.now();
  const report = await runPreflight({ beeUrl: f.url }, { requestTimeoutMs: 100 });
  assert.equal(finding(report, 'bee-health').resultCode, 'TIMEOUT');
  assert.ok(Date.now() - started < 2000);
  await assert.rejects(runPreflight({ beeUrl: f.url }, { requestTimeoutMs: 10001 }));
});

test('selected stamp identity, usability, TTL and depth are checked without claiming capacity or ownership', async () => {
  const f = await fixture();
  const cases = [
    [{ batchID: 'b'.repeat(64) }, 'BATCH_MISMATCH'], [{ batchTTL: 0 }, 'TTL_INSUFFICIENT'],
    [{ batchTTL: 3599 }, 'TTL_INSUFFICIENT'], [{ batchTTL: -1 }, 'RESPONSE_INVALID'],
    [{ batchTTL: '7200' }, 'RESPONSE_INVALID'], [{ exists: false }, 'BATCH_UNUSABLE'],
    [{ usable: false }, 'BATCH_UNUSABLE'], [{ depth: 16 }, 'RESPONSE_INVALID'],
    [{ depth: 20.5 }, 'RESPONSE_INVALID'], [{ bucketDepth: 21 }, 'RESPONSE_INVALID'],
  ];
  for (const [fields, expected] of cases) {
    f.handlers[`/stamps/${BATCH}`] = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(batch(fields)));
    const report = await runPreflight({ beeUrl: f.url, batchId: BATCH });
    assert.equal(finding(report, 'selected-batch').status, 'BLOCKED');
    assert.equal(finding(report, 'selected-batch').resultCode, expected);
    assert.equal(report.gates.postageProvenance, 'UNKNOWN');
    assert.equal(report.gates.uploadEntitlement, 'UNKNOWN');
  }
});

test('an explicit expired stamp is blocked despite positive TTL; optional expiry must be boolean', async () => {
  const f = await fixture();
  for (const [expired, status, code] of [
    [true, 'BLOCKED', 'BATCH_EXPIRED'], [false, 'PASS', 'EXPECTED_RESPONSE'],
    [null, 'BLOCKED', 'RESPONSE_INVALID'], ['false', 'BLOCKED', 'RESPONSE_INVALID'],
    ['true', 'BLOCKED', 'RESPONSE_INVALID'], [0, 'BLOCKED', 'RESPONSE_INVALID'],
    [{}, 'BLOCKED', 'RESPONSE_INVALID'],
  ]) {
    f.handlers[`/stamps/${BATCH}`] = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(batch({ expired, batchTTL: 7200, usable: true, exists: true })));
    const report = await runPreflight({ beeUrl: f.url, batchId: BATCH });
    const observed = finding(report, 'selected-batch');
    assert.equal(observed.status, status);
    assert.equal(observed.resultCode, code);
    if (typeof expired === 'boolean') assert.equal(observed.expiredReported, expired);
    assert.equal(report.deploymentReady, false);
    assert.equal(report.gates.postageProvenance, 'UNKNOWN');
  }
});

test('gateway and health responses must match their exact known semantics', async () => {
  const f = await fixture();
  f.handlers['/health'] = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
    .end('{"status":"ok","version":"SIMULATED","apiVersion":"SIMULATED"}');
  assert.equal(finding(await runPreflight({ beeUrl: f.url }), 'bee-health').status, 'PASS');
  for (const body of ['true', '{"gateway":"true"}', '{"gateway":true,"private":"PRIVATE_SENTINEL"}']) {
    f.handlers['/gateway'] = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    assert.equal(finding(await runPreflight({ beeUrl: f.url }), 'bee-gateway').status, 'BLOCKED');
  }
  f.handlers['/health'] = (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('probably healthy');
  f.handlers['/api/health'] = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
    .end('{"schemaVersion":1,"ok":true,"value":{"service":"observer","status":"scaffold"}}');
  const report = await runPreflight({ beeUrl: f.url, observerUrl: f.url });
  assert.equal(finding(report, 'bee-health').status, 'BLOCKED');
  assert.equal(finding(report, 'observer-health').status, 'BLOCKED');
  f.handlers['/api/health'] = (_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
    .end('{"service":"observer","status":"configured"}');
  assert.equal(finding(await runPreflight({ beeUrl: f.url, observerUrl: f.url }), 'observer-health').status, 'BLOCKED');
});

test('metric duplicate/nonfinite/negative values are rejected and labelled series are not exported', async () => {
  const f = await fixture();
  for (const value of ['stamp_ttl_gauge NaN', 'stamp_ttl_gauge +Inf', 'stamp_ttl_gauge -1',
    'stamp_ttl_gauge 1e999', 'stamp_ttl_gauge 1\nstamp_ttl_gauge 2', 'stamp_usable_count_gauge 0.5']) {
    f.handlers['/metrics'] = (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end(value);
    assert.equal(finding(await runPreflight({ beeUrl: f.url }), 'bee-metrics').status, 'BLOCKED');
  }
  f.handlers['/metrics'] = (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' })
    .end('stamp_ttl_gauge{peer="PRIVATE_SENTINEL"} 100\n');
  const report = await runPreflight({ beeUrl: f.url });
  assert.equal(finding(report, 'bee-metrics').recognizedAggregateCount, 0);
  assert.equal(JSON.stringify(report).includes('PRIVATE_SENTINEL'), false);
});

test('report output is exclusively created, private, complete and leaves existing files intact', async () => {
  const f = await fixture();
  const out = join(f.temp, 'report.json');
  const report = await runCli(['--bee-url', f.url, '--out', out]);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), report);
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  const digest = createHash('sha256').update(await readFile(out)).digest('hex');
  const count = f.requests.length;
  await assert.rejects(runCli(['--bee-url', f.url, '--out', out]));
  assert.equal(f.requests.length, count);
  await assert.rejects(writeReport(out, { overwrite: true }));
  assert.equal(createHash('sha256').update(await readFile(out)).digest('hex'), digest);
  const cyclic = {}; cyclic.self = cyclic;
  const partial = join(f.temp, 'partial.json');
  await assert.rejects(writeReport(partial, cyclic));
  await assert.rejects(stat(partial), { code: 'ENOENT' });
});

test('CLI validates arguments and returns safe errors; blocked reports still exit zero', async () => {
  const f = await fixture({ '/health': (_req, res) => res.writeHead(503).end('PRIVATE_PROVIDER_ERROR') });
  const script = new URL('../../deploy/swarm/preflight.mjs', import.meta.url).pathname;
  const out = join(f.temp, 'cli.json');
  const result = await execute(process.execPath, [script, '--bee-url', f.url, '--out', out]);
  assert.equal(result.stdout, 'GET-only preflight report written; deployment readiness remains UNTESTED.\n');
  assert.equal(result.stderr, '');
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(finding(report, 'bee-health').resultCode, 'HTTP_ERROR');
  assert.equal(JSON.stringify(report).includes('PRIVATE_PROVIDER_ERROR'), false);
  await writeFile(join(f.temp, 'existing.json'), 'keep');
  for (const argv of [[], ['--bee-url', f.url, '--out', out, '--reference', 'PRIVATE_SENTINEL'],
    ['--bee-url', f.url, '--out', out, '--bee-url', f.url], ['--unknown', 'PRIVATE_SENTINEL'],
    ['--bee-url', f.url, '--out', out, '--min-ttl-seconds', '0']]) {
    assert.throws(() => parseArguments(argv));
  }
  await assert.rejects(execute(process.execPath, [script, '--bee-url', 'https://user:PRIVATE_SENTINEL@example.org', '--out', out]),
    (error) => error.code === 1 && error.stdout === '' && error.stderr === 'Swarm preflight failed.\n');
});
