import assert from 'node:assert/strict';
import test from 'node:test';
import { publicClient, sampleQuery } from './arkiv-query.mts';
import { sampleValues, SOURCE } from './arkiv-source.mts';
import { assessEntity } from './arkiv-trust.mts';

test('SIMULATED query construction binds schema, run, creator AND owner', () => {
  const client = publicClient();
  const publisher = '0x1111111111111111111111111111111111111111';
  const trusted = sampleQuery(client, 'mn005-synthetic-run', publisher).toString();
  assert.match(trusted, /monolith\.rpc\.v1/);
  assert.match(trusted, /run_id = str\('mn005-synthetic-run'\)/);
  assert.match(trusted, /\$creator = addr\(0x1111111111111111111111111111111111111111\)/);
  assert.match(trusted, /\$owner = addr\(0x1111111111111111111111111111111111111111\)/);
  assert.match(trusted, / AND /);
  const discovery = sampleQuery(client, 'mn005-synthetic-run').toString();
  assert.doesNotMatch(discovery, /\$creator|\$owner/);
});

test('SIMULATED run IDs cannot inject a second query condition', () => {
  const query = sampleQuery(publicClient(), "x') OR status = str('verified").toString();
  assert.equal(query, "arkiv.schema = str('monolith.rpc.v1') AND run_id = str('x'') OR status = str(''verified')");
});

test('SIMULATED decoded writer sample satisfies the independent trust policy', () => {
  const values = sampleValues('mn005-sample-fixture', '2030-01-01T00:00:00.000Z');
  const publisher = '0x1111111111111111111111111111111111111111';
  const row = {
    ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { type: 'str', value }])),
    $key: `0x${'01'.repeat(32)}`, $creator: publisher, $owner: publisher, $expiresAt: 100n,
  };
  assert.equal(assessEntity(row, {
    publisher, runId: values.run_id, currentBlock: 99n, nowISO: '2030-01-01T00:00:01.000Z',
    sourceCommit: SOURCE.commit, snapshotSha256: SOURCE.snapshotSha256,
    sourceUrl: SOURCE.url, licenseUrl: SOURCE.licenseUrl,
  }).trusted, true);
});
