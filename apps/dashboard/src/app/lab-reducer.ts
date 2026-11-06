import {
  CALLSITES,
  FIXTURE_ENDPOINT,
  FIXTURE_REGISTRY_REVISION,
  FIXTURE_TIMINGS,
  PASSTHROUGH_SPECIFIER,
  TOR_JS_SPECIFIER,
  scenarioById,
} from './lab-fixtures.js';
import type {
  CheckView,
  Milestones,
  LabAction,
  LabErrorCode,
  LabState,
  ReadKind,
  ReadMethod,
  ReadRow,
  ScenarioId,
} from './lab-model.js';

const MINUTE = 60_000;

export function createLabState(scenario: ScenarioId, now: number, epoch = 0): LabState {
  const fixture = scenarioById(scenario);
  const fresh = fixture.registry === 'fresh';
  return {
    epoch,
    scenario,
    privateMode: true,
    leakInjected: false,
    confirmingDirect: false,
    worker: {
      ...fixture.worker,
      specifier: fixture.worker.network === 'Passthrough' ? PASSTHROUGH_SPECIFIER : TOR_JS_SPECIFIER,
    },
    registry: {
      status: fixture.registry,
      origin: 'fixture',
      revision: FIXTURE_REGISTRY_REVISION,
      generatedAt: now - (fresh ? 13 : 66) * MINUTE,
      expiresAt: now + (fresh ? 47 : -6) * MINUTE,
      endpoint: FIXTURE_ENDPOINT,
      chainProbe: 'not-run',
    },
    observer: fixture.observer,
    reads: [],
    seq: 0,
    focus: null,
    observed: { direct: null, anon: null },
    milestones: NO_MILESTONES,
  };
}

const NO_MILESTONES: Milestones = {
  baseline: false,
  protectedRead: false,
  leakCaught: false,
  leakFixed: false,
  failedClosed: false,
};

interface ReadSpec {
  readonly kind: ReadKind;
  readonly method: ReadMethod;
  readonly callsite: string;
  readonly now: number;
  readonly startDelayMs?: number;
}

function travelling(state: LabState, spec: ReadSpec, row: Pick<ReadRow, 'route' | 'lane' | 'durationMs' | 'originSeen' | 'bypass'>): LabState {
  const seq = state.seq + 1;
  const read: ReadRow = {
    id: `read-${state.epoch}-${seq}`,
    seq,
    kind: spec.kind,
    method: spec.method,
    callsite: spec.callsite,
    privacyRequired: state.privateMode,
    requestedAt: spec.now,
    startDelayMs: spec.startDelayMs ?? 0,
    outcome: 'in-flight',
    evidence: 'SIMULATED',
    errorCode: null,
    addressInPayload: spec.method === 'eth_getBalance' || spec.method === 'eth_call',
    ...row,
  };
  return { ...state, seq, reads: [...state.reads, read] };
}

function blocked(state: LabState, spec: ReadSpec, errorCode: LabErrorCode): LabState {
  const seq = state.seq + 1;
  const read: ReadRow = {
    id: `read-${state.epoch}-${seq}`,
    seq,
    kind: spec.kind,
    method: spec.method,
    callsite: spec.callsite,
    route: 'blocked',
    lane: spec.kind === 'direct-comparison' ? 'direct' : 'anon',
    bypass: false,
    privacyRequired: state.privateMode,
    requestedAt: spec.now,
    startDelayMs: 0,
    durationMs: null,
    outcome: 'blocked',
    evidence: 'SIMULATED',
    errorCode,
    originSeen: 'nothing',
    addressInPayload: false,
  };
  const failedClosed = state.milestones.failedClosed || errorCode === 'WORKER_UNAVAILABLE';
  return { ...state, seq, reads: [...state.reads, read], milestones: { ...state.milestones, failedClosed } };
}

function fireLeak(state: LabState, now: number, startDelayMs = 0): LabState {
  const caught = { ...state, milestones: { ...state.milestones, leakCaught: true, leakFixed: false } };
  return travelling(
    caught,
    { kind: 'leak', method: 'eth_getTransactionReceipt', callsite: CALLSITES.leak, now, startDelayMs },
    {
      route: 'direct-debug',
      lane: 'leak',
      durationMs: FIXTURE_TIMINGS.leakMs,
      originSeen: 'your-network',
      bypass: true,
    },
  );
}

