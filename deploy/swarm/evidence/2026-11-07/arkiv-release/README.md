# Observed Arkiv release publication and read

Issue [#99](https://github.com/Dijo-404/monolith/issues/99). This directory adds release-discovery evidence to the [original Swarm upload/browser evidence](../README.md); it does not replace those records. All copied JSON receipts retain their original bytes. [Reconciliation summary](reconciliation-summary.json) binds their SHA-256 values and the corrected read sources.

One actual create produced entity `0xfc1627a9bf52005565d74111403477cc08c89d584a954da02371ffe73018179d` under the explicitly trusted publisher `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` on Rabdi chain `7794095`. Transaction `0x5f22569bf2158e00f1be1b3b7f3cdf6c0bbcf06b9023a2bdd0f39e37df36ba28` succeeded at block `310566`; gas `174479` at `1000000000` wei cost `174479000000000` wei, within the fixed `2000000000000000` wei ceiling. No second create was attempted.

| Receipt | What it establishes |
| --- | --- |
| [Descriptor](descriptor.json) | Exact published source/reference, canonical ten-file inventory and bounded lifetime. |
| [Original preview](original-preview.json) | Earlier offline-only preparation; its `UNTESTED` label is preserved. |
| [Prewrite](prewrite.json) | Existing signer matched the explicit publisher; read-only chain/block/balance checks covered the fixed fee ceiling. No transaction at this step. |
| [Write code bindings](write-code-bindings.json) | Frozen clean code `c4469171763853fc9d21058572a09665ef211846`, compiled adapter, CLI, dependencies and descriptor hashes used for the one create. |
| [Publication intent](publication-intent.json) | One-create bound, descriptor/source binding and reserved operation; no automatic retry. |
| [Original publication result](original-publication-result.json) and [CLI blocked result](original-cli-blocked.json) | Post-create verification did not complete. These are retained as uncertain outcomes, rather than rewritten as success. |
| [Known-ID journal projection](known-id-journal-projection.json) | Safe selected public fields show `SUBMISSION_KNOWN` with both IDs persisted by the post-create callback. Private state remains unchanged; this local state alone does not establish chain success. |
| [Incomplete reconciliation](original-incomplete-reconciliation.json) | The indexed read found the entity, but the diagnostic stopped before completing transaction reconciliation. No signing, writes or block scan. |
| [Confirmed transaction](confirmed-transaction.json) | Later read of the known transaction receipt confirmed success and the expected entity contract log, with no signing key or new submission. |
| [Independent read](independent-read.json) | Corrected adapter validated trusted creator/owner/readonly flags, current chain/block and UTC lifetime; all ten Swarm files' sizes/hashes and executable MIME verified. No signing key loaded. |

The initial adapter incorrectly expected `Uint8Array` for SDK bytes values. SDK 1.0.1 actually returns a hex string. Correction `a48b750` adds bounded strict hex/UTF-8/canonical decoding and a regression using the SDK's public helper. Independent receipt and descriptor checks confirmed the same entity/reference/inventory; a second write was unnecessary. The durable private journal remains reserved with the known IDs; these public receipts do not authorize replay.

The successful content read was observed at `2026-11-06T23:21:25.158Z` and verified 673,482 bytes. Three WOFF2 responses had literal `false` MIME headers: their exact bytes verified, but MIME remains explicitly unverified with warnings. The reader grants no RPC admission and proves neither anonymous browsing nor future storage retention. Original real-worker/browser evidence is linked above, separately.

The record expires at block `353315`; its descriptor expires at `2026-11-07T23:00:00.000Z`. Either condition ends trust. Recorded success is historical and does not override current expiry or availability. Actual provider postage batch ID is still **unknown**, demo-video timestamp **pending**, and sponsor eligibility unclaimed. No credential values/paths, source archive, private wallet payloads or raw IP logs are retained here. See the [runbook](../../../../../arkiv/swarm.md) for reproduction and limits.
