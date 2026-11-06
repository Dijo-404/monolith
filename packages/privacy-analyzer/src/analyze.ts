import { makeError, privacyReportSchema } from '@monolith/shared';
import type { PrivacyFinding, Result, RpcTrace } from '@monolith/shared';
import type {
  AnalyzerInput, AnalyzerScope, BootstrapRule, DeclaredRead, LatencySummary,
  MeasuredAttempt, PrivacyAnalysis,
} from './types.js';
import { validateAnalysisInput } from './validation.js';

const messages = {
  CAPTURE_INCOMPLETE: 'Independent capture is incomplete; protection is unresolved.',
  EMPTY_RUN: 'No eligible application reads were measured.',
  UNDECLARED_READ: 'A read was absent from the declared scenario inventory.',
  UNEXPLAINED_EGRESS: 'An independently measured request has no logical read binding.',
  MISSING_TRACE: 'A measured attempt has no matching transport trace.',
  MISSING_MEASUREMENT: 'A transport trace has no matching attempt measurement.',
  MISSING_EXECUTION: 'A declared read has no attempt evidence.',
  MISSING_ATTEMPT: 'The retry sequence has missing attempt evidence.',
  DUPLICATE_TRACE: 'An identical transport trace was delivered more than once.',
  DUPLICATE_EVENT: 'An identical measurement was delivered more than once.',
  DUPLICATE_SEND: 'Distinct request events claim the same logical attempt.',
  ROUTE_CONFLICT: 'The measured route or completion disagrees with the trace.',
  DIRECT_BYPASS: 'A privacy-required read used an ordinary direct RPC route.',
  DIRECT_CONTROL: 'An explicit direct comparison earns no protected credit.',
  NOT_ANONYMIZED: 'Passthrough does not anonymize the network path.',
  UNKNOWN_ROUTE: 'The measured network route is unknown.',
  WORKER_UNVERIFIED: 'A sent anonymizing attempt lacks usable worker verification.',
  EVIDENCE_CONFLICT: 'A claimed send contradicts a pre-send denial or worker failure.',
  BLOCKED_READ: 'The read was blocked before any request was sent.',
  BOOTSTRAP_MISCLASSIFIED: 'An application read cannot use the bootstrap exclusion.',
  UNKNOWN_CALLSITE: 'The callsite is outside the configured static catalog.',
} as const;
type FindingCode = keyof typeof messages;
type Group = {
  key: string;
  identity: { endpointId: string; chainId: string; method: RpcTrace['method'] };
  declared?: DeclaredRead;
  callsiteAlias?: string;
  traces: Map<number, RpcTrace>;
  attempts: Map<number, MeasuredAttempt[]>;
  unbound: boolean;
};
const failure = <T>(): Result<T> => ({ ok: false, error: makeError('INVALID_INPUT') });
const keyOf = (readId: string, attempt: number) => JSON.stringify([readId, attempt]);
const groupKey = (id: string) => JSON.stringify(['read', id]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameIdentity = (a: Group['identity'], b: Group['identity']) => (
  a.endpointId === b.endpointId && a.chainId === b.chainId && a.method === b.method
);
const isAnon = (route: MeasuredAttempt['route']) => route === 'anon-tor' || route === 'anon-nym';
const preSendFailure = new Set([
  'INVALID_INPUT', 'UNSUPPORTED_VERSION', 'POLICY_DENIED', 'METHOD_DENIED', 'TARGET_DENIED',
  'WORKER_UNAVAILABLE', 'WORKER_INTEGRITY_FAILED', 'ENDPOINT_REJECTED',
  'REGISTRY_UNTRUSTED', 'REGISTRY_EXPIRED', 'REGISTRY_UNAVAILABLE',
]);
const ruleMatches = (rule: BootstrapRule, trace: RpcTrace) => (
  rule.readId === trace.readId && rule.endpointId === trace.endpointId
  && rule.chainId === trace.chainId && trace.method === 'eth_call'
  && trace.callsite === rule.callsiteAlias && trace.route === 'direct-bootstrap' && trace.bootstrap
);

/** Pure accounting over caller-supplied measurements. This does not authenticate network evidence. */
export function analyzePrivacyRun(input: unknown, scope: unknown): Result<PrivacyAnalysis> {
  const validated = validateAnalysisInput(input, scope);
  if (!validated.ok) return validated;
  // Catch accidental or hostile non-JSON inputs without exporting exceptions or fragments.
  try {
    return analyze(validated.value.input, validated.value.scope);
  } catch {
    return failure();
  }
}

function analyze(input: AnalyzerInput, scope: AnalyzerScope): Result<PrivacyAnalysis> {
  const groups = new Map<string, Group>();
  const declared = new Map<string, DeclaredRead>();
  const traceIndex = new Map<string, RpcTrace>();
  const eventIndex = new Map<string, MeasuredAttempt>();
  const duplicateTraces = new Set<string>();
  const duplicateEvents = new Set<string>();
  const excluded = new Map<string, BootstrapRule>();
  const callsites = new Map(scope.callsites.map((entry) => [entry.alias, entry.label]));

  function ensure(key: string, identity: Group['identity'], unbound = false): Group | undefined {
    const existing = groups.get(key);
    if (existing) return sameIdentity(existing.identity, identity) ? existing : undefined;
    const group: Group = { key, identity, traces: new Map(), attempts: new Map(), unbound };
    groups.set(key, group);
    return group;
  }
  function bindCallsite(group: Group, alias: string | undefined): boolean {
    if (alias === undefined) return true;
    if (group.callsiteAlias !== undefined && group.callsiteAlias !== alias) return false;
    group.callsiteAlias = alias;
    return true;
  }
  for (const read of input.reads) {
    const previous = declared.get(read.readId);
    if (previous && !equal(previous, read)) return failure();
    declared.set(read.readId, read);
    const group = ensure(groupKey(read.readId), read);
    if (!group || !bindCallsite(group, read.callsiteAlias)) return failure();
    group.declared = read;
  }
  // Parse snapshots have canonical property ordering, so identical delivery is idempotent.
  for (const trace of input.traces) {
    const key = keyOf(trace.readId, trace.attempt);
    const previous = traceIndex.get(key);
    if (previous) {
      if (!equal(previous, trace)) return failure();
      duplicateTraces.add(groupKey(trace.readId));
    } else traceIndex.set(key, trace);
  }
  for (const event of input.attempts) {
    const previous = eventIndex.get(event.eventId);
    if (previous) {
      if (!equal(previous, event)) return failure();
      duplicateEvents.add(event.ref ? groupKey(event.ref.readId) : JSON.stringify(['event', event.eventId]));
    } else eventIndex.set(event.eventId, event);
  }

  for (const [key, trace] of traceIndex) {
    const rule = !declared.has(trace.readId)
      ? scope.bootstrapRules.find((candidate) => ruleMatches(candidate, trace)) : undefined;
    if (rule) {
      // Reject an exclusion if any bound measurement contradicts the approved operation.
      const bound = [...eventIndex.values()].filter((event) => event.ref
        && keyOf(event.ref.readId, event.ref.attempt) === key);
      if (bound.every((event) => sameIdentity(trace, event) && event.route === 'direct-bootstrap'
        && event.originAlias === rule.originAlias && event.callsiteAlias === rule.callsiteAlias
        && event.completed === trace.success)) {
        excluded.set(key, rule);
        continue;
      }
    }
    const group = ensure(groupKey(trace.readId), trace);
    if (!group || !bindCallsite(group, trace.callsite)) return failure();
    group.traces.set(trace.attempt, trace);
  }
  for (const event of eventIndex.values()) {
    if (event.ref && excluded.has(keyOf(event.ref.readId, event.ref.attempt))) continue;
    const key = event.ref ? groupKey(event.ref.readId) : JSON.stringify(['event', event.eventId]);
    const group = ensure(key, event, !event.ref);
    if (!group || !bindCallsite(group, event.callsiteAlias)) return failure();
    const attempt = event.ref?.attempt ?? 1;
    const events = group.attempts.get(attempt) ?? [];
    events.push(event);
    group.attempts.set(attempt, events);
  }

  const ordered = [...groups.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const endpoints = [...new Set(ordered.map((group) => group.identity.endpointId))].sort();
  const endpointAliases = new Map(endpoints.map((id, index) => [id, `endpoint-${String(index + 1).padStart(6, '0')}`]));
  const findings: PrivacyFinding[] = [];
  const findingKeys = new Set<string>();
  let unresolved = !scope.captureComplete;
  let protectedReads = 0;
  let successfulReads = 0;
  const latency = new Map<string, { identity: Group['identity']; route: MeasuredAttempt['route']; events: MeasuredAttempt[] }>();
  function add(code: FindingCode, readId?: string, callsite = 'analysis.scope') {
    const key = JSON.stringify([code, readId ?? '', callsite]);
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    const finding: PrivacyFinding = { code, callsite, message: messages[code] };
    if (readId !== undefined) finding.readId = readId;
    findings.push(finding);
  }
  if (!scope.captureComplete) add('CAPTURE_INCOMPLETE');
  if (ordered.length === 0) add('EMPTY_RUN');
  for (const [index, group] of ordered.entries()) {
    const publicId = `read-${String(index + 1).padStart(6, '0')}`;
    const sourceCallsite = group.callsiteAlias;
    const callsite = (sourceCallsite && callsites.get(sourceCallsite)) || 'unattributed';
    const note = (code: FindingCode) => add(code, publicId, callsite);
    let accounted = Boolean(group.declared) && scope.captureComplete && callsite !== 'unattributed';
    let sentCount = 0;
    let allSentProtected = true;
    if (!group.declared) { note('UNDECLARED_READ'); unresolved = true; }
    if (group.unbound) { note('UNEXPLAINED_EGRESS'); unresolved = true; }
    if (sourceCallsite && !callsites.has(sourceCallsite)) { note('UNKNOWN_CALLSITE'); unresolved = true; }
    if (duplicateTraces.has(group.key)) note('DUPLICATE_TRACE');
    if (duplicateEvents.has(group.key)) note('DUPLICATE_EVENT');
    const attemptNumbers = [...new Set([...group.traces.keys(), ...group.attempts.keys()])].sort((a, b) => a - b);
    if (attemptNumbers.length === 0) { note('MISSING_EXECUTION'); accounted = false; unresolved = true; }
    if (attemptNumbers.some((attempt, ordinal) => attempt !== ordinal + 1)) {
      note('MISSING_ATTEMPT'); accounted = false; unresolved = true;
    }
    for (const attempt of attemptNumbers) {
      const trace = group.traces.get(attempt);
      const events = group.attempts.get(attempt) ?? [];
      if (!trace) { note('MISSING_TRACE'); accounted = false; unresolved = true; }
      if (events.length === 0) { note('MISSING_MEASUREMENT'); accounted = false; unresolved = true; }
      if (events.length > 1) { note('DUPLICATE_SEND'); accounted = false; unresolved = true; }
      if (trace?.bootstrap) { note('BOOTSTRAP_MISCLASSIFIED'); accounted = false; }
      for (const event of events) {
        if (trace && (trace.route !== event.route || trace.success !== event.completed)) {
          note('ROUTE_CONFLICT'); accounted = false; unresolved = true;
        }
        if (event.sent && trace?.errorCode && preSendFailure.has(trace.errorCode)) {
          note('EVIDENCE_CONFLICT'); accounted = false; unresolved = true;
        }
        if (!event.sent) continue;
        sentCount++;
        const verified = isAnon(event.route) && event.workerVerified
          && (event.evidence === 'OBSERVED_LIVE' || event.evidence === 'SIMULATED');
        if (!verified) allSentProtected = false;
        if (isAnon(event.route) && !verified) note('WORKER_UNVERIFIED');
        if (event.route === 'direct-debug' || event.route === 'direct-bootstrap') {
          note(group.declared?.privacyRequired === false ? 'DIRECT_CONTROL' : 'DIRECT_BYPASS');
        }
        if (event.route === 'passthrough') note('NOT_ANONYMIZED');
        if (event.route === 'unknown') { note('UNKNOWN_ROUTE'); unresolved = true; }
        const sampleKey = JSON.stringify([group.identity.endpointId, group.identity.chainId, group.identity.method, event.route]);
        const sample = latency.get(sampleKey) ?? { identity: group.identity, route: event.route, events: [] };
        sample.events.push(event);
        latency.set(sampleKey, sample);
      }
    }
    const last = attemptNumbers.at(-1);
    const terminalEvents = last === undefined ? [] : group.attempts.get(last) ?? [];
    if (terminalEvents.some((event) => event.completed)) successfulReads++;
    if (sentCount === 0 && attemptNumbers.length > 0) note('BLOCKED_READ');
    if (accounted && sentCount > 0 && allSentProtected) protectedReads++;
  }
  const report = {
    schemaVersion: 1 as const,
    runId: scope.reportRunId,
    evidence: input.evidence,
    eligibleReads: ordered.length,
    protectedReads,
    successfulReads,
    protectedCoverage: ordered.length === 0 ? null : protectedReads / ordered.length,
    findings: findings.sort((a, b) => {
      const x = JSON.stringify([a.readId ?? '', a.code, a.callsite]);
      const y = JSON.stringify([b.readId ?? '', b.code, b.callsite]);
      return x < y ? -1 : x > y ? 1 : 0;
    }),
    scope: {
      rpcOrigins: [...new Set(scope.origins.map((entry) => entry.origin))].sort(),
      scenarios: [...new Set(scope.scenarios.map((entry) => `${scope.application}:${entry.label}`))].sort(),
      bootstrapExclusions: [...new Set(scope.bootstrapRules.map((rule) => rule.label))].sort(),
    },
  };
  const parsed = privacyReportSchema.safeParse(report);
  if (!parsed.success) return failure();
  const summaries: LatencySummary[] = [...latency.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, sample]) => {
      const durations = sample.events.map((event) => event.durationMs).sort((a, b) => a - b);
      const percentile = (p: number) => durations[Math.max(0, Math.ceil(durations.length * p) - 1)] ?? 0;
      return {
        endpointId: endpointAliases.get(sample.identity.endpointId) ?? 'unattributed',
        chainId: sample.identity.chainId, method: sample.identity.method, route: sample.route,
        sampleCount: durations.length, successfulSamples: sample.events.filter((event) => event.completed).length,
        p50Ms: percentile(0.5), p95Ms: percentile(0.95),
      };
    });
  return {
    ok: true,
    value: {
      report: parsed.data,
      summary: {
        application: scope.application,
        completionRate: ordered.length === 0 ? null : successfulReads / ordered.length,
        functionalAcceptance: input.evidence === 'UNTESTED' ? 'unresolved'
          : input.evidence === 'BLOCKED' || ordered.length === 0 || successfulReads !== ordered.length ? 'fail'
            : unresolved ? 'unresolved' : 'pass',
        latency: summaries,
      },
    },
  };
}

/** Recompute the public projection; never serialize input objects or caller-supplied findings. */
export function exportPrivacyReport(input: unknown, scope: unknown): Result<string> {
  const analysis = analyzePrivacyRun(input, scope);
  return analysis.ok ? { ok: true, value: `${JSON.stringify(analysis.value.report, null, 2)}\n` } : analysis;
}
