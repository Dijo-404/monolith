import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import { http, type Address } from 'viem';
import { RpcSource } from './arkiv-schema.mts';

export const CHAIN_ID = 7794095;

export function publicClient() {
  return createPublicClient({
    chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? '' }),
    transport: http(undefined, { timeout: 15_000, retryCount: 0 }),
    pollingInterval: 2_000,
  });
}

export function sampleQuery(client: ReturnType<typeof publicClient>, runId: string, publisher?: Address) {
  const query = client.select('*').from(RpcSource).where(eq('run_id', runId)).limit(20);
  return publisher ? query.createdBy(publisher).ownedBy(publisher) : query;
}
