import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { bytes, defineSchema, str } from '@arkiv-network/sdk/schema';
import { http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  assessSwarmRelease, assertSwarmReleaseFresh, canonicalSwarmInventory, prepareSwarmRelease,
  type SwarmRelease, type SwarmReleaseInput,
} from '../../domain/swarm-release.js';

const RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
const CHAIN = 7794095;
const CONTRACT = '0x4400000000000000000000000000000000000044';
const hex32 = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fail(code = 'SWARM_RELEASE_UNAVAILABLE'): never { throw new Error(code); }
const schema = defineSchema('monolith.release.v1', {
  release_id: str().indexed(), source_commit: str(), swarm_reference: str(), inventory_sha256: str(),
  published_at: str(), content_expires_at: str(), inventory_json: bytes(),
});
export const SWARM_RELEASE_MAX_GAS = 2_000_000n;
export const SWARM_RELEASE_GAS_PRICE = 1_000_000_000n;

export interface SwarmReleaseClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getEntity(key: string): Promise<unknown>;
  getBalance?(publisher: string): Promise<bigint>;
  createEntity?(descriptor: SwarmRelease): Promise<{ entityKey: string; txHash: string; expiresAt: bigint }>;
  getReceipt?(hash: string): Promise<{ status: string; from: string; to: string | null }>;
}
export type SwarmReleaseFileReader = (url: string, expectedBytes: number) => Promise<{ bytes: Uint8Array; mime: string }>;
export type SwarmReleaseInfrastructure = Readonly<{
  client?: SwarmReleaseClient; readFile?: SwarmReleaseFileReader; now?: () => string;
}>;

export function createSwarmRelease(input: SwarmReleaseInput): SwarmRelease { return prepareSwarmRelease(input, digest); }
export function validateSwarmRelease(input: unknown): SwarmRelease { return assessSwarmRelease(input, digest); }
export function hashSwarmRelease(input: unknown): string { return validateSwarmRelease(input).releaseId; }
export function swarmManifestCid(reference: string): string {
  if (!/^[0-9a-f]{64}$/.test(reference)) fail('SWARM_RELEASE_INVALID');
  const encoded = Buffer.concat([Buffer.from([1, 250, 1, 27, 32]), Buffer.from(reference, 'hex')]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let result = 'b'; let bits = 0; let accumulator = 0;
  for (const byte of encoded) {
    accumulator = (accumulator << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(accumulator >>> bits) & 31]; }
    accumulator &= (1 << bits) - 1;
  }
  if (bits) result += alphabet[(accumulator << (5 - bits)) & 31];
  return result;
}
export function swarmReleaseOrigin(reference: string): string { return `https://${swarmManifestCid(reference)}.bzz.limo`; }

