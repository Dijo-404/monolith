import { observerRunSchema, type RpcTrace } from '@monolith/shared';
import { analyzePrivacyRun, type AnalyzerInput, type AnalyzerScope, type MeasuredAttempt } from '@monolith/privacy-analyzer';
import type { WorkerMetadata } from '@monolith/transport/browser';
import { LIVE_CALLSITES, type Correlation, type LiveAllocation, type LiveMode, type LiveWireRead } from './live-types.js';

export function verifiedLiveWorker(worker: WorkerMetadata | null): boolean {
  return worker !== null && worker.network === 'nym'
    && worker.specifier.toLowerCase() === '0x3acd9742c68f6d993066ae25533e09b9e1f60ed0'
    && /^0x[0-9a-f]{64}$/.test(worker.workerHash) && worker.harnessVersion === '0.4.0'
    && worker.verification === 'harness-ready-after-specifier-lookup'
    && worker.bootstrap === 'NON_ANONYMOUS_SPECIFIER_LOOKUP' && worker.bootstrapCalls === 2
    && worker.privacyLabel === 'ANONYMIZING_WORKER';
}

/** Independent observer receipts are joined only by the exact issued wire ID. */
export function correlateLiveRun(options: {
  allocation: LiveAllocation;
  reads: readonly LiveWireRead[];
  traces: readonly RpcTrace[];
  worker: WorkerMetadata | null;
  diagnostics: unknown;
  observerOrigin: string;
  mode: LiveMode;
  now: string;
  reportRunId: string;
  completedWithoutError: boolean;
}): Correlation {
  const codes = new Set<string>();
  const parsed = observerRunSchema.safeParse(options.diagnostics);
  const diagnostics = parsed.success ? parsed.data : null;
  if (!diagnostics || diagnostics.runId !== options.allocation.runId
    || diagnostics.expiresAt !== options.allocation.expiresAt
    || Date.parse(diagnostics.expiresAt) <= Date.parse(options.now)) codes.add('DIAGNOSTICS_UNAVAILABLE');
  const expected = new Map(options.reads.map((row) => [row.rpcId, row]));
  const observations = new Map<string, NonNullable<typeof diagnostics>['observations'][number]>();
  if (expected.size !== options.reads.length || options.reads.length > 64) codes.add('DUPLICATE_WIRE_ID');
  for (const observation of diagnostics?.observations ?? []) {
    if (!expected.has(observation.rpcId)) codes.add('UNEXPECTED_OBSERVATION');
    if (observations.has(observation.rpcId)) codes.add('DUPLICATE_OBSERVATION');
    observations.set(observation.rpcId, observation);
  }
  for (const row of options.reads) {
    const observation = observations.get(row.rpcId);
    if (!observation) { codes.add('MISSING_OBSERVATION'); continue; }
    if (observation.method !== row.method || observation.addressPresent !== (row.method === 'eth_getBalance')
      || observation.success !== row.success || row.completedAt === null) codes.add('OBSERVATION_MISMATCH');
  }
  const exactInventory = codes.size === 0 && options.reads.length > 0;
  const workerVerified = verifiedLiveWorker(options.worker);
  if (!workerVerified) codes.add('WORKER_UNVERIFIED');
  let sourceComparison: Correlation['sourceComparison'] = 'not-run';
  if (options.mode !== 'private') {
    const controls = options.reads.filter((row) => row.role === 'direct-control');
    const sourcesMatch = exactInventory && controls.length === 1 && options.reads.every((row) =>
      observations.get(row.rpcId)?.sourceClass ===
        (row.role === 'direct-control' || row.role === 'leak' ? 'baseline' : 'different-from-baseline'));
    sourceComparison = sourcesMatch && workerVerified ? 'confirmed' : 'inconclusive';
    if (sourceComparison !== 'confirmed') codes.add('SOURCE_COMPARISON_INCONCLUSIVE');
  }
  const evidence = options.reads.some((row) => row.evidence === 'SIMULATED') ? 'SIMULATED'
    : options.reads.length ? 'OBSERVED_LIVE' : 'UNTESTED';
  const attempts: MeasuredAttempt[] = options.reads.map((row) => {
    const receipt = observations.get(row.rpcId);
    const direct = row.role === 'direct-control' || row.role === 'leak';
    return {
      eventId: `event_${row.rpcId}`,
      ...(row.logicalReadId ? { ref: { readId: row.logicalReadId, attempt: 1 } } : {}),
      endpointId: row.endpointId || 'observer_target', chainId: row.chainId, method: row.method,
      originAlias: 'observer', callsiteAlias: LIVE_CALLSITES[row.role],
      route: direct ? 'direct-debug' : sourceComparison === 'confirmed' && workerVerified ? 'anon-nym' : 'unknown',
      sent: receipt !== undefined,
      completed: receipt?.success === true && row.success,
      durationMs: row.durationMs,
      workerVerified: !direct && workerVerified && sourceComparison === 'confirmed' && receipt !== undefined,
      evidence: row.evidence,
    };
  });
  const unmatched = (diagnostics?.observations ?? []).filter((row) => !expected.has(row.rpcId));
  // Unknown receipts remain in the denominator as unbound measured traffic.
  // Never export an untrusted server-supplied correlation value as a public label.
  for (const [index, observation] of unmatched.entries()) attempts.push({
    eventId: `unexplained_event_${index + 1}`, endpointId: 'observer_target', chainId: '10',
    method: observation.method, originAlias: 'observer', route: 'unknown', sent: true,
    completed: observation.success, durationMs: observation.durationMs, workerVerified: false, evidence,
  });
  const input: AnalyzerInput = {
    schemaVersion: 1, runId: options.allocation.runId, evidence,
    reads: options.reads.filter((row) => row.logicalReadId).map((row) => ({
      readId: row.logicalReadId, endpointId: row.endpointId || 'observer_target', chainId: row.chainId,
      method: row.method, callsiteAlias: LIVE_CALLSITES[row.role], scenarioAlias: 'live.regression',
      privacyRequired: row.role !== 'direct-control',
    })),
    traces: options.traces, attempts,
  };
  const scope: AnalyzerScope = {
    reportRunId: options.reportRunId, application: 'Monolith Leak Lab',
    origins: [{ alias: 'observer', origin: options.observerOrigin },
      { alias: 'bootstrap', origin: 'https://ethereum.publicnode.com' }],
    callsites: [
      { alias: 'lab.direct', label: 'Explicit direct comparison' },
      { alias: 'lab.balance', label: 'Protected balance read' },
      { alias: 'lab.widget', label: 'Sandbox status widget' },
      { alias: 'transport.chain-probe', label: 'Protected chain check' },
      { alias: 'transport.bootstrap.hash', label: 'Worker hash bootstrap' },
      { alias: 'transport.bootstrap.resolvers', label: 'Worker resolver bootstrap' },
    ],
    scenarios: [{ alias: 'live.regression', label: 'Live privacy regression' }],
    bootstrapRules: ['hash', 'resolvers'].map((part) => ({
      readId: `bootstrap_${part}`, endpointId: 'bootstrap_mainnet', chainId: '1', method: 'eth_call',
      callsiteAlias: `transport.bootstrap.${part}`, originAlias: 'bootstrap',
      label: part === 'hash' ? 'Non-anonymous worker hash lookup' : 'Non-anonymous worker resolver lookup',
    })),
    captureComplete: exactInventory && sourceComparison === 'confirmed' && options.completedWithoutError,
  };
  const result = analyzePrivacyRun(input, scope);
  if (!result.ok) codes.add('ANALYSIS_UNAVAILABLE');
  const analysis = result.ok ? result.value : null;
  const leakMeasured = options.reads.some((row) => row.role === 'leak' && row.success
    && observations.get(row.rpcId)?.success === true);
  const repaired = options.reads.some((row) => row.role === 'repair' && row.success);
  const widgetPrivacy = leakMeasured ? 'fail' : repaired && exactInventory && sourceComparison === 'confirmed'
    && options.completedWithoutError && analysis?.summary.functionalAcceptance === 'pass'
    && !analysis.report.findings.some((finding) => finding.code === 'DIRECT_BYPASS') ? 'pass' : 'not-run';
  return { exactInventory, unmatchedObservations: unmatched.length,
    sourceComparison, codes: [...codes].sort(), diagnostics, analysis, widgetPrivacy };
}
