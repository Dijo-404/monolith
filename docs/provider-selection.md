# Protected provider selection

MN-028 adds an isolated, network-free application helper for explicit provider
selection and bounded diagnostics. The current slice is exercised through
**SIMULATED** dependencies. It does not add dashboard controls, production
composition, importer changes, observer routes, live RPC calls or a deployment.
The existing live lab continues to use its existing selection path.

The full task remains subject to accepted evidence for
[MN-017](https://github.com/Dijo-404/monolith/issues/17),
[MN-023](https://github.com/Dijo-404/monolith/issues/36),
[MN-025](https://github.com/Dijo-404/monolith/issues/40),
[MN-027](https://github.com/Dijo-404/monolith/issues/55) and the planning
[registration PR](https://github.com/Dijo-404/monolith/pull/57).
The owner's exception authorizes only this offline slice; passing its tests
does not accept MN-028 or promote any dependent task.

## Application boundary

`createProviderController(options: ProviderOptions)` in
`apps/dashboard/src/features/providers/controller.ts` receives an operator's
chain ID, registry policy and endpoint bindings when constructed. These pins
must be captured independently of received manifests and widget input. A binding
contains `endpointId`, `rpcUrl` and `observerEndpointId`, identifying an approved
public registry candidate and its exact operator-owned route. A client URL or
an endpoint ID alone cannot authorize an upstream. Configuration permits one or
two bindings with distinct endpoint IDs, observer endpoint IDs and upstream
origins. Invalid binding, count or timeout configuration throws a fixed
`TypeError`; registry policy remains subject to admission validation.

The helper uses small injected ports:

| Port | Responsibility |
| --- | --- |
| `registry.load(chainId, signal)` | Load the current public manifest; respect cancellation and return typed failures. |
| `createTransport(binding)` | Return an isolated `MonolithTransport` capability for the exact approved binding. |
| `workerEpoch()` | Return a nonnegative safe integer identifying the current worker lifecycle. |
| `clock.now()` | Supply the explicit UTC clock used by admission and expiry checks. |

The factory is a composition responsibility. Before production use it must
construct a transport with required privacy, direct debug disabled, fail-closed
policy and `maxAttempts: 1`. It must bind the approved route independently of
untrusted request input and retain the existing target/selector policy for
`eth_call`. Each selection or diagnostic capability must have independent
readiness and cleanup; closing an old capability must not close a newer one or
the entire shared worker. Worker lifecycle changes or replacement must advance
the epoch. `invalidateWorker()` eagerly revokes all current capabilities while
the epoch guards also reject stale work at subsequent operation boundaries.
The offline helper neither constructs nor verifies a browser SDK worker.

This boundary preserves the public `MonolithTransport` facade from
[the shared contracts](contracts.md#transport-and-trace-boundary). It adds no
shared DTO, SDK adapter, ordinary HTTP RPC fallback or automatic failover.

## Explicit selection and useful reads

`select(endpointId)` is an explicit application action. A new action invalidates
the previous selection before asynchronous work begins. It initializes its
isolated transport, then loads the current manifest, applies the existing
`admitRegistryManifest` policy and finds the exact approved binding. Loading
after worker initialization avoids spending the manifest lease on startup.

Admission checks the expected chain, trusted creator/owner, immutable licensed
source provenance, approved origin, manifest age and both manifest/endpoint
expiry. A structurally valid HTTPS URL or `OBSERVED_LIVE` field does not establish
trust by itself. Received metadata cannot extend its own lease or add an
operator route. Recheck admission and the worker lifecycle around asynchronous
operations and before granting selection authority.

The admitted candidate must pass a fresh protected `validateEndpoint` chain-ID
probe through that capability. A previous provider's probe, an earlier manifest
revision or a previous worker lifecycle cannot authorize the new selection.
The resulting capability expires no later than either the admitted manifest or
its endpoint. A wrong-chain, untrusted, expired or forbidden candidate leaves
useful reads blocked. `getSelection()` returns a copy of the still-valid summary
or `null`; it does not grant the caller a mutable transport capability.

`read` accepts only `readId`, `method`, `params` and `callsite`. It derives chain,
endpoint and route authority from the current selection. Extra fields, including
URL, chain-ID or endpoint-ID overrides, must be rejected rather than used as a
second routing input. The transport still validates allowed methods, parameter
shape and callsite/target policy. Request payloads do not enter public state or
diagnostic exports.

An availability failure does not choose a replacement. The caller must request
another approved endpoint explicitly, which repeats manifest admission and the
protected chain probe. Retry permission in a typed error never authorizes direct
HTTP or a weaker trust policy. Invalid read input and a capacity rejection leave
an otherwise valid selection intact.

## Bounded diagnostics

`diagnose()` is a separate explicit action over at most two approved candidates,
sampled sequentially. Each candidate requires current admission and a protected
chain-ID probe before its public `eth_blockNumber` sample. Diagnostics do not
implicitly select a provider for useful application reads. A worker epoch change
or selection action invalidates the in-flight diagnostic run; a single returned
batch cannot silently combine samples from different worker lifecycles.

Record each sample's endpoint, chain-check outcome, tip, measured duration,
actual sample time and sanitized failure. A sample describes the observed path
at that time; it does not establish current uptime, anonymity, consensus or
future availability. Displaying an old sample must preserve its age. Do not add
background polling, wallet-specific requests, telemetry or an availability score.

Every chain-ID probe and tip read belongs in the eventual attempt inventory,
including failed, cancelled and superseded work. Protected diagnostic traffic
alone does not prove the useful Uniswap quote can complete.

## Cancellation, expiry and resource bounds

Switching provider, replacing or closing the worker, expiry and controller close
invalidate selection authority. Abort pending registry work and request transport
cleanup where supported; suppress late results at every application boundary.
A completion from an old action cannot update selection, overwrite a newer
sample or revive an expired capability. No new read may be dispatched through a
deselected capability.

Already dispatched traffic cannot be recalled. Its attempt remains reportable
even if its result is discarded. The shared transport port does not provide a
per-read abort signal, so result suppression and capability close must not be
described as proof that bytes were never sent.

The current helper enforces these fixed limits:

| Resource | Limit |
| --- | --- |
| Configured candidates / samples per diagnostic run | 2 |
| Timeout per asynchronous operation | 10,000 ms by default; `operationTimeoutMs` must be a safe integer from 1 through 60,000 ms |
| Retained sessions | 4 |
| Concurrent initialization/registry/probe/read operations per session | 2 |
| Explicit selection attempts per controller | 128 |
| Diagnostic runs per controller | 8 |
| Concurrent diagnostic runs / candidates sampled together | 1 / 1 |

These are operation deadlines, not a single total deadline for a multistep
selection or diagnostic run. Exceeding a lifetime budget requires a fresh
controller; it does not silently reset the budget or change provider.
A timed-out dependency that ignores cancellation retains
its resource slot until its actual work settles. A channel with unresolved
asynchronous cleanup also retains its session slot. Slots are reserved during
transport construction so reentrant adapter callbacks cannot exceed the cap.
Returning a timeout must not
permit repeated calls to create an unbounded collection of unresolved work.
Exhausted capacity fails closed with a sanitized error. Repeated close is safe;
cleanup failures do not restore readiness. `close()` synchronously revokes local
authority and requests channel cleanup; it does not return proof that remote
traffic or asynchronous driver cleanup has finished.

## Offline verification

The focused suite uses deterministic registry, clock, worker-lifecycle and
transport fakes. Its scenarios cover exact binding/admission, fresh protected
probes, request-override rejection, two-candidate diagnostic bounds, explicit
replacement, wrong-chain/untrusted/expired data, cancellation races, ignored
cancellation, late completion and cleanup. Fixture success remains SIMULATED,
including fixture manifests shaped like live registry DTOs.

Run the focused tests and workspace checks from the checkout with the pinned
Node/pnpm versions:

```sh
pnpm exec vitest run tests/e2e/provider-selection
pnpm check
git diff --check
```

With Node 24.22.2 and pnpm 12.18.0, the focused suite passed all 55 SIMULATED
tests. `pnpm check` passed lint, type checks, all 1,476 tests across 45 files and
workspace builds. The static RPC boundary scan passed with 42 files and zero
violations; its strict TypeScript check, documentation links and whitespace
checks also passed. Independent review exercised cancellation, cleanup and
reentrant lifecycle boundaries. Exact commands belong in the PR and issue
handoff. No browser worker, Arkiv write/query, controlled provider outage or
real quote run is represented as tested by this slice.

## Evidence required before live integration

The remaining task must supply two genuinely distinct approved same-chain
providers from actual trusted Arkiv records. The bounded opt-in import mode must
preserve the existing default, licensed provenance, expiry and journal/rerun
identity. Two endpoint aliases pointing at one upstream are one provider.
Importer, registry, observer and composition owners must coordinate exact paths
and route bindings before these interfaces are wired into the live lab.

For each provider, establish the operator's exact registry-to-observer/upstream
mapping without accepting arbitrary client URLs. Use a real verified worker for
all required-privacy probes, diagnostics and useful reads. Validate lifecycle
isolation and include the affected fixed-route adapter in the existing reviewed
adapter and independent egress checks; this offline slice changes neither.

Actual acceptance then requires a controlled A-unavailable case, explicit choice
of approved B and the same useful MN-027 Uniswap quote succeeding through B.
Independently observe routing with zero unexpected direct egress and account for
all logical reads, probes, diagnostic samples and attempts. Preserve failures
and original evidence; a dropdown, mocked outage or successful probe is
insufficient. Keep real observations separate from simulated tests and record
source/artifact hashes, times and remaining limits.

The RPC destination can still read JSON-RPC payloads, including public contract
and address parameters. Anonymity routing does not conceal public onchain data
or remove payload/timing correlation. Registry metadata contact and the approved
non-anonymous worker bootstrap are disclosed separately from protected app
reads. Public artifacts omit raw IPs, keys, private wallet/order data and stable
user identifiers. See [the architecture](architecture.md#evidence-and-privacy-regressions)
and [evidence contracts](contracts.md#verification-manifest) for the wider proof
boundary.
