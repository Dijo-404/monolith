# Core leak, repair and rerun walkthrough

Monolith detects a direct RPC read that bypasses the required transport, shows a
bounded sandbox repair, and reruns the useful operation. This walkthrough requires
no payment contract, relayer, wallet key or Whitechain integration.

The [sandbox presenter](../apps/dashboard/src/features/sandbox/SandboxWalkthrough.tsx)
is mounted in the live dashboard through the existing controller. Normal MN-012
and MN-014 dependency acceptance preceded this integration; the earlier offline
checkpoint and its recorded software evidence remain explicitly SIMULATED.
Passing offline tests does not accept the mounted live walkthrough or core release.

The coordinated integration uses the existing controller's current snapshot and
its `run` method, without introducing another controller or network adapter:

```tsx
<SandboxWalkthrough state={state} onRun={(mode) => { void controller.run(mode); }} />
```

Its repair action remains disabled until a completed measured failing report is
retained. The presenter shows a repaired outcome only after a distinct completed
report also passes the useful-read and independent-correlation checks.

## Run the offline software regression

Use Node **24.22.2** and pnpm **12.18.0**, as pinned by
[`.node-version`](../.node-version) and [`package.json`](../package.json). From the
repository root, install the pinned workspace and run its checks:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec tsx scripts/check-rpc-egress.ts
pnpm exec tsc -p tests/privacy/egress/tsconfig.json
```

Use an isolated Playwright **1.65.0** installation for the browser runner. The path
below names the existing local tools directory; another machine must supply its own
directory containing that version and a compatible Chromium installation. Dependency
installation is setup and can use the network; the regression intercepts fixture
RPC HTTP and makes no external RPC request.

Choose a new output directory for each run:

```sh
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
  node tests/e2e/break-fix/run.mjs --output /tmp/monolith-break-fix-new-run
```

The [runner](../tests/e2e/break-fix/run.mjs) executes the existing eight-case
[independent Chromium regression](../tests/e2e/privacy/run.mjs), then requires a
useful leaking read, its useful repaired rerun, and fail-closed outage behavior.
It creates a new evidence directory exclusively; an existing directory is refused
so an earlier observation cannot be overwritten. Inspect these generated files:

| File | What to review |
| --- | --- |
| `capture-matrix.json` | Actual browser capture of the controlled fixture, individual policy outcomes, useful-read results, source bindings and capture limits |
| `repair.diff` | The supported fixture change from the leaking receipt call to the MonolithTransport read path; no arbitrary source rewrite is applied |
| `summary.json` | The runner's evaluated failure/repair/outage assertions and references to the retained capture and diff |

All three files describe **SIMULATED software regression evidence**. Chromium
executes the fixture and CDP independently captures its ordinary HTTP requests, but
the fixture driver and RPC results are test-controlled. No actual anonymity worker,
live chain result, Arkiv query or payment is proved by this run. Preserve a failed
or incomplete output as such and start a different output directory when retrying.

### Read the failure, then the repair

The offline scenario uses seed **`mn012-regression-001`**. Its useful operations are
a synthetic balance read and transaction-receipt lookup, plus the eligible protected
chain-ID probe. The receipt's `null` result is a valid completed lookup in this
fixture; it is not proof that a transaction settled.

1. Find the `leak` case. The balance and receipt operations complete, while the
   receipt widget makes a direct `eth_getTransactionReceipt` request outside
   MonolithTransport. The independent collector identifies the request even though
   it has no transport trace. Functional acceptance passes; the privacy gate fails.
2. Open `repair.diff`. It shows the fixed fixture route using the existing
   MonolithTransport API for that same receipt intent. This is a supported sandbox
   fixture change, not an edit to an arbitrary application or an automatic repair
   service.
3. Find the `fixed` case. The same seed and useful operations run again. The
   independently measured capture must contain zero unexpected direct requests,
   useful operations must complete, and all three eligible reads receive protected
   credit **within the simulated fixture**. A changed badge alone cannot satisfy
   these assertions.
4. Find `outage` and `block-all`. No direct fallback is permitted. Blocked useful
   work fails functional acceptance and the complete gate, even when the privacy
   check finds no direct leak.

The matrix also checks protected retries, unexplained traffic, a missing trace and
an explicit direct control. Unexplained traffic remains in the denominator; retries
do not invent additional logical reads. The explicit direct control is counted
with zero protected credit. The matrix runner succeeds only when every case meets
its own expected result; deliberately failing policy cases remain failures in the
capture. See the [MN-012 evidence explanation](../tests/e2e/privacy/README.md) and
[capture policy](../tests/privacy/egress/README.md) for the exact interception scope.

The unexplained-traffic negative case can retain a conservative
`NETWORK_COMPLETION_MISSING` failure when its unawaited request is interrupted by
context cleanup. That observation stays failed. The required leak, fixed and outage
observations must have complete captures before this walkthrough passes.

For separate failure and repaired commands, the existing runner remains available:

```sh
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
  node tests/e2e/privacy/run.mjs --case leak --output /tmp/monolith-new-leak.json
```

That command is expected to exit **1** because it finds the deliberate privacy
regression. Run the repaired case with another new file:

```sh
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
  node tests/e2e/privacy/run.mjs --case fixed --output /tmp/monolith-new-fixed.json
