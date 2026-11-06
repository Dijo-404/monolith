# Live lab UI boundaries (MN-014)

The default dashboard composes the public Nym browser driver, the trusted Arkiv registry client, the protected registry transport and the public observer diagnostics. Its application controller makes no API/RPC contact on page load; page assets and hosting security bootstrap are separate ordinary contacts. Missing public HTTPS observer configuration blocks before worker bootstrap. Public registry metadata may retry at most three fresh network queries, with abort-safe one- and two-second waits, only for typed `REGISTRY_UNAVAILABLE` or `UPSTREAM_TIMEOUT`. Trust, expiry, policy, target, chain and explicit rate-limit failures never retry; exhausted metadata retries block with zero application RPC/direct controls. Every successful response is re-admitted against current trust and true expiry. This is not a protected-RPC retry or cached fallback. `?mode=simulated` opens the separate, explicitly labelled authored walkthrough.

The chain-10 policy independently pins `https://mainnet.optimism.io/`, the accepted registry publisher and source revision/hash. Only that exact Arkiv-selected URL maps to `lab_optimism` at the configured observer. Protected probes and balance reads use the verified Nym driver. The diagnostic `runId` query carries no source claim; source comparison relies on the separately reviewed observer edge. Native HTTP is limited to public metadata and the separately consented fixed synthetic direct-control/leak adapter. There is no direct private-read fallback.

The public lab independently caps newly validated manifests at 120 seconds and protected-probe validation at 60 seconds, within the framework's existing 300-second configuration bounds. This explicit lab policy was coordinated on [14](https://github.com/Dijo-404/monolith/issues/14#issuecomment-6692867516), [10](https://github.com/Dijo-404/monolith/issues/10#issuecomment-6692866450) and [40](https://github.com/Dijo-404/monolith/issues/40#issuecomment-6692866944) after an actual 21.6-second probe plus 9.6-second balance read exceeded a fresh 30-second generation. The repair can require three protected operations, each bounded to 25 seconds, plus a separately bounded direct control. Other registry consumers retain the 30-second generation default. True entity expiry still shortens every capability; current trust, metadata freshness, chain and source checks remain before and after every read. No previously issued lease is extended. Completed runs display **Recorded snapshot**, including blocked runs, rather than a coarse-clock claim of current freshness.

Every action receives a fresh server allocation. Protected wire IDs are fresh random UUIDs and are restored to the core transport's internal IDs only after exact response validation. The collector binds traces causally to one outstanding exchange and matches independent observer receipts by exact wire ID, method, address-presence flag and completion. Unexpected receipts fail the run and remain in the denominator. A private read alone does not prove a network-source comparison. An explicit comparison counts its direct control: two protected reads out of three, rather than claiming full coverage. The sandbox leak has an independent receipt without a transport trace; the repair preserves the earlier failing report.

## Offline checks

Use the repository's pinned Node `24.22.2` and pnpm `12.18.0` toolchain. No new dependencies are introduced.

```sh
pnpm check
pnpm exec vitest run tests/e2e/lab-ui
pnpm exec tsx scripts/check-rpc-egress.ts
```

The focused Vitest cases are **SIMULATED**. They cover the default private path, one warm worker across four fresh runs, cancellation/close/expiry and failure paths, strict fixed-URL mapping, independent inventory disagreements, explicit direct controls, unknown egress accounting, unchanged synthetic functional intent across the route-only fixture patch, bounded metadata parsing/cancellation/error redaction, exact metadata retry timing/limits/deny codes/close cancellation, the actual 60-second probe-validity boundary, rejection above the independent 120-second lab maximum, shorter real entity deadlines and strict hosted-frame classification. They contact no external worker, registry, observer or chain.

