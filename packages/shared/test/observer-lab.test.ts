import { describe, expect, it } from 'vitest';
import {
  httpResultSchema, observerLabAllocationSchema, parseContract,
  type ObserverLabAllocation,
} from '@monolith/shared';

const allocation: ObserverLabAllocation = {
  schemaVersion: 1,
  runId: 'run-12345678-1111-4111-8111-111111111111',
  baselineRpcId: 'rpc-12345678-2222-4222-8222-222222222222',
  expiresAt: '2030-01-01T00:05:00.000Z',
};

describe('synthetic observer lab allocation boundary', () => {
  it('exports a strict SDK-free allocation and HTTP wrapper without evidence claims', () => {
    expect(observerLabAllocationSchema.parse(allocation)).toEqual(allocation);
    expect(httpResultSchema(observerLabAllocationSchema).safeParse({ schemaVersion: 1, ok: true, value: allocation }).success).toBe(true);
  });

  it.each([
    { ...allocation, schemaVersion: 2 }, { ...allocation, runId: 'private-user-or-order' },
    { ...allocation, runId: allocation.runId.toUpperCase() },
    { ...allocation, baselineRpcId: allocation.runId },
    { ...allocation, baselineRpcId: 'rpc-12345678-2222-1222-8222-222222222222' },
    { ...allocation, expiresAt: '2030-01-01T00:05:00+00:00' },
    { ...allocation, expiresAt: 'not-a-date' },
    { ...allocation, sourceClass: 'different-from-baseline' },
    { ...allocation, evidence: 'OBSERVED_LIVE' }, { ...allocation, rawIp: '192.0.2.1' },
    { ...allocation, rpcUrl: 'https://private-sensitive-sentinel.invalid' },
    { ...allocation, success: true }, { ...allocation, extra: undefined },
  ])('rejects caller/private/claim additions or malformed identifiers %#', (input) => {
    expect(observerLabAllocationSchema.safeParse(input).success).toBe(false);
    const result = parseContract(observerLabAllocationSchema, input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-sensitive-sentinel');
  });
});
