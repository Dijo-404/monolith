import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { getAddress, http, isAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, publicClient, sampleQuery } from './arkiv-query.mts';
import { RpcSource } from './arkiv-schema.mts';
import { sampleValues, SOURCE } from './arkiv-source.mts';
import { assessEntity } from './arkiv-trust.mts';

type Run = {
  schemaVersion: 1;
  runId: string;
  publisher: Address;
  chainId: typeof CHAIN_ID;
  observedAt: string;
  status: string;
  storageEvidence: 'OBSERVED_LIVE' | 'UNTESTED' | 'BLOCKED';
  payloadEvidence: 'SIMULATED';
  txHash: Hex | null;
  entityKey: Hex | null;
  expiresAtBlock: string | null;
};

function save(path: string, value: unknown, exclusive = false) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
    flag: exclusive ? 'wx' : 'w',
  });
}

function loadRun(path: string): Run {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Run>;
  if (value.schemaVersion !== 1 || value.chainId !== CHAIN_ID ||
    typeof value.runId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.runId) ||
    typeof value.publisher !== 'string' || !isAddress(value.publisher) ||
    (value.entityKey !== null && !/^0x[0-9a-fA-F]{64}$/.test(value.entityKey ?? ''))) {
    throw new Error('INVALID_RUN');
  }
  return value as Run;
}

