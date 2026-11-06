# Monolith integration contracts

Status: proposed v1 handoff contract for MN-002. The implementing owner must turn these shapes into exported TypeScript types, runtime validation schemas and synthetic fixtures in `packages/shared`. This document is not executable code and does not assert SDK compatibility or live results. Follow [architecture.md](architecture.md) for dependency and trust boundaries.

## Compatibility rules

- Packages use `@monolith/*` names and public entry points. Browser/server adapters get distinct exports. Core code must not infer SDK types across these boundaries.
- HTTP DTOs carry `schemaVersion: 1`, except standard JSON-RPC bodies. Validate all external input. Unknown schema versions fail explicitly; required-field or meaning changes require a coordinated version change.
- `ChainId` is an unsigned canonical decimal string; convert RPC hex chain IDs at the adapter boundary. EVM addresses/hashes use validated `0x` hex. JSON contains no bigint: amounts/nonces/deadlines are canonical unsigned decimal strings, amounts in token base units. Human-readable dates are UTC ISO-8601 strings.
- A required schema/route change names the task IDs, producers, consumers, fixture update and migration in its PR. No consumer adds an incompatible private copy to bypass review.
- The foundation task establishes package tooling; MN-002 freezes contracts. Owners can run isolated preflights earlier, then adapt those experiments to the frozen interface.

## Core values and failures

```ts
type ChainId = string;
type EvidenceKind = 'OBSERVED_LIVE' | 'SIMULATED' | 'UNTESTED' | 'BLOCKED';
type WorkerState = 'BOOTSTRAPPING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'CLOSED';
type Route = 'anon-tor' | 'anon-nym' | 'direct-debug' | 'passthrough' | 'blocked';
type ReadMethod =
  | 'eth_chainId' | 'eth_blockNumber' | 'eth_getBalance'
  | 'eth_call' | 'eth_getTransactionReceipt';

type SafeError = {
  code: ErrorCode;
  message: string;      // fixed/sanitized text; no raw upstream exception
  retryable: boolean;  // retry permission never authorizes a direct fallback
};
type Result<T> = { ok: true; value: T } | { ok: false; error: SafeError };
```

