import {
  chainIdSchema, identifierSchema, jsonValueSchema, makeError, publicHttpsUrlSchema,
  readRequestSchema, resultSchema,
  type Clock, type EndpointCandidate, type ErrorCode, type JsonValue,
  type MonolithTransport, type ReadRequest, type RegistryManifest, type Result,
} from '@monolith/shared';
import { admitRegistryManifest, type RegistryPolicy } from '../../composition/registry.js';

export type ProviderBinding = { endpointId: string; rpcUrl: string; observerEndpointId: string };
export type ProviderRead = Pick<ReadRequest, 'readId' | 'method' | 'params' | 'callsite'>;
export type ProviderSelection = {
  endpointId: string; observerEndpointId: string; chainId: string;
  revision: string; expiresAt: string; selectedAt: string;
};
export type ProviderDiagnostic = {
  endpointId: string; checkedAt: string; durationMs: number;
  result: Result<{ chainMatch: true; tip: string }>;
};
export type ProviderOptions = {
  chainId: string;
  bindings: readonly ProviderBinding[];
  policy: RegistryPolicy;
  clock: Clock;
  workerEpoch(): number;
  registry: { load(chainId: string, signal: AbortSignal): Promise<Result<RegistryManifest>> };
  /** A fresh isolated, fail-closed MonolithTransport, with maxAttempts: 1.
   * close() must revoke/cancel this channel without closing another channel.
   * The operator maps observerEndpointId to EXACTLY rpcUrl; no client URL authority.
   */
  createTransport(binding: Readonly<ProviderBinding>): MonolithTransport;
  operationTimeoutMs?: number;
};
type Session = {
  transport: MonolithTransport; binding: ProviderBinding; epoch: number; generation: number;
  abort: AbortController; pending: number; reason?: ErrorCode;
  deadline?: number; timer?: ReturnType<typeof setTimeout>;
  capability?: EndpointCandidate; summary?: ProviderSelection;
};
const fail = <T>(code: ErrorCode): Result<T> => ({ ok: false, error: makeError(code) });
const copy = <T>(value: T): T => structuredClone(value);
const replySchema = resultSchema(jsonValueSchema);

/** Network-free application policy. Real-worker/observer integration is separately gated.
 * Calling select is an explicit user choice, never an automatic availability retry.
 */
