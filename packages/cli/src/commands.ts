import { analyzePrivacyRun } from '@monolith/privacy-analyzer';
import { privacyReportSchema } from '@monolith/shared';
import type { PrivacyReport } from '@monolith/shared';

export const VERSION = '0.1.0';
export const HELP = `Monolith ${VERSION} — privacy checks and browser lab

Usage: monolith <command> [--json]

  doctor                      Check local runtime and configuration (offline)
  check --input <file>        Analyze a portable measurement envelope (offline)
  report <file>              View report counts; does not verify evidence
  lab --url <dashboard>      Open an explicit browser lab URL
  tui                         Open the keyboard-driven terminal interface
  --help / --version         Show help or version

Configuration: MONOLITH_LAB_URL supplies the lab URL when --url is omitted.
Exit codes: 0 success/viewed/launched, 1 failed check, 2 invalid/unavailable, 130 cancelled.
JSON goes to stdout; human errors go to stderr. No interactive prompts without a TTY.
Protected reads run in the browser through its verified worker, or fail closed.
Local input labels are unverified claims; the RPC destination still sees payloads.
`;

export interface CommandContext {
  readJson(file: string): Promise<unknown>;
  openLab(url: string): Promise<boolean>;
  nodeVersion: string;
  configuredLabUrl?: string;
}
export interface CommandResult { exitCode: number; stdout: string; stderr: string }

const knownFindings = new Set([
  'CAPTURE_INCOMPLETE', 'EMPTY_RUN', 'UNDECLARED_READ', 'UNEXPLAINED_EGRESS',
  'UNKNOWN_CALLSITE', 'DUPLICATE_TRACE', 'DUPLICATE_EVENT', 'MISSING_EXECUTION',
  'MISSING_ATTEMPT', 'MISSING_TRACE', 'MISSING_MEASUREMENT', 'DUPLICATE_SEND',
  'BOOTSTRAP_MISCLASSIFIED', 'ROUTE_CONFLICT', 'EVIDENCE_CONFLICT', 'WORKER_UNVERIFIED',
  'DIRECT_CONTROL', 'DIRECT_BYPASS', 'NOT_ANONYMIZED', 'UNKNOWN_ROUTE', 'BLOCKED_READ',
]);
const errors = {
  INVALID_INPUT: 'Invalid command or input. Use monolith --help.',
  UNSUPPORTED_VERSION: 'This input schema version is unsupported.',
  FILE_UNAVAILABLE: 'Cannot read a bounded regular JSON input file.',
  RUNTIME_UNAVAILABLE: 'Use the supported Node.js runtime: >=24.22.2 <25.',
  LAB_UNAVAILABLE: 'The browser launcher is unavailable. No lab run was performed.',
  TTY_REQUIRED: 'The terminal interface requires interactive stdin and stdout.',
  INTERNAL_ERROR: 'The command could not complete.',
} as const;
type ErrorCode = keyof typeof errors;
type Data = Record<string, unknown>;

function output(command: string, status: string, data: Data, exitCode: number, json: boolean, human: string): CommandResult {
  return {
    exitCode,
    stdout: json ? `${JSON.stringify({ schemaVersion: 1, command, status, data })}\n` : `${human}\n`,
    stderr: '',
  };
}
export function commandError(command: string, code: ErrorCode, json: boolean): CommandResult {
  return {
    exitCode: 2,
    stdout: json ? `${JSON.stringify({ schemaVersion: 1, command, status: 'error', error: { code, message: errors[code] } })}\n` : '',
    stderr: json ? '' : `${errors[code]}\n`,
  };
}

/** A count projection, never a serialization of supplied free text or identifiers. */
function reportData(report: PrivacyReport): Data {
  const counts = new Map<string, number>();
  for (const finding of report.findings) {
    const code = knownFindings.has(finding.code) ? finding.code : 'UNRECOGNIZED_FINDING';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return {
    evidence: report.evidence,
    inputTrust: 'unverified-local-input',
    eligibleReads: report.eligibleReads,
    protectedReads: report.protectedReads,
    successfulReads: report.successfulReads,
    protectedCoverage: report.protectedCoverage,
    findings: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
  };
}
function reportText(report: PrivacyReport): string {
  const coverage = report.protectedCoverage === null ? 'n/a' : `${(report.protectedCoverage * 100).toFixed(1)}%`;
  const findings = reportData(report)['findings'] as Array<{ code: string; count: number }>;
  const details = findings.map(({ code, count }) => `  ${code}: ${count}`).join('\n');
  return `Evidence: ${report.evidence} (unverified local input)\nProtected: ${report.protectedReads}/${report.eligibleReads} (${coverage})\nSuccessful: ${report.successfulReads}/${report.eligibleReads}\nFindings: ${report.findings.length}${details ? '\n'+details : ''}\nWorker bootstrap is non-anonymous; RPC destinations can read payloads.`;
}

/** Opening a URL is an explicit UI action, never an RPC proxy or a live-run assertion. */
export function validateLabUrl(value: string): string | undefined {
  if (!value || value.length > 2_048 || /[\s\p{Cc}]/u.test(value)) return;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) return;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return;
    return url.href;
  } catch { return; }
}

