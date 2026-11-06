import {
  makeError,
  type ObserverObservation,
  type ObserverRun,
  type ReadMethod,
  type Result,
} from '@monolith/shared';

const RUN_TTL_MS = 5 * 60 * 1_000;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const runIdPattern = new RegExp(`^run-${UUID_V4}$`, 'i');
const rpcIdPattern = new RegExp(`^rpc-${UUID_V4}$`, 'i');

export function isLabRunId(input: unknown): input is string {
  return typeof input === 'string' && runIdPattern.test(input);
}

export function isLabRpcId(input: unknown): input is string {
  return typeof input === 'string' && rpcIdPattern.test(input);
}

/** A reservation handle contains no source identity or request payload. */
export type ObservationTicket = Readonly<{ runId: string; generation: symbol }>;

type PendingObservation = Pick<ObserverObservation, 'rpcId' | 'method' | 'addressPresent' | 'sourceClass'>;
type RunState = {
  generation: symbol;
  expiresAtMs: number;
  baselineRpcId: string;
  baselineCaptured: boolean;
  baselinePeer: string | undefined;
  cancelExpiry: (() => void) | undefined;
  reservations: Map<ObservationTicket, PendingObservation>;
  observations: ObserverObservation[];
};

export type DiagnosticsOptions = {
  nowMs: () => number;
  maxRuns?: number;
  maxObservations?: number;
  /** Production composition injects a cancellable, unref'ed timer. */
  scheduleExpiry?: (callback: () => void, delayMs: number) => () => void;
};

/**
 * Operator-registered synthetic runs only. Case and route headers cannot create
 * a run, designate its baseline, or assert an anonymizing transport.
 */
export class DiagnosticsStore {
  readonly #nowMs: () => number;
  readonly #maxRuns: number;
  readonly #maxObservations: number;
  readonly #scheduleExpiry: DiagnosticsOptions['scheduleExpiry'];
  readonly #runs = new Map<string, RunState>();

  constructor(options: DiagnosticsOptions) {
    this.#nowMs = options.nowMs;
    this.#maxRuns = options.maxRuns ?? 128;
    this.#maxObservations = options.maxObservations ?? 128;
    this.#scheduleExpiry = options.scheduleExpiry;
    if (![this.#maxRuns, this.#maxObservations].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Diagnostics limits must be positive safe integers.');
    }
  }

  /** Private operator/composition port; the HTTP read surface never calls this. */
  register(runId: string, baselineRpcId: string): Result<void> {
    const now = this.#nowMs();
    this.#prune(now);
    if (!isLabRunId(runId) || !isLabRpcId(baselineRpcId) || this.#runs.has(runId)) {
      return { ok: false, error: makeError('INVALID_INPUT') };
    }
    if (this.#runs.size >= this.#maxRuns) {
      return { ok: false, error: makeError('RATE_LIMITED') };
    }
    const generation = Symbol();
    const run: RunState = {
      generation,
      expiresAtMs: now + RUN_TTL_MS,
      baselineRpcId,
      baselineCaptured: false,
      baselinePeer: undefined,
      cancelExpiry: undefined,
      reservations: new Map(),
      observations: [],
    };
    this.#runs.set(runId, run);
    const cancelExpiry = this.#scheduleRunExpiry(runId, generation);
    if (this.#runs.get(runId) === run) run.cancelExpiry = cancelExpiry;
    else cancelExpiry?.();
    return { ok: true, value: undefined };
  }

  /** Reserve before awaiting upstream work so concurrency cannot exceed caps. */
  reserve(
    runId: string,
    rpcId: string,
    method: ReadMethod,
    addressPresent: boolean,
    peer: string | undefined,
  ): Result<ObservationTicket> {
    this.#prune(this.#nowMs());
    if (!isLabRunId(runId) || !isLabRpcId(rpcId)) {
      return { ok: false, error: makeError('INVALID_INPUT') };
    }
    const run = this.#runs.get(runId);
    if (!run) return { ok: false, error: makeError('INVALID_INPUT') };
    if (run.observations.length + run.reservations.size >= this.#maxObservations) {
      return { ok: false, error: makeError('RATE_LIMITED') };
    }

    if (rpcId === run.baselineRpcId && !run.baselineCaptured) {
      run.baselineCaptured = true;
      run.baselinePeer = peer;
    }
    const sourceClass: ObserverObservation['sourceClass'] = (
      !run.baselineCaptured || run.baselinePeer === undefined || peer === undefined
    ) ? 'unknown' : peer === run.baselinePeer ? 'baseline' : 'different-from-baseline';

    const ticket: ObservationTicket = Object.freeze({ runId, generation: run.generation });
    run.reservations.set(ticket, { rpcId, method, addressPresent, sourceClass });
    return { ok: true, value: ticket };
  }

  /** Completion cannot revive an expired run or attach to a replacement run. */
  complete(ticket: ObservationTicket, durationMs: number, success: boolean): void {
    this.#prune(this.#nowMs());
    const run = this.#runs.get(ticket.runId);
    if (!run || run.generation !== ticket.generation) return;
    const pending = run.reservations.get(ticket);
    if (!pending) return;
    run.reservations.delete(ticket);
    // Public diagnostics never contain an invalid duration or an untyped value.
    if (!Number.isFinite(durationMs) || durationMs < 0 || typeof success !== 'boolean') return;
    run.observations.push({ ...pending, durationMs, success });
  }

  get(runId: string): Result<ObserverRun> {
    this.#prune(this.#nowMs());
    const run = this.#runs.get(runId);
    if (!run) return { ok: false, error: makeError('EVIDENCE_EXPIRED') };
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        runId,
        expiresAt: new Date(run.expiresAtMs).toISOString(),
        observations: run.observations.map((observation) => ({ ...observation })),
      },
    };
  }

  clear(): void {
    for (const run of this.#runs.values()) this.#discard(run);
    this.#runs.clear();
  }

  #prune(now: number): void {
    for (const [runId, run] of this.#runs) {
      if (now >= run.expiresAtMs) {
        this.#discard(run);
        this.#runs.delete(runId);
      }
    }
  }

  #discard(run: RunState): void {
    const cancelExpiry = run.cancelExpiry;
    run.cancelExpiry = undefined;
    cancelExpiry?.();
    run.baselinePeer = undefined;
    run.reservations.clear();
    run.observations.length = 0;
  }

  #scheduleRunExpiry(runId: string, generation: symbol): (() => void) | undefined {
    // The timer captures only an identifier/generation, never a raw baseline.
    return this.#scheduleExpiry?.(() => {
      const run = this.#runs.get(runId);
      if (!run || run.generation !== generation) return;
      this.#discard(run);
      this.#runs.delete(runId);
    }, RUN_TTL_MS);
  }
}
