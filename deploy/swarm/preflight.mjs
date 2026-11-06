import { createHash } from 'node:crypto';
import { open, lstat, stat, unlink } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const MAX_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 10_000;
const HEX32 = /^[0-9a-fA-F]{64}$/;
const METRICS = ['stamp_usable_count_gauge', 'stamp_ttl_gauge', 'stamp_usage_gauge'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = () => { throw new Error('Swarm preflight failed.'); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Explicit origins only. Plain HTTP is restricted to literal loopback addresses. */
function targetOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim()) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !/^https?:\/\/[^/?#]+\/?$/.test(value)) fail();
  const authority = value.match(/^https?:\/\/([^/?#]+)/)[1];
  const rawHost = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']'))
    : authority.replace(/:\d+$/, '');
  const loopback = (isIP(rawHost) === 4 && rawHost.split('.')[0] === '127')
    || (isIP(rawHost) === 6 && url.hostname === '[::1]');
  if (url.protocol === 'http:' && !loopback) fail();
  return { origin: url.origin, loopback };
}

function normalizeOptions(options) {
  const bee = targetOrigin(options.beeUrl);
  const observer = options.observerUrl === undefined ? null : targetOrigin(options.observerUrl);
  for (const key of ['batchId', 'reference']) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !HEX32.test(options[key]))) fail();
  }
  const minTtlSeconds = options.minTtlSeconds ?? 3600;
  if (!Number.isSafeInteger(minTtlSeconds) || minTtlSeconds <= 0) fail();
  return { bee, observer, minTtlSeconds,
    batchId: options.batchId?.toLowerCase(), reference: options.reference?.toLowerCase() };
}

export function parseArguments(argv) {
  const names = new Map([
    ['--bee-url', 'beeUrl'], ['--observer-url', 'observerUrl'], ['--batch-id', 'batchId'],
    ['--reference', 'reference'], ['--min-ttl-seconds', 'minTtlSeconds'], ['--out', 'out'],
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    const value = argv[index + 1];
    if (!key || Object.hasOwn(options, key) || typeof value !== 'string' || !value || value.startsWith('--')) fail();
    options[key] = value;
  }
  if (options.minTtlSeconds !== undefined) {
    if (!/^[1-9]\d*$/.test(options.minTtlSeconds)) fail();
    options.minTtlSeconds = Number(options.minTtlSeconds);
  }
  if (typeof options.out !== 'string' || options.out !== options.out.trim()) fail();
  normalizeOptions(options);
  options.out = resolve(options.out);
  return options;
}

/** CIDv1 / swarm-manifest / keccak-256, encoded in lower-case base32. */
export function swarmManifestCid(reference) {
  if (typeof reference !== 'string' || !HEX32.test(reference)) fail();
  const bytes = Buffer.concat([Buffer.from([1, 250, 1, 27, 32]), Buffer.from(reference, 'hex')]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let output = 'b';
  let bits = 0;
  let accumulator = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(accumulator >>> bits) & 31];
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

/** Native HTTP(S) has no proxy/cookie/credential discovery and never follows redirects. */
function getBounded(url, timeoutMs) {
  return new Promise((resolveRequest) => {
    let settled = false;
    let response;
    let statusCode = null;
    let bytes = 0;
    let loopbackPeer = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRequest({ statusCode, bytes, loopbackPeer, ...result });
    };
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET', agent: false, maxHeaderSize: 8192, rejectUnauthorized: true,
      headers: { accept: 'application/json, text/plain, text/html, application/openmetrics-text',
        'accept-encoding': 'identity', connection: 'close' },
    });
    const stop = (code) => {
      finish({ error: code });
      response?.destroy();
      request.destroy();
    };
    timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    request.once('error', () => finish({ error: 'NETWORK_ERROR' }));
    request.once('response', (incoming) => {
      response = incoming;
      const peer = incoming.socket.remoteAddress ?? '';
      loopbackPeer = peer === '::1' || peer.startsWith('127.') || peer.startsWith('::ffff:127.');
      statusCode = incoming.statusCode ?? null;
      if (statusCode >= 300 && statusCode <= 399) { stop('REDIRECT_BLOCKED'); return; }
      if (statusCode !== 200) { stop('HTTP_ERROR'); return; }
      if (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') {
        stop('ENCODING_REJECTED'); return;
      }
      const length = incoming.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
        stop('BODY_LIMIT'); return;
      }
      const chunks = [];
      incoming.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { stop('BODY_LIMIT'); return; }
        chunks.push(chunk);
      });
      incoming.once('error', () => finish({ error: 'NETWORK_ERROR' }));
      incoming.once('aborted', () => finish({ error: 'NETWORK_ERROR' }));
      incoming.once('end', () => {
        if (settled) return;
        try {
          const body = Buffer.concat(chunks);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
          finish({ text, mime: incoming.headers['content-type'] ?? '', bodySha256: sha256(body) });
        } catch { finish({ error: 'UTF8_REJECTED' }); }
      });
    });
    request.end();
  });
}

