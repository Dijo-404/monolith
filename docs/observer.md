# Controlled observer operation

The observer provides a configured, read-only JSON-RPC surface and short-lived lab diagnostics. MN-004 implements the service boundary; a successful offline test does not establish a working anonymity network. MN-009 must pair a real verified worker with independently observed source evidence before claiming a direct-versus-anonymous comparison. See [the shared contracts](contracts.md) and [architecture](architecture.md) for those boundaries.

`POST /api/observer/read?endpointId=<configured-id>` accepts one JSON-RPC 2.0 request and returns an ordinary JSON-RPC response with the correlated ID. `GET /api/observer/runs/:runId` returns the versioned `Result<ObserverRun>` wrapper. The observer has no transaction-submission or relayer route. Requests cannot supply an upstream URL, custom upstream headers, credentials or a broader method policy.

## Operator configuration

The default configuration has no approved endpoints, no registered lab runs and unknown source topology. An operator supplies the following server-only variables; no observer setting belongs under a `MONOLITH_PUBLIC_` prefix.

| Variable | Default | Meaning |
|---|---|---|
| `MONOLITH_OBSERVER_HOST` | `127.0.0.1` | Explicit listener IP or `localhost` |
| `MONOLITH_OBSERVER_PORT` | `3001` | Decimal integer from 1 to 65535 |
| `MONOLITH_OBSERVER_ENDPOINTS` | `[]` | JSON array of approved endpoint objects |
| `MONOLITH_OBSERVER_SOURCE_MODE` | `unknown` | `unknown`, `direct`, or `trusted-proxy` deployment topology |
| `MONOLITH_OBSERVER_TRUSTED_PROXIES` | empty | Comma-separated exact IPv4/IPv6 peer addresses; only valid in `trusted-proxy` mode |
| `MONOLITH_OBSERVER_LAB_RUNS` | `[]` | JSON array of fresh synthetic lab registrations |

The following is a synthetic configuration example. `rpc.example.invalid` is intentionally unroutable and supplies no live chain result. Replace it with an operator-approved public HTTPS endpoint and independently verify its chain. The call rule is an example policy for a synthetic target, not a deployed-contract assertion.

```dotenv
MONOLITH_OBSERVER_ENDPOINTS=[{"endpointId":"ethereum-demo","chainId":"1","rpcUrl":"https://rpc.example.invalid","calls":[{"to":"0x1111111111111111111111111111111111111111","selector":"0x70a08231","dataBytes":36}]}]
MONOLITH_OBSERVER_SOURCE_MODE=unknown
MONOLITH_OBSERVER_TRUSTED_PROXIES=
MONOLITH_OBSERVER_LAB_RUNS=[{"runId":"run-7b9377ea-cb1b-4b12-a8ca-ded37e8b66f0","baselineRpcId":"rpc-b54f28e1-a70a-467f-804c-e74f7c2d75e9"}]
```

Keep both JSON arrays on single environment-file lines. Generate new UUIDv4 values for each lab run; do not reuse these published example IDs. The run ID begins with `run-`; the reserved baseline RPC ID begins with `rpc-`. They are random synthetic correlation values, never a user address, order ID or stable session identifier. Registered IDs do not authorize private data access, and the diagnostics endpoint contains no private payloads.

Configuration rejects unknown JSON keys, duplicate endpoint IDs and duplicate run/baseline IDs. It limits the combined configuration values to 64 KiB of UTF-8, 64 endpoints, 64 call rules per endpoint, 128 runs and 32 trusted proxy peers. Endpoint IDs use the shared opaque identifier format; chains use canonical unsigned decimal strings. Endpoint URLs must pass the shared public HTTPS syntax checks. Startup rejects malformed configuration with fixed text and never echoes its JSON, URLs or environment values.

Only `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_call` and `eth_getTransactionReceipt` are accepted. Balance/call block tags are restricted to `latest`, `safe` and `finalized`. Each `eth_call` must match a configured target and four-byte selector, with exactly `dataBytes` bytes of calldata including the selector. `dataBytes` is an integer from 4 through 4096. An empty `calls` array disables contract calls for that endpoint. Batches, notifications, write methods and extended call-object fields are rejected.

