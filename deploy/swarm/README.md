# Swarm deployment preflight

Tracking: [issue #96](https://github.com/Dijo-404/monolith/issues/96). Ethereum Swarm is the selected frontend target; the observer remains separate.

This dependency-free Node tool makes bounded GET requests only. It never uploads, buys or changes postage, reads wallet/transaction endpoints, allocates observer runs, sends target RPC, or writes Arkiv entities. Use the repository's pinned Node **24.22.2**.

```sh
node deploy/swarm/preflight.mjs \
  --bee-url https://api.gateway.ethswarm.org \
  --observer-url https://your-current-observer-origin \
  --reference bc9b942212421e2a19fe1ffdf0add641ae530923041ea8f549381747b14b2f2d \
  --out /absolute/new-preflight-report.json
```

The reference above is public example content from [Swarm's website guide](https://docs.ethswarm.org/docs/desktop/publish-a-website/), not Monolith. Its availability does not establish that a new Monolith upload or worker will work.

With an operator-provided node and batch, also supply `--batch-id <64-hex-public-batch-id>` and optionally `--min-ttl-seconds 3600`. Do not put private keys or authentication tokens in arguments or URLs. The tool does not support authenticated upload services; qualify their documented credential mechanism separately if needed.

Origins must omit credentials, path, query and fragment. Public services require HTTPS; literal loopback HTTP is allowed for an operator's own node and isolated tests. Redirects are rejected. Each response has a deadline and byte bound; only selected sanitized fields and content hashes enter the report. No ambient authorization/cookies or upstream response messages are retained.

The fixed checks are:

- Bee/gateway health, readiness, gateway-mode metadata and selected aggregate postage metrics.
- Optional exact selected batch state and remaining lifetime from the [Bee API](https://docs.ethswarm.org/api/).
- Optional observer `/api/health`, without registry queries or observer RPC.
- Optional known-reference retrieval from the two CID origins on `bzz.link` and `bzz.limo`.

The CID encodes a Swarm manifest reference using the [official Swarm CID format](https://github.com/ethersphere/swarm-cid-js). A 64-character hex reference cannot be used directly as one DNS label. Equal downloaded bytes and their SHA-256 establish the observed HTTP comparison; this tool does not independently reconstruct the Swarm chunk tree or prove the gateways have independent operators.

Exit **0** means a complete GET-only report was written. Individual checks can still be blocked, and deployment remains untested. Exit **1** means invalid input or an output/write failure. Existing output files are never overwritten. A low TTL, missing batch metadata, HTTP failure or unknown gateway mode remains visible in the report instead of becoming a successful upload claim.

## Interpreting public gateway access

The [official Bee-JS usage example](https://github.com/ethersphere/bee-js#usage) documents gateway uploads with `NULL_STAMP`. The gateway can select its own postage; that zero request value is not evidence of the actual batch ID. Its configuration and authentication policy are described in the [official gateway source](https://github.com/ethersphere/swarm-gateway).

`gateway: true`, healthy metrics and a known file loading are useful preflight observations. They do not prove upload entitlement, retention, the actual batch identity, application-origin isolation or new-site moderation approval. Do not purchase postage or configure a provider's automatic purchase/top-up mode under the current ₹0 budget.

Before frontend promotion, qualify an actual bounded upload, retrieve every authored file against the exact clean-build inventory, verify executable MIME types and distinct worker HTML/module, and execute the real privacy workflow from an isolated application origin. Keep existing publication and backend ownership unchanged until the candidate passes. The Arkiv release descriptor, actual upload/read evidence and `/arkiv/swarm.md` belong to separately coordinated implementation/evidence work; this preflight alone earns no bonus credit.

## Checks

```sh
pnpm exec vitest run tests/deploy/swarm-preflight.test.mjs
pnpm exec eslint deploy/swarm/preflight.mjs tests/deploy/swarm-preflight.test.mjs --max-warnings 0
pnpm check
```

The focused tests use simulated loopback services and make no live upload, wallet, registry or anonymity-network requests. Actual observations and resource limits are recorded in [the preflight report](../../docs/preflight/swarm.md).
