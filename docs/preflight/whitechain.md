# Whitechain token and gasless-route preflight (MN-018)

The designated test-USDT exposes a promising token-native authorization route. Actual public reads and verified implementation-source inspection support investigating Route A, an isolated real Nym-worker Whitechain chain-ID probe/read passed, and later zero-value EIP-3009 node simulations accepted correct signatures and rejected the specified negative controls. **Funded nonzero authorization, sponsored settlement and funded role separation remain unproven.** The route remains unselected and payment activation remains blocked. This report is ready to review as a bounded feasibility result, not accepted payment feasibility.

The owner authorized starting this two-path task locally before planning PR #85 merges, in the [MN-018 claim](https://github.com/Dijo-404/monolith/issues/18#issuecomment-6697462166). This exception changes planning order only. It does not waive implementation evidence, downstream dependency merges or owner acceptance. Core privacy release and concurrent sessions retain their existing ownership.

## Reproduce the bounded operator check

Use the repository's pinned Node 24.22.2 and pnpm 12.18.0. The [preflight script](../../scripts/whitechain-preflight.ts) needs no new dependency, key, wallet, configuration file or browser session.

```sh
pnpm exec tsx scripts/whitechain-preflight.ts --help
pnpm exec tsx scripts/whitechain-preflight.ts --self-test
pnpm exec tsx scripts/whitechain-preflight.ts --run > /tmp/monolith-whitechain-preflight.json
```

Default/help are offline. `--self-test` runs deterministic in-memory boundary cases and labels its output `SIMULATED`; successful software checks exit 0. `--run` explicitly opts into direct, public operator reads and emits a JSON diagnostic report. It exits **2**, including when every diagnostic read succeeds, because this command cannot establish the remaining activation gates. Invalid arguments or an unexpected command failure exit 1. A successful getter never produces a successful payment status.

Only these fixed targets are contacted:

| Target | Fixed value |
| --- | --- |
| Network / expected chain | Whitechain Sepolia / `1874` (`0x752`) |
| Public RPC | `https://rpc.testnet.whitechain.io` |
| Explorer | `https://explorer.testnet.whitechain.io` |
| Designated test-USDT proxy | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |
| EIP-1967 implementation slot | `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` |

The `--run` diagnostic has no URL, token, wallet, method or calldata override. It does not load environment secrets. Its RPC allowlist is `eth_chainId`, `eth_blockNumber`, `eth_getCode`, `eth_getStorageAt` and three fixed getter `eth_call`s. Code/storage/getters share one captured block tag. The implementation address comes from that token's checked slot; its code is read at the same block and its current explorer metadata is inspected separately. This does not prove historical source/bytecode equivalence. The separate funding mode below accepts only public demo query addresses and a requested token amount; it never accepts signing material.

Requests omit credentials, reject redirects and make no retries or fallback calls. Each request/body is bounded to eight seconds and one MiB; the whole run is bounded to sixty seconds and twelve requests (ten in the ordinary successful diagnostic path). Strict RPC version/string-ID/envelope/result checks reject mismatched or malformed responses. Wrong chain, missing token code, malformed decimals or missing implementation stop dependent probes. Optional getter/explorer failures retain sanitized diagnostics. Late headers, stalled bodies and oversized streams are cancelled. Provider messages, error data, response bodies and stack traces are not exported. The fixed `Mozilla/5.0` User-Agent is required by the observed public edge behavior; requests without it previously returned 403. It conveys no anonymity or verification claim.

These requests expose the **operator's ordinary network path** to the public services. They are not browser application reads and earn no protected-read credit. The zero-address nonce is a synthetic probe, not a shopper account. This direct client must never be used as a browser fallback. Browser checkout reads still require real verified-worker `MonolithTransport` routing or must fail closed.

## Public demo funding snapshot

The owner confirmed that public demo addresses will be supplied. No address or balance has yet been supplied or fabricated. Once available, run:

```sh
pnpm exec tsx scripts/whitechain-preflight.ts --funding \
  --shopper <public-demo-shopper-address> \
  --merchant <public-demo-merchant-address> \
  --relayer <public-demo-relayer-address> \
  --admin <public-demo-admin-address> \
  --amount-base-units 1000000 > /tmp/monolith-whitechain-funding.json
```

