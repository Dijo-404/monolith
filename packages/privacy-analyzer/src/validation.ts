import {
  chainIdSchema, evidenceKindSchema, identifierSchema, labelSchema, makeError,
  publicHttpsUrlSchema, readMethodSchema, routeSchema, rpcTraceSchema,
} from '@monolith/shared';
import type { Result, RpcTrace } from '@monolith/shared';
import type {
  AnalyzerInput, AnalyzerScope, BootstrapRule, DeclaredRead, LabelEntry,
  MeasuredAttempt, OriginEntry, ReadRef,
} from './types.js';

const MAX_ITEMS = 1_000;
const MAX_DURATION_MS = 3_600_000;
const INVALID = Symbol('invalid-analysis-input');
const UNSUPPORTED = Symbol('unsupported-analysis-version');

type Parser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw INVALID;
}

function parse<T>(schema: Parser<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw INVALID;
  return parsed.data;
}

/** Read data descriptors once; neither validation nor its snapshots invoke getters. */
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype: unknown = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(value);
  const permitted = new Set([...required, ...optional]);
  requireValue(keys.length <= permitted.size);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    requireValue(typeof key === 'string' && permitted.has(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor && 'value' in descriptor && descriptor.enumerable);
    snapshot[key] = descriptor.value;
  }
  for (const key of required) requireValue(Object.hasOwn(snapshot, key));
  return snapshot;
}

/** Plain dense arrays only; reject subclass/prototype and accessor surprises. */
function array(value: unknown): unknown[] {
  requireValue(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  requireValue(lengthDescriptor && 'value' in lengthDescriptor);
  const length: unknown = lengthDescriptor.value;
  requireValue(typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 && length <= MAX_ITEMS);
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length === length + 1);
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValue(descriptor && 'value' in descriptor && descriptor.enumerable);
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function boolean(value: unknown): boolean {
  requireValue(typeof value === 'boolean');
  return value;
}

function attemptIndex(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_ITEMS);
  return value;
}

function duration(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS);
  return value;
}

/** Trusted labels still need a conservative guard before becoming public text. */
function publicLabel(value: unknown): string {
  const label = parse(labelSchema, value);
  requireValue(!/0x[a-f\d]{40,}|[a-f\d]{64,}/i.test(label));
  requireValue(!/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(label));
  requireValue(!/(?:^|[\s[(])(?:[a-f\d]{0,4}:){2,}[a-f\d:]{0,4}(?=$|[\s)\]])/i.test(label));
  requireValue(!/\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/i.test(label));
  requireValue(!/https?:\/\/|[?=]|\b(?:bearer\s+|sk-[a-z\d_-]{8,})/i.test(label));
  requireValue(!/\b(?:password|passwd|secret|signature|authorization|api[_-]?key|private[_-]?key|mnemonic|seed[_-]?phrase|access[_-]?token)\s*[:=]/i.test(label));
  return label;
}

function alias(value: unknown): string {
  const result = publicLabel(value);
  requireValue(/^[A-Za-z][A-Za-z0-9_.:/-]{0,95}$/.test(result));
  return result;
}

function labels(value: unknown): LabelEntry[] {
  return array(value).map((entry) => {
    const item = record(entry, ['alias', 'label']);
    return { alias: alias(item['alias']), label: publicLabel(item['label']) };
  });
}

function origins(value: unknown): OriginEntry[] {
  return array(value).map((entry) => {
    const item = record(entry, ['alias', 'origin']);
    const origin = parse(publicHttpsUrlSchema, item['origin']);
    requireValue(/^https:\/\/[a-z0-9.-]+$/.test(origin));
    return { alias: alias(item['alias']), origin };
  });
}

function uniqueAliases(entries: readonly { alias: string }[]): Set<string> {
  const result = new Set(entries.map((entry) => entry.alias));
  requireValue(result.size === entries.length);
  return result;
}

