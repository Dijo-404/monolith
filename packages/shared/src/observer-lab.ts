import * as z from 'zod';
import { schemaVersionSchema, timestampSchema } from './primitives.js';

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** Fresh synthetic correlation identifiers; never user/order/wallet identifiers. */
export const observerLabRunIdSchema = z.string().regex(new RegExp(`^run-${UUID_V4}$`));
export const observerLabRpcIdSchema = z.string().regex(new RegExp(`^rpc-${UUID_V4}$`));

/** Allocation conveys no source classification, worker readiness or anonymity result. */
export const observerLabAllocationSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  runId: observerLabRunIdSchema,
  baselineRpcId: observerLabRpcIdSchema,
  expiresAt: timestampSchema,
});
export type ObserverLabAllocation = z.infer<typeof observerLabAllocationSchema>;
