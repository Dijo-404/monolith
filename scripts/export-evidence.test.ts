// Every fixture in this file is synthetic. These tests establish no live-evidence gate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { EvidenceFailure, exportBundle, validateBundle } from './export-evidence.js';

type Kind = 'privacy-report' | 'observer-run' | 'rpc-trace' | 'registry-manifest';
type Evidence = 'SIMULATED' | 'BLOCKED' | 'UNTESTED' | 'OBSERVED_LIVE';
type Artifact = { path: string; sha256: string; generatedAt: string; evidence: Evidence; sourceTask: string };
type Plan = {
  manifest: { schemaVersion: 1; runId: string; generatedAt: string; evidence: Evidence; artifacts: Artifact[] };
  kinds: Record<string, string>;
};
type Fixture = {
  root: string;
  inputDirectory: string;
  planPath: string;
  outputDirectory: string;
  nowISO: string;
  plan: Plan;
};

const runId = 'run-00000000-0000-4000-8000-000000000001';
const reportId = 'report_00000000-0000-4000-8000-000000000001';
const generatedAt = '2026-11-06T00:00:00.000Z';
const nowISO = '2026-11-07T00:00:00.000Z';
const futureISO = '2026-11-08T00:00:00.000Z';
const canonical = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function report() {
  return {
    schemaVersion: 1,
    runId,
    evidence: 'SIMULATED',
    eligibleReads: 2,
    protectedReads: 1,
    successfulReads: 2,
    protectedCoverage: 0.5,
    findings: [{ code: 'DIRECT_BYPASS', readId: 'read-synthetic-001', callsite: 'fixture.balance', message: 'Synthetic direct read.' }],
    scope: { rpcOrigins: ['https://rpc.example.com'], scenarios: ['synthetic-failure'], bootstrapExclusions: ['specifier-lookup'] },
  };
}

function observer() {
  return {
    schemaVersion: 1,
    runId,
    expiresAt: '2026-11-06T00:05:00.000Z',
    observations: [{ rpcId: 'rpc-synthetic-001', method: 'eth_chainId', addressPresent: false, sourceClass: 'unknown', durationMs: 12, success: true }],
  };
}

function trace() {
  return {
    schemaVersion: 1,
    readId: 'read-synthetic-001',
    attempt: 1,
    endpointId: 'endpoint-synthetic',
    chainId: '1',
    method: 'eth_chainId',
    callsite: 'fixture.chain-id',
    route: 'anon-nym',
    durationMs: 10,
    success: true,
    bootstrap: false,
    evidence: 'SIMULATED',
    payloadVisibility: 'rpc-endpoint-can-read',
  };
}

function registry() {
  return {
    schemaVersion: 1,
    revision: 'synthetic-snapshot',
    generatedAt,
    expiresAt: '2026-11-06T00:01:00.000Z',
    evidence: 'SIMULATED',
    origin: 'fixture',
    endpoints: [{
      endpointId: 'endpoint-synthetic',
      chainId: '1',
      chainName: 'Synthetic chain',
      rpcUrl: 'https://rpc.example.com',
      publisher: { creator: `0x${'1'.repeat(40)}`, owner: `0x${'2'.repeat(40)}` },
      entityKey: `0x${'3'.repeat(64)}`,
      expiresAt: '2026-11-06T00:01:00.000Z',
      source: { url: 'https://source.example.com/chains', revision: 'synthetic-revision', licenseUrl: 'https://source.example.com/LICENSE', snapshotSha256: '4'.repeat(64) },
    }],
  };
}

async function savePlan(fixture: Fixture): Promise<void> {
  await writeFile(fixture.planPath, canonical(fixture.plan));
}

