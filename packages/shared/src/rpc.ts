import { z } from 'zod';
import { addressSchema, hex32Schema, jsonRpcIdSchema, jsonValueSchema } from './primitives.js';
import { makeError } from './errors.js';
import type { Result } from './errors.js';

export const readMethodSchema = z.enum([
  'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_call', 'eth_getTransactionReceipt',
]);
export const hexQuantitySchema = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
export const blockTagSchema = z.union([
  z.enum(['latest', 'earliest', 'pending', 'safe', 'finalized']),
  hexQuantitySchema,
]);
const callSchema = z.strictObject({
  to: addressSchema,
  data: z.string().regex(/^0x(?:[0-9a-fA-F]{2}){4,4096}$/),
});
const parameterSchemas = {
  eth_chainId: z.tuple([]),
  eth_blockNumber: z.tuple([]),
  eth_getBalance: z.tuple([addressSchema, blockTagSchema]),
  eth_call: z.tuple([callSchema, blockTagSchema]),
  eth_getTransactionReceipt: z.tuple([hex32Schema]),
} as const;

export type ReadMethod = z.infer<typeof readMethodSchema>;

export function validReadParams(method: ReadMethod, params: unknown[]): boolean {
  return parameterSchemas[method].safeParse(params).success;
}

export const jsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema,
  method: readMethodSchema,
  params: z.array(jsonValueSchema).max(16),
}).refine((request) => validReadParams(request.method, request.params));

export const jsonRpcSuccessSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema,
  result: jsonValueSchema,
});
export const jsonRpcErrorSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([jsonRpcIdSchema, z.null()]),
  error: z.strictObject({
    code: z.number().int(),
    message: z.string().min(1).max(512),
    data: jsonValueSchema.optional(),
  }),
});
export const jsonRpcResponseSchema = z.union([jsonRpcSuccessSchema, jsonRpcErrorSchema]);

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcSuccess = z.infer<typeof jsonRpcSuccessSchema>;
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

/** Correlates envelopes only; adapters additionally decode the result for the requested method. */
export function validateRpcResponse(input: unknown, expectedId: string): Result<JsonRpcSuccess> {
  const parsed = jsonRpcResponseSchema.safeParse(input);
  if (!jsonRpcIdSchema.safeParse(expectedId).success || !parsed.success || parsed.data.id !== expectedId) {
    return { ok: false, error: makeError('RPC_RESPONSE_INVALID') };
  }
  if ('error' in parsed.data) return { ok: false, error: makeError('RPC_ERROR') };
  return { ok: true, value: parsed.data };
}
