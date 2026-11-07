import { useEffect, useState, type ReactNode } from 'react';
import { Header } from '../../components/Header.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { CodeBlock } from './CodeBlock.js';
import './docs.css';

const REPO = 'https://github.com/Dijo-404/monolith';
const doc = (path: string) => `${REPO}/blob/main/${path}`;

interface Entry { readonly id: string; readonly title: string }
const GROUPS: ReadonlyArray<{ readonly label: string; readonly entries: readonly Entry[] }> = [
  { label: 'Start', entries: [
    { id: 'overview', title: 'Overview' },
    { id: 'cli', title: 'CLI quickstart' },
    { id: 'local', title: 'Run the lab locally' },
  ] },
  { label: 'Build', entries: [
    { id: 'transport', title: 'MonolithTransport' },
    { id: 'contracts', title: 'Contracts and errors' },
    { id: 'registry', title: 'Registry trust' },
    { id: 'observer', title: 'Observer API' },
  ] },
  { label: 'Verify', entries: [
    { id: 'reports', title: 'Privacy reports' },
    { id: 'harness', title: 'Agent harness' },
  ] },
  { label: 'Reference', entries: [
    { id: 'wallet', title: 'Wallet connection' },
    { id: 'limits', title: 'What stays visible' },
  ] },
];
const ENTRIES = GROUPS.flatMap((group) => group.entries);
const number = (id: string) => String(ENTRIES.findIndex((entry) => entry.id === id) + 1).padStart(2, '0');

function Section({ id, title, lede, children }: {
  readonly id: string; readonly title: string; readonly lede?: string; readonly children: ReactNode;
}) {
  return <section id={id} className="doc-section" aria-labelledby={`${id}-title`}>
    <p className="doc-section__index mono" aria-hidden="true">§ {number(id)}</p>
    <h2 id={`${id}-title`}>{title}</h2>
    {lede && <p className="doc-section__lede">{lede}</p>}
    {children}
  </section>;
}

function Callout({ tone = 'neutral', title, children }: {
  readonly tone?: 'neutral' | 'exposed' | 'protected' | 'sim'; readonly title: string; readonly children: ReactNode;
}) {
  const icon: IconName = tone === 'exposed' ? 'alert' : tone === 'protected' ? 'check' : 'info';
  return <aside className={`callout callout--${tone}`}>
    <Icon name={icon} size={18} />
    <div><p className="callout__title">{title}</p><div className="callout__body">{children}</div></div>
  </aside>;
}