function bootstrapRules(value: unknown, callsites: ReadonlySet<string>, originAliases: ReadonlySet<string>): BootstrapRule[] {
  const rules = array(value).map((entry) => {
    const item = record(entry, ['readId', 'endpointId', 'chainId', 'method', 'callsiteAlias', 'originAlias', 'label']);
    const callsiteAlias = alias(item['callsiteAlias']);
    const originAlias = alias(item['originAlias']);
    requireValue(callsites.has(callsiteAlias) && originAliases.has(originAlias));
    requireValue(item['method'] === 'eth_call');
    return {
      readId: parse(identifierSchema, item['readId']),
      endpointId: parse(identifierSchema, item['endpointId']),
      chainId: parse(chainIdSchema, item['chainId']),
      method: 'eth_call' as const,
      callsiteAlias,
      originAlias,
      label: publicLabel(item['label']),
    };
  });
  requireValue(new Set(rules.map((rule) => rule.readId)).size === rules.length);
  return rules;
}

function scopeSnapshot(value: unknown): AnalyzerScope {
  const item = record(value, ['reportRunId', 'application', 'origins', 'callsites', 'scenarios', 'bootstrapRules', 'captureComplete']);
  const application = publicLabel(item['application']);
  const parsedOrigins = origins(item['origins']);
  const parsedCallsites = labels(item['callsites']);
  const parsedScenarios = labels(item['scenarios']);
  const originAliases = uniqueAliases(parsedOrigins);
  const callsites = uniqueAliases(parsedCallsites);
  uniqueAliases(parsedScenarios);
  const parsedBootstrapRules = bootstrapRules(item['bootstrapRules'], callsites, originAliases);
  requireValue(parsedOrigins.length + parsedCallsites.length + parsedScenarios.length + parsedBootstrapRules.length <= MAX_ITEMS);
  for (const scenario of parsedScenarios) requireValue(application.length + scenario.label.length + 1 <= 256);
  return {
    reportRunId: publicLabel(parse(identifierSchema, item['reportRunId'])),
    application,
    origins: parsedOrigins,
    callsites: parsedCallsites,
    scenarios: parsedScenarios,
    bootstrapRules: parsedBootstrapRules,
    captureComplete: boolean(item['captureComplete']),
  };
}

function declaredRead(value: unknown, callsites: ReadonlySet<string>, scenarios: ReadonlySet<string>): DeclaredRead {
  const item = record(value, ['readId', 'endpointId', 'chainId', 'method', 'callsiteAlias', 'scenarioAlias', 'privacyRequired']);
  const callsiteAlias = alias(item['callsiteAlias']);
  const scenarioAlias = alias(item['scenarioAlias']);
  requireValue(callsites.has(callsiteAlias) && scenarios.has(scenarioAlias));
  return {
    readId: parse(identifierSchema, item['readId']),
    endpointId: parse(identifierSchema, item['endpointId']),
    chainId: parse(chainIdSchema, item['chainId']),
    method: parse(readMethodSchema, item['method']),
    callsiteAlias,
    scenarioAlias,
    privacyRequired: boolean(item['privacyRequired']),
  };
}

function traceSnapshot(value: unknown): RpcTrace {
  const item = record(value, [
    'schemaVersion', 'readId', 'attempt', 'endpointId', 'chainId', 'method', 'callsite',
    'route', 'durationMs', 'success', 'bootstrap', 'evidence', 'payloadVisibility',
  ], ['errorCode']);
  attemptIndex(item['attempt']);
  duration(item['durationMs']);
  return parse(rpcTraceSchema, item);
}

function reference(value: unknown): ReadRef {
  const item = record(value, ['readId', 'attempt']);
  return { readId: parse(identifierSchema, item['readId']), attempt: attemptIndex(item['attempt']) };
}

