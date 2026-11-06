# MN-009 paired observer proof

**Status: BLOCKED, 6 November 2026.** The runner and offline checks are implemented;
the real paired-source acceptance gate has not passed. The operator has no VPS,
domain or existing verified observer deployment. The available Quick Tunnel
actually sends a `CF-Worker` marker, so its source path is refused rather than
treated as verified.

The runner attempts the same fixed synthetic `eth_getBalance` request through an
explicit direct control and the real Nym worker, using the public
`MonolithTransport` implementation. A protected `eth_chainId` probe must return
`0x1` before the protected balance read. The observer independently reports
coarse source classes and address presence. A worker label, matching schema,
successful mock, or caller forwarding header cannot pass acceptance.

The actual blocked observations are linked below.
The temporary service is stopped after each attempt; its hostname is a recorded
deployment reference rather than an available hosted demo.

## Reproduce

Use the repository's Node **24.22.2** and pnpm **12.18.0**. First build the public
exports and existing observer process:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm exec tsc -p tests/privacy/live-observer/tsconfig.json
```

Browser tooling stays outside the workspace and does not change its manifests:

```sh
mn009_tools=$(mktemp -d)
npm install --prefix "$mn009_tools" --no-fund --save-exact playwright@1.65.0 @noble/hashes@1.8.0
"$mn009_tools/node_modules/.bin/playwright" install chromium
```

Download the Linux amd64 `cloudflared` **2026.10.7** asset from its
[official release](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7).
Its SHA-256 must be
`1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872`.
Keep the executable outside the repository. The runner checks that digest and
the browser-tool/SDK versions before starting:

```sh
MONOLITH_BROWSER_TOOLS="$mn009_tools" node scripts/compare-rpc-routes.ts \
  --cloudflared /absolute/path/to/cloudflared-2026.10.7 \
  --output /absolute/path/to/a-new-comparison.json
```

The output path must be new: earlier attempts cannot be overwritten. Ordinary
`pnpm check` runs deterministic tests, without a tunnel or external worker. The
explicit command above starts temporary external infrastructure and live reads;
it returns a failing exit status for blocked or inconclusive acceptance.

## Deployment and source trust

The runner starts one temporary
[Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
to an edge bound only to `127.0.0.1`. It supplies an explicit empty configuration
to prevent ambient ingress rules from changing the target, disables updates and
management diagnostics, and binds metrics to loopback. Raw child stdout/stderr
is discarded through a bounded projector that extracts only the generated public
hostname. No raw tunnel logs, browser logs, request captures, or source-address
logs are written.

The edge accepts the tunnel's rewritten Host only when it matches a fresh,
unguessable private capability generated for this process. That capability is
never exported. This trusts the local single-user host: another process with
access to process arguments is outside the isolation guarantee.

Cloudflare documents `CF-Connecting-IP` as the connection-source field and can
append caller values to `X-Forwarded-For`. The edge therefore discards caller
forwarding fields, requires exactly one valid Cloudflare connection-source
field on its authenticated local hop, rejects Worker-subrequest markers and the
documented cross-zone Worker address, and creates one replacement
`X-Forwarded-For`. The existing observer trusts only the loopback edge. An unknown
or ambiguous source cannot become a successful comparison.
[Header semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

Cloudflare is an additional trusted intermediary which can see connection and
payload information. Its platform-managed retention and access-log controls were
not verified for this accountless temporary tunnel. Local log suppression does
not imply suppression of Cloudflare-managed records.

The observer process uses the existing approved endpoint map: only
`mn009_ethereum` routes to `https://ethereum.publicnode.com`. The edge permits
only observer read, run-diagnostic and health paths, caps bytes/concurrency/time,
and cannot accept caller-selected proxy URLs. The observer retains its own
read-only policy, DNS/public-address/TLS checks and redirect prohibition.

## Execution and correlation

1. Generate fresh synthetic run, baseline and direct-control UUIDs. Start the
   temporary edge/tunnel and wait up to three minutes for the public hostname's
   native DNS publication. This retries only deployment readiness, never RPCs.
2. Warm the real verified Nym worker, capturing actual bundle-response bytes and
   its public specifier metadata. Its two mainnet specifier calls remain visible
   as non-anonymous `direct-bootstrap` traces.
3. Start a fresh observer process and register the five-minute run only after
   warmup. Its real upstream is configured by the operator, never by a request.
4. Send the reserved direct baseline. Send the same synthetic balance request
   again under the reserved control ID while injecting forged XFF, Forwarded,
   X-Real-IP and CF source values. The control also claims `protected` in its
   diagnostic case label. Both observations must still be `baseline` before any
   protected call proceeds.
5. Validate the candidate through the real worker, then issue the same balance
   request through `MonolithTransport`. Native browser HTTP to that destination
   is independently intercepted; only the two exact direct ID/payload/header
   tuples have one-send permission. A deliberate denied direct request first
   checks that the interceptor is active. Public coarse diagnostics are a
   separately disclosed ordinary HTTP contact.
6. Export diagnostics before expiry and require exactly one successful
   observation per issued wire ID, matching method and address presence. Reject
   missing, duplicate, unexpected, failed or conflicting observations; require
   real `different-from-baseline` classes for both protected calls. Preserve
   structurally valid inconclusive observations without live acceptance.
7. Close the worker/transport, verify zero remaining host frames, cleared worker
   metadata and denied post-close reads, then destroy the context and stop the
   observer, tunnel and edge.