function Table({ head, rows, mono = [0] }: {
  readonly head: readonly string[]; readonly rows: ReadonlyArray<readonly ReactNode[]>; readonly mono?: readonly number[];
}) {
  return <div className="doc-table" role="region" aria-label={head.join(', ')} tabIndex={0}>
    <table>
      <thead><tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) =>
        <td key={cellIndex} className={mono.includes(cellIndex) ? 'mono' : undefined}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function Source({ path, line }: { readonly path: string; readonly line?: number }) {
  return <a className="source-link mono" href={`${doc(path)}${line ? `#L${line}` : ''}`}>{path}{line ? `:${line}` : ''}<Icon name="external" size={12} /></a>;
}

function useActiveSection(): string {
  const [active, setActive] = useState(ENTRIES[0]!.id);
  useEffect(() => {
    const sections = ENTRIES.map((entry) => document.getElementById(entry.id)).filter((node) => node !== null);
    const observer = new IntersectionObserver((records) => {
      const visible = records.filter((record) => record.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-20% 0px -70% 0px' });
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);
  return active;
}

function Toc({ active }: { readonly active: string }) {
  return <nav className="doc-toc" aria-label="Documentation">
    {GROUPS.map((group) => <div key={group.label} className="doc-toc__group">
      <p className="doc-toc__label mono">{group.label}</p>
      <ul>{group.entries.map((entry) => <li key={entry.id}>
        <a href={`#${entry.id}`} aria-current={active === entry.id ? 'location' : undefined}>
          <span className="mono" aria-hidden="true">{number(entry.id)}</span>{entry.title}
        </a>
      </li>)}</ul>
    </div>)}
  </nav>;
}

const TRANSPORT_EXAMPLE = `import { createMonolithTransport } from '@monolith/transport';
import { createBrowserDriver } from '@monolith/transport/browser';
import type { EndpointCandidate, RpcTrace } from '@monolith/shared';

const TARGET = 'https://ethereum-rpc.publicnode.com';
const clock = { now: () => new Date().toISOString() };
const traces: RpcTrace[] = [];
const sink = { emit: (trace: RpcTrace) => traces.push(trace) };

// A fixed route capability. It never falls back to another driver.
const driver = createBrowserDriver({
  hostUrl: new URL('./host.html', location.href).href, network: 'nym',
  bootstrapRpcUrl: 'https://ethereum.publicnode.com', approvedOrigins: [TARGET], traceSink: sink,
});

const transport = createMonolithTransport({
  policy: { privacyRequired: true, allowedChains: ['1'], allowedMethods: ['eth_chainId'],
    allowDirectDebugControl: false, failClosed: true },
  driver, clock, traceSink: sink, trustedPublishers: [endpoint.publisher], approvedOrigins: [TARGET],
  allowedCallsites: ['transport.acceptance.read'], maxAttempts: 2,
  initializationTimeoutMs: 180_000, requestTimeoutMs: 60_000, validationTtlMs: 120_000,
});

try {
  const initialized = await transport.initialize();          // BOOTSTRAPPING, then DEGRADED
  if (!initialized.ok) throw initialized.error.code;
  const validated = await transport.validateEndpoint(endpoint); // protected eth_chainId probe, READY
  if (!validated.ok) throw validated.error.code;
  const read = await transport.read({
    readId: \`app_\${crypto.randomUUID()}\`, endpointId: endpoint.endpointId, chainId: '1',
    method: 'eth_chainId', params: [], callsite: 'transport.acceptance.read',
  });
  if (!read.ok) throw read.error.code;  // e.g. WORKER_UNAVAILABLE: blocked, never sent directly
} finally {
  await transport.close();
}`;

const HOST_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Monolith transport host</title></head>
  <body>
    <script type="module">
      import { installBrowserHost } from '@monolith/transport/browser';
      installBrowserHost();
    </script>
  </body>
</html>`;

export function DocsPage() {
  const active = useActiveSection();
  return <>
    <Header section="demo" page="docs" />
    <div className="docs">
      <aside className="docs__rail">
        <details className="docs__toc-mobile">
          <summary>On this page<Icon name="chevron-down" size={16} /></summary>
          <Toc active={active} />
        </details>
        <div className="docs__toc-desktop"><Toc active={active} /></div>
      </aside>

      <main id="docs-content" className="docs__main" tabIndex={-1}>
        <header className="docs__hero">
          <p className="fig-label">Developer documentation</p>
          <h1>Route reads privately, or fail closed. Then prove it.</h1>
          <p className="docs__intro">Monolith wraps browser JSON-RPC reads in a policy: a privacy-required read goes through a verified anonymizing worker or returns a typed error. An independent observer and a report analyzer measure what actually happened, including what the endpoint can still read.</p>
          <dl className="docs__facts">
            <div><dt>Published</dt><dd><code>@dijo-404/monolith-cli@0.1.0</code></dd></div>
            <div><dt>Workspace only</dt><dd><code>@monolith/transport</code>, <code>shared</code>, <code>registry</code>, <code>privacy-analyzer</code></dd></div>
            <div><dt>Runtime</dt><dd>Node 24.22.2 · pnpm 12.18.0</dd></div>
          </dl>
        </header>

        <Section id="overview" title="Overview" lede="Four parts, each with one job. Domain code depends on small ports; network SDKs stay in adapters.">
          <ol className="parts">
            <li><Icon name="gate" size={22} /><div><p className="parts__name">Transport</p><p><code>MonolithTransport</code> enforces the route policy for every read: allowed chains, methods, callsites and a validated endpoint.</p></div></li>
            <li><Icon name="mix" size={22} /><div><p className="parts__name">Browser driver</p><p>Runs the Anon-RPC worker (Nym or Tor) inside a same-origin iframe. Passthrough exists and is labelled <code>NOT_ANONYMIZED</code>.</p></div></li>
            <li><Icon name="observer" size={22} /><div><p className="parts__name">Observer</p><p>A read-only HTTP service that forwards only to configured upstreams and records which network source each synthetic read came from.</p></div></li>
            <li><Icon name="terminal" size={22} /><div><p className="parts__name">Analyzer and CLI</p><p>Turns measurements into a <code>PrivacyReport</code> with explicit denominators, and gives CI an exit code.</p></div></li>
          </ol>
          <Callout tone="sim" title="Packages are not on npm yet">
            <p>Only the CLI is published. Use <code>@monolith/*</code> packages from a clone of the workspace; they are marked private and their APIs may still change.</p>
          </Callout>
        </Section>

        <Section id="cli" title="CLI quickstart" lede="Check captured measurements locally and fail a build when a read bypasses the policy.">
          <CodeBlock language="sh" title="Install or run once" code={`npx @dijo-404/monolith-cli@0.1.0 --help
npm install --global @dijo-404/monolith-cli@0.1.0`} />
          <CodeBlock language="sh" title="Typical CI step" code={`monolith doctor
monolith check --input measurements.json --json`} />
          <Table head={['Command', 'What it does']} rows={[
            ['monolith doctor [--json]', 'Check local prerequisites without contacting a service.'],
            ['monolith check --input <file> [--json]', 'Validate and analyze portable captured measurements, then return a CI exit code.'],
            ['monolith report <file> [--json]', 'View a safe projection of a report’s counts, evidence label and known finding codes. It does not verify evidence.'],
            ['monolith lab [--url <dashboard-url>] [--json]', 'Open the selected browser lab. Without --url it uses MONOLITH_LAB_URL.'],
            ['monolith tui', 'Start the keyboard-operated terminal menu (arrows or j/k, Enter, ?, Esc, q).'],
          ]} />
          <Table head={['Exit code', 'Meaning']} rows={[
            ['0', 'Completed, or the check passed'],
            ['1', 'The check failed'],
            ['2', 'Invalid input or a required runtime is unavailable'],
            ['130', 'Cancelled with Ctrl-C'],
          ]} />
          <Callout title="A pass is strict">
            <p><code>check</code> passes only when every eligible read was protected and returned, and the report has no findings at all. An intentional <code>DIRECT_CONTROL</code> read therefore fails it. Input is a regular UTF-8 JSON file up to 1 MiB, and JSON output always states <code>"inputTrust": "unverified-local-input"</code>.</p>
          </Callout>
        </Section>

        <Section id="local" title="Run the lab locally" lede="No wallet, signing key or live-network credentials are needed to start.">
          <CodeBlock language="sh" title="From source" code={`git clone https://github.com/Dijo-404/monolith.git
cd monolith
npm install --global pnpm@12.18.0
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev`} />
          <Table head={['Address', 'What is there']} rows={[
            ['http://127.0.0.1:5173', 'Live lab. Real requests are sent only when you run a step.'],
            ['http://127.0.0.1:5173/?mode=simulated', 'Offline walkthrough. Every result is labelled SIMULATED.'],
            ['http://127.0.0.1:3001/api/health', 'Observer health check.'],
          ]} />
          <Table head={['Script', 'Runs']} rows={[
            ['pnpm dev', 'Dashboard and observer together'],
            ['pnpm check', 'lint, typecheck, test and build: the full gate'],
            ['pnpm exec tsx scripts/check-rpc-egress.ts', 'The static direct-RPC egress scan on its own'],
            ['pnpm --filter @monolith/dashboard preview', 'Preview a production dashboard build'],
          ]} />
          <Callout title="One browser variable">
            <p>The dashboard receives only <code>MONOLITH_PUBLIC_OBSERVER_URL</code>, allowlisted by exact name (default <code>http://127.0.0.1:3001</code>). It must be an origin with no credentials, path, query or fragment; live actions need a public HTTPS origin.</p>
          </Callout>
        </Section>

        <Section id="transport" title="MonolithTransport" lede="Create one transport per route policy. It never throws to callers: every call resolves to a Result.">
          <ol className="steps-inline">
            <li><span className="mono">01</span><code>initialize()</code><span>Start the worker. State goes BOOTSTRAPPING, then DEGRADED.</span></li>
            <li><span className="mono">02</span><code>validateEndpoint(candidate)</code><span>Trust checks plus a protected <code>eth_chainId</code> probe. State becomes READY.</span></li>
            <li><span className="mono">03</span><code>read(request)</code><span>Refused with <code>ENDPOINT_REJECTED</code> unless that endpoint has a current validation.</span></li>
          </ol>
          <CodeBlock title="Protected read in the browser" code={TRANSPORT_EXAMPLE}
            source="Adapted from packages/transport/test/live/main.ts · endpoint is an EndpointCandidate" />
          <p className="doc-p">The driver needs an application-owned, same-origin HTML page that installs the worker host. Calling <code>installBrowserHost()</code> from a top-level page throws.</p>
          <CodeBlock language="html" title="host.html" code={HOST_PAGE} source="apps/dashboard/assets/worker-host.html" />
          <Table head={['Option', 'Default', 'Range']} rows={[
            ['maxAttempts', '2', '1–3; retries only retryable errors, on the same driver'],
            ['requestTimeoutMs', '45_000', '1–180_000'],
            ['initializationTimeoutMs', '180_000', '1–300_000'],
            ['validationTtlMs', '60_000', '1–300_000'],
          ]} mono={[0, 1]} />
          <Callout tone="exposed" title="Configuration that would weaken privacy is refused">
            <p>The policy must allow <code>eth_chainId</code>. With <code>privacyRequired: true</code>, passthrough and direct-debug drivers are rejected and <code>allowDirectDebugControl</code> must be false. An invalid configuration does not throw; <code>initialize</code>, <code>validateEndpoint</code> and <code>read</code> return <code>POLICY_DENIED</code>.</p>
          </Callout>
          <Table head={['Worker state', 'Means']} rows={[
            ['BOOTSTRAPPING', 'initialize() is running'],
            ['DEGRADED', 'Worker started, or an attempt failed; no current endpoint validation'],
            ['READY', 'Worker and required target checks passed. Not a claim that all traffic is anonymous.'],
            ['BLOCKED', 'Initial state, or initialization failed'],
            ['CLOSED', 'close() was called'],
          ]} />
        </Section>

        <Section id="contracts" title="Contracts and errors" lede="Every boundary is a versioned schema in @monolith/shared (schemaVersion 1).">
          <h3 className="doc-h3">Read methods</h3>
          <p className="doc-p">Exactly five read methods exist. Batches, notifications and write methods are excluded.</p>
          <ul className="chip-list mono">
            <li>eth_chainId</li><li>eth_blockNumber</li><li>eth_getBalance</li><li>eth_call</li><li>eth_getTransactionReceipt</li>
          </ul>
          <CodeBlock title="Result shape" code={`type SafeError = { code: ErrorCode; message: string; retryable: boolean };
type Result<T> = { ok: true; value: T } | { ok: false; error: SafeError };`} source="packages/shared/src/errors.ts" />
          <h3 className="doc-h3">Error codes</h3>
          <Table head={['Code', 'Returned when', 'Retry']} rows={[
            ['POLICY_DENIED', 'Invalid configuration, or the callsite or chain is not allowed', '—'],
            ['METHOD_DENIED', 'The method is not in the policy', '—'],
            ['TARGET_DENIED', 'An eth_call outside allowedCalls, or an unapproved origin', '—'],
            ['ENDPOINT_REJECTED', 'No current validation for the endpoint', '—'],
            ['CHAIN_MISMATCH', 'The protected probe returned a different chain', '—'],
            ['REGISTRY_UNTRUSTED', 'The publisher is not trusted', '—'],
            ['REGISTRY_EXPIRED', 'The candidate’s expiresAt has passed', '—'],
            ['WORKER_UNAVAILABLE', 'Worker not initialized, closed or replaced', 'Yes'],
            ['UPSTREAM_TIMEOUT', 'The read timed out', 'Yes'],
            ['UPSTREAM_UNAVAILABLE', 'The upstream failed', 'Yes'],
            ['RATE_LIMITED', '128 or more calls pending in the browser driver', 'Yes'],
            ['RPC_ERROR / RPC_RESPONSE_INVALID', 'A JSON-RPC error or a malformed envelope', '—'],
            ['INVALID_INPUT', 'The read failed its schema', '—'],
          ]} />
          <h3 className="doc-h3">Evidence labels</h3>
          <Table head={['Label', 'Means']} rows={[
            ['OBSERVED_LIVE', 'Measured on a real network in a recorded run'],
            ['SIMULATED', 'Fixture or software behaviour only'],
            ['UNTESTED', 'Not measured yet'],
            ['BLOCKED', 'The run stopped at a policy or availability check'],
          ]} />
        </Section>

        <Section id="registry" title="Registry trust" lede="Arkiv supplies endpoint candidates. A schema tag never authenticates its publisher.">
          <ul className="rule-list">
            <li><Icon name="key" size={18} /><span><strong>Trusted publisher.</strong> Creator and owner must both match the pinned addresses, and the entity must be read-only with no permissionless extension.</span></li>
            <li><Icon name="hash" size={18} /><span><strong>Provenance.</strong> Source revision, snapshot SHA-256 and licence hash must match the policy; <code>record_id</code> must equal the hash of the immutable record.</span></li>
            <li><Icon name="clock" size={18} /><span><strong>Expiry.</strong> Both the Arkiv block-height expiry and the publisher’s UTC content expiry must be in the future. Remembered metadata never serves a stale success.</span></li>
            <li><Icon name="external" size={18} /><span><strong>Safe URL.</strong> Public HTTPS only: no credentials, ports, IP literals, private hosts, placeholders or unusual paths, and the origin must be allowlisted.</span></li>
            <li><Icon name="node" size={18} /><span><strong>Chain ID.</strong> The registry does not probe chains. The transport’s protected <code>eth_chainId</code> probe in <code>validateEndpoint</code> does.</span></li>
          </ul>
          <Callout tone="exposed" title="The accepted registry rows have expired">
            <p>The accepted Arkiv records expired on 7 November 2026, between 13:42 and 13:44 UTC. Reproducing a live run needs a fresh import. See <Source path="docs/registry-setup.md" />.</p>
          </Callout>
        </Section>

        <Section id="observer" title="Observer API" lede="Read-only, with configured upstreams. It never accepts a proxy URL from a client.">
          <Table head={['Route', 'Purpose']} rows={[
            ['GET /api/health', 'Service status: configured or scaffold'],
            ['POST /api/observer/read?endpointId=<id>', 'One JSON-RPC 2.0 read to an operator-configured upstream'],
            ['GET /api/observer/runs/:runId', 'Run diagnostics; expired runs return EVIDENCE_EXPIRED'],
            ['POST /api/observer/runs', 'Allocate a lab run. Only when MONOLITH_OBSERVER_PUBLIC_LAB_RUNS=true'],
            ['GET /api/registry/chains?chainId=<decimal>', 'A validated RegistryManifest, or 410, 403, 429 or 503'],
          ]} />
          <ul className="doc-bullets">
            <li>Records only method, whether an address was present, source class, duration and success. No bodies, results, raw addresses or IP addresses; a five-minute TTL.</li>
            <li>Rejects private, loopback and link-local DNS answers, pins the destination and refuses redirects. Cookies, auth and forwarding headers are never sent upstream.</li>
            <li>Forwarding headers count only in <code>trusted-proxy</code> mode from exact peer IPs. 60 requests per minute, 16 concurrent.</li>
          </ul>
        </Section>

        <Section id="reports" title="Privacy reports" lede="Coverage always shows its denominator. Zero eligible reads is null, never 100 percent.">
          <CodeBlock language="json" title="PrivacyReport (shape)" code={`{
  "schemaVersion": 1,
  "runId": "…",
  "evidence": "OBSERVED_LIVE",
  "eligibleReads": 3,
  "protectedReads": 2,
  "successfulReads": 3,
  "protectedCoverage": 0.6667,
  "findings": [{ "code": "DIRECT_BYPASS", "callsite": "…", "message": "…" }],
  "scope": { "rpcOrigins": [], "scenarios": [], "bootstrapExclusions": [] }
}`} source="Field names from packages/shared/src/report.ts; values illustrative" />
          <p className="doc-p">A read earns protected credit only when every send went through <code>anon-nym</code> or <code>anon-tor</code> with a verified worker. Direct controls stay in the denominator and earn none. Finding codes include:</p>
          <ul className="chip-list mono">
            {['DIRECT_BYPASS', 'DIRECT_CONTROL', 'NOT_ANONYMIZED', 'WORKER_UNVERIFIED', 'UNDECLARED_READ', 'UNEXPLAINED_EGRESS', 'MISSING_TRACE', 'CAPTURE_INCOMPLETE', 'BLOCKED_READ', 'UNKNOWN_CALLSITE'].map((code) => <li key={code}>{code}</li>)}
          </ul>
        </Section>

        <Section id="harness" title="Agent harness" lede="Replay a direct-RPC regression and check that a candidate patch restores the private route.">
          <CodeBlock language="sh" title="1 · Collect the regression (exit 1 expected)" code={`node scripts/agent-harness/main.mjs run \\
  --mode simulated --browser-tools "$browser_tools" \\
  --output /tmp/mn029-original-run --allow-direct-regression`} source="docs/agent-harness.md · browser_tools is a temporary Playwright Chromium install" />
          <CodeBlock language="sh" title="2 · Run and verify an agent’s candidate patch" code={`node scripts/agent-harness/main.mjs run \\
  --mode simulated --browser-tools "$browser_tools" \\
  --output /tmp/mn029-candidate-run --allow-direct-regression \\
  --patch /tmp/mn029-agent-candidate.diff
node scripts/agent-harness/main.mjs verify --input /tmp/mn029-candidate-run`} />
          <p className="doc-p">Each run needs a new output directory outside the repository. In simulated mode the fixed RPC request is fulfilled locally and no public RPC is contacted. Exit codes: 0 pass, 1 fail, 2 invalid, 3 unavailable, 130 cancelled. <code>--mode live</code> currently returns BLOCKED; the live adapter is not implemented.</p>
        </Section>

        <Section id="wallet" title="Wallet connection" lede="The header’s wallet button is optional and separate from every lab read.">
          <ul className="doc-bullets">
            <li>Wallets are discovered through EIP-6963 announcements. Only inline <code>data:image</code> icons are shown, so listing wallets contacts nobody.</li>
            <li>The page asks the wallet for <code>eth_requestAccounts</code> and <code>eth_chainId</code> when you choose a wallet, and for <code>wallet_revokePermissions</code> when you disconnect. Nothing reconnects on reload.</li>
            <li>No chain state is read through the wallet. Lab reads keep their synthetic address and the privacy policy.</li>
            <li>Your wallet’s own RPC traffic is outside Monolith’s capture and protection.</li>
          </ul>
        </Section>

        <Section id="limits" title="What stays visible" lede="Say these out loud wherever you show a protected result.">
          <ul className="rule-list rule-list--exposed">
            <li><Icon name="node" size={18} /><span><strong>The payload.</strong> The RPC endpoint still reads the method and parameters, including any address. Every trace records <code>payloadVisibility: "rpc-endpoint-can-read"</code>.</span></li>
            <li><Icon name="mix" size={18} /><span><strong>Bootstrap.</strong> Starting a worker makes two non-anonymous specifier lookups. Run allocation, registry metadata and diagnostics are ordinary connections.</span></li>
            <li><Icon name="observer" size={18} /><span><strong>Coverage scope.</strong> Browser checks cover configured origins and ordinary Chromium HTTP traffic, not arbitrary third-party apps, extensions or WebRTC. The static scan is not a universal proof.</span></li>
            <li><Icon name="wallet" size={18} /><span><strong>Payments.</strong> Whitechain checkout is conditional and disabled. Onchain transfers are public; nothing here makes a payment anonymous.</span></li>
          </ul>
          <p className="doc-p">Specifications: <Source path="docs/architecture.md" /> · <Source path="docs/contracts.md" /> · <Source path="docs/cli.md" /> · <Source path="docs/observer.md" /> · <Source path="docs/evidence-policy.md" /></p>
        </Section>

        <footer className="docs__footer">
          <a className="text-link" href="./#demo">Open the live lab<Icon name="arrow-right" size={14} /></a>
          <a className="text-link" href={REPO}>Source on GitHub<Icon name="external" size={14} /></a>
        </footer>
      </main>
    </div>
  </>;
}
