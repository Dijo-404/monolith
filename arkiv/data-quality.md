# Source quality, import accounting and freshness

This report describes the recorded **6 November 2026** import from
[ethereum-lists/chains revision e17474286275730fb6b0490b1d7ea1c64a36ed9e](https://github.com/ethereum-lists/chains/tree/e17474286275730fb6b0490b1d7ea1c64a36ed9e).
The [MIT notice](https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/LICENSE)
is [retained locally](../packages/registry/src/adapters/source/LICENSE.ethereum-lists-chains).
No separately sourced Whitechain documentation was imported or relabeled.

| Source identity | Exact value |
| --- | --- |
| Upstream commit | `e17474286275730fb6b0490b1d7ea1c64a36ed9e` |
| Selected-source catalog SHA-256 | `2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952` |
| MIT notice SHA-256 | `1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685` |
| Local snapshot loading time retained by the import | `2026-11-06T13:41:58.596Z` |

The [catalog](../packages/registry/test/importer/observed-live-2026-11-06/source-catalog.json)
hash covers sorted selected `LICENSE`, `README.md` and chain paths with byte
lengths and SHA-256 hashes. The source adapter checks the official Git origin,
pinned tree, selected working-tree bytes and exact license notice. Loading a
prepared local checkout does not fetch upstream; the preserved acquisition
timestamp is not a claim that each import/rerun retrieved new remote data.

## Measured source admission

The [source-only preview](../packages/registry/test/importer/observed-live-2026-11-06/source-preview.json)
is explicitly `SOURCE_ONLY`/`UNTESTED`, with no Arkiv write or destination probe.
Its measurements are:

| Quantity | Count |
| --- | ---: |
| Source network files | 2,855 |
| Source RPC entries | 4,220 |
| Networks with admitted metadata | 2,238 |
| Admitted candidate records | 2,942 |
| Rejected entries | 1,277 |
| Within-chain normalized duplicates, accounted separately | 1 |
| Selected distinct networks / records for publication | 100 / 100 |

First-match rejection counts are **738** unsafe HTTPS forms, **375** custom
paths requiring review, **162** inactive or reused-chain entries and **2**
query-string URLs. They sum to 1,277; the duplicate is separate.
The complete RPC-entry accounting is **2,942 + 1,277 + 1 = 4,220**.
Rejection is a conservative importer-policy outcome, not proof every excluded
upstream URL is malicious or unusable.

[Source policy](../packages/registry/src/domain/source-policy.ts) excludes
credential/template forms, unsafe URL syntax, unreviewed query/custom paths,
inactive/reused chain IDs and overlong stored strings. Canonical chain IDs must
agree with exact source filenames/content without unsafe JSON-number rounding.
Selection takes the first admitted URL per network in deterministic source
order, bounded at 100 networks for this run. The published set is a subset of
eligible metadata; it does not mirror all 2,942 admitted URLs.

## Actual storage and independent reads

| Executed command | Actual outcome | Artifact |
| --- | --- | --- |
| First ten networks | 10 new entities, 1 transaction | [First import](../packages/registry/test/importer/observed-live-2026-11-06/import-first10.json) |
| Extend selection to 100 | 90 new entities, 10 reused, 9 transactions | [Full selection](../packages/registry/test/importer/observed-live-2026-11-06/import-full100.json) |
| Repeat same state/selection | 0 new entities, 100 reused, 0 transactions | [Rerun](../packages/registry/test/importer/observed-live-2026-11-06/rerun100.json) |
| Separate key-free read | 100 selected / 100 found at block 293497, 13:46:01.705Z | [Original query](../packages/registry/test/importer/observed-live-2026-11-06/independent-query.json) |
| Corrected-reader key-free read | 100/100 at block 294286, 14:12:19.316Z | [Post-review query](../packages/registry/test/importer/post-review-query-2026-11-06.json) |

The total is **100 unique readonly entities in ten transactions**, not 110
new entities. [Receipt evidence](../packages/registry/test/importer/observed-live-2026-11-06/receipt-evidence.json)
records matching creations and **0.018453639 test tGLM** in actual fees.
[Artifact consistency](../packages/registry/test/importer/observed-live-2026-11-06/artifact-consistency.json)
links the original input hashes. A separate reviewer checked all ten receipts
and one live entity; the all-100 claim comes from the linked key-free CLI
queries, not a second independent per-entity scan by that reviewer.

Storage/read-back is `OBSERVED_LIVE` at the artifacts' original times.
All imported URLs remain `candidate`, empty `measured_chain_id`, and endpoint
validation `UNTESTED`; the importer performed **zero destination RPC probes**.
Original import/rerun artifacts predate the later guard corrections. They were
preserved unchanged; the [importer guide](../packages/registry/test/importer/README.md)
documents the fixes and separate later public read.

## Freshness, recovery and unmeasured quality

Each write requested a 24-hour lifetime. Actual `$expiresAt` is an engine block;
`content_expires_at` is a separate publisher UTC deadline. For the first batch
these are **336579** and **2026-11-07T13:42:00.547Z** respectively. A live reader
checks both against current block/time; equality is expired. Historical JSON
cannot establish current availability. See [schema](schema.md) for exact checks
and [setup](../docs/registry-setup.md) for a new direct query.

Publication uses a durable pending journal, serial bounded batches and no
automatic write retry. Uncertain outcomes require trusted reconciliation;
discarding state or seeing an empty query cannot authorize resubmission.
An ISO-expired entity whose engine block is still live blocks a duplicate
publication. Explicit refresh is permitted only through the importer's reviewed
expired-row policy. A recurring refresh service has not been deployed.

Expired/rejected **live storage ratios**, endpoint availability, destination
chain correctness across the 100 networks, latency distribution, provider
trustworthiness and long-term refresh success are **UNTESTED**. The rejection
counts above describe source normalization, not a live endpoint-health survey.
No percentage for those unmeasured properties is inferred from a successful
storage query. [Reader/API evidence](../packages/registry/test/reader/README.md)
covers a separate configured chain-10 discovery policy; application-wide route
coverage and final release acceptance remain separate work.