The two native adapter pins were independently reviewed at the exact hashes in [reviewed-adapters.json](../../privacy/egress/reviewed-adapters.json), coordinated on issues [14](https://github.com/Dijo-404/monolith/issues/14#issuecomment-6690884498) and [12](https://github.com/Dijo-404/monolith/issues/12#issuecomment-6690884946). The controller remains subject to the normal scanner. Any change to pinned bytes requires another boundary review.

## Actual production-browser layout check

Build without `MONOLITH_PUBLIC_OBSERVER_URL`, and serve the resulting production output locally:

```sh
pnpm --filter @monolith/dashboard build
pnpm --filter @monolith/dashboard preview --host 127.0.0.1 --port 5187
```

In another terminal, set `MONOLITH_BROWSER_TOOLS` to an isolated Playwright `1.65.0` installation, `MONOLITH_PREVIEW_URL=http://127.0.0.1:5187/`, and `MONOLITH_LAYOUT_OUTPUT` to a **new** directory, then run:

```sh
node tests/e2e/lab-ui/browser-layout.mjs
```

This checks actual Chromium rendering at desktop/390/320 widths, reduced motion, no-WebGL fallback, the built same-origin worker host, the secondary simulation label and unconfigured failure before bootstrap. It aborts unexpected external requests and requires zero external/API contacts and page errors. Its artifact explicitly sets `liveRpcAcceptance: false`; rendering is not live integration evidence.

## Actual public workflow

For ordinary accepted-stack runs, MN-024 and MN-025 must have merged and their evidence have been accepted. A specifically coordinated pre-acceptance composition may produce evidence at named clean commits; it does not itself accept a dependency. Build with the reviewed public `MONOLITH_PUBLIC_OBSERVER_URL`, then serve the production output as above. Set `MONOLITH_LIVE_OBSERVER_ORIGIN` to the same origin, `MONOLITH_LIVE_OUTPUT` to a **new** directory, and the same pinned browser-tool and preview variables:

```sh
node tests/e2e/lab-ui/browser-live.mjs
```

[The actual 7 November capture](observed-live/2026-11-07/README.md) passed all four actions through the production preview and public backend at exact clean source/compiled inputs. It preserves all four earlier blocked attempts, sanitized reports, screenshots and hash/redaction bindings. Public frontend deployment QA remains a separate gate.

This runner uses only the actual UI and official worker. It does not inject a fake driver, alter SDK/worker source, mock RPC responses, or replace backend responses. It first proves its ordinary-HTTP interception detects an attempted direct target request, then permits only the explicitly requested fixed synthetic direct controls. On the already-counted leak POST only, it adds test-only forged forwarding/case labels using reserved documentation addresses; it changes neither the body nor wire ID and requires that request still be observed as baseline. It retains only the body hash, ID, count and categories of those labels. It runs private read, comparison, leak and useful repair through the UI; downloads the sanitized reports; and independently correlates visible wire/trace identities with actual diagnostic responses. It requires actual bundle-response bytes matching the verified worker hash, four fresh run allocations, zero ordinary protected-target fallback requests, no page errors through teardown, and browser-context shutdown. It preserves a failed attempt as `BLOCKED` instead of inventing success. Screenshots and reports are bound to exact current source, compiled package/dashboard artifacts, SDK entry and lockfile hashes; the runner requires those inputs remain unchanged during capture.

The ancillary `scenario`, `widgetFixture` and `fixturePatch` fields are outside the shared report schema. They identify the same public synthetic intent/seed and a JSON Patch whose only replacement is `direct-debug` to `anon-nym`, with source anchors for review. Fresh observer/wire/report IDs are not reused. The actual runner compares leak/repair descriptors and observed routes; authored descriptors alone establish no live success.

For final deployed QA, omit `MONOLITH_PREVIEW_URL` and explicitly set `MONOLITH_DEPLOYED_UI_ORIGIN` to a canonical public HTTPS origin without credentials, path, query or fragment. Local production preview remains the default. The runner records target kind/origin and retains every RPC, worker-integrity, source, denominator and useful-repair assertion. The deployment owner must first verify authored asset bytes and source/provenance identity against the prepared static snapshot, plus any explicitly reviewed hosting document addition and actual served hashes; this UI runner does not replace that independent deployment probe.

The observed public host adds a Cloudflare security bootstrap and a hidden challenge iframe. [The frame collector](hosting-frames.mjs) therefore checks the owned Monolith frame by its exact title, same-origin source, hidden attribute and absence of `srcdoc`: zero at startup, one after each completed live action and zero after navigation. A deployed run may separately record at most one positively recognized hosting frame: blank source, no name/ID/title/`srcdoc`, one-pixel dimensions, the exact observed hidden positioning, and a readable child with exactly one same-origin challenge script and consistent canonical ray/time parameters. Preview mode grants no hosting exception. Unknown or duplicate frames fail; a hidden frame alone is never sufficient. Synthetic tests cover foreign/credentialed/changed challenge URLs, extra or inconsistent parameters, unreadable documents, visible impostors and extra frames.

Frame records contain only booleans/counts. Hosting requests retain only a fixed category and method, never challenge IDs, timestamps, cookies, payloads or arbitrary frame attributes. This identifies a hosting footprint rather than authenticating Cloudflare or proving anonymity. The deployment check separately pins the reviewed inline hosting addition; fetched challenge runtime is outside transport privacy measurement. `shutdown.iframeScope` explicitly scopes worker cleanup, while the remaining global frame count is reported separately. The hosting/security bootstrap is ordinary, non-anonymous traffic outside eligible app reads.

Ordinary allocation, registry and diagnostic metadata contacts and two worker bootstrap lookups remain disclosed. The observer and tunnel provider are trusted intermediaries that can see source and request payloads; provider retention is unverified. Capture covers this synthetic workflow and ordinary page/frame HTTP, not worker WebRTC/KPS, browser extensions, wallets, unrelated pages or arbitrary applications. Hop count is illustrative and unmeasured. The backend's source/compiled provenance and operational lifetime are established by MN-025's separate accepted evidence, not by this UI runner.
