import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import { str } from '@arkiv-network/sdk/schema';
import { http } from 'viem';
import { RpcSource } from './arkiv-schema.mts';
import { assessEntity, type ExpectedSample, type TrustFailure } from './arkiv-trust.mts';

const publisher: `0x${string}` = `0x${'ab'.repeat(20)}`;
const foreignPublisher = `0x${'cd'.repeat(20)}`;
const key = `0x${'12'.repeat(32)}`;
const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const expected: ExpectedSample = {
  publisher,
  runId: 'mn005-simulated-01',
  entityKey: key,
  currentBlock: 1000n,
  nowISO: '2030-01-02T00:00:00.000Z',
  sourceCommit: commit,
  sourceUrl: `https://raw.githubusercontent.com/ethereum-lists/chains/${commit}/_data/chains/eip155-1.json`,
  licenseUrl: `https://raw.githubusercontent.com/ethereum-lists/chains/${commit}/LICENSE`,
  snapshotSha256: hash,
};

function simulatedRow(): Record<string, unknown> {
  return {
    $key: key,
    $creator: publisher,
    $owner: publisher,
    $expiresAt: 1001n,
    chain_id: str('1'),
    chain_name: str('Ethereum Mainnet'),
    rpc_host: str('https://ethereum-rpc.publicnode.com'),
    network_type: str('ethereum'),
    status: str('candidate'),
    source_url: str(expected.sourceUrl),
    source_commit: str(commit),
    source_license: str(expected.licenseUrl),
    snapshot_sha256: str(hash),
    observed_at: str('2030-01-01T00:00:00.000Z'),
    measured_chain_id: str(''),
    run_id: str(expected.runId),
    evidence: str('SIMULATED'),
  };
}

function reject(row: unknown, reason: TrustFailure, context = expected): void {
  assert.deepEqual(assessEntity(row, context), { trusted: false, reason });
}

