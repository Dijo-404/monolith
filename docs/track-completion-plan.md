# Complete the selected Mumbai tracks

The owner selected **Classic / new project** and explicitly added Uniswap and Whitechain on **7 November 2026 IST**. All four partners below are development targets. Check each item after its implementation/test/evidence is complete; an unchecked item names work to finish. Existing task owners retain their branches and paths.

| Partner | Classic tracks to complete | GitHub work |
| --- | --- | --- |
| Ethereum Foundation | Anon-RPC; CROPS App | [Final walkthrough #16](https://github.com/Dijo-404/monolith/issues/16), [release #17](https://github.com/Dijo-404/monolith/issues/17), [hosting #36](https://github.com/Dijo-404/monolith/issues/36) |
| Arkiv | Mirror; Build from scratch | [Importer #8](https://github.com/Dijo-404/monolith/issues/8), [reader #10](https://github.com/Dijo-404/monolith/issues/10), [routing #13](https://github.com/Dijo-404/monolith/issues/13), [judging docs #15](https://github.com/Dijo-404/monolith/issues/15) |
| Uniswap | Build with Uniswap | [Protected quote #55](https://github.com/Dijo-404/monolith/issues/55) |
| Whitechain | Scale; Operate; Tokenize | [Preflight #18](https://github.com/Dijo-404/monolith/issues/18), [contract #19](https://github.com/Dijo-404/monolith/issues/19), [relayer #20](https://github.com/Dijo-404/monolith/issues/20), [checkout #21](https://github.com/Dijo-404/monolith/issues/21), [merchant integration #87](https://github.com/Dijo-404/monolith/issues/87), [asset lifecycle #88](https://github.com/Dijo-404/monolith/issues/88), [packaging #22](https://github.com/Dijo-404/monolith/issues/22) |

The event permits **three partner selections**, with several tracks from one partner counting once. Build all four and choose three finished partner demonstrations for the dashboard. Classic does not include Continuity-only entries. Published cutoff: **7 November 2026, 09:00 IST**. [Official event guide](https://ethglobal.com/events/mumbai/info/details).

## Uniswap Build

The [Uniswap requirements](https://ethglobal.com/events/mumbai/prizes/uniswap-foundation) apply to genuine ecosystem tooling as well as protocol integrations. Complete the reusable privacy-checked quote scenario under #55:

- [ ] Use the accepted core/public deployment and verify official chain, Quoter/pool contracts and ABI references. Preserve the current owner's offline ABI work as the starting point.
- [ ] Return a decoded, useful quote for one fixed public token pair/amount through MonolithTransport and the verified browser worker. Record observation time and separately sampled tip; do not invent an exact execution block.
- [ ] Allow only exact reviewed contract/selector/calldata/block-tag combinations. Keep every supporting RPC read and chain-ID probe protected or blocked.
- [ ] Independently detect an injected direct quote; repair it and rerun the same useful quote with zero unexpected direct egress. Count failures/retries/bootstrap correctly.
- [ ] Test malformed ABI, wrong chain, stale/untrusted registry, worker outage, cancellation and stale results. Keep payload/pair/amount visibility and quote-versus-settlement limits visible.
- [ ] Add README links to deployed contracts and immutable integration source lines after implementation.
- [ ] Write root `FEEDBACK.md` from actual experience: successful flow, expected/actual behavior, reproducible friction and requested improvement. #55 owns that file.
- [ ] Complete the [Uniswap developer feedback form](https://developers.uniswap.org/hackathon-feedback), linking the public feedback file; retain confirmation. This is a participant action, not performed by this plan.
- [ ] Finish public-source, setup/license, demo and event-wide disclosure requirements in the [submission audit](prize-compliance.md).

Completion evidence: exact source/ABI links, commands/results, real decoded quote, injected failure, useful repaired success, outage capture, feedback URL and form confirmation. Do not mark a logo, installed SDK or offline ABI test as that evidence.

## Whitechain shared work

The [Whitechain requirements](https://ethglobal.com/events/mumbai/prizes/whitechain) apply to all three selected tracks. Complete shared infrastructure once and reuse it across their demonstrations:

- [ ] **MN-018 / #18:** Verify Sepolia chain **1874**, designated USDT **`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`**, decimals and deployed authorization ABI/code. Test protected reads and actual test-USDT/WBT access. Never assume permit/EIP-3009 support; obtain sponsor confirmation for a prefunded-vault strategy if used.
- [ ] **MN-019 / #19:** Implement the selected signed payment route with fixed token/merchant semantics, domain/chain binding, expiry, nonce/replay protection and appropriate accounting/role/reentrancy controls. Deploy and explorer-verify the actual committed contracts.
- [ ] **MN-020 / #20:** Implement bounded relayer submission, exact target/function rules, signature/amount/gas/rate checks, atomic idempotency and receipt reconciliation across retries/restarts. Keep operator keys out of browser/Git/public reports.
- [ ] **MN-021 / #21:** Build payer/merchant views and settle the designated USDT in the main flow. Verify receipt status, contract events and token `Transfer`, amounts/destination and gas payer. Protect app-owned status/balance reads; demonstrate leak detection and useful repair.
- [ ] **MN-022 / #22:** Put contract verification and actual settlement explorer links in README, explain why this flow benefits from Whitechain stablecoin settlement versus ordinary rails, and document setup, architecture and prototype limits.
- [ ] Retain public incremental history and root `WHITECHAIN_FEEDBACK.md` with honest experience and friction. #22 owns feedback and final documentation.
- [ ] Record a human-narrated **2–4 minute** video showing all relevant parties and completed flows. A shared EF CROPS video can be **2–3 minutes** if it demonstrates both sets of requirements; otherwise use separate correctly timed evidence videos.

Completion evidence: protected preflight, tested route decision, verified deployment/source, actual designated-USDT receipts, merchant gas funding and abuse tests, relevant per-track flows, public README/feedback/video. Synthetic asset/test inputs must remain labeled while genuine chain execution is evidenced separately.

## Whitechain Scale

- [ ] Let a payer complete checkout without WBT, seed-phrase setup or chain knowledge. Explain prototype account provisioning and any credit prefunding honestly.
- [ ] Show the merchant/business sponsoring gas, where its relayer gets WBT and the controls that prevent gas/fund drain.
- [ ] Complete a real designated-USDT payment and show both the useful payment result and verified sponsored gas; test invalid/tampered/expired/replayed submissions.
- [ ] Demonstrate that protected payment/status reads fail closed when the worker is unavailable and that repairing an injected read leak preserves useful operation.

Own the work through #18–21 and retain the final Scale demonstration under #22.

## Whitechain Operate

- [ ] **MN-030 / #87:** Expose the accepted checkout as a small widget/SDK/payment-link integration and add it to a separate demo merchant app in roughly 20 integration lines. Retain the exact example and line-count reference.
- [ ] Show both merchant and paying-customer views, order-to-receipt behavior, pending/failure/reconciliation and duplicate handling.
- [ ] Reuse the verified actual designated-USDT flow and protected read ports; the separate merchant app must not introduce direct RPC defaults.
- [ ] Consider a refund, renewal or accounting export as extra credit after the required reusable flow works. These examples are not all mandatory.

Completion evidence: independent integration source, actual customer/merchant walkthrough and receipts, meaningful integration tests, setup/architecture/limitations. A plain transfer button alone does not complete this target.

## Whitechain Tokenize

- [ ] **MN-031 / #88:** Choose one bounded asset model, such as a synthetic invoice-financing example or test note, with explicit issuer/investor/business roles and prototype assumptions.
- [ ] Enforce meaningful lifecycle/transfer rules in contracts: for example participant admission, maturity and settlement conditions. Test forbidden transfers, unauthorized roles, premature/expired/repeated settlement and accounting invariants.
- [ ] Deploy and verify the extension on chain 1874, and demonstrate an issuance-to-funding/payment/settlement lifecycle step. Use designated USDT for all lifecycle payments and retain explorer receipts and state transitions.
- [ ] Build the corresponding business/issuer/investor view and protect its browser chain/status reads through the existing transport.
- [ ] Document asset assumptions and limitations. Synthetic asset inputs are not evidence of real customer assets or legally enforceable rights.

Completion evidence: enforced contract rules and tests, verified source, full lifecycle demo with actors and genuine token/state-transition receipts. Paying an invoice belongs to Operate; financing/selling it with enforced lifecycle rules is the Tokenize extension.

## Finish EF, Arkiv and the submission bundle

- [ ] Finish the genuine supported private-read → direct-leak detection → useful repair walkthrough and clean-clone release under #16/#17, preserving actual denominators and bootstrap/payload disclosures.
- [ ] Resolve CROPS host-injected behavior and attach a lead-property video within its three-minute limit; keep the README CROPS section and licensing/run instructions current.
- [ ] Recheck both Arkiv expiry clocks and actual independent query/product selection for the final run. Retain all [judging documents](../arkiv/schema.md), source/license/publisher/query references and actual import evidence.
- [ ] Complete [AI usage](ai-usage.md) with actual human contributions and the relevant historical prompt/spec/asset inventory; retain truthfully labeled reused materials and Classic timing facts.
- [ ] Publish the reviewed source/history with owner approval, verify unauthenticated access and link the exact completed artifacts.
- [ ] Select three partner programs, submit through the participant dashboard and retain the receipt before the cutoff. Track completion is checked against artifacts, never inferred from an unchecked plan.

## Implementation order

Use the established core/public acceptance path, then complete Uniswap #55 with its existing owner. Whitechain starts with #18 → #19 → #20 → #21. After accepted #21, complete reusable merchant integration #87 and the separate asset lifecycle #88 in their coordinated scopes; #22 packages all three tracks. Core MN-017 remains independently releasable. These dependencies schedule work; every selected target stays on this plan until completed or the owner changes scope.