function mimeIs(mime, allowed) {
  if (typeof mime !== 'string') return false;
  const charset = mime.match(/(?:^|;)\s*charset\s*=\s*"?([^;"\s]+)"?/i);
  return (!charset || ['utf-8', 'utf8'].includes(charset[1].toLowerCase()))
    && allowed.includes(mime.split(';')[0].trim().toLowerCase());
}

function health(response, readiness) {
  if (mimeIs(response.mime, ['text/plain']) && response.text.trim() === 'OK') {
    return { passed: true, healthy: true, format: 'PLAIN_OK' };
  }
  if (!mimeIs(response.mime, ['application/json'])) fail();
  const value = JSON.parse(response.text);
  if (!object(value) || value.status !== (readiness ? 'ready' : 'ok')
    || Object.keys(value).some((key) => !['status', 'version', 'apiVersion', 'debugApiVersion'].includes(key))
    || ['version', 'apiVersion', 'debugApiVersion'].some((key) => Object.hasOwn(value, key)
      && (typeof value[key] !== 'string' || value[key].length > 128
        || Array.from(value[key]).some((character) => character.codePointAt(0) < 32)))) fail();
  return { passed: true, healthy: true, format: 'BEE_JSON' };
}

function json(response) {
  if (!mimeIs(response.mime, ['application/json'])) fail();
  return JSON.parse(response.text);
}

function gateway(response) {
  const value = json(response);
  if (!exactKeys(value, ['gateway']) || typeof value.gateway !== 'boolean') fail();
  return { passed: true, gatewayModeReported: value.gateway };
}

function metrics(response) {
  if (!mimeIs(response.mime, ['text/plain', 'application/openmetrics-text'])) fail();
  const values = Object.fromEntries(METRICS.map((name) => [name, null]));
  const number = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
  for (const line of response.text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const name = METRICS.find((candidate) => trimmed.startsWith(`${candidate} `)
      || trimmed.startsWith(`${candidate}\t`) || trimmed === candidate);
    if (!name) continue; // Labelled/per-peer series are deliberately not collected.
    const match = trimmed.match(new RegExp(`^${name}\\s+(${number})$`));
    if (!match || values[name] !== null || !nonnegative(Number(match[1]))) fail();
    values[name] = Number(match[1]);
    if (name === 'stamp_usable_count_gauge' && !Number.isSafeInteger(values[name])) fail();
  }
  return { passed: true, aggregateMetrics: values,
    recognizedAggregateCount: Object.values(values).filter((value) => value !== null).length };
}

function batch(response, selectedId, minTtlSeconds) {
  const value = json(response);
  if (!object(value) || typeof value.batchID !== 'string' || !HEX32.test(value.batchID)) fail();
  if (value.batchID.toLowerCase() !== selectedId) return { passed: false, resultCode: 'BATCH_MISMATCH' };
  if (typeof value.usable !== 'boolean' || typeof value.exists !== 'boolean'
    || !nonnegative(value.batchTTL) || !Number.isInteger(value.depth) || value.depth < 17 || value.depth > 255
    || !Number.isInteger(value.bucketDepth) || value.bucketDepth < 0 || value.bucketDepth > value.depth) fail();
  for (const key of ['utilization', 'utilizationRatio', 'blockNumber']) {
    if (Object.hasOwn(value, key) && !nonnegative(value[key])) fail();
  }
  if (Object.hasOwn(value, 'amount') && (typeof value.amount !== 'string' || !/^\d+$/.test(value.amount))) fail();
  if (Object.hasOwn(value, 'immutableFlag') && typeof value.immutableFlag !== 'boolean') fail();
  if (Object.hasOwn(value, 'expired') && typeof value.expired !== 'boolean') fail();
  const expiredReported = Object.hasOwn(value, 'expired') ? value.expired : null;
  const meetsMinimumTtl = value.batchTTL >= minTtlSeconds;
  return { passed: expiredReported !== true && value.usable && value.exists && meetsMinimumTtl,
    resultCode: expiredReported === true ? 'BATCH_EXPIRED' : !value.usable || !value.exists ? 'BATCH_UNUSABLE'
      : meetsMinimumTtl ? 'EXPECTED_RESPONSE' : 'TTL_INSUFFICIENT',
    selectedBatchMatched: true, usableReported: value.usable, existsReported: value.exists, expiredReported,
    ttlSecondsReported: value.batchTTL, meetsMinimumTtl, depthReported: value.depth, bucketDepthReported: value.bucketDepth };
}

function observerHealth(response) {
  const value = json(response);
  if (!exactKeys(value, ['schemaVersion', 'ok', 'value']) || value.schemaVersion !== 1 || value.ok !== true
    || !exactKeys(value.value, ['service', 'status']) || value.value.service !== 'observer'
    || !['configured', 'scaffold'].includes(value.value.status)) fail();
  return { passed: value.value.status === 'configured', configuredReported: value.value.status === 'configured',
    registryAvailabilityTested: false, workerExecutionTested: false };
}

