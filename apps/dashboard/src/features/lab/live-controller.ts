import {
  makeError, type Clock, type ErrorCode, type ObserverRun, type RegistryManifest,
  type Result, type RpcTrace, type TraceSink,
} from '@monolith/shared';
import type { BrowserDriver } from '@monolith/transport/browser';
import { admitRegistryManifest } from '../../composition/registry.js';
import { createRegistryTransport, type RegistryTransport } from '../../composition/transport.js';
import { LIVE_CHAIN, LIVE_REGISTRY_POLICY, LIVE_RPC_URL } from '../registry/live-policy.js';
import { correlateLiveRun, verifiedLiveWorker } from './correlate.js';
import { sendDirectFixture, type DirectFixtureSend } from './direct-fixture.js';
import { createMappedLiveDriver } from './wire-driver.js';
import { SYNTHETIC_ADDRESS, type LiveAllocation, type LiveMode, type LiveRole, type LiveSnapshot, type LiveWireRead } from './live-types.js';
import { LIVE_FIXTURE_PATCH, LIVE_SCENARIO, LIVE_WIDGET_FIXTURES } from './scenario.js';

export type LiveLabPorts = {
  enabled: boolean;
  observerOrigin: string;
  createDriver: (sink: TraceSink) => BrowserDriver;
  allocate: (signal: AbortSignal) => Promise<Result<LiveAllocation>>;
  registry: { load(chainId: string, signal?: AbortSignal): Promise<Result<RegistryManifest>> };
  diagnostics: (allocation: LiveAllocation, signal: AbortSignal) => Promise<Result<ObserverRun>>;
  directFetch: DirectFixtureSend;
  clock: Clock;
  uuid: () => string;
  elapsed: () => number;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initial = (): LiveSnapshot => ({
  version: 0, phase: 'IDLE', mode: 'private', busy: false, workerState: 'CLOSED', worker: null,
  allocation: null, selection: null, manifest: null, reads: [], traces: [], correlation: null,
  error: null, observedAt: null, previousLeakReport: null,
  milestones: { privateRead: false, comparison: false, leak: false, repair: false },
});

/** One controller owns the worker; each fresh run receives a separately revocable capability. */
export function createLiveLabController(ports: LiveLabPorts) {
  let snapshot = initial();
  const listeners = new Set<() => void>();
  let generation = 0;
  let driverGeneration = 0;
  let closed = false;
  let base: BrowserDriver | null = null;
  let session: RegistryTransport | null = null;
  let mapped: ReturnType<typeof createMappedLiveDriver> | null = null;
  let activeContext: { role: LiveRole; logicalReadId: string | null } | null = null;
  let active: AbortController | null = null;
  const bootstrapTraces: RpcTrace[] = [];
  const reads = new Map<string, LiveWireRead>();
  let traces: RpcTrace[] = [];

  const publish = (patch: Partial<LiveSnapshot>) => {
    snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 };
    for (const listener of listeners) listener();
  };
  const current = (value: number) => !closed && generation === value;
  const publishReads = () => publish({ reads: [...reads.values()].map((row) => copy(row)), traces: traces.map((trace) => ({ ...trace })) });
  const storeTrace = (trace: RpcTrace) => {
    if (closed || traces.length >= 128) return;
    if (trace.bootstrap) {
      if (!bootstrapTraces.some((entry) => entry.readId === trace.readId)) bootstrapTraces.push({ ...trace });
    } else mapped?.bindTrace(trace);
    traces.push({ ...trace });
    publishReads();
  };

  async function run(mode: LiveMode) {
    if (closed || snapshot.busy) return;
    if (!ports.enabled) {
      publish({ phase: 'BLOCKED', workerState: 'BLOCKED', error: 'POLICY_DENIED' });
      return;
    }
    const expected = ++generation;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    publish({ busy: true, mode });
    await session?.close();
    if (!current(expected)) return;
    session = null; mapped = null; activeContext = null;
    reads.clear();
    traces = bootstrapTraces.map((trace) => ({ ...trace }));
    publish({ phase: 'WARMING', mode, busy: true, workerState: base?.getMetadata() ? 'READY' : 'BOOTSTRAPPING',
      worker: base?.getMetadata() ?? null, allocation: null, selection: null, manifest: null,
      reads: [], traces: [...traces], correlation: null, error: null, observedAt: null });
    let failure: ErrorCode | null = null;
    function fail(code: ErrorCode): never { failure = code; throw new Error('Live lab operation failed.'); }
    const onRead = (row: LiveWireRead) => {
      if (!current(expected)) return;
      const previous = reads.get(row.rpcId);
      reads.set(row.rpcId, copy(row));
      if (row.role === 'direct-control' && row.trace && !previous?.trace) traces.push({ ...row.trace });
      publishReads();
    };
    try {
      if (!base || !verifiedLiveWorker(base.getMetadata())) {
        await base?.close();
        bootstrapTraces.length = 0; traces = [];
        const driverEpoch = ++driverGeneration;
        base = ports.createDriver({ emit: (trace) => { if (driverEpoch === driverGeneration && current(expected)) storeTrace(trace); } });
        const initialized = await base.initialize(AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]));
        if (!current(expected)) return;
        if (!initialized.ok) fail(initialized.error.code);
      }
      if (!base || !verifiedLiveWorker(base.getMetadata())) fail('WORKER_INTEGRITY_FAILED');
      publish({ workerState: 'READY', worker: base.getMetadata(), phase: 'ALLOCATING' });
      const allocated = await ports.allocate(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
      if (!current(expected)) return;
      if (!allocated.ok) fail(allocated.error.code);
      const allocation = allocated.value;
      if (Date.parse(allocation.expiresAt) <= Date.parse(ports.clock.now())
        || Date.parse(allocation.expiresAt) - Date.parse(ports.clock.now()) > 302_000) fail('EVIDENCE_EXPIRED');
      publish({ allocation: copy(allocation), phase: 'REGISTRY' });
      const loaded = await ports.registry.load(LIVE_CHAIN, controller.signal);
      if (!current(expected)) return;
      if (!loaded.ok) fail(loaded.error.code);
      const admitted = admitRegistryManifest(loaded.value, LIVE_CHAIN, LIVE_REGISTRY_POLICY, ports.clock.now());
      if (!admitted.ok) fail(admitted.error.code);
      const candidate = admitted.value.endpoints[0];
      if (!candidate || candidate.rpcUrl !== LIVE_RPC_URL) fail('TARGET_DENIED');
      publish({ manifest: copy(admitted.value) });

      if (mode !== 'private') {
        const direct = await sendDirectFixture({ consent: true, role: 'direct-control', evidence: base.evidence, observerOrigin: ports.observerOrigin,
          allocation, endpointId: candidate.endpointId, uuid: ports.uuid, now: ports.clock.now, elapsed: ports.elapsed,
          send: ports.directFetch, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), onRead });
        if (!current(expected)) return;
        if (!direct.ok) fail(direct.error.code);
      }

      mapped = createMappedLiveDriver({ base, observerOrigin: ports.observerOrigin, runId: allocation.runId,
        uuid: ports.uuid, now: ports.clock.now, elapsed: ports.elapsed, context: () => activeContext, onRead });
      let usedManifest = false;
      session = createRegistryTransport({
        policy: LIVE_REGISTRY_POLICY,
        // Exactly this run's fresh network response; no outage/stale cache fallback.
        registry: { load: async (chain, signal) => {
          if (usedManifest || chain !== LIVE_CHAIN || signal?.aborted) return { ok: false, error: makeError('REGISTRY_UNAVAILABLE') };
          usedManifest = true;
          return { ok: true, value: admitted.value };
        } },
        transportOptions: {
          driver: mapped.driver, clock: ports.clock, traceSink: { emit: storeTrace },
          policy: { privacyRequired: true, allowedChains: [LIVE_CHAIN], allowedMethods: ['eth_chainId', 'eth_getBalance'],
            allowDirectDebugControl: false, failClosed: true },
          trustedPublishers: LIVE_REGISTRY_POLICY.trustedPublishers,
          approvedOrigins: LIVE_REGISTRY_POLICY.approvedOrigins, allowedCallsites: ['lab.balance', 'lab.widget'],
          initializationTimeoutMs: 5_000, requestTimeoutMs: 25_000, validationTtlMs: 20_000,
        },
      });
      activeContext = { role: 'probe', logicalReadId: null };
      publish({ phase: 'SELECTING' });
      const selected = await session.select(LIVE_CHAIN);
      if (!current(expected)) return;
      if (!selected.ok) fail(selected.error.code);
      publish({ selection: copy(selected.value), phase: 'READING' });
      const read = async (role: 'private' | 'repair') => {
        const readId = `live_read_${ports.uuid()}`;
        activeContext = { role, logicalReadId: readId };
        const result = await session!.read({ readId, method: 'eth_getBalance', params: [SYNTHETIC_ADDRESS, 'latest'],
          callsite: role === 'private' ? 'lab.balance' : 'lab.widget' });
        if (!result.ok) fail(result.error.code);
      };
      await read('private');
      if (!current(expected)) return;
      if (mode === 'leak') {
        // MN014_WIDGET_BEFORE: same fixed balance intent, deliberately outside the transport.
        const leaked = await sendDirectFixture({ consent: true, role: 'leak', evidence: base.evidence, observerOrigin: ports.observerOrigin,
          allocation, endpointId: selected.value.routingEndpointId, uuid: ports.uuid, now: ports.clock.now, elapsed: ports.elapsed,
          send: ports.directFetch, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), onRead });
        if (!leaked.ok) fail(leaked.error.code);
      } else if (mode === 'repair') {
        // MN014_WIDGET_AFTER: same fixed balance intent through the verified worker.
        await read('repair');
      }
    } catch {
      failure ??= controller.signal.aborted ? 'WORKER_UNAVAILABLE' : 'UPSTREAM_UNAVAILABLE';
    } finally {
      activeContext = null;
      if (current(expected)) {
        const allocation = snapshot.allocation;
        publish({ phase: 'VERIFYING' });
        if (allocation) {
          let diagnostic: unknown = null;
          try {
            const result = await ports.diagnostics(allocation, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
            if (result.ok) diagnostic = result.value;
            else failure ??= result.error.code;
          } catch { failure ??= 'UPSTREAM_UNAVAILABLE'; }
          if (current(expected)) {
            const correlation = correlateLiveRun({ allocation, reads: [...reads.values()], traces,
              worker: base?.getMetadata() ?? null, diagnostics: diagnostic, observerOrigin: ports.observerOrigin,
              mode, now: ports.clock.now(), reportRunId: `report_${ports.uuid()}`, completedWithoutError: failure === null });
            if (!correlation.exactInventory || mode !== 'private' && correlation.sourceComparison !== 'confirmed'
              || mode === 'repair' && correlation.widgetPrivacy !== 'pass') failure ??= 'POLICY_DENIED';
            publish({ correlation, ...(correlation.widgetPrivacy === 'fail' && correlation.analysis
              ? { previousLeakReport: copy(correlation.analysis.report) } : {}),
            milestones: {
              privateRead: snapshot.milestones.privateRead || failure === null && correlation.exactInventory
                && [...reads.values()].some((row) => row.role === 'private' && row.success),
              comparison: snapshot.milestones.comparison || failure === null && correlation.sourceComparison === 'confirmed',
              leak: snapshot.milestones.leak || correlation.widgetPrivacy === 'fail',
              repair: snapshot.milestones.repair || correlation.widgetPrivacy === 'pass',
            } });
          }
        }
        if (current(expected)) publish({
          phase: failure ? 'BLOCKED' : 'READY', busy: false, error: failure,
          worker: base?.getMetadata() ?? null,
          workerState: base?.getMetadata() ? 'READY' : 'BLOCKED', observedAt: ports.clock.now(),
        });
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    run,
    exportReport() {
      const analysis = snapshot.correlation?.analysis;
      if (!analysis) return null;
      return `${JSON.stringify({ schemaVersion: 1, observedAt: snapshot.observedAt, mode: snapshot.mode,
        scenario: LIVE_SCENARIO,
        widgetFixture: snapshot.mode === 'leak' ? LIVE_WIDGET_FIXTURES.leak
          : snapshot.mode === 'repair' ? LIVE_WIDGET_FIXTURES.repair : null,
        fixturePatch: LIVE_FIXTURE_PATCH,
        failure: snapshot.error, report: analysis.report, summary: analysis.summary,
        sourceComparison: snapshot.correlation?.sourceComparison,
        widgetPrivacy: snapshot.correlation?.widgetPrivacy,
        registry: snapshot.selection ? { endpoint: snapshot.selection.endpoint, manifestRevision: snapshot.selection.manifest.revision,
          generatedAt: snapshot.selection.manifest.generatedAt, expiresAt: snapshot.selection.manifest.expiresAt } : null,
        worker: snapshot.worker, previousLeakReport: snapshot.previousLeakReport,
        limitations: [
          'Only fixed synthetic reads to the configured observer are covered; this is not universal browser capture.',
          'The observer forwards only the independently pinned Arkiv-selected RPC URL and can see request payloads.',
          'Allocation, registry metadata, diagnostics and two worker bootstrap lookups are ordinary non-anonymous contacts.',
          'Explicit direct controls remain in the denominator and receive no protected credit.',
          'Worker hop count is not measured. Public transfers and RPC payloads are not hidden.',
        ],
      }, null, 2)}\n`;
    },
    async close() {
      if (closed) return;
      closed = true; generation++; driverGeneration++;
      active?.abort();
      await session?.close();
      await base?.close();
      base = null; session = null; mapped = null;
      publish({ phase: 'CLOSED', busy: false, workerState: 'CLOSED', worker: null });
      listeners.clear();
    },
  };
}

export type LiveLabController = ReturnType<typeof createLiveLabController>;
