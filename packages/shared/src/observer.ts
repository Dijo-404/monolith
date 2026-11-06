import * as z from 'zod';
import { identifierSchema, jsonRpcIdSchema, schemaVersionSchema, timestampSchema } from './primitives.js';
import { readMethodSchema } from './rpc.js';

export const observerObservationSchema = z.strictObject({
  rpcId: jsonRpcIdSchema,
  method: readMethodSchema,
  addressPresent: z.boolean(),
  sourceClass: z.enum(['baseline', 'different-from-baseline', 'unknown']),
  durationMs: z.number().finite().nonnegative(),
  success: z.boolean(),
});
export type ObserverObservation = z.infer<typeof observerObservationSchema>;

export const observerRunSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  runId: identifierSchema,
  expiresAt: timestampSchema,
  observations: z.array(observerObservationSchema).max(10_000),
});
export type ObserverRun = z.infer<typeof observerRunSchema>;