function supportedNode(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return Boolean(match && Number(match[1]) === 24
    && (Number(match[2]) > 22 || (Number(match[2]) === 22 && Number(match[3]) >= 2)));
}
function envelope(value: unknown): value is { schemaVersion: 1; input: unknown; scope: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && Object.hasOwn(value, 'input') && Object.hasOwn(value, 'scope')
    && Object.hasOwn(value, 'schemaVersion') && (value as Record<string, unknown>)['schemaVersion'] === 1;
}

export async function executeCommand(argv: readonly string[], context: CommandContext): Promise<CommandResult> {
  const json = argv.includes('--json');
  const args = argv.filter((arg) => arg !== '--json');
  const command = args[0] ?? 'help';
  const safeCommand = ['doctor', 'check', 'report', 'lab', 'help', '--help', '-h', '--version', '-v'].includes(command)
    ? command : 'unknown';
  if (argv.filter((arg) => arg === '--json').length > 1) return commandError(safeCommand, 'INVALID_INPUT', json);
  if (['help', '--help', '-h'].includes(command) && args.length <= 1) {
    return output('help', 'pass', { usage: HELP }, 0, json, HELP.trimEnd());
  }
  if (['--version', '-v'].includes(command) && args.length === 1) {
    return output('version', 'pass', { version: VERSION }, 0, json, VERSION);
  }
  if (command === 'doctor' && args.length === 1) {
    if (!supportedNode(context.nodeVersion)) return commandError(command, 'RUNTIME_UNAVAILABLE', json);
    if (context.configuredLabUrl !== undefined && !validateLabUrl(context.configuredLabUrl)) {
      return commandError(command, 'INVALID_INPUT', json);
    }
    return output(command, 'pass', {
      runtime: 'supported', labConfigured: context.configuredLabUrl !== undefined,
      evidence: 'UNTESTED', protectedReadsAvailableInNode: false, networkContacted: false,
    }, 0, json, 'Local runtime: supported\nLab URL: '+(context.configuredLabUrl ? 'configured' : 'not configured')
      +'\nNetwork/worker: UNTESTED (offline check)\nProtected reads require the browser lab.');
  }
  if (command === 'lab' && ((args.length === 3 && args[1] === '--url') || args.length === 1)) {
    const url = validateLabUrl(args[2] ?? context.configuredLabUrl ?? '');
    if (!url) return commandError(command, 'INVALID_INPUT', json);
    try {
      if (!await context.openLab(url)) return commandError(command, 'LAB_UNAVAILABLE', json);
      return output(command, 'launched', { evidence: 'UNTESTED', workerState: 'UNTESTED', runPerformed: false }, 0, json,
        'Browser launch requested. Lab/worker: UNTESTED; no successful run is claimed.\nProtected reads and chain probes stay in the browser worker or fail closed.');
    } catch { return commandError(command, 'LAB_UNAVAILABLE', json); }
  }
  const check = command === 'check' && args.length === 3 && args[1] === '--input';
  const report = command === 'report' && args.length === 2 && !args[1]?.startsWith('-');
  if (!check && !report) return commandError(safeCommand, 'INVALID_INPUT', json);
  const file = check ? args[2] : args[1];
  if (!file || file.startsWith('-')) return commandError(command, 'INVALID_INPUT', json);
  let value: unknown;
  try { value = await context.readJson(file); }
  catch { return commandError(command, 'FILE_UNAVAILABLE', json); }
  try {
    if (report) {
      const parsed = privacyReportSchema.safeParse(value);
      if (!parsed.success) return commandError(command, 'INVALID_INPUT', json);
      return output(command, 'viewed', reportData(parsed.data), 0, json,
        reportText(parsed.data)+'\nReport viewing does not verify artifact hashes, redaction or live provenance.');
    }
    if (!envelope(value)) {
      const version = value && typeof value === 'object' ? (value as Record<string, unknown>)['schemaVersion'] : undefined;
      return commandError(command, typeof version === 'number' && Number.isSafeInteger(version) && version > 0 && version !== 1
        ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT', json);
    }
    const analysis = analyzePrivacyRun(value.input, value.scope);
    if (!analysis.ok) return commandError(command, analysis.error.code === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT', json);
    const result = analysis.value;
    const passed = result.summary.functionalAcceptance === 'pass' && result.report.eligibleReads > 0
      && result.report.protectedReads === result.report.eligibleReads
      && result.report.successfulReads === result.report.eligibleReads && result.report.findings.length === 0;
    return output(command, passed ? 'pass' : 'fail', {
      ...reportData(result.report), functionalAcceptance: result.summary.functionalAcceptance,
    }, passed ? 0 : 1, json, `Privacy check: ${passed ? 'PASS' : 'FAIL'}\n${reportText(result.report)}\nLocal analysis does not authenticate the supplied measurements or worker claims.`);
  } catch { return commandError(command, 'INVALID_INPUT', json); }
}