Replace the angle-bracket placeholders before running; they are not shell literals or fabricated wallets. Use public synthetic demo accounts only. The command accepts no private key, signature, RPC URL or arbitrary calldata. All four nonzero 20-byte addresses must be distinct after case normalization, and the amount must be a positive canonical uint256 decimal. Duplicated, missing, malformed or unknown options are rejected before network access. A 32-byte private key fails address admission and is never echoed.

The twelve-request maximum covers chain ID, one block number, nonempty designated-token code, exact six-decimal validation, and each role's WBT plus designated-token balance at that block. Funding mode adds only `eth_getBalance` and a fixed `balanceOf(address)` selector; it has the same public fixed RPC, deadlines, body bound, no redirects/retries and strict response checks as the diagnostic. It sends query addresses directly to the RPC, omits them from output and reports base-unit balances under static role names. It loads no credential files and performs no signature or transaction.

Snapshot flags show whether all balances were observed, the shopper has **zero WBT** and at least the requested test-USDT, and the relayer/admin each have positive WBT. Failure or an unqueried role remains explicit; missing values are never interpreted as zero. All output still exits **2** with payment readiness **BLOCKED**. Separate addresses do not prove separate keys or account control. Positive WBT does not prove enough gas for deployment/submission, and a token balance does not establish its official allocation provenance, successful authorization or settlement. The merchant may receive its token balance only after checkout; no initial merchant-token funding is required by these snapshot flags. No public report may relabel this read-only snapshot as a payment receipt.

## Actual observations

The first independently retained capture ran **2026-11-06 22:31:55.240–22:31:59.733 UTC** (7 November IST), at block **12,407,949** / `0xbd548d`. It contains **12 HTTP requests: 10 RPC reads and 2 explorer GETs**, all HTTP 200. Earlier exploratory requests included 403/405 responses and are not relabeled as the retained successful capture. No transaction, signature, key, faucet request or existing runtime was used.

| Observation | Actual result |
| --- | --- |
| `eth_chainId` | `0x752` / 1874 |
| `decimals()` | 6; one test-USDT is 1,000,000 base units |
| `name()` / `symbol()` (initial independent capture) | `Tether USD` / `USDT` |
| Proxy runtime | 2,227 bytes; SHA-256 `e518057ee9772b6d5ad104f0c0cbae96d42e5543dcaaff3b39257089ab5fe699` |
| Implementation slot | `0x26425662d126412128967ecf0a02ec48573026f7`; matches explorer implementation metadata |
| Implementation runtime | 16,067 bytes; SHA-256 `b7cefee3ea43de6b829564109f95aa87aa1939918c705c8fa5d9c92faabe52c4` |
| Implementation explorer assertion | `TetherTokenV2`, `is_verified=true`, `is_fully_verified=true`, compiler `v0.8.4+commit.c7e474f2` |
| Implementation main source hash | SHA-256 `84c43009c9e40ce1ddcc4bbff9827f8cf3f89a2e0ce622f378802df32ef70ded` |
| Proxy explorer verification flags | Both null; **proxy verification itself is not established** |
| `DOMAIN_SEPARATOR()` | `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25` |
| `nonces(0x0000000000000000000000000000000000000000)` | 0 |

