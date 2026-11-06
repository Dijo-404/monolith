# Fixed Uniswap quote: offline preparation

[MN-027 / issue #55](https://github.com/Dijo-404/monolith/issues/55) is being
prepared under the owner's explicit authorization for isolated offline ABI helpers
and simulated tests. The [claim and limits](https://github.com/Dijo-404/monolith/issues/55#issuecomment-6692849235)
record this exception. The normal MN-017, MN-023, MN-025 and registration gates
remain pending. This slice provides no live quote, worker observation, browser
bypass proof, deployed integration or sponsor acceptance.

## Fixed operation and sources

The network-free [helper](../apps/dashboard/src/features/quote/fixed-quote.ts)
constructs one Uniswap v3 QuoterV2 operation. It is not mounted in the dashboard or
connected to an observer, RPC provider or worker.

| Field | Value |
| --- | --- |
| Chain | Optimism, decimal `10` |
| QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |
| Token in | WETH, `0x4200000000000000000000000000000000000006` |
| Token out | Native USDC, `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Amount in | `10000000000000000` base units: 0.01 WETH |
| Fee | `500`: 0.05% |
| Square-root price limit | `0`, the Quoter's default limit |
| Block tag | `latest` |
| Selector | `0xc6a5026a` |
| Calldata | 164 bytes: selector plus five static ABI words |
| Callsite | `quote.fixed.exact-input` |

The [official Optimism deployment table](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-optimism-deployments)
documents the QuoterV2 and WETH addresses. The
[pinned official token list](https://github.com/Uniswap/default-token-list/blob/fc629302df08c20aa5ca368212b5e416b2299e27/src/tokens/optimism.json)
documents native USDC with six decimals. Native USDC and
bridged USDC.e are different tokens; this operation uses native USDC only. Sources
were read on 7 November 2026 (Asia/Kolkata). These are documentation checks;
deployed code, pool existence, liquidity and useful quote output remain untested.

The [pinned IQuoterV2 interface](https://github.com/Uniswap/v3-periphery/blob/24ccf014fe7f81d74a14c1689d6fdf123f280e45/contracts/interfaces/IQuoterV2.sol)
defines the canonical signature
`quoteExactInputSingle((address,address,uint256,uint24,uint160))`. Its five tuple
words are token in, token out, amount in, fee and price limit, in that order.
There is no dynamic tuple offset. QuoterV1 uses a different signature and order;
its calldata is rejected. The
[pinned official SDK test](https://github.com/Uniswap/v3-sdk/blob/4e16fe8e56c8c26541545f138c89133794c7ce72/src/quoter.test.ts)
provides an independent selector/order reference. The fixture's literal calldata
was also cross-checked offline using the already installed viem 2.57.16 encoder
and Keccak selector calculation. Neither the helper nor its tests import viem or
create a provider; no dependency or scanner exemption was added.

QuoterV2's non-view implementation simulates pool activity and reverts internally
to calculate a result. Future integration must use `eth_call`, as explained by
the [official quoting guide](https://developers.uniswap.org/docs/sdks/v3/guides/swapping/quoting)
and [pinned QuoterV2 implementation](https://github.com/Uniswap/v3-periphery/blob/24ccf014fe7f81d74a14c1689d6fdf123f280e45/contracts/lens/QuoterV2.sol).
No swap transaction, token approval, balance, wallet, signature or funding is
needed for this read-only scenario.

## Local API and validation

- `encodeFixedQuoteCall()` returns a fresh `{ to, data }` for the fixed operation.
- `createFixedQuoteRead(readId, endpointId)` returns a shared `Result<ReadRequest>`.
  IDs must meet the shared contract. The chain, callsite, target, calldata and
  block tag cannot be supplied by a widget. Obtain the endpoint ID from an
  independently admitted transport selection.
- `admitFixedQuoteRead(input)` validates the shared request contract and requires
  the exact fixed operation. It rejects extra request/call fields, write methods,
  another chain, target, selector, token, amount, fee, limit or block tag. Hex
  letter case may differ because it represents the same bytes; admitted calls
  return fresh canonical bytes. This function
  validates shape and operation only: an accepted endpoint ID is not evidence of
  an authorized URL, trusted registry, correct live chain or ready worker.
- `decodeFixedQuoteResult(input)` accepts exactly four 32-byte ABI words:
  `uint256 amountOut`, `uint160 sqrtPriceX96After`,
  `uint32 initializedTicksCrossed`, `uint256 gasEstimate`. It rejects truncated,
  trailing, odd-length and nonhex data, nonzero padding above the narrow integer
  widths, zero useful output/gas and a square-root price outside
  [TickMath's domain](https://github.com/Uniswap/v3-core/blob/5ea68a77cb541c6b3812df783be71ba8c081e25f/contracts/libraries/TickMath.sol).
  Zero crossed ticks is valid. Values become lossless decimal strings, never
  floating-point amounts. Gas estimate is contract execution context, not a
  transaction fee quote. ABI validity alone does not authenticate provider data.
- `decodeFixedQuoteResponse(input, expectedId)` uses the public shared envelope
  validator to correlate the RPC ID and sanitize provider errors before decoding
  the result. Transport callers that already receive a validated `Result<JsonValue>`
  use the result decoder; envelope validation still belongs to their adapter.

No API here performs I/O, grants a protected capability, samples a block, chooses
a provider, retries or changes application state. The decoded result carries no
timestamp, block number or evidence label: its caller must retain the actual
source and observation context. In particular, a separately sampled tip cannot
establish the exact execution block of an `eth_call` made with `latest`.

## Offline verification

Use the repository's pinned Node 24.22.2 and pnpm 12.18.0. From a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm exec vitest run tests/e2e/quote-privacy
pnpm exec tsx scripts/check-rpc-egress.ts
pnpm check
```

The [quote tests](../tests/e2e/quote-privacy) and
[fixture](../tests/fixtures/quote-privacy) are explicitly `SIMULATED`.
They verify canonical bytes, independent mutations, strict result decoding,
shared-schema interoperability, JSON-RPC correlation and sanitized failures.
The synthetic output is deliberately invented test data; it is not a market
quote, recorded RPC response or live integration artifact. Offline test success
cannot establish route protection, pool availability or a useful live quote.

## Remaining integrated work

After the normal gates and fresh ownership coordination, verify the configured
pool and deployed contracts through the admitted protected path. Extend the
operator's exact request allowlist and live-driver bindings before using this
call; the current observer and UI have not been changed to permit it. Inventory
every chain probe, supporting metadata read, quote and attempt. Implement real
worker/outage/cancellation handling and independent browser interception for the
injected direct quote and repaired useful operation. Preserve registry expiry,
publisher/origin policy, worker lifecycle and stale-result rejection.

The UI must disclose that the RPC destination still sees calldata, token pair
and amount. A quote is not settlement, private trading, MEV protection or a
verified state proof. Full acceptance still needs actual decoded useful output,
independent failure/repair/outage artifacts, redaction and reproducible source
bindings. `FEEDBACK.md` and the sponsor checklist belong to that later integrated
handoff; no feedback form, partner selection or repository publication has been
performed by this preparation.