async function put(fixture: Fixture, path: string, kind: Kind, value: unknown): Promise<void> {
  const bytes = canonical(value);
  await mkdir(dirname(join(fixture.inputDirectory, path)), { recursive: true });
  await writeFile(join(fixture.inputDirectory, path), bytes);
  fixture.plan.manifest.artifacts = fixture.plan.manifest.artifacts.filter((artifact) => artifact.path !== path);
  fixture.plan.manifest.artifacts.push({ path, sha256: sha256(bytes), generatedAt, evidence: 'SIMULATED', sourceTask: 'MN-017' });
  fixture.plan.kinds[path] = kind;
  await savePlan(fixture);
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'monolith-evidence-simulated-'));
  const fixture: Fixture = {
    root,
    inputDirectory: join(root, 'input'),
    planPath: join(root, 'plan.json'),
    outputDirectory: join(root, 'bundle'),
    nowISO,
    plan: { manifest: { schemaVersion: 1, runId, generatedAt, evidence: 'SIMULATED', artifacts: [] }, kinds: {} },
  };
  try {
    await mkdir(fixture.inputDirectory);
    await put(fixture, 'reports/privacy.json', 'privacy-report', report());
    await run(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function rejectsSafely(operation: () => Promise<unknown>, forbidden: string[] = []): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof EvidenceFailure);
    assert.match(error.code, /^[A-Z_]+$/);
    assert.equal(error.message, error.code);
    for (const value of forbidden) assert.ok(!error.message.includes(value));
    return true;
  });
}

test('validates all four public DTOs, retaining expired registry snapshots as recorded data', async () => {
  await withFixture(async (fixture) => {
    await put(fixture, 'observer.json', 'observer-run', observer());
    await put(fixture, 'trace.json', 'rpc-trace', trace());
    await put(fixture, 'registry.json', 'registry-manifest', registry());
    const result = await validateBundle(fixture);
    assert.deepEqual(result.manifest, fixture.plan.manifest);
    assert.equal(result.artifacts.length, 4);
    for (const artifact of result.artifacts) {
      assert.deepEqual(artifact.bytes, await readFile(join(fixture.inputDirectory, artifact.path)));
      assert.equal(sha256(artifact.bytes), fixture.plan.manifest.artifacts.find((entry) => entry.path === artifact.path)?.sha256);
    }
    assert.deepEqual(await readdir(fixture.root), ['input', 'plan.json']);
  });
});

test('exports original validated bytes and a matching manifest without changing sources', async () => {
  await withFixture(async (fixture) => {
    const beforePlan = await readFile(fixture.planPath);
    const beforeArtifact = await readFile(join(fixture.inputDirectory, 'reports/privacy.json'));
    const manifest = await exportBundle(fixture);
    assert.deepEqual(manifest, fixture.plan.manifest);
    assert.deepEqual(JSON.parse(await readFile(join(fixture.outputDirectory, 'verification-manifest.json'), 'utf8')), manifest);
    assert.deepEqual(await readFile(join(fixture.outputDirectory, 'reports/privacy.json')), beforeArtifact);
    assert.deepEqual(await readFile(fixture.planPath), beforePlan);
    assert.deepEqual(await readFile(join(fixture.inputDirectory, 'reports/privacy.json')), beforeArtifact);
  });
});

test('exports a canonical report identity without rewriting it as a server run', async () => {
  await withFixture(async (fixture) => {
    fixture.plan.manifest.runId = reportId;
    await put(fixture, 'reports/privacy.json', 'privacy-report', { ...report(), runId: reportId });
    const original = await readFile(join(fixture.inputDirectory, 'reports/privacy.json'));
    const result = await validateBundle(fixture);
    assert.equal(result.manifest.runId, reportId);
    const manifest = await exportBundle(fixture);
    assert.equal(manifest.runId, reportId);
    const exported = await readFile(join(fixture.outputDirectory, 'reports/privacy.json'));
    assert.deepEqual(exported, original);
    assert.equal(JSON.parse(exported.toString()).runId, reportId);
    assert.deepEqual(await readFile(join(fixture.inputDirectory, 'reports/privacy.json')), original);
  });
});

