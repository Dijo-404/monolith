import { createHash } from 'node:crypto';
import { bytes } from '@arkiv-network/sdk/schema';
import { describe, expect, it } from 'vitest';
import {
  canonicalSwarmInventory, createSwarmRelease, validateSwarmRelease, swarmManifestCid, swarmReleaseOrigin,
  publishSwarmRelease, readSwarmRelease, SWARM_RELEASE_MAX_GAS, SWARM_RELEASE_GAS_PRICE,
  type SwarmRelease, type SwarmReleaseClient,
} from '../../src/swarm-release.js';

const publisher = `0x${'11'.repeat(20)}`;
const entityKey = `0x${'22'.repeat(32)}`;
const transactionHash = `0x${'33'.repeat(32)}`;
const reference = 'bc9b942212421e2a19fe1ffdf0add641ae530923041ea8f549381747b14b2f2d';
const now = '2026-11-07T00:00:00.000Z';
const sourceCommit = 'a'.repeat(40);
const body = new Map([
  ['index.html', '<html><body>Monolith</body></html>'],
  ['assets/worker-host.html', '<html><script type="module" src="./worker.js"></script></html>'],
  ['assets/worker.js', 'export {};'],
  ['assets/THIRD-PARTY-NOTICES.txt', 'MIT notices'],
  ['assets/font.woff2', 'SIMULATED_FONT_BYTES'],
]);
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function descriptor(): SwarmRelease {
  return createSwarmRelease({ sourceCommit, swarmReference: reference,
    publishedAt: '2026-11-06T23:00:00.000Z', expiresAt: '2026-11-08T00:00:00.000Z',
    files: [...body].map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: sha(text) })) });
}
function row(release = descriptor()): Record<string, unknown> {
  const str = (value: string) => ({ type: 'str', value });
  return { $key: entityKey, $creator: publisher, $owner: publisher, $expiresAt: 10_000n,
    $creationFlags: { readonly: true, permissionlessExtension: false, raw: 1 },
    release_id: str(release.releaseId), source_commit: str(release.sourceCommit), swarm_reference: str(release.swarmReference),
    published_at: str(release.publishedAt), content_expires_at: str(release.expiresAt), inventory_sha256: str(release.inventorySha256),
    inventory_json: bytes(new TextEncoder().encode(canonicalSwarmInventory(release.files))) };
}
function harness() {
  let block = 100n; let chainId = 7794095; let current = row(); let createCount = 0; let fileCount = 0;
  let balance = 1_000_000_000_000_000_000n;
  let receipt = { status: 'success', from: publisher, to: '0x4400000000000000000000000000000000000044' as string | null };
  const urls: string[] = [];
  const client: SwarmReleaseClient = {
    getChainId: async () => chainId, getBlockNumber: async () => block, getEntity: async () => current,
    getBalance: async () => balance,
    createEntity: async () => { createCount++; return { entityKey, txHash: transactionHash, expiresAt: 10_000n }; },
    getReceipt: async () => receipt,
  };
  const readFile = async (url: string, expectedBytes: number) => {
    fileCount++; urls.push(url);
    expect(url.startsWith(`${swarmReleaseOrigin(reference)}/`)).toBe(true);
    const path = url.slice(swarmReleaseOrigin(reference).length + 1);
    const text = body.get(path)!;
    expect(expectedBytes).toBe(Buffer.byteLength(text));
    return { bytes: new TextEncoder().encode(text), mime: path.endsWith('.js') ? 'text/javascript'
      : path.endsWith('.txt') ? 'text/plain; charset=utf-8' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' };
  };
  return { client, readFile, urls, now: () => now, setRow: (value: Record<string, unknown>) => { current = value; },
    setBlock: (value: bigint) => { block = value; }, setChain: (value: number) => { chainId = value; },
    setBalance: (value: bigint) => { balance = value; }, setReceipt: (value: typeof receipt) => { receipt = value; },
    counts: () => ({ createCount, fileCount }) };
}

describe('canonical public Swarm release descriptor', () => {
  it('binds the complete identity, canonical inventory order and immutable copies', () => {
    const release = descriptor();
    const reordered = createSwarmRelease({ ...releaseInput(release), files: [...release.files].reverse() });
    expect(reordered).toEqual(release);
    expect(Object.isFrozen(release.files)).toBe(true);
    expect(Object.isFrozen(release.files[0])).toBe(true);
    expect(validateSwarmRelease(JSON.parse(JSON.stringify(release)))).toEqual(release);
    expect(() => validateSwarmRelease({ ...release, sourceCommit: 'b'.repeat(40) })).toThrow('SWARM_RELEASE_INVALID');
    expect(() => validateSwarmRelease({ ...release, inventorySha256: '0'.repeat(64) })).toThrow('SWARM_RELEASE_INVALID');
  });
  it('rejects unsafe, credential-like, duplicate and excessive inventory data', () => {
    for (const path of ['/etc/passwd', 'assets/../secret', 'assets//worker', 'assets/.env', 'assets/.npmrc',
      'assets/key.pem', 'assets/a.map', 'assets/%2e%2e/secret', 'assets/a?token=secret', 'assets/a\\b']) {
      expect(() => canonicalSwarmInventory([...descriptor().files, { path, bytes: 1, sha256: sha('x') }])).toThrow();
    }
    expect(() => canonicalSwarmInventory([...descriptor().files, descriptor().files[0]])).toThrow();
    expect(() => canonicalSwarmInventory(descriptor().files.map((f) => ({ ...f, bytes: 1024 * 1024 })))).toThrow();
    expect(() => canonicalSwarmInventory([{ ...descriptor().files[0], bytes: Number.NaN }])).toThrow();
    expect(() => createSwarmRelease({ ...releaseInput(descriptor()), swarmReference: 'a'.repeat(128) })).toThrow();
  });
  it('rejects malformed or excessive lifetimes and encodes the official manifest CID vector', () => {
    expect(() => createSwarmRelease({ ...releaseInput(descriptor()), expiresAt: '2026-12-01T00:00:00.000Z' })).toThrow();
    expect(() => createSwarmRelease({ ...releaseInput(descriptor()), publishedAt: '2026-02-30T00:00:00.000Z' })).toThrow();
    expect(swarmManifestCid(reference)).toBe('bah5acgzaxsnziiqsiipcugp6d767blowigxfgcjdaqpkr5kjhalupmklf4wq');
    expect(swarmReleaseOrigin(reference)).toBe('https://bah5acgzaxsnziiqsiipcugp6d767blowigxfgcjdaqpkr5kjhalupmklf4wq.bzz.limo');
  });
});

function releaseInput(release: SwarmRelease) {
  return { sourceCommit: release.sourceCommit, swarmReference: release.swarmReference,
    publishedAt: release.publishedAt, expiresAt: release.expiresAt, files: release.files };
}

describe('trusted Arkiv discovery and useful content reads (SIMULATED)', () => {
  it('reads the Hex BytesValue produced by the public Arkiv SDK bytes helper', async () => {
    expect(bytes(new Uint8Array([0xde, 0xad])).value).toBe('0xdead');
    const h = harness();
    const result = await readSwarmRelease({ entityKey, publisher }, h);
    expect(result.descriptor).toEqual(descriptor());
    expect(h.counts()).toEqual({ createCount: 0, fileCount: 5 });
  });
  it('rejects malformed, oversized, invalid UTF-8 and noncanonical SDK byte payloads before downloads', async () => {
    const inventory = canonicalSwarmInventory(descriptor().files);
    const invalidPayloads: unknown[] = [
      { type: 'bytes', value: new TextEncoder().encode(inventory) },
      { type: 'bytes', value: [0xde, 0xad] }, { type: 'bytes', value: 1 },
      { type: 'str', value: bytes(new TextEncoder().encode(inventory)).value },
      { type: 'bytes', value: 'dead' }, { type: 'bytes', value: '0Xdead' },
      { type: 'bytes', value: '0x0' }, { type: 'bytes', value: '0xgg' },
      { type: 'bytes', value: `0x${'00'.repeat(16 * 1024 + 1)}` },
      bytes(new Uint8Array([0xff])), bytes(new Uint8Array([0xc0, 0xaf])),
      bytes(new TextEncoder().encode(` ${inventory}`)),
      bytes(new TextEncoder().encode(`${inventory}\n`)),
      bytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(inventory)])),
    ];
    for (const payload of invalidPayloads) {
      const h = harness(); const record = row(); record['inventory_json'] = payload; h.setRow(record);
      await expect(readSwarmRelease({ entityKey, publisher }, h)).rejects.toThrow('SWARM_RELEASE_READ_FAILED');
      expect(h.counts()).toEqual({ createCount: 0, fileCount: 0 });
    }
  });
  it('resolves a trusted entity into exact content and notices without a signing interface', async () => {
    const h = harness(); delete h.client.createEntity; delete h.client.getBalance; delete h.client.getReceipt;
    const result = await readSwarmRelease({ entityKey, publisher, expectedReleaseId: descriptor().releaseId }, h);
    expect(result.evidence).toBe('SIMULATED'); expect(result.files).toHaveLength(5);
    expect(h.counts()).toEqual({ createCount: 0, fileCount: 5 });
    expect(h.urls).toContain(`${swarmReleaseOrigin(reference)}/assets/THIRD-PARTY-NOTICES.txt`);
  });
  it('rejects creator/owner/schema/flags/content mismatch before any file is fetched', async () => {
    const mutate: Array<(value: Record<string, unknown>) => void> = [
      (r) => { r['$creator'] = `0x${'44'.repeat(20)}`; }, (r) => { r['$owner'] = `0x${'44'.repeat(20)}`; },
      (r) => { r['$key'] = transactionHash; }, (r) => { r['$creationFlags'] = { readonly: false, permissionlessExtension: false, raw: 0 }; },
      (r) => { r['inventory_sha256'] = { type: 'str', value: '0'.repeat(64) }; },
      (r) => { r['inventory_json'] = bytes(new Uint8Array([255])); },
      (r) => { r['swarm_reference'] = { type: 'str', value: 'a'.repeat(128) }; },
    ];
    for (const mutation of mutate) {
      const h = harness(); const record = row(); mutation(record); h.setRow(record);
      await expect(readSwarmRelease({ entityKey, publisher }, h)).rejects.toThrow('SWARM_RELEASE_READ_FAILED');
      expect(h.counts().fileCount).toBe(0);
    }
  });
  it('rejects chain, current-block and UTC expiry plus stale content after download', async () => {
    const wrongChain = harness(); wrongChain.setChain(1);
    await expect(readSwarmRelease({ entityKey, publisher }, wrongChain)).rejects.toThrow();
    const expired = harness(); expired.setBlock(10_000n);
    await expect(readSwarmRelease({ entityKey, publisher }, expired)).rejects.toThrow();
    const clock = harness();
    await expect(readSwarmRelease({ entityKey, publisher }, { ...clock, now: () => '2026-11-08T00:00:00.000Z' })).rejects.toThrow();
    const revoked = harness(); let first = true;
    const readFile = async (url: string, length: number) => {
      const value = await revoked.readFile(url, length);
      if (first) { first = false; const record = row(); record['$owner'] = `0x${'55'.repeat(20)}`; revoked.setRow(record); }
      return value;
    };
    await expect(readSwarmRelease({ entityKey, publisher }, { ...revoked, readFile })).rejects.toThrow();
    const backwards = harness();
    await expect(readSwarmRelease({ entityKey, publisher }, { ...backwards, readFile: async (url, length) => {
      const found = await backwards.readFile(url, length); backwards.setBlock(99n); return found;
    } })).rejects.toThrow();
  });
  it('rejects byte changes, wrong executable MIME and arbitrary expected release identity', async () => {
    for (const mime of ['application/octet-stream', 'text/html', 'false']) {
      const h = harness();
      await expect(readSwarmRelease({ entityKey, publisher }, { ...h, readFile: async (url, length) => {
        const found = await h.readFile(url, length); return { ...found, mime: url.endsWith('.js') ? mime : found.mime };
      } })).rejects.toThrow();
    }
    const h = harness();
    await expect(readSwarmRelease({ entityKey, publisher }, { ...h, readFile: async () => ({ bytes: new Uint8Array([1]), mime: 'text/html' }) })).rejects.toThrow();
    await expect(readSwarmRelease({ entityKey, publisher, expectedReleaseId: '0'.repeat(64) }, h)).rejects.toThrow();
    expect(h.counts().createCount).toBe(0);
  });
  it('reports the observed false font MIME as unverified without weakening executable MIME checks', async () => {
    const h = harness();
    const result = await readSwarmRelease({ entityKey, publisher }, { ...h, readFile: async (url, length) => {
      const found = await h.readFile(url, length); return { ...found, mime: url.endsWith('.woff2') ? 'false' : found.mime };
    } });
    expect(result.files.find((file) => file.path.endsWith('.woff2'))).toMatchObject({
      mime: 'false', mimeVerified: false, warning: 'GATEWAY_FONT_MIME_NONSTANDARD',
    });
    expect(result.files.filter((file) => !file.path.endsWith('.woff2')).every((file) => file.mimeVerified)).toBe(true);
    await expect(readSwarmRelease({ entityKey, publisher }, { ...h, readFile: async (url, length) => {
      const found = await h.readFile(url, length); return { ...found, mime: url.endsWith('.woff2') ? 'something-else' : found.mime };
    } })).rejects.toThrow();
  });
});

