# Dataset reach and independent consumption

The mirrored source is
[ethereum-lists/chains at immutable revision e17474286275730fb6b0490b1d7ea1c64a36ed9e](https://github.com/ethereum-lists/chains/tree/e17474286275730fb6b0490b1d7ea1c64a36ed9e).
Its [README](https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/README.md)
describes a public EVM chain directory. Monolith measured **2,855 network files
and 4,220 RPC entries** in the selected source; it published a bounded subset
of **100 records for 100 networks**. [Quality accounting](data-quality.md)
distinguishes source coverage, admitted candidates and actual writes.

These are dataset counts, not Monolith users or independent adopters. No
download count, customer count, upstream market share or community adoption
measurement has been collected for this mirror.

## Consumers with evidence

| Consumer | Executed evidence | Scope |
| --- | --- | --- |
| Importer's separate public verification process | [Original query](../packages/registry/test/importer/observed-live-2026-11-06/independent-query.json), 100/100 at 13:46:01.705Z on 6 November 2026; [corrected-reader query](../packages/registry/test/importer/post-review-query-2026-11-06.json), 100/100 at 14:12:19.316Z | Key-free storage read-back; uses the same pinned source/publisher, with no destination RPC probes |
| Public registry HTTP service | [MN-010 API artifact](../packages/registry/test/reader/observed-api-2026-11-06.json), started 14:31:47.843Z on 6 November 2026 | Two HTTP clients received identical chain-10 discovery manifests; personalized query rejected, observer map expansion denied |
| Independent consumer CLI | [Script](../scripts/registry-query-example.ts) and [actual output](../docs/registry-setup.md), 1/1 chain-10 entity at block 296692, 15:32:33.862Z on 6 November 2026 | Direct Rabdi storage query through the public reader export; independent of the Monolith backend and dashboard cache |

For the direct CLI, from the repository root after installation and build:

```sh
env -u DEBUG -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_PUBLISHER_PRIVATE_KEY \
  pnpm exec tsx scripts/registry-query-example.ts --chain-id 10
```

The CLI's exact executed result and timestamp are recorded in
[registry setup](../docs/registry-setup.md). A successful storage query is a
fresh observation only at execution time. Saved output becomes historical and
must not be substituted for a new failed query or loaded as routing authority.

The publisher is public test account
`0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` on Rabdi. Reusers can inspect
[the actual ten receipts](../packages/registry/test/importer/observed-live-2026-11-06/receipt-evidence.json)
and every [entity reference](../packages/registry/test/importer/observed-live-2026-11-06/import-full100.json)
without contacting Monolith or obtaining a Monolith API key. The CLI constructs
no account/signer, reads no wallet/order input, and does not contact destination
RPC URLs. Its public metadata contact to Arkiv is ordinary network traffic,
with no anonymity claim.

## Reuse and pending evidence

The source's [MIT license](https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/LICENSE)
and [retained notice](../packages/registry/src/adapters/source/LICENSE.ethereum-lists-chains)
accompany the importer. [Schema and policy](schema.md) let another consumer
reproduce publisher/content/expiry checks while selecting its own separately
reviewed origin policy. Publisher trust is configured, not inferred from a tag.

External third-party adoption, a teammate's independent clean-clone reproduction
and sustained refresh operation are **pending**; this CLI is a second consumer
implementation within the Monolith repository. It is not evidence of external
adoption. Integrated application coverage, the paired observer proof and final
sponsor acceptance remain their respective task gates. No payment or sponsor
qualification is asserted by these storage-consumption results.