function clientFor(accessKey?: string, privateKey?: string, publisher?: string): SwarmReleaseClient {
  if (accessKey !== undefined && !/^[\x21-\x7e]{1,512}$/.test(accessKey)) fail('SWARM_RELEASE_CONFIG_INVALID');
  const chain = rabdi({ accessKey: '' });
  const transport = () => http(RPC, { timeout: 10_000, retryCount: 0, maxResponseBodySize: 128 * 1024,
    fetchOptions: { redirect: 'error', ...(accessKey === undefined ? {} : { headers: { 'X-API-KEY': accessKey } }) } });
  const client = createPublicClient({ chain, transport: transport(), pollingInterval: 2000 });
  const port: SwarmReleaseClient = {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    getEntity: (key) => client.getEntity(key as Hex, schema),
    getBalance: (owner) => client.getBalance({ address: owner as Address }),
    getReceipt: async (hash) => {
      const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
      return { status: receipt.status, from: receipt.from, to: receipt.to };
    },
  };
  if (privateKey !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail('SWARM_RELEASE_SIGNER_INVALID');
    const account = privateKeyToAccount(privateKey as Hex);
    if (account.address.toLowerCase() !== publisher?.toLowerCase()) fail('SWARM_RELEASE_SIGNER_INVALID');
    const wallet = createWalletClient({ chain, account, transport: transport(), pollingInterval: 2000 });
    port.createEntity = (descriptor) => wallet.createEntity(schema, {
      release_id: descriptor.releaseId, source_commit: descriptor.sourceCommit, swarm_reference: descriptor.swarmReference,
      inventory_sha256: descriptor.inventorySha256, published_at: descriptor.publishedAt,
      content_expires_at: descriptor.expiresAt, inventory_json: new TextEncoder().encode(canonicalSwarmInventory(descriptor.files)),
    }, { expiration: ExpirationTime.atDate(new Date(descriptor.expiresAt)), flags: { readonly: true } },
    { gas: SWARM_RELEASE_MAX_GAS, gasPrice: SWARM_RELEASE_GAS_PRICE });
  }
  return port;
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function column(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (!plain(value) || value['type'] !== 'str' || typeof value['value'] !== 'string'
    || value['value'].length > 128) fail('SWARM_RELEASE_UNTRUSTED');
  return value['value'];
}
function trusted(row: unknown, entityKey: string, publisher: string, block: bigint, now: string): SwarmRelease {
  if (!plain(row) || typeof row['$key'] !== 'string' || row['$key'].toLowerCase() !== entityKey.toLowerCase()
    || typeof row['$creator'] !== 'string' || row['$creator'].toLowerCase() !== publisher.toLowerCase()
    || typeof row['$owner'] !== 'string' || row['$owner'].toLowerCase() !== publisher.toLowerCase()
    || typeof row['$expiresAt'] !== 'bigint' || row['$expiresAt'] <= block) fail('SWARM_RELEASE_UNTRUSTED');
  const flags = row['$creationFlags'];
  if (!plain(flags) || flags['readonly'] !== true || flags['permissionlessExtension'] !== false || flags['raw'] !== 1) {
    fail('SWARM_RELEASE_UNTRUSTED');
  }
  const payload = row['inventory_json'];
  // The SDK's BytesValue stores Hex, including when its public bytes() helper takes Uint8Array.
  if (!plain(payload) || payload['type'] !== 'bytes' || typeof payload['value'] !== 'string'
    || payload['value'].length > 2 + 16 * 1024 * 2
    || !/^0x(?:[0-9a-fA-F]{2})*$/.test(payload['value'])) fail('SWARM_RELEASE_UNTRUSTED');
  let files: unknown; let inventoryJson: string;
  try {
    inventoryJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(Buffer.from(payload['value'].slice(2), 'hex'));
    files = JSON.parse(inventoryJson);
  }
  catch { return fail('SWARM_RELEASE_UNTRUSTED'); }
  const descriptor = validateSwarmRelease({ schemaVersion: 1, releaseId: column(row, 'release_id'),
    sourceCommit: column(row, 'source_commit'), swarmReference: column(row, 'swarm_reference'),
    inventorySha256: column(row, 'inventory_sha256'), publishedAt: column(row, 'published_at'),
    expiresAt: column(row, 'content_expires_at'), files });
  if (canonicalSwarmInventory(descriptor.files) !== inventoryJson) fail('SWARM_RELEASE_UNTRUSTED');
  assertSwarmReleaseFresh(descriptor, now);
  return descriptor;
}
async function pinnedBlock(client: SwarmReleaseClient): Promise<bigint> {
  if (await client.getChainId() !== CHAIN) fail('SWARM_RELEASE_CHAIN_MISMATCH');
  const block = await client.getBlockNumber();
  if (typeof block !== 'bigint' || block < 0n) fail();
  return block;
}

/** Fixed-origin native HTTPS, bounded from headers through the final byte; no redirects or credentials. */
function readPublicFile(url: string, expectedBytes: number): ReturnType<SwarmReleaseFileReader> {
  return new Promise((resolve, reject) => {
    let settled = false; let size = 0; const chunks: Buffer[] = [];
    const req = request(url, { method: 'GET', agent: false, rejectUnauthorized: true, maxHeaderSize: 8192,
      headers: { accept: '*/*', 'accept-encoding': 'identity', connection: 'close' } }, (response) => {
      if (response.statusCode !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity'
        || response.headers['content-length'] !== undefined
        && (!/^\d+$/.test(response.headers['content-length']) || Number(response.headers['content-length']) !== expectedBytes)) {
        stop(); response.destroy(); return;
      }
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > expectedBytes) { stop(); response.destroy(); } else chunks.push(chunk);
      });
      response.on('error', stop);
      response.on('aborted', stop);
      response.on('end', () => {
        if (settled) return;
        if (size !== expectedBytes) { stop(); return; }
        settled = true; clearTimeout(timer);
        resolve({ bytes: Buffer.concat(chunks), mime: response.headers['content-type'] ?? '' });
      });
    });
    const stop = () => { if (!settled) { settled = true; clearTimeout(timer); req.destroy(); reject(new Error('SWARM_RELEASE_FILE_UNAVAILABLE')); } };
    const timer = setTimeout(stop, 10_000);
    req.on('error', stop); req.end();
  });
}
function contentType(path: string, mime: string): { mime: string; mimeVerified: boolean; warning?: string } {
  if (typeof mime !== 'string' || mime.length > 128
    || Array.from(mime).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) fail('SWARM_RELEASE_MIME_INVALID');
  const value = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const allowed: Record<string, readonly string[]> = {
    html: ['text/html'], js: ['text/javascript', 'application/javascript'], css: ['text/css'], txt: ['text/plain'],
    svg: ['image/svg+xml'], png: ['image/png'],
    json: ['application/json'], wasm: ['application/wasm'], woff2: ['font/woff2', 'application/font-woff2', 'application/octet-stream'],
  };
  // Observed gateway quirk only for exact-hash WOFF2 assets. It grants no executable MIME exception.
  if (extension === 'woff2' && value === 'false') {
    return { mime: value, mimeVerified: false, warning: 'GATEWAY_FONT_MIME_NONSTANDARD' };
  }
  if (!allowed[extension]?.includes(value)) fail('SWARM_RELEASE_MIME_INVALID');
  return { mime: value, mimeVerified: true };
}