describe('bounded single release creation (SIMULATED)', () => {
  const options = () => ({ descriptor: descriptor(), publisher, privateKey: `0x${'aa'.repeat(32)}`,
    maxTotalFeeWei: String(SWARM_RELEASE_MAX_GAS * SWARM_RELEASE_GAS_PRICE) });
  it('creates once, verifies receipt and trusted read-back, returns serializable evidence', async () => {
    const h = harness(); const result = await publishSwarmRelease(options(), h);
    expect(h.counts()).toEqual({ createCount: 1, fileCount: 0 });
    expect(result.entityKey).toBe(entityKey); expect(result.evidence).toBe('SIMULATED');
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it('rejects budget, funding and chain failure before create', async () => {
    const budget = harness(); await expect(publishSwarmRelease({ ...options(), maxTotalFeeWei: '1' }, budget)).rejects.toThrow();
    expect(budget.counts().createCount).toBe(0);
    const funds = harness(); funds.setBalance(0n); await expect(publishSwarmRelease(options(), funds)).rejects.toThrow();
    expect(funds.counts().createCount).toBe(0);
    const chain = harness(); chain.setChain(1); await expect(publishSwarmRelease(options(), chain)).rejects.toThrow();
    expect(chain.counts().createCount).toBe(0);
  });
  it('does not resubmit after uncertain creation or bad receipts and sanitizes provider details', async () => {
    for (const receipt of [{ status: 'reverted', from: publisher, to: null },
      { status: 'success', from: `0x${'55'.repeat(20)}`, to: '0x4400000000000000000000000000000000000044' }]) {
      const h = harness(); h.setReceipt(receipt);
      await expect(publishSwarmRelease(options(), h)).rejects.toThrow('SWARM_RELEASE_PUBLICATION_UNCERTAIN');
      expect(h.counts().createCount).toBe(1);
    }
    const h = harness(); let calls = 0;
    h.client.createEntity = async () => { calls++; throw new Error('private-provider-error-with-secret'); };
    await expect(publishSwarmRelease(options(), h)).rejects.toThrow('SWARM_RELEASE_PUBLICATION_UNCERTAIN');
    expect(calls).toBe(1);
  });
  it('hands known creation identities to durable state before a later receipt failure without replay', async () => {
    const h = harness(); h.setReceipt({ status: 'reverted', from: publisher, to: null });
    const retained: unknown[] = [];
    await expect(publishSwarmRelease({ ...options(), onCreated: async (known) => { retained.push(known); } }, h))
      .rejects.toThrow('SWARM_RELEASE_PUBLICATION_UNCERTAIN');
    expect(retained).toEqual([{ entityKey, transactionHash, expiresAtBlock: '10000' }]);
    expect(h.counts().createCount).toBe(1);
    const failedState = harness();
    await expect(publishSwarmRelease({ ...options(), onCreated: async () => { throw new Error('state write failed'); } }, failedState))
      .rejects.toThrow('SWARM_RELEASE_PUBLICATION_UNCERTAIN');
    expect(failedState.counts().createCount).toBe(1);
  });
  it('persists the created IDs before receipt and read-back validation can fail', async () => {
    const h = harness(); const order: string[] = []; const retained: unknown[] = [];
    const malformed = row(); malformed['$owner'] = `0x${'66'.repeat(20)}`; h.setRow(malformed);
    const getReceipt = h.client.getReceipt!; const getEntity = h.client.getEntity;
    h.client.getReceipt = async (hash) => { order.push('receipt'); return getReceipt(hash); };
    h.client.getEntity = async (key) => { order.push('readback'); return getEntity(key); };
    await expect(publishSwarmRelease({ ...options(), onCreated: async (known) => {
      order.push('persist'); retained.push(known);
    } }, h)).rejects.toThrow('SWARM_RELEASE_PUBLICATION_UNCERTAIN');
    expect(order).toEqual(['persist', 'receipt', 'readback']);
    expect(retained).toEqual([{ entityKey, transactionHash, expiresAtBlock: '10000' }]);
    expect(h.counts().createCount).toBe(1);
  });
});