Current public evidence endpoints: [designated token explorer](https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7), [proxy metadata](https://explorer.testnet.whitechain.io/api/v2/smart-contracts/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7), [implementation source/ABI](https://explorer.testnet.whitechain.io/api/v2/smart-contracts/0x26425662D126412128967ECf0a02EC48573026F7). These are live references and can change. The token is an upgradeable proxy; recheck the implementation and authorization domain before signing or submitting.

The retained explorer-response SHA-256 values were `5544a2ae8ef65456c2e58b84b3fa7d943b8be434dc81519a958003d4d7af0cbb` (proxy) and `385a89a221fe0451c3d9a58d9720d4b8b94fb4cf7b6d3c6525745fbf0de84475` (implementation). They identify those responses, not a guarantee that today's endpoint bytes match them.

The implementation ABI declares both forms of each authorization method:

```text
permit(address,address,uint256,uint256,uint8,bytes32,bytes32)
permit(address,address,uint256,uint256,bytes)
transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
```

The captured implementation dependency source initializes `__ERC20Permit_init(_name)`. An independent **offline** EIP-712 domain reconstruction with installed viem public exports matched the observed separator for `name="Tether USD"`, `version="1"`, `chainId=1874`, `verifyingContract=<designated token proxy>`. Version `2` produced `0x0f3fbc211bd0a3680436461960323978a965939a6a2ea795583a5ea112e30272`, a negative control that did not match. Domain reconstruction verifies these domain inputs against the observed getter, not an actual signed payment.

The retained raw public capture also contains full source/ABI and exact request/response hashes. Its local report SHA-256 after the offline domain check is `471449164e5a9683d6db3fd2690902892445f160477cf1c648ba4e210daba154`. It is attached to the task handoff; its local path is not a clean-clone dependency. The committed observations above and runnable script remain available independently.

The committed CLI's first live attempt at `2026-11-06T22:36:33.404Z` stopped after one request with `RESPONSE_INVALID`: native fetch canonicalized the bare RPC origin with a trailing slash. The response URL comparison was corrected to use the canonical target URL, and the offline mock now reproduces native normalization. That failed artifact remains preserved (SHA-256 `4bca8003d8d1ff2f0328e0906fb98b511eadce922592cdd7219d0d8c52fca263`).

Actual CLI attempt 2 ran `2026-11-06T22:36:55.942Z`–`2026-11-06T22:37:00.048Z`, at block **12,408,248** / `0xbd55b8`. All ten diagnostic requests completed with zero diagnostics and matching code/source/domain results. Exit 2 / activation `BLOCKED` is the intended outcome. The executed script SHA-256 was `60d7774945764cbf395a2b814c1d8dc3f77e0ee52ea1e97e11044e0467fa677d`; exact stdout SHA-256 is `bb87d4bd3cc2a37234471db9c41358d18b3071c3b6368e22bfe0e680add81912`. In this diagnostic projection, `isVerified=false` means the API supplied no positive verification assertion (the raw proxy flags were null), not proof that verification is impossible.

Retained CLI stdout, with no edits to values:

```json
{
  "schemaVersion": 1,
  "sourceTask": "MN-018",
  "evidence": "OBSERVED_LIVE",
  "startedAt": "2026-11-06T22:36:55.942Z",
  "completedAt": "2026-11-06T22:37:00.048Z",
  "scope": "operator-direct-public-read-only",
  "rpcUrl": "https://rpc.testnet.whitechain.io",
  "explorerUrl": "https://explorer.testnet.whitechain.io",
  "token": "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  "requestCount": 10,
  "observations": {
    "chainId": "1874",
    "blockNumber": "12408248",
    "blockTag": "0xbd55b8",
    "tokenCode": {
      "bytes": 2227,
      "sha256": "e518057ee9772b6d5ad104f0c0cbae96d42e5543dcaaff3b39257089ab5fe699"
    },
    "decimals": 6,
    "domainSeparator": "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25",
    "syntheticZeroAddressNonce": "0",
    "proxyExplorer": {
      "isVerified": false,
      "isFullyVerified": false,
      "sourceSha256": null,
      "declaredAuthorizationFunctions": [],
      "verificationSource": "current-explorer-api"
    },
    "implementationAddress": "0x26425662d126412128967ecf0a02ec48573026f7",
    "implementationCode": {
      "bytes": 16067,
      "sha256": "b7cefee3ea43de6b829564109f95aa87aa1939918c705c8fa5d9c92faabe52c4"
    },
    "implementationExplorer": {
      "isVerified": true,
      "isFullyVerified": true,
      "sourceSha256": "84c43009c9e40ce1ddcc4bbff9827f8cf3f89a2e0ce622f378802df32ef70ded",
      "declaredAuthorizationFunctions": [
        "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
        "permit(address,address,uint256,uint256,bytes)",
        "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
        "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
        "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
        "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)"
      ],
      "verificationSource": "current-explorer-api"
    }
  },
  "diagnostics": [],
  "readiness": "BLOCKED",
  "routeChoice": "UNSELECTED",
  "gates": {
    "protectedBrowserRead": "UNTESTED",
    "fundedSeparatedRoles": "UNTESTED",
    "signedNativeAuthorization": "UNTESTED",
    "sponsoredSettlement": "UNTESTED",
    "vaultMentorApproval": "UNTESTED"
  },
  "limits": "ABI entries and getters are diagnostic only; they establish neither successful authorization nor its absence. Explorer verification is a current assertion, separate from pinned-block RPC code. No browser anonymity, funding, signature, settlement, deployment or sponsor eligibility is established. No direct browser fallback is enabled."
}
```

## Isolated actual protected Whitechain probe

A separate actual browser probe passed at **2026-11-06 22:39:44.867–22:40:05.475 UTC**, using Node 24.22.2, Chromium 158.0.8127.18, Playwright 1.65.0 and the real Anon-RPC 0.4.0 Nym driver. Both `MonolithTransport.validateEndpoint` and the subsequent `eth_chainId` read returned the expected `0x752`, on attempt 1. Their trace durations were 5,845 ms and 721 ms respectively. Two Ethereum specifier lookups were separately recorded as **non-anonymous bootstrap**, not protected Whitechain operations.

The independently observed 18,283,862-byte resolver body hashed to the actual specifier hash `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`. An independent browser HTTP interceptor first proved it could abort an explicit direct-target negative control. During the actual protected operations it observed **zero ordinary direct requests** to the Whitechain target. Its scope excludes WebRTC/KPS internals; no Whitechain-specific paired observer/source classification was performed. This is a bounded real-worker routing observation, not a general anonymity or application-wide coverage claim. The destination still sees RPC payloads.

All five traces remain in the raw artifact: two bootstrap operations, two successful protected operations and a separate **denied post-close control**. Do not turn that control into a 100% coverage claim. The live transport ended CLOSED with zero iframes, cleared metadata, rejected further reads and destroyed the browser context. A separate in-memory pending-resolver cleanup control was **SIMULATED** and never supplied the live worker.

This probe used a manually approved fixed Whitechain target with **synthetic local candidate provenance**, not an Arkiv record. It copied the existing public-package acceptance harness into a temporary directory, selected public import exports, used an ephemeral loopback port and made one actual worker attempt with no retry. Its source/build/package/lock and temporary harness bindings were checked before and after execution; all were unchanged. Existing dashboard/release source, build output, runtime and earlier captures were untouched. The first harness invocation stopped in setup on an import-condition resolution error **before any server, browser or network call**; its BLOCKED artifact is preserved separately, SHA-256 `29655cf0c4b33670c9fb8e753a0d95b2e29dfe750ce5dae1ea523a81c63cedab`. The corrected harness reads only the package's public import-export map.

The successful original artifact SHA-256 is `77bd02506befab17d15bf2f742f2bc8ca444fbc374022ef43417465270904220`. The exact temporary runner, page and source-binding manifest SHA-256 values are `6803421dbfe3b364b93ddfa0f3b49886f58ab63580347d728d30f14db66bb475`, `d119a82a48acbc370562e025712a130e5b3d948fcfddc6ea04d9b3c503919d8e` and `83f8b32646b240fb4bab6122292babb73918b002dc1519d77e693ea1266474c3`. Original JSON and the temporary harness bundle are retained with the task handoff. The summary below is explicitly a projection, not a byte-for-byte copy of the original artifact:

```json
{
  "schemaVersion": 1,
  "sourceTask": "MN-018",
  "evidence": "OBSERVED_LIVE",
  "sourceCommit": "bd43ff315aa1d98552a7f117f91b4afb56adefd4",
  "startedAt": "2026-11-06T22:39:44.867Z",
  "generatedAt": "2026-11-06T22:40:05.475Z",
  "artifactSha256": "77bd02506befab17d15bf2f742f2bc8ca444fbc374022ef43417465270904220",
  "target": "https://rpc.testnet.whitechain.io",
  "chainId": "1874",
  "result": "0x752",
  "worker": {
    "network": "nym",
    "specifier": "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0",
    "workerHash": "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8",
    "resolverBytes": 18283862,
    "actualResolverHashMatched": true
  },
  "successfulProtectedOperations": 2,
  "protectedProbeDurationMs": 5845,
  "protectedReadDurationMs": 721,
  "nonAnonymousBootstrapOperations": 2,
  "postCloseDeniedControl": 1,
  "ordinaryDirectTargetRequests": 0,
  "directInterceptionSelfCheckPassed": true,
  "shutdownPassed": true,
  "inputsUnchangedAfterRun": true,
  "endpointProvenance": "SIMULATED-local-configuration-not-Arkiv",
  "whitechainPairedSourceClassification": "UNTESTED",
  "funding": "UNTESTED",
  "signedAuthorization": "UNTESTED",
  "settlement": "UNTESTED"
}
```

The executable operator CLI still reports its own protected-read gate `UNTESTED`: it does not load or authenticate external browser artifacts. This later browser proof is a separate observation. It proves neither protected balance/receipt reads nor checkout integration. Reproduce it using a separate checkout of the bound core commit, build its public packages, and use the retained temporary bundle with existing pinned browser tools. The original public harness is [the package acceptance fixture](../../packages/transport/test/live/README.md); its ordinary Ethereum target must not be relabeled Whitechain without applying and reviewing the retained fixed-target modifications. The eight-file retained harness archive is 12,601 bytes, SHA-256 `ee3fc9edd696618b4f69ce1ecd08bd19a0d3bf82407591c4e78e6e3909a97bc7`; its members match the frozen inputs and contain no dependencies, build output or credentials. Temporary paths are not an install or clean-clone dependency of the operator CLI.

## Signed zero-value node simulation

The owner requested continued bounded preflight work. A separate temporary operator diagnostic tested the actual designated token with ephemeral synthetic authorization signers, using **`eth_call` only**. It signed no transaction, broadcast nothing, loaded no key file or user account, exported no signer address/private key/signature/calldata, and made one run with no retry. The public RPC did see the ephemeral public addresses and authorization calldata/signatures as direct operator traffic. These observations are separate from the protected browser proof and the unqueried public demo funding roles.

The actual run completed **2026-11-06 22:55:09.890–22:55:18.329 UTC**, at block **12,409,342**, hash `0x4b7c0244ee6e74b170c6bbb5a4fee837a005b5c9d2b561069370299ff993efc1`, timestamp `1794005710`. Exactly **30 read-only RPC requests** were made. Before the authorization cases, it checked chain1874, both pinned code hashes, EIP-1967 implementation, reconstructed domain and both onchain EIP-3009 type hashes. It also checked the fresh signer was an EOA with zero designated-USDT and zero WBT, the distinct caller had zero WBT, the selected nonce was unused and relevant roles were not blocked. All contract calls used the captured block, and the block hash/timestamp were rechecked at the end.

It used exact `TransferWithAuthorization` and `ReceiveWithAuthorization` typed data: `from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`; domain `Tether USD` / `1` / chain1874 / designated proxy. Both correctly signed messages authorized **zero** tokens, with strict timestamp bounds around the pinned block. A separate tampered-calldata negative changed value to one without changing the original zero-value signature; it was required to revert and was not a nonzero-payment test.

| Case | Actual classified outcome |
| --- | --- |
| Correct zero-value transfer authorization | `SIMULATION_SUCCEEDED` |
| Correct zero-value receive authorization, called by recipient | `SIMULATION_SUCCEEDED` |
| Identical transfer simulation repeated at the same block | `SIMULATION_SUCCEEDED`; **not a replay rejection** |
| Wrong domain version | `INVALID_SIGNATURE` |
| Wrong domain chain | `INVALID_SIGNATURE` |
| Wrong domain verifying contract | `INVALID_SIGNATURE` |
| Altered calldata value | `INVALID_SIGNATURE` |
| Altered recipient | `INVALID_SIGNATURE` |
| Wrong signer | `INVALID_SIGNATURE` |
| `validBefore` equal to block timestamp | `AUTH_EXPIRED` |
| `validAfter` equal to block timestamp | `AUTH_EARLY` |
| Receive caller differs from recipient | `RECIPIENT_CALLER_MISMATCH` |

All twelve cases matched their expected result. Negative controls require exact decoded, allowlisted contract revert classifications; an RPC outage, unclassified rejection, mismatched envelope or unexpected return value cannot count as success. The signer balance remained zero and the selected authorization state remained false after the simulations. Each `eth_call` discards its state: that is why the identical authorization simulation can succeed twice. This does **not** establish a persisted nonce transition, replay resistance across transactions, a funded transfer, gas sponsorship, a receipt, merchant/order semantics or eligibility. The report's diagnostic status is `DIAGNOSTIC_PASS`, but exit **2** and payment activation **BLOCKED** remain intentional.

The retained actual JSON SHA-256 is `cf41fc183fe296997f860a68a72f2126f46dd233b3aea3c82a916f23686c1b8e`. The executed temporary script SHA-256 is `26414534b83bbd4bda94e79954590d2c6ee2d2f8593bd3059b968f874a3f94dc`; its explicitly declared viem 2.57.16 package and lock hashes are `a3801c542a6971420ecf74f698ddf3f9b21f1317363b40d3216f20606283e10b` and `62eadbb3ca0981f51d6d86c077a7e2216e8a4ab2a384822ec0085a82a22eb8fa`. Its isolated offline installation reused thirteen cached packages with zero downloads and did not edit any repository manifest or lockfile. Twenty-nine offline cryptographic, protocol, pinning, cancellation and redaction checks passed before the run. The exact four-file diagnostic/package/lock/instructions archive is 14,179 bytes, SHA-256 `20ef57b3a6237804a2bc0fc3d8c2c3345cb78cdf4435b58f1926b5b2734c0d23`; its members match the frozen inputs and contain no keys, signatures, calldata, dependencies or captured data. The original result and reproduction recipe are retained with the task handoff. The temporary self-test needs the separately retained public source-capture fixture; its explicit `--run` uses only installed pinned dependencies and the static reviewed trust pins. These artifacts do not activate a browser or payment API.

## Route decision and acceptance gates

**Investigate token-native Route A next; do not activate it yet.** ABI declarations, nonempty code, a working nonce/domain getter and matching EIP-712 domain are positive diagnostics. The later zero-value simulations additionally support the exact signed EIP-3009 schema and specified rejection behavior, within their stated limits. None proves successful funded nonzero execution. A failed/reverted getter likewise cannot prove an authorization method is absent. This preflight sends no `permit` or transfer transaction, even as a negative test.

`permit` alone grants allowance and does not settle a checkout or bind its merchant/order semantics. A later payment-contract task must define a fixed authorized spender, immutable quote/payment bounds and onchain order/replay constraints before using it. EIP-3009 also needs the actual typed schema, recipient/amount/nonce/time bounds, signer validation and relayer idempotency. Captured source uses strict `validAfter < block.timestamp < validBefore`; `receiveWithAuthorization` additionally requires the recipient to equal `msg.sender`. Do not substitute an arbitrary relayer address for that recipient. Freeze and test the selected route in MN-019 with the actual ABI; this report does not activate the provisional shared payment intent.

**Route B remains unapproved.** There is no retained Whitechain mentor response accepting the prefunded-credit-vault pattern. No vault is built or presumed eligible. A future use must disclose custody/prefunding and record mentor confirmation, genuine designated-token movement, replay protection and payer gas evidence first.

| Gate | Status in this preflight | Exact recovery action |
| --- | --- | --- |
| Core protected comparison + Arkiv-backed selection | Previously accepted for the core | Preserve [MN-009 actual acceptance](https://github.com/Dijo-404/monolith/issues/9#issuecomment-6689885675) and [MN-013 actual acceptance](https://github.com/Dijo-404/monolith/issues/13#issuecomment-6688778371); this is not Whitechain evidence |
| Token chain/code/decimals/ABI/getters | Observed as above | Recheck implementation/domain at execution time; retain source and actual code bindings |
| Protected Whitechain chain-ID probe/read | **OBSERVED LIVE**, bounded configuration above | Preserve the actual worker/input/interception proof; separately test real checkout balance/status reads through MonolithTransport and fail closed on errors |
| Designated test-USDT funding | **UNTESTED / BLOCKED** | Obtain an official test-USDT allocation for fresh synthetic demo roles; verify actual token balances; no substitute token or assumed mint permission |
| Merchant WBT and separate roles | **UNTESTED** | Fund only the merchant relayer/admin gas accounts; prove the shopper starts with zero WBT and pays no gas; keep signer/admin/relayer keys separate and server signing material out of browser builds |
| Token-native signed execution | Zero-value node simulation **OBSERVED**; funded execution **UNTESTED** | Use actual funded roles to prove nonzero execution and persisted nonce/replay behavior, then the required alteration/expiry negatives and merchant/order bounds before selecting the route |
| Sponsored settlement | **UNTESTED** | Check successful receipt, expected payment contract/event, designated-token `Transfer`, recipient/amount and confirmation policy, with relayer gas attribution |
| Vault route eligibility | **UNTESTED / UNAPPROVED** | Obtain an explicit mentor response before choosing the prefunded route |
| Sponsor qualification | **NOT CLAIMED** | Complete the selected track's actual product/evidence/documentation/video requirements; participant selection and acceptance are separate |

The [official WBT faucet instructions](https://docs.whitechain.io/learn/get-started/get-testnet-wbt) require GitHub authentication, an account at least 30 days old and captcha; they document 0.5 WBT per rolling 24 hours. The [faucet](https://faucet.testnet.whitechain.io/) is a human authentication boundary. The later read-only follow-up found the current [public faucet configuration](https://faucet.testnet.whitechain.io/api/info) advertising **2 WBT per 86,400 seconds**, GitHub OAuth and a 30-day minimum account age at `2026-11-06T22:50:09.596441+00:00`. The documentation and service configuration differ; neither is evidence of a successful claim or guaranteed delivery. No authentication or faucet claim was attempted here.

The later follow-up also found an enabled **exact-token** Ethereum Sepolia → Whitechain route in the current official bridge configuration. The [official token list](https://whitechain.io/tokens/whitechain.tokenlist.json) version 3.0.0 lists the designated `0xcedf…55a7` token with six decimals on 1874; older prose still names a different `0xaa7962…8f46` token. The [bridge app](https://bridge.testnet.whitechain.io/) serves public client code identifying `https://bridge-qa.whitechain.io/api` as its configured API. At `2026-11-06T22:52:20Z`, its [enabled pair response](https://bridge-qa.whitechain.io/api/v1/pairs?origin_chain_id=11155111&target_chain_id=1874) named the designated USDT on both origin chain 11155111 and destination 1874; its [destination token response](https://bridge-qa.whitechain.io/api/v1/networks/1874/tokens) also marked it enabled. The configured origin/destination bridges are `0x4e6106520Ac560a59E29e631183EF29F3a2eD90F` and `0x8790832Ba493Cc16a4dBC5c961B0C4950632799c` respectively.

This is public **configuration evidence**, not a tested bridge transfer, available-liquidity measurement or token-allocation receipt. A public self-service distribution process for the starting exact USDT was still not confirmed on either chain. The recovery options are an official allocation directly on Whitechain or an official exact-token allocation on Sepolia followed by the configured bridge journey, with required source-network test gas. No wallet connection, bridge action, message, claim, signature or transaction was performed in this funding research. The token's captured `mint` function is owner-restricted; arbitrary minting or a replacement token is not a funding solution. Do not reuse the Arkiv operator's key for a checkout role or request production funds.

Funding and a successful signed route are the immediate recovery inputs. MN-019–MN-022 and the merchant/asset-lifecycle extensions remain gated despite the successful bounded protected chain read. Merging this diagnostic report alone does not make them ready. No payment feature, browser routing, existing observer, registry, runtime, deployment, shared contract or dependency manifest changes in this task.

## Validation and remaining limits

The original **33** script offline checks passed, covering wrong-chain early stop; argument admission; string-ID/version/result/error correlation; batch/extra/missing fields; malformed/noncanonical hex; missing/odd bytecode; uint8 decimals; invalid proxy slot; failed optional getters; HTTP/redirect/JSON/UTF-8/stream limits; late headers/stalled-body cancellation and timeout; provider-error redaction. The funding follow-up expands this to **57** passing offline cases, adding strict role/amount admission, a block-pinned twelve-request balance snapshot, output address omission, early wrong-chain stop, insufficient-token/nonzero-shopper-gas/zero-sponsor-gas flags, partial-failure handling, mixed-case duplicate rejection and uint256 boundary controls. Another **62** independent in-memory probe groups passed with zero network requests. Synthetic success still leaves payment readiness `BLOCKED`; the token diagnostic route remains `UNSELECTED`. Focused ESLint and standalone strict TypeScript with explicit Node types pass for the follow-up. Original full `pnpm check` results were 1,895 workspace tests on the captured core and 1,901 on the first PR candidate, with lint, types and all builds; follow-up full checks are recorded in the PR handoff after the final delta.

Run the script's own strict check explicitly: the existing workspace typecheck does not automatically include this standalone file.

```sh
pnpm exec eslint scripts/whitechain-preflight.ts --max-warnings 0
pnpm exec tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --types node --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck scripts/whitechain-preflight.ts
pnpm exec tsx scripts/whitechain-preflight.ts --self-test
pnpm check
git diff --check
```

Current official references: [Whitechain Mumbai requirements](https://ethglobal.com/events/mumbai/prizes/whitechain), [testnet network details](https://docs.whitechain.io/learn/network/testnet), [proxy verification instructions](https://docs.whitechain.io/build/deploy/verify-proxy-contracts), [architecture](../architecture.md), [payment boundary](../contracts.md#conditional-checkout-boundary). Scale needs designated-token settlement, verified contracts, no shopper gas and abuse controls. Operate also requires a reusable merchant integration, and Tokenize requires a contract-enforced asset lifecycle. None is asserted complete by this preflight.
