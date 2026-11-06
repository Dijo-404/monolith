import { z } from 'zod';
import {
  chainIdSchema, evidenceKindSchema, identifierSchema, jsonValueSchema, labelSchema,
  schemaVersionSchema,
} from './primitives.js';
import type { JsonValue, WorkerState } from './primitives.js';
import { errorCodeSchema } from './errors.js';
import type { Result } from './errors.js';
import { readMethodSchema, validReadParams } from './rpc.js';
import type { EndpointCandidate } from './registry.js';

export const routeSchema = z.enum([
  'anon-tor', 'anon-nym', 'direct-debug', 'direct-bootstrap', 'passthrough', 'blocked',
]);
export const routePolicySchema = z.strictObject({
  privacyRequired: z.boolean(),
  allowedChains: z.array(chainIdSchema).min(1).max(256).refine((values) => new Set(values).size === values.length),
  allowedMethods: z.array(readMethodSchema).min(1).refine((values) => new Set(values).size === values.length),
  allowDirectDebugControl: z.boolean(),
  failClosed: z.literal(true),
}).refine((policy) => !policy.privacyRequired || !policy.allowDirectDebugControl);

export const readRequestSchema = z.strictObject({
  readId: identifierSchema,
  endpointId: identifierSchema,
  chainId: chainIdSchema,
  method: readMethodSchema,
  params: z.array(jsonValueSchema).max(16),
  callsite: labelSchema,
}).refine((request) => validReadParams(request.method, request.params));

export const rpcTraceSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  readId: identifierSchema,
  attempt: z.number().int().min(1),
  endpointId: identifierSchema,
  chainId: chainIdSchema,
  method: readMethodSchema,
  callsite: labelSchema,
  route: routeSchema,
  durationMs: z.number().nonnegative(),
  success: z.boolean(),
  bootstrap: z.boolean(),
  evidence: evidenceKindSchema,
  payloadVisibility: z.literal('rpc-endpoint-can-read'),
  errorCode: errorCodeSchema.optional(),
}).refine((trace) => (trace.bootstrap === (trace.route === 'direct-bootstrap'))
  && (trace.route !== 'blocked' || !trace.success)
  && (!trace.success || trace.errorCode === undefined));

export type Route = z.infer<typeof routeSchema>;
export type RoutePolicy = z.infer<typeof routePolicySchema>;
export type ReadRequest = z.infer<typeof readRequestSchema>;
export type RpcTrace = z.infer<typeof rpcTraceSchema>;

export interface ReadTransport {
  read(request: ReadRequest): Promise<Result<JsonValue>>;
}

/** Internal application interface; initialization's void value is not an HTTP DTO. */
export interface MonolithTransport extends ReadTransport {
  initialize(): Promise<Result<void>>;
  validateEndpoint(candidate: EndpointCandidate): Promise<Result<EndpointCandidate>>;
  getState(): WorkerState;
  close(): Promise<void>;
}

export interface TraceSink {
  emit(trace: RpcTrace): void;
}

export interface Clock {
  now(): string;
}