for (const identity of [
  'report-00000000-0000-4000-8000-000000000001',
  'run_00000000-0000-4000-8000-000000000001',
  'Report_00000000-0000-4000-8000-000000000001',
  'report_ABCDEF00-0000-4000-8000-000000000001',
  'report_00000000-0000-1000-8000-000000000001',
  'report_00000000-0000-4000-7000-000000000001',
  'report_00000000-0000-4000-8000-00000000001',
  'report_00000000-0000-4000-8000-000000000001-extra',
  'report_persistent-user-session',
]) {
  test(`rejects malformed report identity before reading artifacts: ${identity}`, async () => {
    await withFixture(async (fixture) => {
      fixture.plan.manifest.runId = identity;
      await savePlan(fixture);
      await assert.rejects(() => exportBundle(fixture), new EvidenceFailure('INVALID_PLAN'));
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

for (const [manifestId, artifactId] of [
  [reportId, 'report_00000000-0000-4000-8000-000000000002'],
  [reportId, runId],
  [runId, reportId],
] as const) {
  test(`rejects a report identity mismatch without prefix substitution: ${manifestId} / ${artifactId}`, async () => {
    await withFixture(async (fixture) => {
      fixture.plan.manifest.runId = manifestId;
      await put(fixture, 'reports/privacy.json', 'privacy-report', { ...report(), runId: artifactId });
      await assert.rejects(() => exportBundle(fixture), new EvidenceFailure('ARTIFACT_INVALID'));
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

test('report identities retain label, hash, timestamp and redaction checks', async (context) => {
  const cases: Array<[string, (fixture: Fixture) => Promise<void>, EvidenceFailure['code']]> = [
    ['label', async (fixture) => {
      await put(fixture, 'reports/privacy.json', 'privacy-report', { ...report(), runId: reportId, evidence: 'BLOCKED' });
    }, 'ARTIFACT_INVALID'],
    ['hash', async (fixture) => { fixture.plan.manifest.artifacts[0]!.sha256 = '0'.repeat(64); }, 'HASH_MISMATCH'],
    ['timestamp', async (fixture) => { fixture.plan.manifest.artifacts[0]!.generatedAt = futureISO; }, 'INVALID_PLAN'],
    ['redaction', async (fixture) => {
      const payload = { ...report(), runId: reportId };
      payload.findings[0]!.message = 'Synthetic source 198.51.100.44';
      await put(fixture, 'reports/privacy.json', 'privacy-report', payload);
    }, 'REDACTION_REQUIRED'],
  ];
  for (const [name, mutate, code] of cases) {
    await context.test(name, async () => {
      await withFixture(async (fixture) => {
        fixture.plan.manifest.runId = reportId;
        await put(fixture, 'reports/privacy.json', 'privacy-report', { ...report(), runId: reportId });
        await mutate(fixture);
        await savePlan(fixture);
        await assert.rejects(() => exportBundle(fixture), new EvidenceFailure(code));
        assert.ok(!(await readdir(fixture.root)).includes('bundle'));
      });
    });
  }
});

test('rejects a whole download wrapper even when its nested report identity matches', async () => {
  await withFixture(async (fixture) => {
    fixture.plan.manifest.runId = reportId;
    await put(fixture, 'reports/privacy.json', 'privacy-report', {
      schemaVersion: 1, observedAt: generatedAt, mode: 'repair', report: { ...report(), runId: reportId },
    });
    await assert.rejects(() => exportBundle(fixture), new EvidenceFailure('ARTIFACT_INVALID'));
    assert.ok(!(await readdir(fixture.root)).includes('bundle'));
  });
});

test('rejects observer projections with an omitted duration instead of filling one', async () => {
  await withFixture(async (fixture) => {
    const payload = observer();
    const observation: Record<string, unknown> = { ...payload.observations[0]! };
    delete observation['durationMs'];
    await put(fixture, 'observer.json', 'observer-run', { ...payload, observations: [observation] });
    await assert.rejects(() => exportBundle(fixture), new EvidenceFailure('ARTIFACT_INVALID'));
    assert.ok(!(await readdir(fixture.root)).includes('bundle'));
  });
});

for (const label of ['BLOCKED', 'UNTESTED'] as const) {
  test(`preserves ${label} labels without upgrading them`, async () => {
    await withFixture(async (fixture) => {
      const payload = { ...report(), evidence: label };
      await put(fixture, 'reports/privacy.json', 'privacy-report', payload);
      fixture.plan.manifest.evidence = label;
      fixture.plan.manifest.artifacts[0]!.evidence = label;
      await savePlan(fixture);
      const manifest = await exportBundle(fixture);
      assert.equal(manifest.evidence, label);
      assert.equal(manifest.artifacts[0]?.evidence, label);
      assert.equal(JSON.parse(await readFile(join(fixture.outputDirectory, 'reports/privacy.json'), 'utf8')).evidence, label);
    });
  });
}

const badPlans: Array<[string, (plan: Plan) => void]> = [
  ['unknown plan field', (plan) => Object.assign(plan, { privatePayload: 'do-not-export' })],
  ['unknown manifest field', (plan) => Object.assign(plan.manifest, { rawIp: '198.51.100.44' })],
  ['empty artifact set', (plan) => { plan.manifest.artifacts = []; plan.kinds = {}; }],
  ['missing kind', (plan) => { delete plan.kinds['reports/privacy.json']; }],
  ['extra kind', (plan) => { plan.kinds['not-listed.json'] = 'privacy-report'; }],
  ['unsupported kind', (plan) => { plan.kinds['reports/privacy.json'] = 'raw-network-log'; }],
  ['wrong declared DTO kind', (plan) => { plan.kinds['reports/privacy.json'] = 'observer-run'; }],
  ['duplicate artifact path', (plan) => { plan.manifest.artifacts.push({ ...plan.manifest.artifacts[0]! }); }],
  ['noncanonical run identifier', (plan) => { plan.manifest.runId = 'persistent-user-session'; }],
  ['UUID without a supported identity prefix', (plan) => { plan.manifest.runId = runId.slice(4); }],
  ['UUID without version four', (plan) => { plan.manifest.runId = runId.replace('-4000-', '-1000-'); }],
  ['future manifest timestamp', (plan) => { plan.manifest.generatedAt = futureISO; }],
  ['future artifact timestamp', (plan) => { plan.manifest.artifacts[0]!.generatedAt = futureISO; }],
  ['artifact timestamp after manifest', (plan) => { plan.manifest.artifacts[0]!.generatedAt = '2026-11-06T00:00:01.000Z'; }],
  ['manifest label differs from artifact', (plan) => { plan.manifest.evidence = 'BLOCKED'; }],
  ['artifact label differs from payload', (plan) => { plan.manifest.evidence = 'BLOCKED'; plan.manifest.artifacts[0]!.evidence = 'BLOCKED'; }],
  ['hash mismatch', (plan) => { plan.manifest.artifacts[0]!.sha256 = '0'.repeat(64); }],
];
for (const [name, mutate] of badPlans) {
  test(`rejects ${name} before creating output`, async () => {
    await withFixture(async (fixture) => {
      mutate(fixture.plan);
      await savePlan(fixture);
      await rejectsSafely(() => exportBundle(fixture));
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

for (const path of ['../escape.json', '/absolute.json', 'reports/../escape.json', 'reports\\escape.json', '.hidden.json', 'verification-manifest.json', 'verification-manifest.json/nested.json', `wallet-0x${'5'.repeat(40)}.json`, 'raw.txt']) {
  test(`rejects unsafe or reserved artifact path ${path}`, async () => {
    await withFixture(async (fixture) => {
      fixture.plan.manifest.artifacts[0]!.path = path;
      fixture.plan.kinds = { [path]: 'privacy-report' };
      await savePlan(fixture);
      await rejectsSafely(() => exportBundle(fixture));
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

test('rejects report or observer identity from a different run', async (context) => {
  for (const [kind, makePayload] of [['privacy-report', report], ['observer-run', observer]] as const) {
    await context.test(kind, async () => {
      await withFixture(async (fixture) => {
        await put(fixture, 'identity.json', kind, { ...makePayload(), runId: 'run-00000000-0000-4000-8000-000000000002' });
        await rejectsSafely(() => validateBundle(fixture));
      });
    });
  }
});

test('rejects registry timestamps that disagree with the artifact sidecar', async () => {
  await withFixture(async (fixture) => {
    await put(fixture, 'registry.json', 'registry-manifest', { ...registry(), generatedAt: '2026-11-05T23:59:59.000Z' });
    await rejectsSafely(() => validateBundle(fixture));
  });
});

test('rejects observer expiry at or before artifact generation', async () => {
  await withFixture(async (fixture) => {
    await put(fixture, 'observer.json', 'observer-run', { ...observer(), expiresAt: generatedAt });
    await rejectsSafely(() => validateBundle(fixture));
  });
});

for (const [name, payload] of [
  ['unknown private report field', { ...report(), walletAddress: `0x${'5'.repeat(40)}` }],
  ['raw observer source', { ...observer(), observations: [{ ...observer().observations[0], rawIp: '198.51.100.44' }] }],
  ['trace RPC params', { ...trace(), params: [`0x${'5'.repeat(40)}`] }],
] as const) {
  const kind: Kind = name.startsWith('raw observer') ? 'observer-run' : name.startsWith('trace') ? 'rpc-trace' : 'privacy-report';
  test(`strictly rejects ${name}`, async () => {
    await withFixture(async (fixture) => {
      await put(fixture, 'private.json', kind, payload);
      await rejectsSafely(() => exportBundle(fixture), ['198.51.100.44', 'walletAddress']);
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

for (const sensitive of ['198.51.100.44', '2001:db8::1', '::1.', 'fe80::1:', `0x${'5'.repeat(40)}`, `0x${'6'.repeat(64)}`, 'private_key=synthetic-value', 'privateKey: synthetic-value', 'Authorization: synthetic-value', 'Bearer synthetic-value', 'mnemonic synthetic-value', 'signature synthetic-value', 'api_key=synthetic-value']) {
  test(`rejects sensitive free text (${sensitive.slice(0, 20)}) with a fixed safe error`, async () => {
    await withFixture(async (fixture) => {
      const payload = report();
      payload.findings[0]!.message = `Synthetic finding ${sensitive}`;
      await put(fixture, 'reports/privacy.json', 'privacy-report', payload);
      await rejectsSafely(() => exportBundle(fixture), [sensitive, fixture.root]);
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

for (const message of ['Synthetic source ::1 observed.', 'Synthetic source fe80::1 observed.', 'Synthetic source [::ffff:192.0.2.1]:443 observed.']) {
  test(`rejects embedded compressed IPv6 in public free text: ${message}`, async () => {
    await withFixture(async (fixture) => {
      const payload = report();
      payload.findings[0]!.message = message;
      await put(fixture, 'reports/privacy.json', 'privacy-report', payload);
      await rejectsSafely(() => exportBundle(fixture), [message]);
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

for (const origin of ['https://localhost.', 'https://api.internal.', 'https://rpc.example.com.']) {
  test(`rejects trailing-dot hostname in a public report origin: ${origin}`, async () => {
    await withFixture(async (fixture) => {
      const payload = report();
      payload.scope.rpcOrigins = [origin];
      await put(fixture, 'reports/privacy.json', 'privacy-report', payload);
      await rejectsSafely(() => exportBundle(fixture), [origin]);
      assert.ok(!(await readdir(fixture.root)).includes('bundle'));
    });
  });
}

test('public registry address exceptions do not exempt the same bytes in labels', async () => {
  await withFixture(async (fixture) => {
    const payload = registry();
    payload.endpoints[0]!.chainName = payload.endpoints[0]!.publisher.creator;
    await put(fixture, 'registry.json', 'registry-manifest', payload);
    await rejectsSafely(() => validateBundle(fixture));
  });
});

for (const rpcUrl of ['https://rpc.example.com/?key=synthetic', 'https://user:synthetic@rpc.example.com', 'https://198.51.100.44', 'http://rpc.example.com', 'https://rpc.example.com/#fragment']) {
  test(`rejects unsafe public artifact URL ${rpcUrl}`, async () => {
    await withFixture(async (fixture) => {
      const payload = registry();
      payload.endpoints[0]!.rpcUrl = rpcUrl;
      await put(fixture, 'registry.json', 'registry-manifest', payload);
      await rejectsSafely(() => validateBundle(fixture), [rpcUrl]);
    });
  });
}

test('rejects noncanonical, duplicate-key and escaped JSON even with a matching byte hash', async (context) => {
  const valid = report();
  const variants = [
    JSON.stringify(valid),
    canonical(valid).toString().replace('"eligibleReads": 2,', '"eligibleReads": 999,\n  "eligibleReads": 2,'),
    canonical(valid).toString().replace('Synthetic direct read.', '\\u0053ynthetic direct read.'),
  ];
  for (const [index, bytes] of variants.entries()) {
    await context.test(`variant ${index + 1}`, async () => {
      await withFixture(async (fixture) => {
        await writeFile(join(fixture.inputDirectory, 'reports/privacy.json'), bytes);
        fixture.plan.manifest.artifacts[0]!.sha256 = sha256(Buffer.from(bytes));
        await savePlan(fixture);
        await rejectsSafely(() => validateBundle(fixture));
      });
    });
  }
});

test('rejects noncanonical plans and duplicate manifest claims', async (context) => {
  for (const duplicate of [false, true]) {
    await context.test(duplicate ? 'duplicate key' : 'compact JSON', async () => {
      await withFixture(async (fixture) => {
        const bytes = duplicate
          ? canonical(fixture.plan).toString().replace('"schemaVersion": 1,', '"schemaVersion": 2,\n    "schemaVersion": 1,')
          : JSON.stringify(fixture.plan);
        await writeFile(fixture.planPath, bytes);
        await rejectsSafely(() => validateBundle(fixture));
      });
    });
  }
});

test('rejects malformed input JSON with no source text in its error', async () => {
  await withFixture(async (fixture) => {
    const sentinel = 'SYNTHETIC_PRIVATE_SENTINEL';
    await writeFile(fixture.planPath, `{"${sentinel}":`);
    await rejectsSafely(() => validateBundle(fixture), [sentinel, fixture.planPath]);
  });
});

test('rejects invalid explicit evaluation clocks', async () => {
  await withFixture(async (fixture) => {
    await rejectsSafely(() => validateBundle({ ...fixture, nowISO: 'not-a-timestamp' }));
  });
});

test('rejects oversized plans and artifacts before creating output', async (context) => {
  for (const target of ['plan', 'artifact'] as const) {
    await context.test(target, async () => {
      await withFixture(async (fixture) => {
        const path = target === 'plan' ? fixture.planPath : join(fixture.inputDirectory, 'reports/privacy.json');
        await writeFile(path, Buffer.alloc((target === 'plan' ? 256 * 1024 : 1024 * 1024) + 1, 32));
        await rejectsSafely(() => exportBundle(fixture));
        assert.ok(!(await readdir(fixture.root)).includes('bundle'));
      });
    });
  }
});

test('rejects more than 64 artifacts', async () => {
  await withFixture(async (fixture) => {
    fixture.plan.manifest.artifacts = Array.from({ length: 65 }, (_, index) => ({ ...fixture.plan.manifest.artifacts[0]!, path: `artifact-${index}.json` }));
    fixture.plan.kinds = Object.fromEntries(fixture.plan.manifest.artifacts.map((artifact) => [artifact.path, 'privacy-report']));
    await savePlan(fixture);
    await rejectsSafely(() => validateBundle(fixture));
  });
});

test('rejects aggregate bytes above 8 MiB while each artifact is below 1 MiB', async () => {
  await withFixture(async (fixture) => {
    const large = report();
    large.findings = Array.from({ length: 3000 }, () => ({ code: 'SYNTHETIC', readId: 'read-synthetic-001', callsite: 'fixture.synthetic', message: 'X'.repeat(150) }));
    const bytes = canonical(large);
    assert.ok(bytes.length < 1024 * 1024);
    assert.ok(bytes.length * 12 > 8 * 1024 * 1024);
    for (let index = 0; index < 12; index++) await put(fixture, `large-${index}.json`, 'privacy-report', large);
    await rejectsSafely(() => exportBundle(fixture));
    assert.ok(!(await readdir(fixture.root)).includes('bundle'));
  });
});

test('rejects missing files and non-regular artifact entries with fixed errors', async (context) => {
  for (const directory of [false, true]) {
    await context.test(directory ? 'directory' : 'missing', async () => {
      await withFixture(async (fixture) => {
        const path = join(fixture.inputDirectory, 'reports/privacy.json');
        await rm(path);
        if (directory) await mkdir(path);
        await rejectsSafely(() => validateBundle(fixture), [path]);
      });
    });
  }
});

test('rejects symlinks at the plan, input root, artifact and artifact ancestor', async (context) => {
  for (const target of ['plan', 'input', 'artifact', 'artifact-ancestor'] as const) {
    await context.test(target, async () => {
      await withFixture(async (fixture) => {
        if (target === 'plan') {
          const real = join(fixture.root, 'real-plan.json');
          await writeFile(real, await readFile(fixture.planPath));
          await rm(fixture.planPath);
          await symlink(real, fixture.planPath);
        } else if (target === 'input') {
          const alias = join(fixture.root, 'input-alias');
          await symlink(fixture.inputDirectory, alias);
          fixture.inputDirectory = alias;
        } else if (target === 'artifact') {
          const original = join(fixture.inputDirectory, 'reports/privacy.json');
          const real = join(fixture.root, 'real-artifact.json');
          await writeFile(real, await readFile(original));
          await rm(original);
          await symlink(real, original);
        } else {
          const original = join(fixture.inputDirectory, 'reports');
          const real = join(fixture.root, 'real-reports');
          await mkdir(real);
          await writeFile(join(real, 'privacy.json'), await readFile(join(original, 'privacy.json')));
          await rm(original, { recursive: true });
          await symlink(real, original);
        }
        await rejectsSafely(() => exportBundle(fixture));
        assert.ok(!(await readdir(fixture.root)).includes('bundle'));
      });
    });
  }
});

test('rejects input and plan paths beneath a symlinked ancestor', async () => {
  await withFixture(async (fixture) => {
    const alias = `${fixture.root}-alias`;
    try {
      await symlink(fixture.root, alias);
      await rejectsSafely(() => validateBundle({ ...fixture, inputDirectory: join(alias, 'input'), planPath: join(alias, 'plan.json') }));
    } finally {
      await rm(alias, { force: true });
    }
  });
});

test('refuses existing output and leaves its contents unchanged', async () => {
  await withFixture(async (fixture) => {
    await mkdir(fixture.outputDirectory);
    const sentinel = join(fixture.outputDirectory, 'owner-file.txt');
    await writeFile(sentinel, 'owner data');
    await rejectsSafely(() => exportBundle(fixture));
    assert.equal(await readFile(sentinel, 'utf8'), 'owner data');
    assert.deepEqual(await readdir(fixture.outputDirectory), ['owner-file.txt']);
  });
});

test('rejects output through a symlinked ancestor without writing to its target', async () => {
  await withFixture(async (fixture) => {
    const real = join(fixture.root, 'real-output-parent');
    const alias = join(fixture.root, 'output-parent-alias');
    await mkdir(real);
    await symlink(real, alias);
    await rejectsSafely(() => exportBundle({ ...fixture, outputDirectory: join(alias, 'bundle') }));
    assert.deepEqual(await readdir(real), []);
  });
});

test('rejects output equal to or nested inside input', async (context) => {
  for (const nested of [false, true]) {
    await context.test(nested ? 'nested' : 'equal', async () => {
      await withFixture(async (fixture) => {
        await rejectsSafely(() => exportBundle({ ...fixture, outputDirectory: nested ? join(fixture.inputDirectory, 'bundle') : fixture.inputDirectory }));
        assert.deepEqual(await readdir(fixture.inputDirectory), ['reports']);
      });
    });
  }
});

test('rejects input nested within output rather than overwriting the source tree', async () => {
  await withFixture(async (fixture) => {
    await rejectsSafely(() => exportBundle({ ...fixture, outputDirectory: fixture.root }));
    assert.deepEqual(await readdir(fixture.root), ['input', 'plan.json']);
  });
});

test('refuses SIMULATED exports under any evidence path segment', async () => {
  await withFixture(async (fixture) => {
    const parent = join(fixture.root, 'evidence');
    await mkdir(parent);
    await rejectsSafely(() => exportBundle({ ...fixture, outputDirectory: join(parent, 'simulated-bundle') }));
    assert.deepEqual(await readdir(parent), []);
  });
});