async function probe(name, target, path, parse, timeoutMs) {
  const response = await getBounded(new URL(path, target.origin), timeoutMs);
  const base = { name, method: 'GET', evidence: target.loopback || response.loopbackPeer ? 'SIMULATED' : 'OBSERVED_LIVE',
    targetOriginSha256: sha256(target.origin), statusCode: response.statusCode, responseBytes: response.bytes };
  if (response.error) return { ...base, status: 'BLOCKED', resultCode: response.error };
  try {
    const { passed, resultCode = 'EXPECTED_RESPONSE', ...details } = parse(response);
    return { ...base, status: passed ? 'PASS' : 'BLOCKED', resultCode, ...details };
  } catch { return { ...base, status: 'BLOCKED', resultCode: 'RESPONSE_INVALID' }; }
}

/** All probes are bounded GETs. No result establishes upload or deployment readiness. */
export async function runPreflight(options, { requestTimeoutMs = MAX_TIMEOUT_MS } = {}) {
  const settings = normalizeOptions(options);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_TIMEOUT_MS) fail();
  const startedAt = new Date().toISOString();
  const probes = [
    ['bee-health', settings.bee, '/health', (response) => health(response, false)],
    ['bee-readiness', settings.bee, '/readiness', (response) => health(response, true)],
    ['bee-gateway', settings.bee, '/gateway', gateway],
    ['bee-metrics', settings.bee, '/metrics', metrics],
  ];
  if (settings.batchId) probes.push(['selected-batch', settings.bee, `/stamps/${settings.batchId}`,
    (response) => batch(response, settings.batchId, settings.minTtlSeconds)]);
  if (settings.observer) probes.push(['observer-health', settings.observer, '/api/health', observerHealth]);
  if (settings.reference) {
    const cid = swarmManifestCid(settings.reference);
    for (const service of ['bzz.link', 'bzz.limo']) {
      probes.push([`reference-${service}`, { origin: `https://${cid}.${service}`, loopback: false }, '/', (response) => {
        if (!mimeIs(response.mime, ['text/html']) || response.text.trim() === '') fail();
        return { passed: true, reference: settings.reference, manifestCid: cid, bodySha256: response.bodySha256,
          artifactIdentityVerified: false, originIsolationVerified: false };
      }]);
    }
  }
  const observations = await Promise.all(probes.map((args) => probe(...args, requestTimeoutMs)));
  return { schemaVersion: 1, purpose: 'GET_ONLY_SWARM_PREFLIGHT', startedAt, completedAt: new Date().toISOString(),
    scope: 'Explicit target probes only; loopback observations are SIMULATED. Public responses are capture-time observations.',
    limits: { requestTimeoutMs, maxResponseBytes: MAX_BYTES, redirectsFollowed: false, method: 'GET' },
    selectedBatchId: settings.batchId ?? null, minimumTtlSeconds: settings.minTtlSeconds,
    observations,
    summary: { attempted: observations.length, passed: observations.filter((entry) => entry.status === 'PASS').length,
      blocked: observations.filter((entry) => entry.status === 'BLOCKED').length },
    deploymentReady: false,
    gates: { upload: 'UNTESTED', postageProvenance: 'UNKNOWN', uploadEntitlement: 'UNKNOWN',
      sdk: 'UNTESTED', browser: 'UNTESTED', arkiv: 'UNTESTED', isolation: 'UNTESTED',
      artifactIdentity: 'UNTESTED', backendRegistry: 'UNTESTED' } };
}

async function assertNewOutput(out) {
  if (typeof out !== 'string' || !out || out !== out.trim()) fail();
  try { await lstat(out); } catch (error) {
    if (error.code === 'ENOENT' && (await stat(dirname(out))).isDirectory()) return;
    fail();
  }
  fail();
}

/** Exclusive creation plus owned-inode cleanup avoids overwriting or leaving a partial report. */
export async function writeReport(out, report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  let handle;
  let identity;
  try {
    handle = await open(out, 'wx', 0o600);
    identity = await handle.stat();
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
  } catch {
    await handle?.close().catch(() => undefined);
    if (identity) {
      try {
        const current = await lstat(out);
        if (current.dev === identity.dev && current.ino === identity.ino) await unlink(out);
      } catch { /* Never delete a path whose ownership cannot be confirmed. */ }
    }
    fail();
  }
}

export async function runCli(argv) {
  const options = parseArguments(argv);
  await assertNewOutput(options.out);
  const report = await runPreflight(options);
  await writeReport(options.out, report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then(() => {
    process.stdout.write('GET-only preflight report written; deployment readiness remains UNTESTED.\n');
  }).catch(() => {
    process.stderr.write('Swarm preflight failed.\n');
    process.exitCode = 1;
  });
}