function privateBalanceRead(state: LabState, now: number, startDelayMs = 0): LabState {
  const slow = state.worker.state === 'DEGRADED';
  return travelling(
    state,
    { kind: 'private', method: 'eth_getBalance', callsite: CALLSITES.balance, now, startDelayMs },
    {
      route: 'anon-tor',
      lane: 'anon',
      durationMs: slow ? FIXTURE_TIMINGS.degradedMs : FIXTURE_TIMINGS.privateMs,
      originSeen: 'exit-relay',
      bypass: false,
    },
  );
}

function runRead(state: LabState, now: number): LabState {
  const balance: ReadSpec = { kind: 'private', method: 'eth_getBalance', callsite: CALLSITES.balance, now };
  let next = state;

  if (state.privateMode) {
    const { worker } = state;
    if (worker.state === 'BOOTSTRAPPING') return state;
    if (state.registry.status !== 'fresh') {
      next = blocked(next, balance, 'REGISTRY_EXPIRED');
    } else if (worker.state === 'BLOCKED' || worker.state === 'CLOSED') {
      next = blocked(next, balance, 'WORKER_UNAVAILABLE');
    } else if (worker.network === 'Passthrough') {
      next = blocked(next, balance, 'POLICY_DENIED');
    } else if (state.registry.chainProbe === 'match') {
      next = privateBalanceRead(next, now);
    } else if (state.registry.chainProbe === 'not-run') {
      // Validate the Arkiv-selected endpoint with eth_chainId through the worker first.
      const slow = worker.state === 'DEGRADED';
      next = travelling(
        next,
        { kind: 'probe', method: 'eth_chainId', callsite: CALLSITES.probe, now },
        {
          route: 'anon-tor',
          lane: 'anon',
          durationMs: slow ? FIXTURE_TIMINGS.degradedMs : FIXTURE_TIMINGS.probeMs,
          originSeen: 'exit-relay',
          bypass: false,
        },
      );
      next = { ...next, registry: { ...next.registry, chainProbe: 'pending' } };
    } else {
      return state;
    }
  } else if (state.registry.status !== 'fresh') {
    next = blocked(next, { ...balance, kind: 'unprotected' }, 'REGISTRY_EXPIRED');
  } else {
    const passthrough = state.worker.network === 'Passthrough' && state.worker.state === 'READY';
    next = travelling(
      next,
      { ...balance, kind: 'unprotected' },
      {
        route: passthrough ? 'passthrough' : 'direct-debug',
        lane: passthrough ? 'passthrough' : 'direct',
        durationMs: passthrough ? FIXTURE_TIMINGS.passthroughMs : FIXTURE_TIMINGS.directMs,
        originSeen: 'your-network',
        bypass: false,
      },
    );
  }

  return state.leakInjected ? fireLeak(next, now, 260) : next;
}