function accountFromFile(variable: string) {
  const path = process.env[variable];
  if (!path) throw new Error('PUBLISHER_KEY_FILE_REQUIRED');
  const key = readFileSync(path, 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('INVALID_PUBLISHER_KEY');
  return privateKeyToAccount(key as Hex);
}

async function check(address: string, output: string) {
  if (!isAddress(address)) throw new Error('INVALID_PUBLISHER');
  const client = publicClient();
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error('CHAIN_MISMATCH');
  const balance = await client.getBalance({ address });
  const block = await client.getBlockNumber();
  const query = sampleQuery(client, 'mn005-connectivity-check', address);
  const rows = await query.fetch();
  const observation = {
    observedAt: new Date().toISOString(), evidence: 'OBSERVED_LIVE',
    scope: 'Public Rabdi connectivity and empty scoped query only; no write or route validation',
    chainId, blockNumber: String(block), publisher: getAddress(address),
    balanceWei: String(balance), query: query.toString(), rowCount: rows.entities.length,
    funding: balance === 0n ? 'BLOCKED_UNFUNDED_PUBLISHER' : 'AVAILABLE',
  };
  save(output, observation, true);
  console.log(JSON.stringify(observation));
}

async function write(output: string, foreignRunPath?: string) {
  // Each explicit write command submits at most one public, synthetic test entity.
  const parent = foreignRunPath ? loadRun(foreignRunPath) : undefined;
  const account = accountFromFile(parent ? 'ARKIV_FOREIGN_KEY_FILE' : 'ARKIV_PUBLISHER_KEY_FILE');
  if (parent && account.address.toLowerCase() === parent.publisher.toLowerCase()) {
    throw new Error('FOREIGN_PUBLISHER_MUST_DIFFER');
  }
  const client = publicClient();
  if (await client.getChainId() !== CHAIN_ID) throw new Error('CHAIN_MISMATCH');
  const balance = await client.getBalance({ address: account.address });
  const run: Run = {
    schemaVersion: 1, runId: parent?.runId ?? `mn005-${randomUUID()}`,
    publisher: account.address, chainId: CHAIN_ID, observedAt: new Date().toISOString(),
    status: 'PREPARED', storageEvidence: 'UNTESTED', payloadEvidence: 'SIMULATED',
    txHash: null, entityKey: null, expiresAtBlock: null,
  };
  if (balance === 0n) {
    // Do not reserve a submission journal until funding exists: no signed write was attempted.
    const blocked = { ...run, status: 'BLOCKED_UNFUNDED_PUBLISHER', storageEvidence: 'BLOCKED' };
    save(output, blocked, true);
    console.log(JSON.stringify(blocked));
    process.exitCode = 2;
    return;
  }

  // Exclusive journal prevents blindly resubmitting after crash/uncertain broadcast.
  save(output, { ...run, status: 'SUBMISSION_UNCERTAIN' }, true);
  const wallet = createWalletClient({
    chain: client.chain, account,
    transport: http(undefined, { timeout: 15_000, retryCount: 0 }),
    pollingInterval: 2_000,
  });
  let progress = run;
  try {
    const result = await wallet.createEntity(RpcSource, sampleValues(run.runId, run.observedAt), {
      expiration: ExpirationTime.fromHours(1), flags: { readonly: true },
    });
    progress = {
      ...run, status: 'RECEIPT_RECHECK_PENDING', storageEvidence: 'OBSERVED_LIVE',
      txHash: result.txHash, entityKey: result.entityKey, expiresAtBlock: String(result.expiresAt),
    };
    save(output, progress);
    const receipt = await client.getTransactionReceipt({ hash: result.txHash });
    if (receipt.status !== 'success') throw new Error('RECEIPT_FAILED');
    const observation: Run = {
      ...run, status: 'WRITTEN_QUERY_PENDING', storageEvidence: 'OBSERVED_LIVE',
      txHash: result.txHash, entityKey: result.entityKey, expiresAtBlock: String(result.expiresAt),
    };
    save(output, observation);
    console.log(JSON.stringify(observation));
  } catch {
    // Do not print provider errors, access-key-bearing URLs or signed transaction payloads.
    const uncertain = { ...progress, status: 'SUBMISSION_UNCERTAIN_RECONCILE_BEFORE_RETRY' };
    save(output, uncertain);
    console.log(JSON.stringify(uncertain));
    process.exitCode = 2;
  }
}

async function query(runPath: string, output: string, reconcile = false) {
  // Independent process: this command never reads a signing key or constructs a wallet client.
  const run = loadRun(runPath);
  if (!run.entityKey && !reconcile) throw new Error('NO_WRITTEN_ENTITY');
  const client = publicClient();
  if (await client.getChainId() !== CHAIN_ID) throw new Error('CHAIN_MISMATCH');
  const filtered = sampleQuery(client, run.runId, run.publisher);
  const unfiltered = sampleQuery(client, run.runId);
  const trustedRows = await filtered.fetch();
  const allRows = await unfiltered.fetch();
  const currentBlock = await client.getBlockNumber();
  const nowISO = new Date().toISOString();
  const expected = {
    publisher: run.publisher, runId: run.runId, currentBlock, nowISO,
    sourceCommit: SOURCE.commit, snapshotSha256: SOURCE.snapshotSha256,
    sourceUrl: SOURCE.url, licenseUrl: SOURCE.licenseUrl,
  };
  const matching = trustedRows.entities.find((row) => row.$key.toLowerCase() === run.entityKey?.toLowerCase());
  const assessment = assessEntity(matching, {
    ...expected, ...(run.entityKey ? { entityKey: run.entityKey } : {}),
  });
  const foreign = allRows.entities.filter((row) =>
    row.$creator.toLowerCase() !== run.publisher.toLowerCase() ||
    row.$owner.toLowerCase() !== run.publisher.toLowerCase());
  const foreignRejected = foreign.filter((row) => !assessEntity(row, expected).trusted);
  const filteredPolicyValid = trustedRows.entities.every((row) => assessEntity(row, expected).trusted);
  const complete = assessment.trusted && filteredPolicyValid && foreign.length > 0 &&
    foreignRejected.length === foreign.length;
  const observation = {
    schemaVersion: 1, observedAt: nowISO, storageEvidence: 'OBSERVED_LIVE',
    payloadEvidence: 'SIMULATED', status: reconcile ? 'RECONCILIATION_ONLY_NO_RESUBMISSION' :
      complete ? 'LIVE_PREFLIGHT_PASSED' : 'LIVE_PREFLIGHT_INCOMPLETE',
    runId: run.runId, publisher: run.publisher, chainId: CHAIN_ID,
    txHash: run.txHash, entityKey: run.entityKey, expiresAtBlock: run.expiresAtBlock,
    currentBlock: String(currentBlock), filteredQuery: filtered.toString(),
    unfilteredQuery: unfiltered.toString(), filteredRows: trustedRows.entities.length,
    trustedEntityFound: assessment.trusted, filteredPolicyValid, foreignRows: foreign.length,
    foreignRejected: foreignRejected.length,
    queryPageLimit: 20, exhaustiveScan: false,
    candidate: assessment.trusted ? assessment.candidate : null,
    reconciliationCandidates: reconcile ? trustedRows.entities.map((row) => {
      const result = assessEntity(row, expected);
      return result.trusted ? result.candidate : null;
    }).filter((candidate) => candidate !== null) : [],
    limits: 'Single source sample, no RPC endpoint probe, no dataset import, no browser integration',
  };
  save(output, observation, true);
  console.log(JSON.stringify(observation));
  if (!complete || reconcile) process.exitCode = 2;
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'new-publisher' && first) {
    const key = generatePrivateKey();
    writeFileSync(first, key, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ publisher: privateKeyToAccount(key).address }));
  } else if (command === 'check' && first && second) {
    await check(first, second);
  } else if (command === 'write' && first) {
    await write(first);
  } else if (command === 'write-foreign' && first && second) {
    await write(second, first);
  } else if (command === 'query' && first && second) {
    await query(first, second);
  } else if (command === 'reconcile' && first && second) {
    await query(first, second, true);
  } else {
    throw new Error('USAGE: new-publisher KEYFILE | check ADDRESS OUTPUT | write OUTPUT | write-foreign RUN OUTPUT | query RUN OUTPUT | reconcile RUN OUTPUT');
  }
}

// The SDK receipt wait may outlive an HTTP request. A total deadline ends this isolated process;
// submission journal remains uncertain and must be reconciled before another explicit write.
const deadline = setTimeout(() => {
  console.error('PREFLIGHT_DEADLINE_REACHED_RECONCILE_BEFORE_RETRY');
  process.exit(2);
}, 90_000);
main().catch(() => {
  console.error('PREFLIGHT_FAILED: check configuration/funding; provider details withheld');
  process.exitCode = 2;
}).finally(() => clearTimeout(deadline));