describe('SIMULATED Arkiv publisher and candidate boundary', () => {
  it('accepts a fresh typed row while keeping storage evidence separate from sample evidence', () => {
    const result = assessEntity(simulatedRow(), expected);
    assert.equal(result.trusted, true);
    if (!result.trusted) assert.fail('expected trusted sample');
    assert.equal(result.candidate.expiresAtBlock, '1001');
    assert.equal(result.candidate.evidence, 'SIMULATED');
    assert.equal(result.candidate.status, 'candidate');
    assert.equal(result.candidate.measuredChainId, '');
  });

  it('does not authenticate a matching-schema foreign creator', () => {
    reject({ ...simulatedRow(), $creator: foreignPublisher }, 'FOREIGN_CREATOR');
  });

  it('does not authenticate a transferred entity owned by another publisher', () => {
    reject({ ...simulatedRow(), $owner: foreignPublisher }, 'FOREIGN_OWNER');
  });

  it('compares addresses without treating checksum case as a different publisher', () => {
    const row = { ...simulatedRow(), $creator: `0x${'AB'.repeat(20)}` };
    assert.equal(assessEntity(row, expected).trusted, true);
  });

  it('rejects expiry at or before the observed block height', () => {
    for (const expiresAt of [0n, 999n, 1000n]) {
      reject({ ...simulatedRow(), $expiresAt: expiresAt }, 'EXPIRED_ENTITY');
    }
    reject({ ...simulatedRow(), $expiresAt: '2030-01-03T00:00:00Z' }, 'MALFORMED_ENTITY');
  });

  it('pins the actual entity key and per-experiment identifier', () => {
    reject({ ...simulatedRow(), $key: `0x${'34'.repeat(32)}` }, 'WRONG_ENTITY');
    reject({ ...simulatedRow(), run_id: str('another-synthetic-run') }, 'WRONG_RUN');
  });

  it('rejects missing fields, incorrectly typed attributes and malformed system metadata', () => {
    const missing = simulatedRow();
    delete missing.source_commit;
    reject(missing, 'MALFORMED_ENTITY');
    reject({ ...simulatedRow(), chain_id: '1' }, 'MALFORMED_ENTITY');
    reject({ ...simulatedRow(), chain_id: { type: 'u256', value: 1n } }, 'MALFORMED_ENTITY');
    reject({ ...simulatedRow(), $creator: 'publisher' }, 'MALFORMED_ENTITY');
    reject({ ...simulatedRow(), $key: '0x1234' }, 'MALFORMED_ENTITY');
    reject(null, 'MALFORMED_ENTITY');
  });

  it('rejects private destinations, numeric host aliases and non-HTTPS URLs before probing', () => {
    for (const rpc of [
      'http://ethereum-rpc.publicnode.com',
      'https://127.0.0.1',
      'https://0x7f000001',
      'https://2130706433',
      'https://0177.0.0.1',
      'https://[::1]',
      'https://localhost',
      'https://rpc.internal',
      'https://rpc.localhost',
      'https://rpc.example:8443',
      'https://name:secret@rpc.example',
      'https://rpc.example#fragment',
      'https://rpc.example/${API_KEY}',
      'https://rpc.example\\private',
    ]) reject({ ...simulatedRow(), rpc_host: str(rpc) }, 'UNSAFE_URL');
  });

  it('pins the content hash, immutable source revision and provenance URLs', () => {
    for (const [name, value] of [
      ['source_commit', 'c'.repeat(40)],
      ['snapshot_sha256', 'd'.repeat(64)],
      ['source_url', 'https://untrusted.example/chains.json'],
      ['source_license', 'https://untrusted.example/LICENSE'],
    ]) reject({ ...simulatedRow(), [name as string]: str(value as string) }, 'PROVENANCE_MISMATCH');
  });

  it('requires a canonical chain ID and truthful unprobed candidate labels', () => {
    for (const [name, value] of [
      ['chain_id', '01'],
      ['chain_id', '0x1'],
      ['chain_name', ' '],
      ['status', 'verified'],
      ['evidence', 'OBSERVED_LIVE'],
      ['measured_chain_id', '1'],
    ]) reject({ ...simulatedRow(), [name as string]: str(value as string) }, 'INVALID_CANDIDATE');
  });

  it('rejects future and impossible observation dates using an explicit evaluation clock', () => {
    for (const observed of ['2030-01-03T00:00:00Z', '2030-02-31T00:00:00Z', 'yesterday']) {
      reject({ ...simulatedRow(), observed_at: str(observed) }, 'INVALID_CANDIDATE');
    }
    reject(simulatedRow(), 'INVALID_CONTEXT', { ...expected, nowISO: 'invalid' });
    reject(simulatedRow(), 'INVALID_CONTEXT', { ...expected, currentBlock: -1n });
  });

  it('returns only the safe selected candidate projection', () => {
    const result = assessEntity({ ...simulatedRow(), raw_ip: 'SIMULATED-IP', body: 'SIMULATED-BODY' }, expected);
    assert.equal(result.trusted, true);
    assert.equal(JSON.stringify(result).includes('SIMULATED-IP'), false);
    assert.equal(JSON.stringify(result).includes('SIMULATED-BODY'), false);
  });

  it('compiles both creator and owner filters into the actual SDK query without contacting a node', () => {
    const client = createPublicClient({
      chain: rabdi({ accessKey: 'SIMULATED-NO-NETWORK' }),
      transport: http(),
    });
    const query = client.select('*').from(RpcSource)
      .createdBy(publisher).ownedBy(publisher).where(eq('run_id', expected.runId));
    const rendered = query.toString().toLowerCase();
    assert.ok(rendered.includes("arkiv.schema = str('monolith.rpc.v1')"));
    assert.ok(rendered.includes(`$creator = addr(${publisher})`));
    assert.ok(rendered.includes(`$owner = addr(${publisher})`));
    assert.ok(rendered.includes(`run_id = str('${expected.runId}')`));
  });
});
