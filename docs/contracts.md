# Monolith integration contracts

Status: v1 shared-contract handoff implemented by MN-002 in [the public shared package](../packages/shared/src/index.ts), with [synthetic fixtures](../tests/fixtures/contracts). These interfaces and validators establish offline integration boundaries; they do not establish worker availability, publisher trust, network privacy or settlement. Follow [architecture.md](architecture.md) for dependency and trust boundaries.

## Compatibility rules

- Packages use `@monolith/*` names and public entry points. Browser/server adapters get distinct exports. Core code must not infer SDK types across these boundaries.
- HTTP DTOs carry `schemaVersion: 1`, except standard JSON-RPC bodies. Validate all external input. An explicitly positive integer version other than 1 returns `UNSUPPORTED_VERSION`; a missing version or malformed value returns `INVALID_INPUT`. Required-field or meaning changes require a coordinated version change.
- `ChainId` is an unsigned canonical decimal string (`0` or a nonzero digit followed by digits); convert RPC hex chain IDs at the adapter boundary. EVM addresses/hashes use validated `0x` hex of the required width. JSON contains no bigint: amounts/nonces/deadlines are canonical unsigned decimal strings, amounts in token base units. Dates are canonical UTC ISO-8601 strings ending in `Z`. IDs and static callsite labels are bounded strings; never interpolate wallet, order, session or upstream error data into them.
- A required schema/route change names the task IDs, producers, consumers, fixture update and migration in its PR. Lane A coordinates shared-contract review with each affected lane on its issue before editing. Change runtime validators, exported types, this document and fixtures together. Breaking changes require a new coordinated schema version and consumer migration; adding a required field, changing field meaning or changing strict allowed keys is breaking. No consumer adds an incompatible private copy to bypass review.
- The foundation task establishes package tooling; MN-002 freezes contracts. Owners can run isolated preflights earlier, then adapt those experiments to the frozen interface.

## Owners and consumers

Lane A owns the v1 shared package and `MonolithTransport` port under MN-002. Lane ownership describes the interface review responsibility; the live GitHub issue records the current person and agent.

| Contract | Producer and owning lane | Consumers and coordinated tasks |
|---|---|---|
| Transport policy, requests, state and traces | A: MN-003/MN-007 transport | C: MN-009/MN-011; D: MN-006/MN-012/MN-014; A: MN-013 |
| Endpoint candidates and registry manifest | B: MN-005/MN-008/MN-010 registry | A: MN-007/MN-013; C: MN-004 observer configuration; B: MN-015; D: MN-014 |
| JSON-RPC envelopes and observer diagnostics | C: MN-004/MN-009 observer | A: MN-003/MN-007; D: MN-014/MN-016 |
| Privacy reports and verification manifest | C: MN-011/MN-017 analyzer/exporter | D: MN-012/MN-014/MN-016; all lanes supplying MN-017 artifacts |
| Provisional payment intent | C: MN-018/MN-019, pending route/ABI freeze | C: MN-020; D: MN-021; C: MN-022 evidence |

## Runtime validation API

Import types, literal constants and validators only from `@monolith/shared`. The package uses pinned Zod as a schema utility, with no runtime dependency on React, Fastify, viem, Arkiv, browser workers or Node APIs. It performs no network calls. Build workspace packages before consuming their public exports.

Exported Zod schemas expose `.safeParse(input)` for local validation (Zod success/error shape) and `.parse(input)` which throws on failure. At an application/HTTP boundary, use `parseContract(schema, input)` to obtain `Result<T>` with fixed safe error text. Never serialize Zod errors, issue paths or raw provider messages into public reports. Parse success returns `{ ok: true, value }`; boundary failure returns `{ ok: false, error }`. Validators reject unexpected object fields, including payload-bearing additions to traces, diagnostics and reports. JSON-RPC `result` and local `params` permit JSON values, excluding bigint, functions, undefined and non-finite numbers. Parsing is validation rather than redaction: producers still select synthetic identifiers and sanitized static messages before exporting data.

| Public API | Purpose |
|---|---|
| `chainIdSchema`, `unsignedDecimalStringSchema`, `addressSchema`, `hex32Schema` | Validate primitive contract values |
| `safeErrorSchema`, `makeError(code)` | Validate or construct canonical sanitized failures |
| `parseContract(schema, input)` | Return a sanitized validation `Result<T>`; distinguish unsupported positive integer versions |
| `resultSchema(valueSchema)`, `httpResultSchema(valueSchema)` | Validate mutually exclusive success/failure wrappers; HTTP wrapper requires version 1 |
| `endpointCandidateSchema`, `registryManifestSchema` | Validate registry DTO shape and values |
| `routePolicySchema`, `readRequestSchema`, `rpcTraceSchema` | Validate fail-closed policy, local reads and exported trace DTOs |
| `jsonRpcRequestSchema`, `jsonRpcResponseSchema` | Validate single JSON-RPC read requests and exclusive result/error envelopes |
| `observerRunSchema`, `privacyReportSchema`, `verificationManifestSchema` | Validate sanitized observer, analyzer and evidence DTOs |
| `validateRegistryManifest(input, nowISO)` | Validate shape and freshness against an explicit clock |
| `validateRpcResponse(input, expectedId)` | Correlate a response ID, reject malformed responses and sanitize RPC errors |

