# Agent privacy regression harness

MN-029 adds a repository-local workflow for an existing coding agent to inspect
one example application's privacy regression, submit a bounded candidate patch
and rerun the same privacy and functional scenario. The maintained example is
separate from the dashboard. The harness uses public Monolith package exports;
it does not add a CLI command or publish a package.

The owner authorized local implementation before MN-017, MN-023, MN-025 and
MN-026 acceptance. That permits this implementation and its review PR; it does
not accept those dependencies or establish the harness's live acceptance. Track
current acceptance on [MN-029](https://github.com/Dijo-404/monolith/issues/69).

## Trust boundary

The trusted controller owns the browser runner, fixed scenario, endpoint policy,
independent collector, useful-read oracle and original evidence. A candidate
patch can change only the declared example application file in a disposable
copy. The original example, runner and tests stay outside that copy. Before and
after hashes bind the source and trusted tools used in each run.

The supported repair changes a direct regression read to the provided private
read adapter. It cannot change the test, suppress observations, alter policy,
invent worker state, select a different endpoint or replace the useful-read
oracle. The controller accepts a narrowly defined patch; arbitrary project
patches and arbitrary hostile code are outside this first slice.

The agent runs separately and proposes a diff. The harness does not embed a
model SDK, invoke a paid model, grant an agent unrestricted tools or apply its
candidate to maintained source. A person reviews the candidate and evidence
before any maintained-source change or PR is applied.

## Local setup and commands

Use Node **24.22.2** and pnpm **12.18.0**, then install and build the pinned
workspace. Install the browser tools in a separate temporary directory; do not
add them to the workspace manifest or lockfile.

```sh
pnpm install --frozen-lockfile
pnpm build
browser_tools=$(mktemp -d /tmp/monolith-agent-browser.XXXXXX)
npm install --prefix "$browser_tools" --no-fund playwright@1.65.0
node "$browser_tools/node_modules/playwright/cli.js" install chromium
```

Each command below requires a **new**, nonexistent output directory outside the
repository. Keep the output from earlier observations. The explicit
`--allow-direct-regression` flag authorizes the fixed synthetic direct negative
control; it does not enable a fallback on ordinary reads. In simulated mode,
Chromium's fixed RPC request is intercepted and fulfilled locally. No public
RPC or backend is contacted.

First collect the regression. Exit **1** is expected because the useful read
works while the independent collector detects its direct bypass:

```sh
node scripts/agent-harness/main.mjs run \
  --mode simulated --browser-tools "$browser_tools" \
  --output /tmp/mn029-original-run --allow-direct-regression
```

Give an existing coding agent the vetted `DIRECT_BYPASS` diagnostic from
`result.json`, the original example source, this document and the patch rules
below. Ask it to return a unified diff as `/tmp/mn029-agent-candidate.diff`.
The agent's invocation is an operator choice; the harness neither starts a
model nor supplies credentials. Record the actual agent/tool identity and
retain its original candidate separately when conducting the genuine agent
trial. Do not substitute the reference repair fixture for that trial.

Run the same original regression and then the candidate:

```sh
node scripts/agent-harness/main.mjs run \
  --mode simulated --browser-tools "$browser_tools" \
  --output /tmp/mn029-candidate-run --allow-direct-regression \
  --patch /tmp/mn029-agent-candidate.diff
node scripts/agent-harness/main.mjs verify --input /tmp/mn029-candidate-run
```

Exercise an unavailable-worker state in the **simulated adapter**. Exit
**3** is expected; there are no sent ordinary fallback requests:

```sh
node scripts/agent-harness/main.mjs run \
  --mode simulated --browser-tools "$browser_tools" \
  --output /tmp/mn029-worker-blocked --allow-direct-regression \
  --worker-unavailable
```

`--mode live` currently returns `BLOCKED` / execution unavailable before any
provider contact. The real worker/observer adapter and genuine external-agent
live trial remain unimplemented acceptance work. There is no live-to-simulated
downgrade.

## Supported patch

Only `examples/agent-harness/app.mjs` can change. The exact resulting source
must equal the reviewed original after this one replacement:

```diff
-  return regressionRead();
+  return privateRead();
```

The controller checks a single unified hunk against exact original context.
It accepts ordinary `a/` and `b/` file headers and an optional matching Git
header/index line. It rejects new/deleted/renamed files, additional files,
traversal or absolute paths, symlinks, NUL/CRLF input, stale context, malformed
hunk counts, oversized patches and any other resulting source. It never shells
out to `git apply`. The fixed example is original Monolith MIT code; its
[license](../examples/agent-harness/LICENSE) accompanies the source.

The runner, collector, public package code/builds, CLI, policy, tests, fixture
inventory, lockfile and this document are included in trusted source bindings.
A changed file, added file or changed disposable source invalidates the next
run. Pause source/build editing while recording a run. The temporary copy is
removed after success, failure or cooperative cancellation.

## JSON and exit codes

`run` writes one schema-version-1 JSON result to stdout. Diagnostics use fixed
codes and reviewed source mappings. Unknown arguments, duplicate flags and
invalid input produce sanitized JSON rather than echoing caller values.

| Exit | Status | Meaning |
| --- | --- | --- |
| `0` | `pass` | The original bypass was detected, and the candidate passed the unchanged privacy and functional gates. |
| `1` | `fail` | Acceptance failed, including a detected original with no candidate, missing useful reads or a privacy regression. |
| `2` | `invalid` | Invalid options/patch/source/capture or changed trusted bindings. |
| `3` | `unavailable` | Required execution/CLI unavailable, worker blocked, timeout or cleanup failure. |
| `130` | `cancelled` | SIGINT/SIGTERM or the controller's cancellation signal stopped the run. |

`verify` returns exit `0` with `status: "verified"` when artifact membership
and hashes agree; it sets `evidenceAuthentication: false`. Hash consistency
does not authenticate an author, an anonymity network or caller-supplied JSON.
Invalid or modified bundles return exit `2`.

The controller permits at most two browser scenarios, caps execution at four
minutes and gives cooperative cleanup five seconds after cancellation/timeout.
The browser scenario has its own twenty-second deadline. Candidate patches are
capped at 8 KiB; public JSON artifacts and CLI output at 1 MiB. These bounds
are enforced in trusted code. A runner that cannot confirm resource closure
returns unavailable and must not be reported as a successful cancellation.

## Output and independent gate

The new output directory contains `baseline.json`, optional `candidate.json`
and `candidate.diff`, `source-bindings.json`, `result.json` and `manifest.json`.
The manifest binds each actual artifact's bytes. The result records UTC
timestamps, Node/collector/CLI bindings, original/candidate source hashes,
read inventories, gate results and workspace/browser/server cleanup outcomes.
Read-only file permissions discourage accidental edits; the hash check remains
necessary and does not create a hostile-code sandbox.

Both scenarios invoke the existing public `monolith check --input … --json`
command as a child process. The baseline must complete a protected witness
balance read and a useful direct application balance read with independently
captured egress. The candidate must retain both useful balance reads and the
same protected chain-ID probe, have complete capture, complete the useful reads,
show zero unexpected direct requests
and pass the CLI check. A collector's boolean cannot replace this check. The
fixture's fake worker may have valid software metadata; its label remains
`SIMULATED` throughout.

## Evidence meaning

| Label | Meaning in this workflow |
| --- | --- |
| `SIMULATED` | Software regression run with controlled browser/network/worker responses. Actual Chromium execution alone does not prove an anonymizing worker. |
| `OBSERVED_LIVE` | A successful actual run with the required real verified worker, independent capture and useful read. Historical artifacts never become fresh configuration. |
| `BLOCKED` | Required execution or a protected read could not complete. There is no direct, Node or passthrough fallback. |
| `UNTESTED` | An operation was not executed or lacks the required evidence. |

A passing repair requires both a useful result and the unchanged privacy gate.
An empty read inventory, missing capture, blocked-all implementation or a
candidate's own success string cannot pass. The injected direct control remains
visible in the read/attempt inventory even when it emits no transport trace.
Worker-unavailable execution must block without an ordinary RPC request.

The destination RPC can still read JSON-RPC contents. Public metadata requests
and worker bootstrap are ordinary contacts; bootstrap is disclosed separately
and never credited as a protected application read. Browser interception covers
the declared ordinary HTTP RPC egress boundary, not all browser networking or
the internals of an anonymity network. The workflow makes no claim about
payments, sponsor eligibility or arbitrary applications.

## Review and acceptance

Retain the original failing observation, exact candidate diff and resulting
rerun together. Review the pinned example provenance/license, source and patch
hashes, fixed policy/tool bindings, complete read and attempt inventory,
capture correlation, useful-read result, cleanup outcome and evidence label.
Do not export raw IPs, credentials, private wallet/order payloads, source paths
containing private data or stable user identifiers.

A deterministic example repair or fixture demonstrates software behavior only.
The acceptance trial must separately identify an external coding agent's actual
candidate, then show the unchanged useful-read and privacy scenario passing.
Current code or a saved `SIMULATED` result does not establish that trial.

## Verification

Run the focused boundary suite with the workspace-pinned tools, then the
normal workspace check:

```sh
pnpm exec vitest run tests/e2e/agent-harness/runner.test.mjs
pnpm check
git diff --check
```

These checks cover policy/source tampering, forbidden patches and symlinks,
independently detected bypass, useful repair, incomplete/empty observations,
worker-unavailable blocking, timeout/cancellation, cleanup, evidence mutation,
fixed scenario inventory and the actual public CLI gate. They use controlled
measurements and do not establish live acceptance. The explicitly invoked
Chromium commands above are separate from `pnpm check`.