export function createProviderController(options: ProviderOptions) {
  const bindings = copy([...options.bindings]);
  const policy = copy(options.policy);
  const chainId = options.chainId;
  const timeout = options.operationTimeoutMs ?? 10_000;
  if (!chainIdSchema.safeParse(chainId).success || !Number.isSafeInteger(timeout)
    || timeout < 1 || timeout > 60_000 || bindings.length < 1 || bindings.length > 2
    || bindings.some((b) => !identifierSchema.safeParse(b.endpointId).success
      || !identifierSchema.safeParse(b.observerEndpointId).success
      || !publicHttpsUrlSchema.safeParse(b.rpcUrl).success)
    || new Set(bindings.map((b) => b.endpointId)).size !== bindings.length
    || new Set(bindings.map((b) => b.observerEndpointId)).size !== bindings.length
    || new Set(bindings.map((b) => new URL(b.rpcUrl).origin)).size !== bindings.length) {
    throw new TypeError('Invalid provider configuration.');
  }
  const sessions = new Set<Session>();
  let selection: Session | undefined;
  let generation = 0;
  let choices = 0;
  let diagnosticRuns = 0;
  let diagnosing = false;
  let closed = false;
  let constructing = 0;

  const now = () => {
    const value = Date.parse(options.clock.now());
    if (!Number.isFinite(value)) throw new TypeError('Invalid provider clock.');
    return value;
  };
  const epoch = () => {
    const value = options.workerEpoch();
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid worker epoch.');
    return value;
  };
  function retire(session: Session, reason: ErrorCode) {
    if (session.reason) return;
    session.reason = reason;
    if (selection === session) selection = undefined;
    clearTimeout(session.timer);
    session.abort.abort();
    // Cleanup is real driver work too: a hung close retains its resource slot.
    session.pending++;
    let cleanup: Promise<void>;
    try { cleanup = Promise.resolve(session.transport.close()); }
    catch { cleanup = Promise.resolve(); }
    void cleanup.catch(() => undefined).finally(() => {
      session.pending--;
      if (session.pending === 0) sessions.delete(session);
    });
  }
  function guard(session: Session, ready = false): ErrorCode | undefined {
    if (session.reason) return session.reason;
    let reason: ErrorCode | undefined;
    try {
      if (closed || epoch() !== session.epoch) reason = 'WORKER_UNAVAILABLE';
      else if (generation !== session.generation) reason = 'ENDPOINT_REJECTED';
      else if (session.deadline !== undefined && now() >= session.deadline) reason = 'REGISTRY_EXPIRED';
      else if (ready && !['READY', 'DEGRADED'].includes(session.transport.getState())) reason = 'WORKER_UNAVAILABLE';
    } catch { reason = 'WORKER_UNAVAILABLE'; }
    if (reason) retire(session, reason);
    return reason;
  }
  function start(binding: ProviderBinding): Result<Session> {
    if (closed) return fail('WORKER_UNAVAILABLE');
    // Retired channels whose raw promises ignore cancellation still occupy a slot.
    if (sessions.size + constructing >= 4) return fail('RATE_LIMITED');
    constructing++;
    try {
      const expectedGeneration = generation;
      const currentEpoch = epoch();
      const session: Session = { binding, transport: options.createTransport(Object.freeze(copy(binding))),
        epoch: currentEpoch, generation: expectedGeneration, abort: new AbortController(), pending: 0 };
      sessions.add(session);
      return { ok: true, value: session };
    } catch { return fail('WORKER_UNAVAILABLE'); }
    finally { constructing--; }
  }
  async function run<T>(session: Session, work: () => Promise<Result<T>>): Promise<Result<T>> {
    const invalid = guard(session);
    if (invalid) return fail(invalid);
    if (session.pending >= 2) return fail('RATE_LIMITED');
    session.pending++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted: (() => void) | undefined;
    const stopped = new Promise<Result<T>>((resolve) => {
      aborted = () => resolve(fail(session.reason ?? 'ENDPOINT_REJECTED'));
      session.abort.signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => retire(session, 'UPSTREAM_TIMEOUT'), timeout);
    });
    const raw = Promise.resolve().then(() => {
      const reason = guard(session);
      return reason ? fail<T>(reason) : work();
    }).catch(() => fail<T>('UPSTREAM_UNAVAILABLE')).finally(() => {
      session.pending--;
      if (session.reason && session.pending === 0) sessions.delete(session);
    });
    try {
      const result = await Promise.race([raw, stopped]);
      const reason = guard(session);
      if (reason) return fail(reason);
      return result.ok ? result : fail(result.error.code);
    } finally {
      clearTimeout(timer);
      if (aborted) session.abort.signal.removeEventListener('abort', aborted);
    }
  }
  async function prepare(session: Session): Promise<Result<ProviderSelection>> {
    const initialized = await run(session, () => session.transport.initialize());
    if (!initialized.ok) return initialized;
    const ready = guard(session, true);
    if (ready) return fail(ready);
    // Load AFTER initialization: worker startup must not consume a metadata lease.
    const loaded = await run(session, () => options.registry.load(chainId, session.abort.signal));
    if (!loaded.ok) return loaded;
    const admitted = admitRegistryManifest(loaded.value, chainId, policy, new Date(now()).toISOString());
    if (!admitted.ok) return admitted;
    const candidates = admitted.value.endpoints.filter((e) => e.endpointId === session.binding.endpointId);
    const candidate = candidates[0];
    if (candidates.length !== 1 || !candidate
      || new URL(candidate.rpcUrl).href !== new URL(session.binding.rpcUrl).href) return fail('TARGET_DENIED');
    session.deadline = Math.min(Date.parse(admitted.value.expiresAt), Date.parse(candidate.expiresAt));
    const valid = guard(session, true);
    if (valid) return fail(valid);
    session.timer = setTimeout(() => retire(session, 'REGISTRY_EXPIRED'), Math.max(0, session.deadline - now()));
    // Unique per channel and choice, never reuse a previous cached chain probe.
    const capability = copy({ ...candidate, endpointId: `provider_${generation}_${choices}_${diagnosticRuns}_${bindings.indexOf(session.binding)}`,
      expiresAt: new Date(session.deadline).toISOString() });
    const validated = await run(session, () => session.transport.validateEndpoint(copy(capability)));
    if (!validated.ok) return validated;
    if (JSON.stringify(validated.value) !== JSON.stringify(capability)) return fail('ENDPOINT_REJECTED');
    const after = guard(session, true);
    if (after) return fail(after);
    session.capability = capability;
    session.summary = { endpointId: candidate.endpointId, observerEndpointId: session.binding.observerEndpointId,
      chainId, revision: admitted.value.revision, expiresAt: capability.expiresAt,
      selectedAt: new Date(now()).toISOString() };
    return { ok: true, value: copy(session.summary) };
  }
  async function select(endpointId: string): Promise<Result<ProviderSelection>> {
    if (closed) return fail('WORKER_UNAVAILABLE');
    const expected = ++generation;
    for (const session of [...sessions]) retire(session, 'ENDPOINT_REJECTED');
    if (closed) return fail('WORKER_UNAVAILABLE');
    if (generation !== expected) return fail('ENDPOINT_REJECTED');
    if (++choices > 128) return fail('RATE_LIMITED');
    const binding = bindings.find((entry) => entry.endpointId === endpointId);
    if (!binding) return fail('TARGET_DENIED');
    const started = start(binding);
    if (!started.ok) return started;
    const session = started.value;
    try {
      const result = await prepare(session);
      if (!result.ok) { retire(session, result.error.code); return result; }
      const invalid = guard(session, true);
      if (invalid) return fail(invalid);
      selection = session;
      return result;
    } catch { retire(session, 'REGISTRY_UNAVAILABLE'); return fail('REGISTRY_UNAVAILABLE'); }
  }
  async function send(session: Session, input: ProviderRead): Promise<Result<JsonValue>> {
    const invalid = guard(session, true);
    if (invalid) return fail(invalid);
    if (!session.capability) return fail('ENDPOINT_REJECTED');
    const parsed = readRequestSchema.safeParse({ ...input,
      endpointId: session.capability.endpointId, chainId });
    if (!parsed.success || Object.keys(input).some((key) => !['readId', 'method', 'params', 'callsite'].includes(key))) {
      return fail('INVALID_INPUT');
    }
    // JSON params are locally validated values; copy nested objects before yielding.
    const request = copy(parsed.data);
    const result = await run(session, () => {
      const reason = guard(session, true);
      return reason ? Promise.resolve(fail<JsonValue>(reason)) : session.transport.read(request);
    });
    const after = guard(session, true);
    if (after) return fail(after);
    const checked = replySchema.safeParse(result);
    if (!checked.success) return fail('RPC_RESPONSE_INVALID');
    return checked.data;
  }
  async function read(input: ProviderRead): Promise<Result<JsonValue>> {
    if (!selection) return fail(closed ? 'WORKER_UNAVAILABLE' : 'ENDPOINT_REJECTED');
    const session = selection;
    try {
      const result = await send(session, input);
      // Any availability failure stops useful reads until another explicit choice.
      if (!result.ok && !['INVALID_INPUT', 'RATE_LIMITED'].includes(result.error.code)) retire(session, result.error.code);
      return result;
    } catch { retire(session, 'UPSTREAM_UNAVAILABLE'); return fail('UPSTREAM_UNAVAILABLE'); }
  }
  async function diagnose(): Promise<Result<ProviderDiagnostic[]>> {
    if (closed) return fail('WORKER_UNAVAILABLE');
    if (diagnosing || diagnosticRuns >= 8) return fail('RATE_LIMITED');
    diagnosticRuns++;
    diagnosing = true;
    const expected = generation;
    const samples: ProviderDiagnostic[] = [];
    try {
      const expectedEpoch = epoch();
      const checkRun = (): ErrorCode | undefined => {
        if (closed) return 'WORKER_UNAVAILABLE';
        if (generation !== expected) return 'ENDPOINT_REJECTED';
        return epoch() !== expectedEpoch ? 'WORKER_UNAVAILABLE' : undefined;
      };
      // Fixed concurrency one, at most two user-triggered public samples per run.
      for (const binding of bindings) {
        const before = checkRun();
        if (before) return fail(before);
        const begin = now();
        const started = start(binding);
        if (!started.ok) return started;
        const session = started.value;
        let result: Result<{ chainMatch: true; tip: string }>;
        try {
          const prepared = await prepare(session);
          if (!prepared.ok) result = prepared;
          else {
            const tip = await send(session, { readId: `provider_diagnostic_${diagnosticRuns}_${bindings.indexOf(binding)}`,
              method: 'eth_blockNumber', params: [], callsite: 'providers.diagnostics.tip' });
            result = !tip.ok ? tip : typeof tip.value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(tip.value)
              ? { ok: true, value: { chainMatch: true, tip: tip.value } } : fail('RPC_RESPONSE_INVALID');
          }
        } catch { result = fail('UPSTREAM_UNAVAILABLE'); }
        finally { retire(session, 'ENDPOINT_REJECTED'); }
        const after = checkRun();
        if (after) return fail(after);
        samples.push({ endpointId: binding.endpointId, checkedAt: new Date(now()).toISOString(),
          durationMs: Math.max(0, now() - begin), result });
      }
      return { ok: true, value: samples };
    } catch { return fail('UPSTREAM_UNAVAILABLE'); }
    finally { diagnosing = false; }
  }
  return {
    select, read, diagnose,
    getSelection(): ProviderSelection | null {
      return selection && !guard(selection, true) && selection.summary ? copy(selection.summary) : null;
    },
    invalidateWorker() {
      generation++;
      for (const session of [...sessions]) retire(session, 'WORKER_UNAVAILABLE');
    },
    close() {
      closed = true;
      generation++;
      for (const session of [...sessions]) retire(session, 'WORKER_UNAVAILABLE');
    },
  };
}
