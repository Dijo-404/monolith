# Independent RPC egress regression checks

MN012 supplies software regressions, all **SIMULATED**. The browser fixture uses the real public `MonolithTransport` policy implementation and a test-owned driver with authored results. It does not load an anonymizing worker. No fixture result establishes live anonymity, Arkiv product use or sponsor eligibility.

`collector.mjs` receives Chromium CDP network events independently of application traces. It captures requests at the two configured fixture RPC origins, uses the browser's request ID for completion association, and reads method/wire ID from actual posted bytes. The browser initiator stack supplies the fixture filename, line and column. Captured JSON/header strings are not exported.

The expected leaking widget has an operator-declared exact wire-ID/payload/callsite binding to its logical receipt read. Unknown requests stay unbound and enter the public analyzer's union denominator. There is no method/time/proximity join and no trust in an `x-route` or worker label. Unparsed requests, reused CDP IDs, incomplete capture and the 128-request capture limit fail conservatively. Captures continue through context destruction; requests are never silently dropped to obtain a pass.

The test-owned driver's exchange records bind to the exact outstanding transport attempt and supply separate SIMULATED completion data. They are not authenticated network-worker evidence. Missing transport traces withhold protection even when the fixture returns a useful value. Functional acceptance requires successful terminal measurements for both operator-configured useful reads as well as the validated result flag; a stale true flag cannot upgrade blocked reads. The public analyzer and exporter recompute the report; an exported report must match the recomputed object.

Only an exact one-send synthetic bootstrap call can be excluded: URL, POST method, wire ID, contract, selector, complete parameters and actual `bootstrapFixture` initiator must match. This is disclosed as non-anonymous fixture bootstrap. The chain-ID probe remains eligible. A separate runner capability permits one exact direct negative control; it remains eligible with zero protected credit, so its four-read scenario reports coverage 3/4. Other direct requests fail regardless of caller headers.

`static.mjs` recursively inspects `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and `.cts` files under dashboard source and transport browser adapters. The installed TypeScript parser selects the syntax mode from each filename, including JSX and TSX, so executable expressions inside components are inspected while JSX text, comments and string explanations remain data. It rejects unreviewed raw network primitives, aliases/destructuring, simple computed property forms and direct viem/ethers/web3 imports. Reviewed adapter files are pinned by whole-file SHA256: bounded bootstrap, explicit direct debug control, verified SDK host and public registry metadata. An adapter edit requires explicit boundary review and a visible pin update; the same check applies to every supported source extension. This is a conservative rule, not universal JavaScript deobfuscation; CSP, workers, arbitrary dependencies and third-party apps are not thereby proven safe.

Use Node 24.22.2 / pnpm 12.18.0:

```sh
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm exec tsx scripts/check-rpc-egress.ts
pnpm exec vitest run tests/privacy/egress/policy.test.mjs tests/privacy/egress/static-files.test.mjs
pnpm exec tsc -p tests/privacy/egress/tsconfig.json
MONOLITH_BROWSER_TOOLS=/absolute/path/to/playwright-tools \
  node tests/e2e/privacy/run.mjs --output /tmp/mn012-new-matrix.json
```

Playwright 1.65.0 is installed outside the workspace; no root dependency or lockfile changes are needed. The workflow installs browser tooling, then its actual test execution intercepts all fixture RPC traffic and rejects other external requests. Ordinary `pnpm check` runs deterministic offline policy tests; it starts no browser or live network.

For a concrete failing command and repaired command using the same seed:

```sh
MONOLITH_BROWSER_TOOLS=/absolute/path/to/playwright-tools \
  node tests/e2e/privacy/run.mjs --case leak --output /tmp/mn012-new-leak.json
# Expected exit 1: actual receipt request + initiator callsite, useful read still works.
MONOLITH_BROWSER_TOOLS=/absolute/path/to/playwright-tools \
  node tests/e2e/privacy/run.mjs --case fixed --output /tmp/mn012-new-fixed.json
# Expected exit 0: the same balance/receipt operations work, with no unexpected direct request.
```

The default matrix expects negative cases to fail their policy gate and positive cases to pass. Its test harness exits0 only if all eight expectations hold. Outage and block-all scenarios explicitly fail functional acceptance despite zero unexpected direct requests; missing traces and unexplained requests also fail. The recorded outputs and hashes are documented in [the browser acceptance record](../../e2e/privacy/README.md).

Scope limits: ordinary Chromium page HTTP at configured origins, no WebRTC/KPS, wallet/extension traffic or arbitrary third-party application coverage. MN009 owns live source proof, MN014 live dashboard composition, MN016 its walkthrough and MN017 final release evidence.