The lab uses a fixed zero-address payload and `latest`; it never accepts an
inspected user's address. Values can change between blocks, so acceptance checks
matching request inputs and valid actual quantities rather than requiring
equal balance values. Public output includes only payload classification,
method, result quantities, synthetic IDs, coarse classes, durations, public
worker metadata and source/compiled/lockfile digests.

The test-owned driver binds one outstanding exchange directly to its emitted
trace; it does not search observations by method, timing or first matching row.
The exact wire response ID is checked before translating it to the transport's
internal ID. One attempt per operation keeps the issued inventory explicit.

## Browser composition boundary

The production package has sequential internal RPC IDs and no lab-run header
option. This task adds no production API or manifest changes. It composes public
`createMonolithTransport`, `createBrowserDriver` and `installBrowserHost` exports
inside the MN-009 test harness. The official SDK installs an instance-bound
`fetch`, so a test-owned subclass delegates the original constructor and wraps
that actual instance method. The scoped Vite alias resolves the subclass's base
back to the installed official public SDK entry. It preserves the original
worker's readiness, integrity verification, receiver binding, close, and
`maxRedirects: 0` configuration.

Only the exact configured observer URL and fixed synthetic payloads can receive
the immutable run header. The wrapper changes no worker bytes, bootstrap calls,
route choice, response result or integrity metadata. It has no direct fallback.
This is explicit lab composition; it does not claim that an unmodified ordinary
application already sends observer diagnostics.

## Validation and remaining limits

Actual observations, all recorded on 6 November 2026:

| Artifact | Observed result |
| --- | --- |
| [Attempt 1](../../tests/privacy/live-observer/observed-blocked-attempt1-2026-11-06.json) | Real worker warmup and matching bundle bytes; first direct baseline failed. No control/protected dispatch. This historical attempt predates the instance-bound SDK-header correction. |
| [Attempt 2](../../tests/privacy/live-observer/observed-blocked-attempt2-2026-11-06.json) | Real worker warmup; public health failed before paired dispatch. Its artifact records `LIVE_RUN_FAILED`; a separate native lookup/fetch diagnostic confirmed `ENOTFOUND`. |
| [Attempt 3](../../tests/privacy/live-observer/observed-blocked-attempt3-2026-11-06.json) | Native DNS became ready after 60,556 ms; public health and direct baseline returned 403. Edge forwarded zero requests. Real bundle response contained 18,283,862 bytes and matched hash `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`. No protected dispatch. |
| [Edge-only diagnosis](../../tests/privacy/live-observer/observed-blocked-edge-2026-11-06.json) | Actual public HTTP/private-hop authentication succeeded; source guard rejected `CF-Worker` plus `CF-EW-Via`. Fixed marker counters were 1/1, no sentinel/Worker-loop match, zero forwarding. The local health target was SIMULATED; this was not an RPC/worker test. |

The three original run artifacts are preserved byte for byte. The edge-only
record is an explicitly scoped export of the actual diagnostic observation,
with its original observation hash. Completed run processes were stopped.
Historical source digests describe their recorded attempts; later diagnostics
and fail-fast handling intentionally change the current runner/edge digests.
No historical artifact claims to certify those subsequent changes.

The newest runner fails at denied public health before sending a redundant
baseline, records fixed denial counters, and retains real warmup metadata/bytes
separately from the overall blocked result. `CF-EW-Via` alone is a loop counter,
not a documented source-authentication guarantee. Here the separate
`CF-Worker` marker was actually present; the guard remains conservative and has
not been relaxed to obtain a passing result.

Unblock requirement: an operator-controlled HTTPS observer with verified direct
TLS/socket source or an explicitly authenticated, reviewed edge whose source
transformation is established. Reuse this runner's exact inventory, baseline,
forgery controls, real-worker capture and redaction rules when integrating that
deployment. That integration and an actual successful pair remain unfinished;
this task must not be accepted or marked done from its draft PR or unit tests.

The unit suite covers edge authentication, forged/duplicate forwarding fields,
Worker ambiguity, URL/method/resource limits, exact wire-ID restoration,
instance-bound SDK delegation, issued-ID/trace/diagnostic correlation, expiry,
inconclusive topology and redaction. These tests use **SIMULATED** fixtures and
cannot earn live acceptance.

Final combined validation after integrating accepted `main` at `0d03288`:
Node 24.22.2/pnpm 12.18.0 frozen install and `pnpm check` passed **862 tests in
22 files**, lint, package/public-consumer typechecks and builds. The additional
`pnpm exec tsc -p tests/privacy/live-observer/tsconfig.json` passed. This task adds
139 simulated cases: 40 edge, 70 proof-validation and 29 browser-binding tests.
Markdown links/fences/whitespace, JSON syntax, forbidden-field checks and exact
historical artifact byte comparisons passed. Independent review accepted this
as a **draft handoff only**, with the deployment/live gate still unpassed.

The actual bundle response hash must match the public worker hash. Source and
compiled observer/transport digests plus the lockfile bind the recorded run to
its tested implementation. Independent browser interception covers ordinary
HTTP to the configured observer, excluding WebRTC/KPS used by the worker and
unrelated page, wallet, extension or third-party traffic. This task establishes
neither application-wide coverage, Arkiv product use, payment settlement nor
sponsor eligibility. The observer and ultimate RPC destination still see the
JSON-RPC method and address payload.
