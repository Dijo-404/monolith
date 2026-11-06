import {
  endpointCandidateSchema, makeError, readRequestSchema, safeErrorSchema, timestampSchema,
  validateRpcResponse,
  type EndpointCandidate, type ErrorCode, type JsonRpcRequest, type JsonValue,
  type MonolithTransport, type ReadRequest, type Result, type RpcTrace, type WorkerState,
} from '@monolith/shared';
import { captureConfiguration, publisherKey } from '../domain/configuration.js';
import { decodeReadResult } from '../domain/results.js';
import type { TransportOptions } from '../ports/driver.js';

type Validation = { candidate: EndpointCandidate; fingerprint: string; validUntil: number; generation: number };
const failure = <T>(code: ErrorCode): Result<T> => ({ ok: false, error: makeError(code) });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Fail-closed orchestration. A driver is a fixed route capability, never a fallback list. */
export function createMonolithTransport(options: TransportOptions): MonolithTransport {
  const configuration = captureConfiguration(options);
  const { driver, clock, traceSink } = options;
  let state: WorkerState = 'BLOCKED';
  let initialized = false;
  let generation = 0;
  let sequence = 0;
  let initialization: Promise<Result<void>> | undefined;
  let closing: Promise<void> | undefined;
  const active = new Set<AbortController>();
  const validations = new Map<string, Validation>();
  const validationEpochs = new Map<string, number>();

  const now = (): number | undefined => {
    try {
      const value = clock.now();
      return timestampSchema.safeParse(value).success ? Date.parse(value) : undefined;
    } catch { return undefined; }
  };
  const nextId = (kind: string) => `monolith_${kind}_${++sequence}`;
  const isClosed = () => state === 'CLOSED';
  const sameDriver = () => driver.route === configuration.route && driver.evidence === configuration.evidence;
  const available = () => initialized && state !== 'CLOSED' && sameDriver();
  const invalidate = () => {
    generation++;
    validations.clear();
    for (const controller of active) controller.abort();
  };
  const trace = (
    request: ReadRequest, attempt: number, startedAt: number | undefined,
    result: Result<unknown>, blocked = false,
  ) => {
    const endedAt = now();
    const event: RpcTrace = {
      schemaVersion: 1, readId: request.readId, attempt, endpointId: request.endpointId,
      chainId: request.chainId, method: request.method,
      callsite: configuration.callsites.has(request.callsite) || request.callsite === 'transport.chain-probe'
        ? request.callsite : 'transport.denied',
      route: blocked ? 'blocked' : configuration.route,
      durationMs: startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : 0,
      success: result.ok, bootstrap: false, evidence: configuration.evidence,
      payloadVisibility: 'rpc-endpoint-can-read',
      ...(!result.ok ? { errorCode: result.error.code } : {}),
    };
    // A reporting callback cannot select a different route or export an upstream exception.
    try { traceSink.emit(event); } catch { /* The sink owns its own delivery/retention policy. */ }
  };
  const blocked = <T>(request: ReadRequest, code: ErrorCode, attempt = 1): Result<T> => {
    const result = failure<T>(code);
    trace(request, attempt, now(), result, true);
    return result;
  };

  async function bounded<T>(
    operation: (signal: AbortSignal) => Promise<Result<T>>, timeoutMs: number,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    active.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeout = false;
    let abortListener: (() => void) | undefined;
    try {
      const aborted = new Promise<Result<T>>((resolve) => {
        abortListener = () => resolve(failure(timeout ? 'UPSTREAM_TIMEOUT' : 'WORKER_UNAVAILABLE'));
        controller.signal.addEventListener('abort', abortListener, { once: true });
      });
      timer = setTimeout(() => { timeout = true; controller.abort(); }, timeoutMs);
      const result = await Promise.race([Promise.resolve().then(() => controller.signal.aborted
        ? failure<T>('WORKER_UNAVAILABLE') : operation(controller.signal)), aborted]);
      if (result.ok === true && 'value' in result) return result;
      if (result.ok === false && safeErrorSchema.safeParse(result.error).success) {
        return failure(result.error.code);
      }
      return failure('UPSTREAM_UNAVAILABLE');
    } catch { return failure('UPSTREAM_UNAVAILABLE'); }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      active.delete(controller);
    }
  }

  function localCandidate(input: EndpointCandidate): Result<EndpointCandidate> {
    const parsed = endpointCandidateSchema.safeParse(input);
    if (!parsed.success) return failure('ENDPOINT_REJECTED');
    const candidate = parsed.data;
    const instant = now();
    if (instant === undefined) return failure('INVALID_INPUT');
    if (Date.parse(candidate.expiresAt) <= instant) return failure('REGISTRY_EXPIRED');
    if (!configuration.policy?.allowedChains.includes(candidate.chainId)) return failure('POLICY_DENIED');
    if (!configuration.publishers.has(publisherKey(candidate.publisher.creator, candidate.publisher.owner))) {
      return failure('REGISTRY_UNTRUSTED');
    }
    if (!configuration.origins.has(new URL(candidate.rpcUrl).origin)) return failure('TARGET_DENIED');
    return { ok: true, value: candidate };
  }

  function currentValidation(validation: Validation): ErrorCode | undefined {
    const instant = now();
    if (instant === undefined) return 'INVALID_INPUT';
    if (Date.parse(validation.candidate.expiresAt) <= instant) return 'REGISTRY_EXPIRED';
    if (validation.generation !== generation || validations.get(validation.candidate.endpointId) !== validation
      || instant >= validation.validUntil) return 'ENDPOINT_REJECTED';
    return undefined;
  }

  async function execute(
    request: ReadRequest, candidate: EndpointCandidate, expectedGeneration: number,
    validateCurrent: () => ErrorCode | undefined,
  ): Promise<Result<JsonValue>> {
    for (let attempt = 1; attempt <= configuration.maxAttempts; attempt++) {
      if (!available() || expectedGeneration !== generation) return blocked(request, 'WORKER_UNAVAILABLE', attempt);
      const invalid = validateCurrent();
      if (invalid) return blocked(request, invalid, attempt);
      const startedAt = now();
      const rpc: JsonRpcRequest = { jsonrpc: '2.0', id: nextId('rpc'), method: request.method, params: request.params };
      const exchanged = await bounded((signal) => driver.exchange(candidate.rpcUrl, rpc, signal), configuration.requestTimeoutMs);
      let result: Result<JsonValue>;
      if (!available() || expectedGeneration !== generation) result = failure('WORKER_UNAVAILABLE');
      else {
        const stale = validateCurrent();
        if (stale) result = failure(stale);
        else if (!exchanged.ok) result = exchanged;
        else {
          const envelope = validateRpcResponse(exchanged.value, rpc.id);
          result = envelope.ok ? decodeReadResult(request.method, envelope.value.result) : envelope;
          if (result.ok && request.method === 'eth_chainId'
            && (typeof result.value !== 'string' || BigInt(result.value).toString() !== candidate.chainId)) {
            validations.delete(candidate.endpointId);
            result = failure('CHAIN_MISMATCH');
          }
          if (result.ok && request.method === 'eth_getTransactionReceipt' && result.value !== null
            && typeof result.value === 'object' && !Array.isArray(result.value)
            && result.value['transactionHash']?.toString().toLowerCase() !== request.params[0]?.toString().toLowerCase()) {
            result = failure('RPC_RESPONSE_INVALID');
          }
        }
      }
      trace(request, attempt, startedAt, result);
      if (result.ok) return result;
      if (state !== 'CLOSED') state = 'DEGRADED';
      if (!result.error.retryable || attempt === configuration.maxAttempts || !available()
        || expectedGeneration !== generation) return result;
    }
    return failure('UPSTREAM_UNAVAILABLE');
  }

  async function initialize(): Promise<Result<void>> {
    if (state === 'CLOSED') return failure('WORKER_UNAVAILABLE');
    if (!configuration.valid || !sameDriver()) return failure('POLICY_DENIED');
    if (initialization) return initialization;
    if (available()) return { ok: true, value: undefined };
    invalidate();
    initialized = false;
    state = 'BOOTSTRAPPING';
    const expectedGeneration = generation;
    const pending = (async (): Promise<Result<void>> => {
      const result = await bounded((signal) => driver.initialize(signal), configuration.initializationTimeoutMs);
      if (expectedGeneration !== generation || isClosed()) return failure('WORKER_UNAVAILABLE');
      if (!result.ok || !sameDriver()) {
        state = 'BLOCKED';
        // The adapter must tear down its bootstrap realm; late readiness is never adopted.
        try { await driver.close(); } catch { /* Return only the fixed safe failure. */ }
        return result.ok ? failure('WORKER_UNAVAILABLE') : result;
      }
      initialized = true;
      state = 'DEGRADED';
      return { ok: true, value: undefined };
    })();
    initialization = pending;
    try { return await pending; }
    finally { if (initialization === pending) initialization = undefined; }
  }

  async function validateEndpoint(input: EndpointCandidate): Promise<Result<EndpointCandidate>> {
    if (!configuration.valid) return failure('POLICY_DENIED');
    const candidateResult = localCandidate(input);
    if (!candidateResult.ok) {
      if (input && typeof input.endpointId === 'string') {
        validations.delete(input.endpointId);
        const epoch = validationEpochs.get(input.endpointId);
        // Rejection revokes pending probes too; unseen invalid IDs need no retained state.
        if (epoch !== undefined) validationEpochs.set(input.endpointId, epoch + 1);
      }
      return candidateResult;
    }
    const candidate = candidateResult.value;
    const endpointId = candidate.endpointId;
    const fingerprint = JSON.stringify(candidate);
    const previous = validations.get(endpointId);
    if (previous?.fingerprint === fingerprint && available() && !currentValidation(previous)) {
      return { ok: true, value: copy(previous.candidate) };
    }
    validations.delete(endpointId);
    const epoch = (validationEpochs.get(endpointId) ?? 0) + 1;
    validationEpochs.set(endpointId, epoch);
    const expectedGeneration = generation;
    const request: ReadRequest = {
      readId: nextId('probe'), endpointId, chainId: candidate.chainId,
      method: 'eth_chainId', params: [], callsite: 'transport.chain-probe',
    };
    const validateCurrent = (): ErrorCode | undefined => {
      if (validationEpochs.get(endpointId) !== epoch) return 'ENDPOINT_REJECTED';
      const checked = localCandidate(candidate);
      return checked.ok ? undefined : checked.error.code;
    };
    const result = await execute(request, candidate, expectedGeneration, validateCurrent);
    if (!result.ok) return result;
    const instant = now();
    // Completion and trace callbacks may have revoked this probe before commit.
    if (!available() || expectedGeneration !== generation) return failure('WORKER_UNAVAILABLE');
    if (validationEpochs.get(endpointId) !== epoch) return failure('ENDPOINT_REJECTED');
    if (instant === undefined) return failure('INVALID_INPUT');
    if (Date.parse(candidate.expiresAt) <= instant) return failure('REGISTRY_EXPIRED');
    validations.set(endpointId, {
      candidate, fingerprint, generation: expectedGeneration,
      validUntil: Math.min(Date.parse(candidate.expiresAt), instant + configuration.validationTtlMs),
    });
    state = 'READY';
    return { ok: true, value: copy(candidate) };
  }

  async function read(input: ReadRequest): Promise<Result<JsonValue>> {
    const parsed = readRequestSchema.safeParse(input);
    if (!parsed.success) return failure('INVALID_INPUT');
    const request = copy(parsed.data);
    if (!configuration.valid) return blocked(request, 'POLICY_DENIED');
    if (!configuration.callsites.has(request.callsite)) return blocked(request, 'POLICY_DENIED');
    if (!configuration.policy?.allowedChains.includes(request.chainId)) return blocked(request, 'POLICY_DENIED');
    if (!configuration.policy.allowedMethods.includes(request.method)) return blocked(request, 'METHOD_DENIED');
    if (request.method === 'eth_call') {
      const call = request.params[0];
      const blockTag = request.params[1];
      if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call['to'] !== 'string'
        || typeof call['data'] !== 'string' || typeof blockTag !== 'string'
        || !configuration.calls.some((allowed) => allowed.target === call['to']?.toString().toLowerCase()
          && allowed.selector === call['data']?.toString().slice(0, 10).toLowerCase()
          && allowed.blockTags.includes(blockTag))) return blocked(request, 'TARGET_DENIED');
    }
    const validation = validations.get(request.endpointId);
    if (!validation || validation.candidate.chainId !== request.chainId) return blocked(request, 'ENDPOINT_REJECTED');
    return execute(request, validation.candidate, generation, () => currentValidation(validation));
  }

  function close(): Promise<void> {
    if (closing) return closing;
    state = 'CLOSED';
    initialized = false;
    invalidate();
    closing = Promise.resolve().then(() => driver.close()).catch(() => undefined);
    return closing;
  }

  return { initialize, validateEndpoint, read, getState: () => {
    if (state !== 'CLOSED' && initialized && !sameDriver()) state = 'BLOCKED';
    if (state === 'READY' && ![...validations.values()].some((value) => !currentValidation(value))) state = 'DEGRADED';
    return state;
  }, close };
}
