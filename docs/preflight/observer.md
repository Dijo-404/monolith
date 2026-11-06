# MN-009 paired observer proof

**Current result: OBSERVED_LIVE, 6 November 2026.** The [localhost.run continuation](#localhostrun-continuation)
records a genuine verified-Nym chain probe and balance comparison with distinct
observed source classes, after accepted main `dbb1d7e`. The temporary service is
stopped; this is recorded evidence, not a durable deployed observer. Review and
owner acceptance remain separate from the observed result.

**Historical Cloudflare result: BLOCKED.** The original implementation and checks
below record the unavailable VPS/domain and Quick Tunnel path. That tunnel
actually sends a `CF-Worker` marker and remains refused. Its guard and all earlier
observation files are unchanged; the successful continuation uses a separate
reviewed connection-source adapter.

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

## localhost.run continuation

The [final actual observation](../../tests/privacy/live-observer/observed-localhost-run-final-2026-11-06.json)
ran from `2026-11-06T16:14:32.271Z` to `2026-11-06T16:15:16.856Z` on Node
24.22.2 and the pinned tools above, after integrating accepted main `dbb1d7e`
(PRs #35/#37). Exit **0**, evidence `OBSERVED_LIVE`; artifact SHA-256:
`d31ca69e8a334f0190fb424c4a7f873f82e1f0cc8d3d426eab0ac930b8c285b0`.

| Actual issued operation | Genuine result | Observed source class |
| --- | --- | --- |
| Direct synthetic balance baseline | `0x2ff70ee5de97c9ab42b` | `baseline` |
| Same direct read with forged forwarding headers/protected case label | `0x2ff70ee5de97c9ab42b` | `baseline` |
| Nym protected chain probe | `0x1` | `different-from-baseline` |
| Same balance read through Nym | `0x2ff70ee5de97c9ab42b` | `different-from-baseline` |

Exactly four wire IDs/read-attempt bindings/observer observations and six traces
agree. Actual 18,283,862-byte resolver response bytes matched Nym hash
`0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`.
The two specifier bootstrap calls remain disclosed as non-anonymous. Independent
direct-interception self-check passed; exactly two direct comparison sends were
permitted and **zero ordinary protected-target HTTP requests** were observed.
Both worker responses were HTTP 200. Cleanup observed CLOSED, no host frames,
cleared metadata, denied post-close reads, context destruction and stopped
observer/tunnel/edge processes. The [first successful continuation](../../tests/privacy/live-observer/observed-localhost-run-attempt6-2026-11-06.json)
is preserved separately; the final observation is a fresh post-integration run.

### Connection-source trust

The new [PROXYv2 adapter](../../tests/privacy/live-observer/proxy-edge.mjs) accepts
one bounded binary TCP source frame per connection from an SSH reverse tunnel.
It rejects LOCAL/unknown/datagram/UNIX frames, invalid lengths, zero ports,
incomplete prefix deadlines and HTTP without a frame. Source identity attaches
to the actual socket in private process memory; HTTP forwarding headers never
supply it. Existing path/method/byte/concurrency/time and observer JSON-RPC
validation remain enforced. Caller forwarding/Worker fields are discarded.
The existing private edge's internal `CF-Connecting-IP` slot is a compatibility
bridge, **not Cloudflare-provided evidence**. Original Cloudflare guards remain
unchanged.

SSH uses only the explicitly supplied known-hosts pin, disables global known-hosts
files and ignores ambient configuration/user identities. The [actual provider-help
and public-key observation](../../tests/privacy/live-observer/observed-localhost-run-provider-help-2026-11-06.json)
records public server fingerprint
`SHA256:pG6qrBxubYfWa1Zadu/V0NUgjEDiBds/7e2xzte/QNM` plus the pin-file hash.
Initial enrollment used **trust on first use**, not an independently certified
fingerprint. Later commands reject a different enrolled key.

**A trusted single-user host is required.** Loopback does not authenticate the
SSH process against other local processes; another local process can construct
a frame. The intended provider hop is the pinned encrypted SSH connection.
localhost.run supplies public TLS termination and is trusted to report the real
connection source. It can observe sources and payloads; its platform retention
controls were not verified. Owned raw process/browser logs are discarded. Raw
source addresses remain only in socket/run memory, expire at teardown/TTL, and
never appear in artifacts.

### Explicit single-run diagnostic adaptation

Actual attempts observed the installed verified Nym/harness stack omitting
content-type/run/case headers from a read POST. Its downstream cause remains
unconfirmed. Changing a `Headers` instance to a record did not solve it; that
hypothesis is not represented as a fix.

For this **single operator-owned ephemeral run**, the adapter receives the
already registered synthetic run ID. Only on the exact configured POST/read
path, it fills a missing `application/json` content type and a missing fixed
run header. Duplicate/conflicting supplied values are denied. It adds no case
or route label and changes no actual RPC body, method, parameters, wire ID,
result or connection source. Baseline election still requires the reserved
wire ID. Unexpected public calls stay in diagnostics and make exact-inventory
acceptance fail. The final run records **two content-type fills, two run-header
fills, zero conflicts**. This is diagnostic composition, never origin evidence.

This bridge is not a multi-visitor allocation API: the startup run expires after
five minutes. A public product needs fresh bounded runs separately. A recorded
pair establishes neither application-wide protection nor durable hosting.

### Reproduce

Use the pinned workspace/browser tooling above. Create a dedicated known-hosts
file and review its public fingerprint; first retrieval alone is trust on first
use:

```sh
mn009_known_hosts=$(mktemp)
ssh-keyscan -t ed25519 localhost.run 2>/dev/null > "$mn009_known_hosts"
ssh-keygen -lf "$mn009_known_hosts"

MONOLITH_BROWSER_TOOLS=/absolute/path/to/pinned-browser-tools \
  node scripts/compare-rpc-routes.ts --provider localhost-run \
  --ssh /usr/sbin/ssh --ssh-known-hosts "$mn009_known_hosts" \
  --output /absolute/path/to/a-new-comparison.json
```

The runner uses `nokey@localhost.run -- --output json --proxy-protocol-v2` and
accepts only the bounded accepted-registration event as its public origin,
never the admin/marketing URL from a banner. Actual server `--help` exposes
`--proxy-protocol-v2`; the [website reference](https://localhost.run/docs/cli)
instead advertised rejected `--inject-proxy-protocol-header`/version options.
The observed help-command exit 255 is recorded, not misreported as an
authentication failure or successful worker test. The [provider FAQ](https://localhost.run/docs/faq)
warns free domains change after hours. Keep the host/SSH process online for an
ephemeral demo; this acceptance runner deliberately stops its URL afterward.

### Preserved failures and validation

| Observation | Actual outcome |
| --- | --- |
| [Attempt 1](../../tests/privacy/live-observer/observed-localhost-run-attempt1-2026-11-06.json) | Direct controls worked; protected read failed. Coarse counters alone did not identify which request was denied. |
| [Attempt 2](../../tests/privacy/live-observer/observed-localhost-run-attempt2-2026-11-06.json) | Direct controls worked; no protected request reached the edge. |
| [Attempt 3](../../tests/privacy/live-observer/observed-localhost-run-attempt3-2026-11-06.json) | Actual protected HTTP 403; read POST arrived without content-type/run/case headers. |
| [Attempt 4](../../tests/privacy/live-observer/observed-localhost-run-attempt4-2026-11-06.json) | Worker rejected without HTTP response; no protected edge request. |
| [Attempt 5](../../tests/privacy/live-observer/observed-localhost-run-attempt5-2026-11-06.json) | Plain-record header experiment still returned 403 without those headers. |
| [Post-main 1](../../tests/privacy/live-observer/observed-localhost-run-post-main-attempt1-2026-11-06.json) | Public health 502, zero PROXY connections, no paired dispatch. |
| [Post-main 2](../../tests/privacy/live-observer/observed-localhost-run-post-main-attempt2-2026-11-06.json) | Protected HTTP 502 without a protected edge connection, after successful direct controls. |

These preserve network/provider reliability limits; later success does not erase
them. No direct fallback was introduced; original Cloudflare observations remain
byte-for-byte unchanged.

After main `dbb1d7e`, pinned `pnpm check` passed lint, package/public-consumer
types, **1,190 tests in 31 files**, and all production builds. Explicit
`pnpm exec tsc -p tests/privacy/live-observer/tsconfig.json` passed. The MN-009
suite has **164 SIMULATED cases** including actual loopback sockets, hostile and
duplicate headers, strict diagnostic normalization, unchanged body/source and
unexpected-call visibility. Independent review exercised eight further
adversarial socket/lifecycle cases and reviewed the bounded metadata bridge.
Offline tests alone do not prove anonymity.

All 68 final source/compiled/entrypoint/lockfile hashes, installed public SDK
entry, SSH binary and dedicated pin-file hashes (**71 comparisons**) match the
final workspace/runtime inputs. Generated JSON bytes are preserved. JSON,
forbidden-field/IP-literal, documentation link/fence, scope and whitespace checks
passed. Pure validation now requires exactly one forged direct-control inventory
entry before accepting a pair, independently of the runner's separate controls.