For example, `parseContract(httpResultSchema(registryManifestSchema), body)` validates the versioned registry HTTP response. On a successfully parsed success envelope, `validateRegistryManifest(parsed.value.value, nowISO)` then checks freshness before the consumer applies its publisher, origin and chain policy. `resultSchema` returns a validation `Result` whose successful value is itself the decoded `Result<T>`; a valid remote error envelope is distinct from failure to parse that envelope.

`makeError` uses the finite fixed message/retry vocabulary; `safeErrorSchema` accepts that canonical vocabulary only. Never pass through an upstream exception as a public message. `retryable` permits a policy-compliant retry only. `validateRpcResponse` returns `RPC_RESPONSE_INVALID` for a malformed or mismatched envelope and `RPC_ERROR` for a correlated RPC error, without returning its raw error message. It validates the JSON-RPC protocol envelope; method-specific result validation belongs to the calling adapter.

## Core values and failures

```ts
type ChainId = string;
type EvidenceKind = 'OBSERVED_LIVE' | 'SIMULATED' | 'UNTESTED' | 'BLOCKED';
type WorkerState = 'BOOTSTRAPPING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'CLOSED';
type Route = 'anon-tor' | 'anon-nym' | 'direct-debug' | 'direct-bootstrap' | 'passthrough' | 'blocked';
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

`registryManifestSchema` validates shape without consulting a clock. `validateRegistryManifest(input, nowISO)` also rejects expired manifests or endpoints with `REGISTRY_EXPIRED`. Both functions leave publisher authorization, approved origin policy, DNS/IP checks, redirect policy and protected chain-ID verification to the registry/transport adapters. A structurally valid public HTTPS URL is not permission to contact it. The Arkiv adapter authenticates records using configured creator/owner policy, schema `monolith.rpc.v1`, content validation and expiry. The importer records actual source/entity/transaction counts and rejects unsafe data rather than publishing `verified` by assumption. A public manifest supplies discovery; deployment origin policy plus a protected live `eth_chainId` probe is still required before a browser read. The observer's operator endpoint map is a stricter subset; a manifest cannot expand that map automatically.

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
  params: JsonValue[];
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

MN-002 freezes these SDK-neutral ports in `@monolith/shared`; MN-007 supplies the transport implementation:

```ts
interface MonolithTransport {
  initialize(): Promise<Result<void>>;
  validateEndpoint(candidate: EndpointCandidate): Promise<Result<EndpointCandidate>>;
  read(request: ReadRequest): Promise<Result<JsonValue>>;
  getState(): WorkerState;
  close(): Promise<void>;
}
interface TraceSink {
  emit(trace: RpcTrace): void;
}
```

`initialize` and `validateEndpoint` resolve typed failures rather than granting an implicit direct fallback. Successful endpoint validation returns the candidate after the implementation has applied its required policy and protected chain probe; the DTO shape alone does not establish trust. `close` finishes resource cleanup; repeated close is safe. `Result<void>` is local to these ports and is not a JSON HTTP success payload. Caller decoders refine `read` results. The implementation receives its trace sink and adapters by composition, rather than reading global SDK clients. Reinitialization/close cancels outstanding work or marks its outcome unusable, invalidates target readiness and prevents stale success from changing UI state. The shared package constructs no workers and infers no SDK integrity metadata.

`validateEndpoint` performs local URL/policy checks before a network call and then `eth_chainId` through an initialized real worker whenever privacy is required. A direct validation probe is not a bootstrap exception. Explicit debug comparisons use their own configuration and route; the normal read API never chooses them after an error. Worker metadata records selected network, actual specifier/hash verification outcome and observed time using the installed harness's real interface; do not invent SDK fields.

The bootstrap provider is a separate port with an enumerated specifier lookup allowlist. Bootstrap events use the distinct `direct-bootstrap` route with `bootstrap: true`; ordinary traces set `bootstrap: false`. They are reported outside eligible app reads, and the exact exclusions appear in every report. A `privacyRequired` policy cannot enable the separate direct-debug control; comparison mode requires its own explicit policy. They must not be hidden as `anon-tor` reads. Passthrough remains a visible route with zero protected credit even if its bundle hash is valid.

## Controlled observer HTTP boundary

Choose the idea's illustrative `/api/observer/read` spelling as the single canonical route. `/observe/rpc` is not a second independently implemented API.

`POST /api/observer/read?endpointId=<configured-id>` takes an ordinary single JSON-RPC 2.0 body:

```ts
type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string;
  method: ReadMethod;
  params: JsonValue[];
};
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string; result: JsonValue }
  | { jsonrpc: '2.0'; id: string | null; error: { code: number; message: string; data?: JsonValue } };
