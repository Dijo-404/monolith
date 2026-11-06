# ETHGlobal Mumbai submission audit

Checked **7 November 2026 IST** against the [official prize directory](https://ethglobal.com/events/mumbai/prizes/). The owner confirmed **Classic / new project** registration in this audit session. This document covers all 12 listed sponsors; it is a source/evidence assessment, not an organizer's eligibility decision. GitHub issues hold current acceptance state.

The reviewed baseline is `79054dc` on `main`, with the documentation additions in [issue #83](https://github.com/Dijo-404/monolith/issues/83). In the followup, the owner explicitly selected **EF, Arkiv, Uniswap and Whitechain as development targets**, including all three Classic Whitechain tracks. The [completion plan](track-completion-plan.md) gives the unchecked work for each. Later commits, deployments and live availability need their own verification. Existing planning documents describe intended behavior; they do not override this evidence assessment.

## Event-wide requirements

The [Mumbai submission guide](https://ethglobal.com/events/mumbai/info/details) sets the deadline at **7 November 2026, 09:00 IST**. Submit in the participant dashboard and select at most **three partners**; several tracks from one partner consume one selection. Only selected partners assess the submission.

Classic requires project-specific code, designs and assets to start after kickoff, with transparent public-library reuse and incremental Git history. Disclose AI-assisted files/assets and meaningful human work; spec-driven submissions must retain their specs, prompts and planning artifacts. [AI usage](ai-usage.md) records the current gaps.

An uploaded video must be **2–4 minutes**, at least **720p**, with spoken human narration. Do not use speed-up, phone recordings, music/text replacing speech or AI voiceover. CROPS tightens the limit to three minutes: use **2–3 minutes** for a shared video. Finalist judging requires attendance for a four-minute demo and three-minute Q&A; partner booth presentations are optional. Confirm dashboard selections and receipt before the cutoff.

The [getting-started guide](https://ethglobal.com/events/mumbai/info/start) caps teams at five and requires each member's acceptance/staking. [Global rules](https://ethglobal.com/rules) also govern venue check-in, conduct, rights to reused materials, and disclosure of any earlier work. Participant records and absence of pre-event work cannot be certified from this repository.

## Candidate tracks and evidence

### Ethereum Foundation

[Official EF requirements](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation): Anon-RPC apps must route RPC reads through it by default. CROPS requires a public free-software repository with run instructions, a README section named **CROPS** addressing each letter, an end-to-end video of the lead property lasting at most three minutes, no third-party client trackers/analytics, and device-local keys/personal data or an explanation. A project can receive only one EF prize across its tracks.

| Candidate | Implemented evidence | Remaining gate |
| --- | --- | --- |
| Best Use of Anon-RPC | [Live default entry](../apps/dashboard/src/main.tsx), [real worker adapter](../packages/transport/src/adapters/browser/host.ts), [routing application](../packages/transport/src/application/transport.ts), [actual paired source comparison](preflight/observer.md), [registry-driven protected read](../tests/e2e/registry-routing/live/observed-live-2026-11-06.json) | Final supported leak/repair workflow and release verification under [MN-016](https://github.com/Dijo-404/monolith/issues/16)/[MN-017](https://github.com/Dijo-404/monolith/issues/17); fresh availability and event-wide gates |
| Best CROPS App | Privacy regression developer tool; [README CROPS](../README.md#crops), MIT license, local setup, [independent egress checks](../tests/privacy/egress/README.md), [source-bound deployment tooling](../scripts/deploy/README.md) | Public source, qualifying video and deployed-client tracker review; final workflow/release gates above |

Ordinary protected reads use the worker or fail closed. The explicit comparison/leak controls, bootstrap lookups, Arkiv metadata, hosting resources and worker-network traffic have different exposure and counting rules. [The lab guide](../tests/e2e/lab-ui/README.md) defines scope. Destination RPCs still see payloads; screenshots and synthetic regressions do not prove current network anonymity.

Authored dashboard code adds no analytics integration. The retained hosting follow-up in [PR #74](https://github.com/Dijo-404/monolith/pull/74) identifies **Cloudflare JavaScript Detection**, including a challenge runtime and hidden frame. Do not call that Cloudflare Insights or infer tracker compliance from an RPC-egress pass. [MN-023](https://github.com/Dijo-404/monolith/issues/36) must establish the final host's behavior against CROPS's tracker rule, remove disallowed additions or choose a compatible host before claiming this criterion. Merely disclosing a disallowed tracker would not satisfy it.

### Arkiv

[Official Arkiv requirements](https://ethglobal.com/events/mumbai/prizes/arkiv): Mirror and Build-from-scratch require event-built work, actual current-testnet writes, useful Arkiv reads, a public licensed repository, AI disclosure, README writer addresses/query, schema/friction files and judging documents. Mirror additionally requires republishable non-Sourcify data, its README license link and a rerunnable importer. One main Arkiv track award is possible per team; the separate Swarm bonus has its own requirements.

| Candidate | Required document/evidence | State |
| --- | --- | --- |
| Mirror something Ethereum depends on | [Schema](../arkiv/schema.md), [friction](../arkiv/friction.md), [reach](../arkiv/reach.md), [why Arkiv](../arkiv/why-arkiv.md), [data quality](../arkiv/data-quality.md), [importer](../scripts/import-evm-registry.ts), [retained source license](../packages/registry/src/adapters/source/LICENSE.ethereum-lists-chains) | Recorded 100 distinct networks/100 entities, ten transactions and independent read-back; source revision/license and importer rerun accounting retained |
| Build on Arkiv — from scratch | Same schema/friction/reach/why documents plus [how Arkiv is used](../arkiv/how-you-use-arkiv.md); a user-visible read | [Registry transport composition](../apps/dashboard/src/composition/transport.ts) selects a trusted candidate and requires a protected chain probe; [actual routing evidence](../tests/e2e/registry-routing/live/observed-live-2026-11-06.json) is historical |

The [README query](../README.md#query-the-accepted-registry-import-independently) includes the real production publisher, immutable upstream MIT link and key-free command. [Registry setup](registry-setup.md) supplies pins, output and failure behavior. Importing metadata does not verify endpoint health, chain identity or anonymity. Entity engine-block expiry and content UTC expiry are both enforced; historical receipts cannot establish freshness at judging. No continuous refresh service is claimed. A new run may block on expiry, rate limits or service availability.

Both candidates still need public source, completed AI/human/prompt disclosure, current readable entities and accepted final product/release evidence. Build is an alternative eligible design fit, not a second promised payout. Scores/adoption are not inferred from having the required filenames.

### Uniswap — Build completion target

[Official Uniswap requirements](https://ethglobal.com/events/mumbai/prizes/uniswap-foundation) allow genuine ecosystem tooling and require public open-source code, root `FEEDBACK.md`, completion of the [developer feedback form](https://developers.uniswap.org/hackathon-feedback) linking that file, and README pointers to relevant contracts and integration lines.

[MN-027 / #55](https://github.com/Dijo-404/monolith/issues/55) owns the integration and `FEEDBACK.md`. Its [draft PR #61](https://github.com/Dijo-404/monolith/pull/61) provides the offline ABI starting point. Finish the real protected quote, independently detected bypass/repaired useful result, exact deployment/ABI and source-line references, honest feedback, and form-completion evidence using the [Uniswap checklist](track-completion-plan.md#uniswap-build). This is an explicit development target; completion is recorded when the corresponding checks and artifacts exist. This audit submits no form.

### Whitechain — Scale, Operate and Tokenize completion targets

[Official Whitechain requirements](https://ethglobal.com/events/mumbai/prizes/whitechain) require explorer-verified contracts on Sepolia **1874**, main-flow settlement in designated USDT **`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`**, a README transaction link and settlement rationale, public incremental history with setup/architecture/limits, root `WHITECHAIN_FEEDBACK.md`, and a **2–4 minute** video showing the parties. Scale additionally needs payer gas abstraction, merchant gas funding and abuse controls.

The owner activated this workstream in the followup. Complete the shared token/funding/contract/relayer/checkout work through [MN-018–021](plan.md#chunk-list), reusable merchant integration through [MN-030 / #87](https://github.com/Dijo-404/monolith/issues/87), and enforced asset lifecycle through [MN-031 / #88](https://github.com/Dijo-404/monolith/issues/88). [MN-022 / #22](https://github.com/Dijo-404/monolith/issues/22) packages all three track demonstrations. The [Whitechain checklists](track-completion-plan.md#whitechain-shared-work) specify each artifact, test and demo. Keep route feasibility, sponsor confirmation for any prefunded-vault strategy, real designated-token receipts and verification as concrete work items. Classic excludes Continuity. Building all four partners is supported by this plan; final submission still has three partner slots.

## Remaining sponsor and subtrack screening

These exclusions concern this implementation. They are not statements that privacy tools are categorically ineligible. Adding a sponsor logo, SDK dependency or registry row would not change them.

| Sponsor / tracks screened | Missing qualifying implementation |
| --- | --- |
| [World](https://ethglobal.com/events/mumbai/prizes/world): Agent Pass; IDKit; their Continuity versions | No World agent authentication or verified IDKit credential flow with successful/alternative paths and integration debrief |
| [1inch](https://ethglobal.com/events/mumbai/prizes/1inch): Aqua; Continuity Aqua | No official Aqua/SwapVM position with demonstrated token-transfer execution |
| [0G](https://ethglobal.com/events/mumbai/prizes/0g): Private Computer; Physical AI; Keep Building; self-paying agents | No actual 0G inference, embodied decision loop, storage episode or self-funded compute-payment loop |
| [Arc](https://ethglobal.com/events/mumbai/prizes/arc): DeFi; mobile consumer; advanced stablecoin contracts; Bridge Kit; Continuity | No Arc Studio starting-point provenance or working Arc/Circle application; every Arc prize requires starting in Arc Studio |
| [Hedera](https://ethglobal.com/events/mumbai/prizes/hedera): x402; tokenization; SDK app; Continuity | No Hedera settlement/tokenization or app using the required native services |
| [ENS](https://ethglobal.com/events/mumbai/prizes/ens): ENSv2; Continuity ENSv2 | No central functional ENSv2 integration or live demo |
| [Definitive](https://ethglobal.com/events/mumbai/prizes/definitive): social and creative Flash advanced orders | Both tracks are Continuity-only; no Flash integration/executed advanced order exists |
| [Chainlink](https://ethglobal.com/events/mumbai/prizes/chainlink): CRE; CCIP 2.0 | No meaningful CRE workflow or CCIP contract integration causing state changes |
| [EF](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation): alternative mempool; CROPS upgrade | No admitted frame transaction or submitting code; the upgrade award is Continuity-only |
| [Arkiv](https://ethglobal.com/events/mumbai/prizes/arkiv): Node tooling; Swarm bonuses; Build existing | No tool operating beside a real node, or actual Swarm upload/read/postage proof and `arkiv/swarm.md`; existing-project and Continuity bonuses do not fit Classic |
| [Uniswap](https://ethglobal.com/events/mumbai/prizes/uniswap-foundation): Continuity Build | Classic registration excludes this entry |

The [agent repair harness draft #81](https://github.com/Dijo-404/monolith/pull/81) is local/SIMULATED, with live mode blocked. It may strengthen the privacy-tool demonstration after acceptance; it is not a new Anon-RPC platform harness and establishes no 0G/Hedera or other AI-track integration.

## Submission gates still open

| Gate | Concrete next action / owner |
| --- | --- |
| Public repository | Repository was **PRIVATE** when checked through GitHub. The owner must approve publication of a reviewed source/history snapshot and then verify unauthenticated access. MIT licensing and a public hosted frontend do not establish public source. [MN-023](https://github.com/Dijo-404/monolith/issues/36) retains publication coordination. |
| Meaningful human work and Classic history | Owner supplies truthful contributions, confirms all project-specific work began after kickoff, attributes reused materials and confirms team/registration facts. Earliest recorded commit `6001783` is 6 November 2026, 17:23:12 IST; that alone cannot prove no earlier work. |
| AI/spec/prompt completeness | Complete [AI usage](ai-usage.md) with all tools/affected assets and the missing historical prompts/planning artifacts; do not replace actual human work with an invented attestation. |
| Final live/release acceptance | Existing owners finish [MN-016](https://github.com/Dijo-404/monolith/issues/16), [MN-017](https://github.com/Dijo-404/monolith/issues/17) and [MN-023](https://github.com/Dijo-404/monolith/issues/36). Use immutable source/evidence links and clean-clone results; keep `SIMULATED`, historical `OBSERVED_LIVE`, `BLOCKED` and `UNTESTED` distinct. |
| CROPS hosting and video | Resolve host-injected behavior; record an actual 2–3 minute human-narrated screen demo showing a useful protected read, deliberate leak, repair and the moment fail-closed protection matters. No qualifying video is attached by this audit. |
| Arkiv current availability | Registry/runtime owner verifies both expiry clocks and independent useful reads for the final run; preserve failures and historical evidence without relabeling. |
| Uniswap completion | #55 supplies the actual integration, feedback file/form and README contract/code pointers from the completion checklist. |
| Whitechain completion | #18–22 and #87–88 supply shared settlement, Scale gas abstraction, Operate integration and Tokenize lifecycle artifacts. |
| Dashboard submission | Participant submits the verified materials, selects the eligible partners and retains the submission receipt before **09:00 IST**. This audit does not access or submit the participant form. |

Develop all four selected partners using the [completion plan](track-completion-plan.md); choose three for the participant submission based on the finished demonstrations and official rules. Record each completed item with actual evidence. No document or passing offline test alone certifies eligibility, human contribution, anonymity or payment settlement.