function settle(state: LabState, id: string, now: number): LabState {
  const row = state.reads.find((read) => read.id === id);
  if (row === undefined || row.outcome !== 'in-flight') return state;

  const reached = state.observer === 'available';
  const settled: ReadRow = reached
    ? { ...row, outcome: 'arrived' }
    : { ...row, outcome: 'failed', errorCode: 'UPSTREAM_UNAVAILABLE', originSeen: 'nothing', addressInPayload: false };
  let next: LabState = {
    ...state,
    reads: state.reads.map((read) => (read.id === id ? settled : read)),
  };
  if (reached && row.kind !== 'probe') {
    const viaWorker = settled.originSeen === 'exit-relay';
    const observed = viaWorker ? { ...next.observed, anon: settled } : { ...next.observed, direct: settled };
    const m = next.milestones;
    const cleanRerun =
      viaWorker && row.kind === 'private' && m.leakCaught && !next.leakInjected && !next.reads.some((read) => read.bypass);
    next = {
      ...next,
      observed,
      milestones: {
        ...m,
        baseline: m.baseline || row.kind === 'direct-comparison',
        protectedRead: m.protectedRead || (viaWorker && row.kind === 'private'),
        leakFixed: m.leakFixed || cleanRerun,
      },
    };
  }

  if (row.kind === 'probe') {
    next = { ...next, registry: { ...next.registry, chainProbe: reached ? 'match' : 'not-run' } };
    // The balance read only leaves after the endpoint is validated, and only if policy still allows it.
    const workerUsable = next.worker.state === 'READY' || next.worker.state === 'DEGRADED';
    if (reached && next.privateMode && workerUsable) next = privateBalanceRead(next, now, 140);
  }
  return next;
}

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'load-scenario':
      return createLabState(action.scenario, action.now, state.epoch + 1);
    case 'new-run':
      return {
        ...state,
        epoch: state.epoch + 1,
        reads: [],
        seq: 0,
        confirmingDirect: false,
        registry: { ...state.registry, chainProbe: 'not-run' },
      };
    case 'set-private-mode':
      return { ...state, privateMode: action.on, confirmingDirect: false };
    case 'set-leak':
      if (action.on === state.leakInjected) return state;
      return action.on ? fireLeak({ ...state, leakInjected: true }, action.now) : { ...state, leakInjected: false };
    case 'run-read':
      return runRead(state, action.now);
    case 'ask-direct':
      return { ...state, confirmingDirect: true };
    case 'cancel-direct':
      return { ...state, confirmingDirect: false };
    case 'confirm-direct': {
      const spec: ReadSpec = {
        kind: 'direct-comparison',
        method: 'eth_getBalance',
        callsite: CALLSITES.directComparison,
        now: action.now,
      };
      const closed = { ...state, confirmingDirect: false };
      if (state.registry.status !== 'fresh') return blocked(closed, spec, 'REGISTRY_EXPIRED');
      return travelling(closed, spec, {
        route: 'direct-debug',
        lane: 'direct',
        durationMs: FIXTURE_TIMINGS.directMs,
        originSeen: 'your-network',
        bypass: false,
      });
    }
    case 'read-settled':
      return action.epoch === state.epoch ? settle(state, action.id, action.now) : state;
    case 'worker-hop': {
      if (action.epoch !== state.epoch || state.worker.state !== 'BOOTSTRAPPING') return state;
      const hopsReady = Math.min(3, state.worker.hopsReady + 1);
      return {
        ...state,
        worker: { ...state.worker, hopsReady, state: hopsReady === 3 ? 'READY' : 'BOOTSTRAPPING', note: null },
      };
    }
    case 'retry-worker':
      if (state.worker.state !== 'BLOCKED') return state;
      return {
        ...state,
        worker: {
          ...state.worker,
          state: 'BOOTSTRAPPING',
          hopsReady: 0,
          note: 'Retrying the same worker. In this fixture the gateway answers on retry.',
        },
      };
    case 'simulate-outage':
      if (state.worker.state === 'BLOCKED' || state.worker.state === 'CLOSED') return state;
      return {
        ...state,
        worker: {
          ...state.worker,
          state: 'BLOCKED',
          hopsReady: 0,
          note: 'WORKER_UNAVAILABLE: the anonymity network was taken offline for this demo.',
        },
      };
    case 'focus':
      return { ...state, focus: action.target };
  }
}

/** True when the primary read control can do something in the current state. */
export function canRunRead(state: LabState): boolean {
  if (state.privateMode && state.worker.state === 'BOOTSTRAPPING') return false;
  return !state.reads.some((read) => read.outcome === 'in-flight' && read.kind !== 'leak');
}

export function hasFlightInProgress(state: LabState): boolean {
  return state.reads.some((read) => read.outcome === 'in-flight');
}

export interface RunTally {
  readonly eligible: number;
  readonly viaWorker: number;
  readonly blocked: number;
  readonly bypassed: number;
}

/** Descriptive counts of the fixture replay. Deliberately not a coverage ratio. */
export function tallyRun(reads: readonly ReadRow[]): RunTally {
  const eligible = reads.filter((read) => read.privacyRequired && read.kind !== 'direct-comparison');
  return {
    eligible: eligible.length,
    viaWorker: eligible.filter((read) => read.route === 'anon-tor' && read.outcome === 'arrived').length,
    blocked: eligible.filter((read) => read.outcome === 'blocked').length,
    bypassed: eligible.filter((read) => read.bypass).length,
  };
}

