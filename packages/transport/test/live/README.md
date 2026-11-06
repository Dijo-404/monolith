# MN-007 public package browser acceptance

This manually invoked runner exercises the compiled public `@monolith/transport` and
`@monolith/transport/browser` exports. Ordinary workspace checks remain offline.

From the repository root, with the pinned Node and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm --filter @monolith/shared build
pnpm --filter @monolith/transport build
node packages/transport/test/live/run.mjs
```

The runner installs pinned Playwright 1.65.0 and hash tooling in a temporary directory.
It requires Chromium installed for that Playwright version. A preinstalled matching
tool directory can be supplied with `MONOLITH_BROWSER_TOOLS`; a Chromium binary can
be selected with `MONOLITH_CHROMIUM_PATH`. `--output <path>` chooses the generated
JSON location. `--offline-only` runs only the explicitly simulated disposal control.

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