/** One explicit create only. The caller must reserve durable uncertain-submission state BEFORE calling. */
export async function publishSwarmRelease(options: {
  descriptor: SwarmRelease; publisher: string; privateKey: string; accessKey?: string; maxTotalFeeWei: string;
  onCreated?: (created: { entityKey: string; transactionHash: string; expiresAtBlock: string }) => Promise<void>;
}, infrastructure: SwarmReleaseInfrastructure = {}) {
  try {
    const descriptor = validateSwarmRelease(options.descriptor);
    if (!address.test(options.publisher) || !/^(?:0|[1-9][0-9]{0,77})$/.test(options.maxTotalFeeWei)) fail('SWARM_RELEASE_CONFIG_INVALID');
    const maximumFee = SWARM_RELEASE_MAX_GAS * SWARM_RELEASE_GAS_PRICE;
    if (BigInt(options.maxTotalFeeWei) < maximumFee) fail('SWARM_RELEASE_FEE_BUDGET');
    const now = infrastructure.now ?? (() => new Date().toISOString());
    assertSwarmReleaseFresh(descriptor, now());
    const client = infrastructure.client ?? clientFor(options.accessKey, options.privateKey, options.publisher);
    await pinnedBlock(client);
    if (!client.createEntity || !client.getReceipt || !client.getBalance
      || await client.getBalance(options.publisher) < maximumFee) fail('SWARM_RELEASE_PUBLISHER_UNFUNDED');
    const result = await client.createEntity(descriptor);
    if (!hex32.test(result.entityKey) || !hex32.test(result.txHash) || typeof result.expiresAt !== 'bigint') fail();
    // Persist known identities before later receipt/indexer checks can fail. Callback failure never retries a create.
    await options.onCreated?.({ entityKey: result.entityKey, transactionHash: result.txHash, expiresAtBlock: String(result.expiresAt) });
    const receipt = await client.getReceipt(result.txHash);
    if (receipt.status !== 'success' || receipt.from.toLowerCase() !== options.publisher.toLowerCase()
      || receipt.to?.toLowerCase() !== CONTRACT) fail();
    const row = await client.getEntity(result.entityKey);
    const block = await pinnedBlock(client);
    const observed = trusted(row, result.entityKey, options.publisher, block, now());
    if (!plain(row) || row['$expiresAt'] !== result.expiresAt || observed.releaseId !== descriptor.releaseId) fail();
    return { entityKey: result.entityKey, transactionHash: result.txHash, expiresAtBlock: String(result.expiresAt), descriptor,
      maximumFeeWei: String(maximumFee), evidence: infrastructure.client ? 'SIMULATED' as const : 'OBSERVED_LIVE' as const };
  } catch { return fail('SWARM_RELEASE_PUBLICATION_UNCERTAIN'); }
}

/** Key-free release discovery followed by bounded verification of every declared public file. */
export async function readSwarmRelease(options: {
  entityKey: string; publisher: string; expectedReleaseId?: string; accessKey?: string;
}, infrastructure: SwarmReleaseInfrastructure = {}) {
  try {
    if (!hex32.test(options.entityKey) || !address.test(options.publisher)
      || options.expectedReleaseId !== undefined && !/^[0-9a-f]{64}$/.test(options.expectedReleaseId)) fail('SWARM_RELEASE_CONFIG_INVALID');
    const client = infrastructure.client ?? clientFor(options.accessKey);
    const now = infrastructure.now ?? (() => new Date().toISOString());
    const block = await pinnedBlock(client);
    const row = await client.getEntity(options.entityKey);
    const descriptor = trusted(row, options.entityKey, options.publisher, block, now());
    if (options.expectedReleaseId !== undefined && descriptor.releaseId !== options.expectedReleaseId) fail('SWARM_RELEASE_UNTRUSTED');
    const origin = swarmReleaseOrigin(descriptor.swarmReference);
    const readFile = infrastructure.readFile ?? readPublicFile;
    const files = [];
    for (const expected of descriptor.files) {
      const received = await readFile(`${origin}/${expected.path}`, expected.bytes);
      if (!(received.bytes instanceof Uint8Array) || received.bytes.byteLength !== expected.bytes
        || digest(received.bytes) !== expected.sha256) fail('SWARM_RELEASE_CONTENT_MISMATCH');
      files.push({ ...expected, ...contentType(expected.path, received.mime) });
    }
    const finalBlock = await pinnedBlock(client);
    if (finalBlock < block || finalBlock - block > 128n) fail('SWARM_RELEASE_UNTRUSTED');
    const final = trusted(await client.getEntity(options.entityKey), options.entityKey, options.publisher, finalBlock, now());
    if (final.releaseId !== descriptor.releaseId) fail('SWARM_RELEASE_UNTRUSTED');
    return { entityKey: options.entityKey, publisher: options.publisher, expiresAtBlock: String((row as Record<string, unknown>)['$expiresAt']),
      observedAt: now(), descriptor, origin, files,
      evidence: infrastructure.client || infrastructure.readFile ? 'SIMULATED' as const : 'OBSERVED_LIVE' as const,
      limits: 'Release discovery and public-file identity only; no worker, RPC routing, storage-retention or sponsor-eligibility claim.' };
  } catch { return fail('SWARM_RELEASE_READ_FAILED'); }
}