function measuredAttempt(value: unknown, callsites: ReadonlySet<string>, originAliases: ReadonlySet<string>): MeasuredAttempt {
  const item = record(value, [
    'eventId', 'endpointId', 'chainId', 'method', 'originAlias', 'route',
    'sent', 'completed', 'durationMs', 'workerVerified', 'evidence',
  ], ['ref', 'callsiteAlias']);
  const originAlias = alias(item['originAlias']);
  requireValue(originAliases.has(originAlias));
  const route = item['route'] === 'unknown' ? 'unknown' : parse(routeSchema, item['route']);
  const sent = boolean(item['sent']);
  const completed = boolean(item['completed']);
  const workerVerified = boolean(item['workerVerified']);
  requireValue(!completed || sent);
  requireValue(route !== 'blocked' || (!sent && !completed && !workerVerified));
  requireValue(!workerVerified || (sent && (route === 'anon-tor' || route === 'anon-nym')));
  const result: MeasuredAttempt = {
    eventId: parse(identifierSchema, item['eventId']),
    endpointId: parse(identifierSchema, item['endpointId']),
    chainId: parse(chainIdSchema, item['chainId']),
    method: parse(readMethodSchema, item['method']),
    originAlias,
    route,
    sent,
    completed,
    durationMs: duration(item['durationMs']),
    workerVerified,
    evidence: parse(evidenceKindSchema, item['evidence']),
  };
  if (Object.hasOwn(item, 'ref')) result.ref = reference(item['ref']);
  if (Object.hasOwn(item, 'callsiteAlias')) {
    const callsiteAlias = alias(item['callsiteAlias']);
    requireValue(callsites.has(callsiteAlias));
    result.callsiteAlias = callsiteAlias;
  }
  return result;
}

/** Strictly snapshot measurements/configuration; returned errors never contain submitted data. */
export function validateAnalysisInput(input: unknown, scope: unknown): Result<{ input: AnalyzerInput; scope: AnalyzerScope }> {
  try {
    requireValue(input !== null && typeof input === 'object' && !Array.isArray(input));
    const prototype: unknown = Object.getPrototypeOf(input);
    requireValue(prototype === Object.prototype || prototype === null);
    const versionDescriptor = Object.getOwnPropertyDescriptor(input, 'schemaVersion');
    requireValue(versionDescriptor && 'value' in versionDescriptor && versionDescriptor.enumerable);
    const version: unknown = versionDescriptor.value;
    if (typeof version === 'number' && Number.isSafeInteger(version) && version > 0 && version !== 1) throw UNSUPPORTED;
    requireValue(version === 1);
    const item = record(input, ['schemaVersion', 'runId', 'evidence', 'reads', 'traces', 'attempts']);
    requireValue(item['schemaVersion'] === 1);
    const parsedScope = scopeSnapshot(scope);
    const callsites = new Set(parsedScope.callsites.map((entry) => entry.alias));
    const scenarios = new Set(parsedScope.scenarios.map((entry) => entry.alias));
    const originAliases = new Set(parsedScope.origins.map((entry) => entry.alias));
    const reads = array(item['reads']);
    const traces = array(item['traces']);
    const attempts = array(item['attempts']);
    requireValue(reads.length + traces.length + attempts.length <= MAX_ITEMS);
    const evidence = parse(evidenceKindSchema, item['evidence']);
    const parsedTraces = traces.map(traceSnapshot);
    const parsedAttempts = attempts.map((entry) => measuredAttempt(entry, callsites, originAliases));
    requireValue(parsedTraces.every((entry) => entry.evidence === evidence));
    requireValue(parsedAttempts.every((entry) => entry.evidence === evidence));
    if (evidence === 'UNTESTED' || evidence === 'BLOCKED') {
      requireValue(parsedTraces.every((entry) => !entry.success));
      requireValue(parsedAttempts.every((entry) => !entry.completed));
    }
    return {
      ok: true,
      value: {
        input: {
          schemaVersion: 1,
          runId: parse(identifierSchema, item['runId']),
          evidence,
          reads: reads.map((entry) => declaredRead(entry, callsites, scenarios)),
          traces: parsedTraces,
          attempts: parsedAttempts,
        },
        scope: parsedScope,
      },
    };
  } catch (error: unknown) {
    return { ok: false, error: makeError(error === UNSUPPORTED ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT') };
  }
}