```

`validateRpcResponse` correlates the envelope ID and returns a success envelope or a fixed error; provider error `message`/`data` are never returned by that helper. An error with `id: null` cannot match an expected string request ID. The observer HTTP route returns the JSON-RPC envelope directly. Do not wrap it in `{ result, diagnostics }` or the transport will parse a different protocol from normal RPC providers. Reject batch requests/notifications for v1; cap request/response size and execution time. Never forward arbitrary headers, cookies, authorization, caller-selected URL or write method to the upstream. `endpointId` maps to a deployment-owned approved HTTPS target with chain metadata. HTTP status is meaningful for transport failures; JSON-RPC errors preserve IDs where valid and use sanitized messages.

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

Only `ProvisionalPayIntent` is exported; it is not an activated payment API, ABI or final signed schema. MN-018 chooses the supported route and MN-019 freezes its actual domain/ABI before removing this provisional designation. For the prefunded-vault path only, choose exact `amount`, resolving the idea's illustrative `maxAmount`/`amount` variation:

```ts
type ProvisionalPayIntent = {
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

The evidence exporter creates `evidence/<run>/verification-manifest.json` only after the run:

```ts
type EvidenceArtifact = {
  path: string;              // relative artifact path; no traversal or absolute paths
  sha256: string;            // 64 hex characters, content hash without 0x
  generatedAt: string;
  evidence: EvidenceKind;
  sourceTask: string;        // MN-xxx task identifier
};
type VerificationManifest = {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  evidence: EvidenceKind;
  artifacts: EvidenceArtifact[];
};
```

Schema validation checks the manifest structure; it does not read files, calculate hashes, prove redaction or upgrade an evidence claim. MN-017 checks actual artifact contents and hashes. Omitted integrations stay `UNTESTED` or explicitly excluded. The bundle can contain redacted worker, paired observer, privacy-run and registry-snapshot artifacts, plus conditional checkout-settlement evidence. The release task checks redaction and claims against those real files.

## Synthetic integration fixtures

[Contract fixtures](../tests/fixtures/contracts) provide success and failure examples for the lanes: malformed RPC envelopes, version mismatch, expired registry data, unavailable worker states and sanitized diagnostics/report shapes. Their enclosing fixture metadata identifies them as `SIMULATED`; DTOs that carry `evidence` also retain that marker. Fake URLs, hashes and publisher addresses are synthetic values and must not be copied into observed evidence.

Run the foundation `pnpm check` command for lint, type checking (including public-package test consumers), fixture validation and builds. The fixtures are deterministic offline examples; passing them does not satisfy the MN-003 worker, MN-005 Arkiv, MN-009 observer or conditional payment live-evidence gates. Their JSON belongs under `tests/fixtures/contracts`, never in the release evidence directory. The catalog records an explicit synthetic 2030 evaluation timestamp; helpers never read the machine clock for freshness decisions.

## Frozen v1 validation details

- `identifierSchema` accepts opaque 8–128 character ASCII letter/digit/underscore/hyphen IDs for runs, reads and endpoints; these must be synthetic or random, never stable user/session identifiers. JSON-RPC correlation IDs accept 1–128 control-free characters, so the observer can report short valid RPC IDs.
- `publicHttpsUrlSchema` rejects credentials, fragments, templates, whitespace, IP literals/normalized numeric-IP aliases, non-default ports and explicitly local hostnames. It checks candidate syntax only; it performs no DNS resolution, host authorization or chain verification. Deployment adapters must still enforce those policies.
- Request schemas permit only five read methods with v1 parameter shapes: empty parameters for chain/block number, address plus block tag for balance, hash for receipt, and `{to,data}` plus block tag for `eth_call`. Call data contains at least a four-byte selector. Actual target/selector allowlisting belongs to the observer/transport. Batches, notifications, write methods and extended call-object fields are excluded from v1.
- JSON-valued RPC results and local parameters use iterative validation with at most 64 nested levels and 10,000 visited values per JSON value. Cycles, excessive nesting/size, non-finite numbers and non-JSON values fail without recursive validator stack overflow. HTTP adapters must also cap request/response bytes.
- Strict DTOs reject extra fields rather than silently exporting raw IP/body/order fields. Schema checks do not redact values embedded in allowed free-text fields; producers must select static safe labels and sanitize public findings.
- Registry manifests require ordered generation/expiry and unique endpoint IDs; freshness checks use explicit UTC ISO `nowISO` and reject expired endpoints. They do not authenticate publishers or source hashes.
- Privacy reports require count/coverage consistency; an empty denominator uses `null`. The schema does not calculate measured reads or verify routing. Evidence manifests require unique safe relative artifact paths, hashes and coherent timestamps/evidence labels; the exporter still verifies file contents and actual observations.
- `ReadTransport.read`, `MonolithTransport`, `TraceSink.emit` and `Clock.now(): string` are SDK-free interfaces. `Clock.now` returns a UTC ISO timestamp. Initialization's `Result<void>` stays internal and is not a JSON HTTP payload. No shared schema constructs or verifies an anonymity worker.