An endpoint remains a candidate after URL parsing. The upstream adapter independently rejects private, loopback, link-local or otherwise prohibited DNS answers, pins the checked destination for connection, verifies HTTPS normally, and rejects redirects. A public registry response cannot expand this operator-owned endpoint map. Incoming cookies, authorization, origin, forwarding and Monolith lab headers are never forwarded to the upstream; the adapter constructs its own minimal request.

## Source topology and baseline

Leave source mode `unknown` until the deployed connection path is known. This returns inconclusive source classifications. A client-supplied `x-monolith-case`, route label, `Forwarded` or `X-Forwarded-For` value is not evidence of an anonymizing network.

Use `direct` only when the application listener receives clients directly without a reverse proxy changing the apparent peer. Classification then uses the socket peer and ignores client attempts to supply forwarding evidence. A local reverse proxy would otherwise make unrelated callers appear to have the same source.

Use `trusted-proxy` only behind configured exact edge IPs. The edge must remove any incoming `Forwarded` and `X-Forwarded-For`, then write exactly one validated source IP into `X-Forwarded-For`. Multi-address chains, duplicate forwarding headers and the alternative `Forwarded` form are rejected as source evidence. An untrusted socket peer cannot provide a source through that header. The service keeps Fastify's global `trustProxy` disabled; wildcard, CIDR and hostname trust settings are not accepted. IPv4-mapped IPv6 peer addresses are normalized before comparison.

The server reserves each lab baseline using the configured `baselineRpcId`. Send that synthetic direct control through the declared topology with the registered `x-monolith-run`, then use fresh synthetic RPC IDs for subsequent comparisons. A case header cannot elect a new baseline. Source classes are `baseline`, `different-from-baseline` or `unknown`; a changed source alone does not prove Tor/Nym use or general anonymity. The paired worker evidence must establish which transport actually executed the comparison.

## Retention, HTTP limits and deployment

Diagnostics are recorded only when a request supplies a registered random run ID and a synthetic RPC ID. Ordinary requests may receive valid read results without being saved as lab observations. Environment-configured runs are registered at service startup and expire five minutes later, even if no observation has arrived. Reads and diagnostic lookups never refresh that deadline. Start the observer immediately before the paired lab test; a later controlled composition may use the private registration port, which is not exposed through HTTP. Expiry clears the stored source and pending observations. Expired runs return `EVIDENCE_EXPIRED`. No RPC bodies, results, raw addresses, raw peer IPs or incoming forwarding headers are included in public diagnostics or persisted logs. The baseline source is held only in the short-lived process memory needed for comparison.

The service caps JSON request bodies at 16 KiB, upstream responses at 512 KiB, upstream execution at eight seconds and global concurrent upstream work at 16. A global 60-read-request-per-minute budget bounds upstream forwarding without retaining per-source IP counters. Rate/concurrency failures are sanitized. Operators must also set suitable infrastructure connection and body limits. These bounds describe the service policy, not measured throughput or availability.

Observer reads and diagnostic lookups support public worker-compatible CORS without credentialed cookies. Only the read route accepts POST preflight; this CORS policy does not apply to a payment relayer or arbitrary server routes. Treat diagnostics as public, short-lived synthetic lab information.

Use HTTPS for a production observer. When terminating TLS at a reverse proxy, configure TLS/HSTS at that edge, disable raw-IP access logs at every layer, and apply the exact trusted-edge policy above. Keep application logging disabled for request data. Startup emits only a fixed readiness message; configuration/startup failures contain no source details. Do not enable generic proxy logging, request-body capture or header tracing for the lab.

Start locally with `pnpm dev:observer`, or build with `pnpm build` and start with `NODE_ENV=production pnpm start:observer`. Runtime environment values remain server-side. Relevant checks are the observer environment/service tests plus the foundation `pnpm check`; record exact executed results in the task PR. No command in this document asserts a live worker, live upstream or accepted privacy proof.
