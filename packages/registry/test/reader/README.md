# MN-010 trusted public registry reader

`GET /api/registry/chains?chainId=<decimal>` publishes discovery metadata from a
configured Arkiv Rabdi publisher and immutable source snapshot. The default
observer configuration returns `503 REGISTRY_UNAVAILABLE`. No signing key is
needed. The public operator configuration uses `MONOLITH_REGISTRY_CONFIG` with
exactly `creator`, `owner`, `sourceRevision`, `snapshotSha256`, `licenseSha256` and
`allowedOrigins`; see [the environment example](../../../../.env.example).
Origins are explicit canonical HTTPS origins, with no wildcard or automatic
admission of every imported endpoint. A successful API response does not add a
destination to the observer's configured RPC map.

The reader selects all production schema/system fields, filters creator and
owner separately, and independently checks every returned row. It requires the
production importer discriminator, readonly flags, the approved MIT hash, exact
source URLs/revision/catalog hash, and the importer's recomputed immutable
`record_id`. Preflight samples, foreign publishers, incomplete typed rows,
duplicate identities and inconsistent cursor counts fail closed. Cursor pages
are separate observations, with bounded rows/pages/block drift; this is not an
atomic single-block snapshot. A final uncached engine block check follows the
scan. Engine expiry is a block height; the independent publisher content deadline
is UTC ISO. Both must be live, including equality boundary checks.

Each request reads current Arkiv data and resolves both DNS families for every
approved destination. Any unsafe answer blocks discovery. This is **metadata
admission**, with no socket or JSON-RPC probe to the candidate. DNS can change
after this observation; browser host policy and a protected live chain-ID probe
remain MN-013 requirements. Any future server probe must use the observer's
existing DNS-pinned HTTPS reader and redirect policy. The registry API grants no
network capability and does not claim to establish endpoint chain identity.

There is no stale snapshot or unsigned cache fallback. A bounded map remembers
only generation metadata so clients receive identical bodies while every
request rechecks storage and DNS. Its lifetime is at most 30 seconds and never
exceeds the earliest endpoint deadline. Arkiv failure, deleted/expired rows or a
new unsafe DNS answer cannot serve an earlier success. HTTP responses use
`Cache-Control: no-store`; only the public chain parameter is accepted. Headers,
cookies, wallet/session parameters and caller-selected URLs cannot change the
query or policy. Timeouts discard late results, and outstanding application/HTTP
operations retain bounded slots until their infrastructure work settles.

## Verification

Use Node **24.22.2** and pnpm **12.18.0**, as pinned by the workspace. From the
repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2023 --types node --skipLibCheck packages/registry/test/reader/query.test.ts packages/registry/test/reader/adapter.test.ts
```

The new regression tests use **SIMULATED** rows, clocks and DNS/SDK responses.
The final workspace run passed **917 tests in 23 files**, lint, public-package
type checks and production builds; the reader/API adds 194 simulated cases.
The explicit strict TypeScript command above also passed.
SDK protocol tests intercept the actual public SDK request path without network
access. They cover malicious matching-schema records, both expiry clocks,
pagination/mismatch/count/flags, URL credentials/private addresses, DNS changes,
fail-closed outages, deterministic public responses, output redaction and
resource limits. The HTTP boundary also rejects successful service manifests
with a different requested chain. A source name with trailing whitespace is
preserved exactly, matching the accepted importer identity definition.

## Actual API observation

[The generated observation](observed-api-2026-11-06.json) records an actual
key-free run started at **2026-11-06T14:31:47.843Z**. Its SHA-256 is
`f75be96cba40beadab76ca57d43c001f7c02e2841d33052d4fd1cbd037d1521b`.

- Two sequential HTTP clients received `200` with identical `OBSERVED_LIVE`,
  `arkiv-query` manifests for chain **10**. The second request included synthetic
  caller headers/cookie; they did not affect the public snapshot.
- The returned OP Mainnet entity is
  `0xc8d33bed907f23f9cddcf19fb151318dbe7758c5880a6378e8f6a50826010f07`, from
  creator/owner `0x93d1a42655f2b0bcfa126e3d2a33e4ab60a74ca4`, with immutable
  source revision `e17474286275730fb6b0490b1d7ea1c64a36ed9e` and catalog SHA-256
  `2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952`.
- A request with a synthetic `wallet` query parameter returned `400`; attempting
  to use the discovery ID on the unconfigured observer RPC route returned `403`.
- The child observer inherited only public configuration, contacted the fixed
  public Arkiv reader plus current DNS, and stopped after execution. No signing
  environment, keys, writes, funding or candidate RPC probes were used.

The artifact includes hashes of the 27 relevant source files and their compiled
JavaScript plus the lockfile, checked unchanged across the run. It contains the
actual HTTP bodies, including provenance, entity and expiry, rather than a
fabricated live fixture. Its short-lived manifest is now **recorded historical
evidence**; it must not be loaded as a routing fallback or described as current
freshness. It proves public storage discovery and API behavior, not a protected
RPC read, payload confidentiality, DNS pinning for browser traffic or sponsor
eligibility.

Reproduce explicitly after building; this command makes real read-only network
queries and writes a new observation only after execution:

```sh
pnpm build
node packages/registry/test/reader/observe-api.mjs --run --output /tmp/monolith-registry-api-observation.json
```

[The runner](observe-api.mjs) starts the built observer on a temporary loopback
port with a minimal environment. It uses the accepted import's public chain-10
record/policy, makes fresh API queries, checks source/build hashes and stops the
observer. It reports `BLOCKED` on an unavailable or changed deployment; no mock
or old response substitutes for a failed read. The accepted imported rows
eventually expire, so reproduction may require a separately accepted fresh
import and explicit operator policy update.