export function deriveChecks(state: LabState): CheckView[] {
  const { reads } = state;
  const arrived = reads.filter((read) => read.outcome === 'arrived');
  const directControl = arrived.filter((read) => read.kind === 'direct-comparison');
  const viaWorker = arrived.filter((read) => read.route === 'anon-tor' && read.privacyRequired);
  const bypass = reads.filter((read) => read.bypass);
  const eligible = reads.filter(
    (read) => read.privacyRequired && (read.kind === 'private' || read.kind === 'probe'),
  );
  const workerBlocked = reads.filter((read) => read.errorCode === 'WORKER_UNAVAILABLE');
  const fallback = reads.filter(
    (read) => read.privacyRequired && read.lane === 'direct' && read.kind !== 'direct-comparison',
  );
  const passthroughRows = reads.filter(
    (read) => read.route === 'passthrough' || read.errorCode === 'POLICY_DENIED',
  );
  const expiredRows = reads.filter((read) => read.errorCode === 'REGISTRY_EXPIRED');

  const checks: CheckView[] = [
    {
      id: 'GT-01',
      title: 'Direct control shows your network origin',
      status: directControl.length > 0 ? 'pass' : 'not-run',
      detail:
        directControl.length > 0
          ? 'The endpoint attributed the direct read to your network.'
          : 'Run the direct comparison to record the baseline.',
      evidence: 'SIMULATED',
    },
    {
      id: 'GT-02',
      title: 'Worker read arrives without your origin',
      status: viaWorker.length > 0 ? 'pass' : 'not-run',
      detail:
        viaWorker.length > 0
          ? 'The endpoint saw the exit relay. The payload was still readable.'
          : 'Run a private read through the worker.',
      evidence: 'SIMULATED',
    },
    {
      id: 'GT-03',
      title: 'No read bypasses MonolithTransport',
      status: bypass.length > 0 ? 'fail' : eligible.length > 0 ? 'pass' : 'not-run',
      detail:
        bypass.length > 0
          ? `${bypass.length} direct ${bypass.length === 1 ? 'read' : 'reads'} from ${CALLSITES.leak} skipped the transport.`
          : eligible.length > 0
            ? 'Every privacy-required read went through the transport.'
            : 'No privacy-required reads in this run yet.',
      evidence: 'SIMULATED',
    },
    {
      id: 'GT-04',
      title: 'Managed reads never fall back during an outage',
      status: workerBlocked.length === 0 ? 'not-run' : fallback.length > 0 ? 'fail' : 'pass',
      detail:
        workerBlocked.length === 0
          ? 'Load "Worker unavailable" and run a private read.'
          : bypass.length > 0
            ? 'The managed read was blocked without fallback. The injected widget still bypasses the transport; GT-03 fails.'
            : 'The managed read was blocked before send. No direct fallback was attempted.',
      evidence: 'SIMULATED',
    },
    {
      id: 'GT-16',
      title: 'Endpoint payload exposure is shown',
      status: arrived.some((read) => read.addressInPayload) ? 'pass' : 'not-run',
      detail: 'Anon-RPC hides the network origin, never the method or the queried address.',
      evidence: 'SIMULATED',
    },
  ];

  if (state.worker.network === 'Passthrough' || passthroughRows.length > 0) {
    checks.push({
      id: 'GT-05',
      title: 'Passthrough earns no protected credit',
      status: passthroughRows.length > 0 ? 'pass' : 'not-run',
      detail: 'Passthrough is labelled NOT_ANONYMIZED and refused for privacy-required reads.',
      evidence: 'SIMULATED',
    });
  }
  if (state.registry.status !== 'fresh' || expiredRows.length > 0) {
    checks.push({
      id: 'GT-08',
      title: 'Expired registry entry is refused',
      status: expiredRows.length > 0 ? 'pass' : 'not-run',
      detail: 'An expired Arkiv snapshot never selects an endpoint.',
      evidence: 'SIMULATED',
    });
  }
  // Results lead (failures first) so the outcome of this run is visible without scrolling.
  const rank: Record<CheckView['status'], number> = { fail: 0, pass: 1, 'not-run': 2 };
  return checks.map((check, index) => ({ check, index }))
    .sort((a, b) => rank[a.check.status] - rank[b.check.status] || a.index - b.index)
    .map(({ check }) => check);
}