| `ErrorCode` | Meaning and handling |
|---|---|
| `INVALID_INPUT`, `UNSUPPORTED_VERSION` | Reject before side effects |
| `POLICY_DENIED`, `METHOD_DENIED`, `TARGET_DENIED` | No request leaves the boundary |
| `WORKER_UNAVAILABLE`, `WORKER_INTEGRITY_FAILED` | Protected reads block; UI offers retry only |
| `ENDPOINT_REJECTED`, `CHAIN_MISMATCH` | Exclude candidate, invalidate its validation |
| `REGISTRY_UNTRUSTED`, `REGISTRY_EXPIRED`, `REGISTRY_UNAVAILABLE` | No silent discovery downgrade |
| `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `RPC_ERROR`, `RPC_RESPONSE_INVALID` | Sanitized failure; retries obey the same policy |
| `RATE_LIMITED`, `EVIDENCE_EXPIRED` | Bound retry or rerun scenario |
| `AUTHORIZATION_INVALID`, `PAYMENT_EXPIRED`, `NONCE_CONFLICT`, `INSUFFICIENT_CREDIT` | Conditional payment rejection |
| `PAYMENT_RECONCILE` | Broadcast outcome uncertain; reconcile existing intent |

An `eth_call` requires allowlisted target, selector, block tag and bounded parameter size. Enumerating its method alone does not make arbitrary contract calls safe. Add other read methods only with a policy, fixtures and observer support.

## Registry boundary

```ts
type EndpointCandidate = {
  endpointId: string;         // opaque stable identifier within this revision
  chainId: ChainId;
  chainName: string;
  rpcUrl: string;             // validated public HTTPS URL; no credentials/template
  publisher: { creator: string; owner: string };
  entityKey: string;
  expiresAt: string;
  source: {
    url: string;
    revision: string;        // immutable upstream commit or separately identified snapshot
    licenseUrl: string;
    snapshotSha256: string;
  };
};
type RegistryManifest = {
  schemaVersion: 1;
  revision: string;
  generatedAt: string;
  expiresAt: string;
  evidence: EvidenceKind;
  origin: 'arkiv-query' | 'fixture';
  endpoints: EndpointCandidate[];
};
```

`GET /api/registry/chains?chainId=<decimal>` returns `Result<RegistryManifest>` with a versioned response wrapper. Inputs are public network IDs only; wallet, user session and order IDs are forbidden. HTTP cache keys use public chain/revision; no personalized response. In the MVP, unavailable or expired data returns a failure. Signed-cache fallback is a separate reviewed extension with verification-key, signature, age and expiry fields; it cannot be inferred from this contract.

The Arkiv adapter authenticates records using configured creator/owner policy, schema `monolith.rpc.v1`, content validation and expiry. The importer records actual source/entity/transaction counts and rejects unsafe data rather than publishing `verified` by assumption. A public manifest supplies discovery; deployment origin policy plus a protected live `eth_chainId` probe is still required before a browser read. The observer's operator endpoint map is a stricter subset; a manifest cannot expand that map automatically.

## Transport and trace boundary

```ts
type RoutePolicy = {
  privacyRequired: boolean;
  allowedChains: ChainId[];
  allowedMethods: ReadMethod[];
  allowDirectDebugControl: boolean;
  failClosed: true;
};
type ReadRequest = {
  readId: string;            // random per logical read, never a user/session identifier
  endpointId: string;
  chainId: ChainId;
  method: ReadMethod;
  params: unknown[];
  callsite: string;          // static app/module label; no payload interpolation
};
type RpcTrace = {
  schemaVersion: 1;
  readId: string;
  attempt: number;
  endpointId: string;
  chainId: ChainId;
  method: ReadMethod;
  callsite: string;
  route: Route;
  durationMs: number;
  success: boolean;
  bootstrap: boolean;
  evidence: EvidenceKind;
  payloadVisibility: 'rpc-endpoint-can-read';
  errorCode?: ErrorCode;
};
```

The shared schema owner supplies `ErrorCode` as the finite union in the table. `params` stays only inside the local request; it is never copied into a trace or public report. Result decoders validate method-specific responses. Correlate JSON-RPC IDs and reject malformed/mismatched envelopes before returning success.

`MonolithTransport` exposes `initialize()`, `validateEndpoint(candidate)`, `read(request)`, `getState()`, and `close()`. The implementation task freezes exact asynchronous signatures against these values. `read` returns `Promise<Result<unknown>>`; caller decoders refine results. It receives a trace sink and adapters by composition, rather than reading global SDK clients. Reinitialization/close cancels outstanding work or marks its outcome unusable, invalidates target readiness and prevents stale success from changing UI state.

`validateEndpoint` performs local URL/policy checks before a network call and then `eth_chainId` through an initialized real worker whenever privacy is required. A direct validation probe is not a bootstrap exception. Explicit debug comparisons use their own configuration and route; the normal read API never chooses them after an error. Worker metadata records selected network, actual specifier/hash verification outcome and observed time using the installed harness's real interface; do not invent SDK fields.

The bootstrap provider is a separate port with an enumerated specifier lookup allowlist. Bootstrap events are reported outside eligible app reads, and the exact exclusions appear in every report. They must not be hidden as `anon-tor` reads. Passthrough remains a visible route with zero protected credit even if its bundle hash is valid.

## Controlled observer HTTP boundary

Choose the idea's illustrative `/api/observer/read` spelling as the single canonical route. `/observe/rpc` is not a second independently implemented API.

`POST /api/observer/read?endpointId=<configured-id>` takes an ordinary single JSON-RPC 2.0 body:

```ts
type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string;
  method: ReadMethod;
  params: unknown[];
};
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string; result: unknown }
  | { jsonrpc: '2.0'; id: string | null; error: { code: number; message: string } };