```

The repaired command is expected to exit **0** only after useful operations and the
privacy gate pass. These are reproduction expectations, not a claim that commands
listed in this document have passed in the reader's environment.

## Walk through the configured live lab

The [live dashboard](../apps/dashboard/src/features/lab/LiveLabApp.tsx) exposes the
four-step guide and a dedicated **Break, repair and rerun** card. Use **Run leaky
fixture** and then **Run repaired fixture** in that card to exercise the mounted
presenter. The repair action starts disabled and becomes available only after a
measured failing report is retained. The card shows the bounded route diff, the
earlier failure and the distinct current report; it never edits arbitrary source.

Follow this script only in a deployment prepared by the MN-014/MN-025/MN-023
owners; these instructions do not start, replace or publish a service. A genuine
deployed presenter-button run passed at the named clean assembled source. Its
[original capture and route-only repair evidence](../tests/e2e/break-fix/observed-live/2026-11-07/README.md)
retain the actual source, runtime, report IDs and limits. Normal owner task
acceptance and the separate core release remain tracked on issues 16 and 17. The
[live acceptance runner and setup](../tests/e2e/lab-ui/README.md)
document how the owning sessions bind an actual capture to reviewed source and
compiled assets.

The live scenario uses seed **`monolith-zero-address-balance-v1`**, not the offline
seed. Its fixed public intent is an OP Mainnet chain-10 `eth_getBalance` request for
the synthetic zero address at `latest`. A balance can change between calls; the
same intent does not require identical returned balances. Fresh allocations, wire
IDs and public report IDs are required for each action and must not reuse an expired
run's identity.

| Action | What to demonstrate | Evidence required |
| --- | --- | --- |
| **Run private read** | Start the verified Nym worker, admit the current trusted Arkiv manifest, perform the protected chain-ID probe, then complete the useful balance read | Current worker verification, admitted registry selection and exact observed probe/read inventory. This action alone does not establish a source comparison |
| **Compare direct and private** | Explicitly consent to one direct synthetic control, then repeat the protected probe and useful read | Exactly matched observer receipts establish the direct baseline and a different source for protected traffic; the control remains in the denominator |
| **Send the leaky widget** | Repeat the fixed useful intent and deliberately send its widget read directly outside the transport | The independent receipt identifies the extra direct widget request without a transport trace; the failure report retains the common live seed |
| **Reroute widget and rerun** | Change only the sandbox fixture route and rerun the same useful intent through the worker in a fresh run | A new independently correlated report shows the repaired widget succeeds, no unexpected direct egress remains, and the earlier failure stays available |

The live [scenario descriptor](../apps/dashboard/src/features/lab/scenario.ts)
exports a bounded JSON Patch whose only replacement is:

```diff
- "route": "direct-debug"
+ "route": "anon-nym"
```

Its first operation tests the complete original fixture descriptor, then its
`replace` operation changes `/route`. The before/after descriptors preserve the
live seed, method, chain, synthetic address, block tag, callsite and required privacy
policy. The [controller](../apps/dashboard/src/features/lab/live-controller.ts)
exports those descriptors and retains `previousLeakReport` alongside the repaired
report. The presenter shows this fixture change; it cannot edit production source.

With an exact successful inventory, the live leak and repair scenarios each contain
four eligible logical reads. The leak has two protected reads; the repair has three.
The separately requested direct baseline stays unprotected, so a repaired run's
expected coverage is **3/4**, not 100%. These counts are assertions to verify against
the actual capture, never values to type into a report. Missing receipts, unknown
source topology, unexpected traffic or failed useful reads cannot produce a passing
complete walkthrough.

Every action must use fresh admitted metadata and the actual configured operator
route. Expired/untrusted registry data, a wrong-chain probe, unavailable worker,
invalid observer allocation or inconclusive source comparison blocks the applicable
acceptance. A timeout, retry or SDK convenience method must never select ordinary
HTTP as a protected-read fallback. Preserve blocked observations and obtain a fresh
run after the owning session resolves the cause; do not extend leases or relabel
fixtures as live evidence.

## Narration and evidence limits

Say: “The endpoint still sees the RPC method and synthetic address. Monolith checks
the transport path and catches this widget's accidental direct read. The repair
changes one supported sandbox route, and the same useful read must pass again.”

Worker bootstrap lookups are **non-anonymous**. Live public run allocation, registry
metadata and diagnostic requests are also ordinary contacts, disclosed separately
from eligible app RPC reads. Direct comparisons require an explicit user action and
receive no protected credit. Passthrough workers receive no anonymity credit.

Independent browser capture covers its declared application and known origins;
extensions, other wallets, unrelated pages and uninstrumented traffic remain outside
that scope. A source difference paired with the verified worker supports this
bounded observation; it does not prove general anonymity or hide payloads, timing
correlation or public blockchain transfers.

Keep public exports free of raw source IPs, private keys, private wallet/order data
and stable user identifiers. Retain actual timestamps, source bindings, evidence
labels, bootstrap exclusions, useful-read denominators and earlier failures. Offline
artifacts stay labelled `SIMULATED`; a prior real capture is recorded evidence of its
timestamp, not present-day service health. Actual full live acceptance, publication
and the final evidence bundle remain with their tracked task owners and gates.
