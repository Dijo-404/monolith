# MN-007 public package browser acceptance

This manually invoked runner exercises the compiled public `@monolith/transport` and
`@monolith/transport/browser` exports. Ordinary workspace checks remain offline.

From the repository root, with the pinned Node and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm --filter @monolith/shared build
pnpm --filter @monolith/transport build
node packages/transport/test/live/run.mjs --target ethereum-main
```

The runner installs pinned Playwright 1.65.0 and hash tooling in a temporary directory.
It requires Chromium installed for that Playwright version. A preinstalled matching
tool directory can be supplied with `MONOLITH_BROWSER_TOOLS`; a Chromium binary can
be selected with `MONOLITH_CHROMIUM_PATH`. `--output <path>` chooses the generated
JSON location. `--offline-only` runs only the explicitly simulated disposal control.
`--target ethereum-rpc` selects the default `ethereum-rpc.publicnode.com` target;
`--target ethereum-main` explicitly selects `ethereum.publicnode.com`. Only these two
configured public endpoints are accepted. There is no automatic endpoint switch.

When the selected target shares the bootstrap origin, interception permits only the
two exact fixed Nym specifier `eth_call` requests, including IDs, selectors and block
tag, once each. Other ordinary target requests are aborted and counted. CORS
preflights, if intercepted, are answered locally without target egress. The artifact
records both exclusions explicitly.

The disposal control holds a synthetic matching-bundle resolver response, closes the
public package driver, then releases the response. It asserts that the complete host
iframe is removed and cannot create late worker frames or restore readiness. Its
fake bootstrap/bundle bytes never contribute to the separate live attempt.

The live attempt uses the official Nym specifier and harness 0.4.0, performs a
protected endpoint chain probe followed by a protected `eth_chainId` package read,
with at most two attempts through the same worker, and checks disposal plus post-close denial.
Playwright deliberately intercepts a
direct negative control before the attempt, then independently counts ordinary HTTP
requests to the configured target. Any such request during the protected attempt
fails acceptance. The runner hashes actual complete resolver response bytes and
requires a match with the captured actual specifier hash.

The candidate's identity/provenance is a labeled synthetic local configuration.
This does not claim Arkiv product use. Bootstrap is non-anonymous, the destination
can read RPC payloads, and interception excludes WebRTC/KPS. The paired source-class
comparison belongs to MN-009 and remains untested by this runner. No application-wide
coverage or sponsor qualification is inferred from a successful read.

Generated output contains timestamps, source hashes, fixed trace labels, public
specifier metadata and coarse outcomes. It omits raw IPs, worker log arguments,
request payloads, wallet/order information, keys and signatures.

## Application composition

The [browser example](main.ts) composes the SDK-free public transport with the
browser driver. Serve an application-owned same-origin HTML asset like
[host.html](host.html) whose module calls `installBrowserHost()`. The host owns the
SDK realm; the official untrusted worker still runs in its inner null-origin
sandbox. Create a new driver and transport after closing an instance.

Supply exact approved origins, trusted publisher pairs, static callsites and the
required chain/method policy at composition. Include `eth_chainId` for protected
validation. Browser URL checks do not establish DNS safety or registry trust.
Ordinary application configuration must not construct the direct comparison driver.

Nym always receives a zero redirect budget; callers cannot override it. The
[pinned upstream audit](redirect-audit.md) explains why `redirect: 'error'` alone
does not enforce this in the published worker. This guard has source evidence;
the successful read below is not a live redirect-server test.

## Recorded observations, 6 November 2026

[The successful package run](observed-live-2026-11-06.json) finished at
`2026-11-06T13:18:27.033Z` with Node 24.22.2 and Chromium 158.0.8127.18:

```sh
MONOLITH_BROWSER_TOOLS=/tmp/monolith-anon-xEX2ji node packages/transport/test/live/run.mjs --target ethereum-main --output /tmp/monolith-mn007-live-alternate.json
```

This environment reused the previously installed matching browser tools. The
portable command above can install those same pinned tools in a new temporary
directory when `MONOLITH_BROWSER_TOOLS` is omitted.

The explicitly configured `ethereum.publicnode.com` target returned `0x1` through
the package's protected chain probe in 5,789 ms and app read in 675 ms, both on the
first attempt. Total package lifecycle time was 21,929 ms. The actual 18,283,862-byte
Nym resolver response matched the captured specifier hash
`0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`.
The direct interception negative control passed, exactly two fixed bootstrap
exceptions were observed, and no other ordinary target HTTP request was observed.
Repeated close left state `CLOSED`, zero iframes, cleared metadata and a rejected
future read. The separate simulated pending-resolver disposal control also passed.

Two earlier actual attempts against `ethereum-rpc.publicnode.com` are retained:
[the single-attempt failure](observed-blocked-2026-11-06.json) and
[the bounded two-attempt failure](observed-blocked-retry-2026-11-06.json). Nym boot,
actual bundle hash, disclosed bootstrap and cleanup passed, but chain probes returned
`UPSTREAM_UNAVAILABLE` after about 24 seconds per attempt. No ordinary target HTTP
fallback occurred. These artifacts contain their earlier source snapshots; the
failure's network cause remains unresolved. The later alternate target was selected
explicitly in a separate run, rather than used as an automatic retry destination.

The successful artifact records its transport source and compiled-module hashes
for review. This evidence proves the exercised package read and boundary controls;
the limitations above, including untested paired source-class proof, still apply.

## Retry trace correction and fresh package proof

A retry can be denied before egress if endpoint validation expires after a retryable
failure. The blocked trace now retains that retry's current attempt index instead of
reusing attempt 1. A **SIMULATED** public-factory regression advances the explicit
clock when the first `RATE_LIMITED` trace is emitted. It verifies that only the first
app attempt reaches the driver, while the failure and the later blocked retry carry
distinct `(readId, attempt)` keys: attempts 1 and 2. This prevents a false conflicting
duplicate in the privacy analyzer without changing the fixed route or fail-closed policy.

After that source correction, the compiled public package was exercised again:

```sh
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:/tmp/monolith-pnpm/node_modules/.bin:$PATH MONOLITH_BROWSER_TOOLS=/tmp/monolith-anon-xEX2ji node packages/transport/test/live/run.mjs --target ethereum-main --output /tmp/monolith-mn007-retry-trace-live-2026-11-06.json
```

The [unchanged generated observation](observed-retry-trace-2026-11-06.json) started at
`2026-11-06T13:32:14.136Z` and finished at `2026-11-06T13:32:33.149Z`, with Node
24.22.2 and Chromium 158.0.8127.18. The protected chain probe returned `0x1` in
6,188 ms and the app read returned `0x1` in 666 ms, each on attempt 1. Total package
lifecycle time was 17,973 ms. The actual 18,283,862-byte resolver reply matched the
same captured Nym hash shown above. The direct-interception control passed, only
two exact disclosed bootstrap requests used ordinary target HTTP, and zero ordinary
app-target requests were observed. Repeated close left state `CLOSED`, zero frames,
cleared metadata and a denied future read; the browser context was destroyed.

The new artifact binds all 11 source files, 11 compiled modules and the lockfile to
this run; each digest was checked before copying its actual bytes into the repository.
The separate pending-resolver disposal control remains explicitly `SIMULATED`.
Earlier live and blocked observations are retained unchanged. Candidate provenance
remains synthetic local configuration. This successful read does not exercise the
offline retry-expiry case, a live redirect server, paired observer source classes,
Arkiv product use or application-wide protection; those limits remain unchanged.

After merging accepted main `c641786` (the privacy analyzer), the pinned Node
24.22.2 / pnpm 12.18.0 frozen install and full `pnpm check` passed: lint, all
source/public-consumer typechecks, **587 tests in 14 files**, and production builds.
The [retry-expiry regression](../core.test.ts) first reproduced duplicate attempts
`[1, 1]` before the correction and now passes with `[1, 2]`; all 54 transport core
tests pass. Source, compiled-module and lockfile digests still match the fresh live
observation after that merge and rebuild. No SDK, dependency, export or lockfile
change was needed for this correction.