```

Return that JSON-RPC envelope directly. Do not wrap it in `{ result, diagnostics }` or the transport will parse a different protocol from normal RPC providers. Reject batch requests/notifications for v1; cap request/response size and execution time. Never forward arbitrary headers, cookies, authorization, caller-selected URL or write method to the upstream. `endpointId` maps to a deployment-owned approved HTTPS target with chain metadata. HTTP status is meaningful for transport failures; JSON-RPC errors preserve IDs where valid and use sanitized messages.

The browser may attach `x-monolith-run` with a random synthetic lab-run ID and `x-monolith-case` with a fixed scenario label. These are short-lived diagnostics, not authentication or evidence that a connection is anonymized. Upstream requests strip them. Public worker-compatible CORS is allowed only for this read-only surface; no credentialed cookies. Rate limits must accommodate the live paired test without creating an open general proxy.

`GET /api/observer/runs/:runId` returns `Result<ObserverRun>` inside the HTTP wrapper:

```ts
type ObserverRun = {
  schemaVersion: 1;
  runId: string;             // random synthetic run, expires with its diagnostics
  expiresAt: string;
  observations: Array<{
    rpcId: string;
    method: ReadMethod;
    addressPresent: boolean;
    sourceClass: 'baseline' | 'different-from-baseline' | 'unknown';
    durationMs: number;
    success: boolean;
  }>;
};
```

Use a five-minute in-memory TTL for the lab run; cap active runs and never persist source addresses, RPC bodies or results in diagnostics. The controlled direct call establishes the baseline from trusted socket/proxy context. A different source class plus a verified worker supports the paired observation; a header or source difference alone proves neither Tor usage nor general anonymity. Unknown/untrusted proxy topology yields `unknown`, never inferred success. On expiry return `EVIDENCE_EXPIRED`. The scenario runner exports only sanitized data before expiry.

## Analyzer and test-run boundary

The analyzer consumes traces, independent egress observations, declared scenario scope and bootstrap exclusions. It performs no network calls or SDK access. Its v1 result is:

```ts
type PrivacyReport = {
  schemaVersion: 1;
  runId: string;
  evidence: EvidenceKind;
  eligibleReads: number;
  protectedReads: number;
  successfulReads: number;
  protectedCoverage: number | null;
  findings: Array<{ code: string; readId?: string; callsite: string; message: string }>;
  scope: { rpcOrigins: string[]; scenarios: string[]; bootstrapExclusions: string[] };
};
```

Count logical eligible reads once, including failed/blocked attempts and bypasses found by the independent interceptor. Retries have the same `readId` with a different attempt index; they do not inflate coverage. A read earns protected credit only when its actual attempts use real anonymizing transport and none bypass the policy. Completion is independent of route protection. A blocked-before-send read earns no protected credit. An injected direct read must be counted even though it did not emit a wrapper trace. Correlation/de-duplication rules are frozen as fixtures by MN-011 and MN-012; unexplained traffic is a finding, not silently discarded. `eligibleReads === 0` gives `protectedCoverage: null` and cannot pass functional acceptance.

Optional `POST /api/tests/run` and `GET /api/tests/:id` are sandbox-only, for named allowlisted scenarios and synthetic identifiers. They must never execute arbitrary uploaded code or shell commands. The MVP may run scenarios from the browser/test CLI instead; the report contract stays the same. CI requires both the expected failure for the injected fixture and success with useful reads after repair. A UI status toggle is not a test result.

## Conditional checkout boundary

MN-018 selects the supported authorization route. MN-019 freezes the actual ABI and EIP-712/domain schema before MN-020/MN-021 rely on it. Values from the idea, including chain/token configuration, must be independently checked during that preflight; no successful settlement is asserted here.

For the prefunded-vault path only, choose exact `amount`, resolving the idea's illustrative `maxAmount`/`amount` variation:

```ts
type PayIntent = {
  payer: string;
  merchant: string;
  amount: string;            // exact base-unit amount; uint256 onchain
  orderId: string;           // bytes32; not a merchant's raw private order payload
  nonce: string;
  deadline: string;          // Unix seconds; uint256 onchain
};
// EIP-712 domain binds name, version, chainId, verifyingContract.
```

Do not re-use this type for token-native authorization unless the actual token's signed schema matches; an adapter maps the chosen token-native fields and preserves equivalent recipient/amount/replay constraints. Both browser and relayer validate pinned chain, token and verifying contract before signature/submission.

| Route | Request and result |
|---|---|
| `POST /api/checkout/quote` | Configured merchant ID + synthetic order ID; returns short-lived `quoteId`, immutable bounded intent/domain fields and scoped submission capability |
| `POST /api/checkout/submit` | `quoteId`, exact signed intent, signature and idempotency key; returns stable payment ID, state and transaction hash if broadcast |
| `GET /api/checkout/:orderId` | Requires that merchant/order capability; returns `pending`, `settled`, `failed`, or `reconcile` with sanitized receipt reference |

All non-JSON-RPC endpoints use `{ schemaVersion: 1, ...Result<T> }`; errors also use an appropriate HTTP status. Relayer routes require explicit scoped access and strict origin policy. Quote capabilities expire, bind the expected payer/order/merchant and are neither logged nor placed in public reports. Arbitrary caller merchant, amount, calldata or contract inputs cannot override server-side quote limits.

Submission idempotency is anchored to chain/verifying contract/payer/nonce, not just an HTTP header. Duplicate matching requests return the same payment state; a conflicting body is `NONCE_CONFLICT`. Use atomic reservation and durable recovery through broadcast; multiple relayer processes require shared atomic state. After an uncertain broadcast, reconcile the existing transaction/nonce before another submission. Onchain replay checks remain mandatory even with server idempotency.

Settlement evidence verifies the successful receipt, expected payment event/contract, designated token `Transfer`, amount/merchant and confirmation policy. Public reports contain explorer references and synthetic demo facts, never signatures, capabilities, private order data or private user addresses. App-owned browser payment/balance reads use MonolithTransport; receipt inspection by the relayer is disclosed separately. Keep the entire checkout feature visibly disabled until its activation evidence is approved.

## Verification manifest

The evidence exporter creates `evidence/<run>/verification-manifest.json` only after the run. Each entry names artifact path, content hash, generated time, evidence kind and source task; omitted integrations stay `UNTESTED` or explicitly excluded. The bundle can contain redacted worker, paired observer, privacy-run and registry-snapshot artifacts, plus conditional checkout-settlement evidence. The release task checks redaction and claims against those real files. Synthetic fixtures belong in `tests/fixtures`, carrying `SIMULATED` markers; they must not be shipped as observed evidence.
