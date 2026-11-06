# MN-008 licensed registry importer

The importer reads an immutable local `ethereum-lists/chains` Git checkout, checks its selected
bytes against the pinned tree, admits conservative HTTPS metadata, and publishes expiring
`monolith.rpc.v1` candidate entities. It never contacts those candidate RPC endpoints.

On 6 November 2026, the real Rabdi run published **100 records for 100 distinct networks in
10 transactions**. A same-state rerun reused all 100 records with **zero writes and zero
transactions**. A separate process without signing-key environment variables independently
read all 100 records. These are storage/read-back observations; endpoint chain verification,
product routing and sponsor qualification remain untested here.

## Actual source and results

The source revision is `e17474286275730fb6b0490b1d7ea1c64a36ed9e`.
The [retained MIT notice](../../src/adapters/source/LICENSE.ethereum-lists-chains) applies only
to this upstream dataset, including any Whitechain metadata actually present in that source.
No Whitechain documentation was imported or relabeled.

The exact snapshot catalog is UTF-8 JSON plus a final LF, with `sourceSha` and a sorted array
of the selected LICENSE, README and canonical chain-file paths, raw byte lengths and SHA-256
hashes. Its hash is
`2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952`.
This hashes the documented source subset, rather than the whole Git archive or an import
manifest. The license hash is
`1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685`.

| Source measurement | Actual count |
| --- | ---: |
| Source networks / RPC entries | 2,855 / 4,220 |
| Networks with admitted metadata / candidate endpoints | 2,238 / 2,942 |
| Rejected entries / within-chain duplicates | 1,277 / 1 |
| Selected networks / endpoints | 100 / 100 |
| New entities / transactions across both write commands | 100 / 10 |
| Same-state rerun: new entities / reused / transactions | 0 / 100 / 0 |
| Independent key-free query: selected / found | 100 / 100 |
| Candidate endpoint probes | 0 |

Rejection reasons are first-match counts: 738 unsafe HTTPS forms, 375 custom paths requiring
review, 162 inactive/reused-chain entries and two query strings. The duplicate count is separate.
The accounting is `2942 + 1277 + 1 = 4220`. Admission checks URL syntax, encoding, public path
policy and storage size; they establish neither DNS safety nor provider trust or availability.

The bounded selection takes the first admitted endpoint of each distinct network in the
deterministic source order, up to the configured limit. It is explicitly a subset of the
eligible metadata. The first command published ten networks; the extension published 90 more
and reused those ten. No retries or uncertain writes occurred.

Generated files below were copied unchanged from their command outputs:

- [First ten: actual import manifest](observed-live-2026-11-06/import-first10.json)
- [Extension to 100: actual import manifest](observed-live-2026-11-06/import-full100.json)
- [Same-state rerun, zero new writes](observed-live-2026-11-06/rerun100.json)
- [Separate key-free read-back](observed-live-2026-11-06/independent-query.json)
- [Selected public candidate records](observed-live-2026-11-06/selected-records.json)
- [Exact source catalog](observed-live-2026-11-06/source-catalog.json)
- [Source-only preview and its limits](observed-live-2026-11-06/source-preview.json)
- [License copied with the generated artifacts](observed-live-2026-11-06/LICENSE.ethereum-lists-chains)
- [Independent public receipts and actual fees](observed-live-2026-11-06/receipt-evidence.json)
- [Independent SDK read of one selected entity](observed-live-2026-11-06/sample-entity-evidence.json)
- [Independent artifact consistency and original input hashes](observed-live-2026-11-06/artifact-consistency.json)

The dedicated public test publisher is `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4`.
The first real [batch transaction](https://rabdi.explorer.arkiv.network/tx/0x90b084611bc5850c066e1101938b4fe76e350f658d543cb0fa64cf66ca4e69ca)
created, among others, entity
`0x77eb7c1e22c6552d7f085f8a1c2313121dfbff3a4abb682608ca5ff2c8cd7b43`.
All 100 entity references and declared deadlines are in the manifests. Evidence is recorded
at the files' observed timestamps and will become historical when the entities expire.
An independent public-client reviewer read all ten receipts and one selected entity without
importing the Monolith writer or any signing API. The receipts emitted 100 matching readonly
creations and consumed **0.018453639 test tGLM** in actual fees. The reviewer also checked
the full 100-record CLI query's artifact consistency, rather than repeating every entity read.
The consistency file preserves original command-layout names; for example,
`first10/import-manifest.json` is copied here as `import-first10.json`.

## Reproduce

Use Node **24.22.2** and pnpm **12.18.0**. `pnpm install --frozen-lockfile` and `pnpm build`
prepare the public package exports. The SDK and viem are pinned to **1.0.1** and **2.57.16**.

Acquire the public source once outside the workspace:

```sh
git clone https://github.com/ethereum-lists/chains.git /tmp/monolith-chains-source
git -C /tmp/monolith-chains-source checkout --detach e17474286275730fb6b0490b1d7ea1c64a36ed9e
```

Commands below load that existing local checkout; they perform no automatic fetch. The
loader requires the official origin, matching HEAD/tree bytes, a clean selected directory,
regular files, canonical IDs and the reviewed exact MIT notice. A changed notice needs review.
Use a new output directory for each command; output files use exclusive creation.

```sh
env -u DEBUG pnpm registry:import preview \
  --source /tmp/monolith-chains-source \
  --revision e17474286275730fb6b0490b1d7ea1c64a36ed9e \
  --out /tmp/monolith-import-preview
```

For writes, provide a dedicated funded **Rabdi test-only** publisher and its protected key
file outside the checkout. The command reads `ARKIV_PUBLISHER_KEY_FILE`, requires restrictive
file permissions and verifies the account matches `--publisher`. The key is never copied into
state or output. Disable DEBUG so SDK diagnostics cannot expose sensitive provider data.

```sh
env -u DEBUG pnpm registry:import write \
  --source /tmp/monolith-chains-source \
  --revision e17474286275730fb6b0490b1d7ea1c64a36ed9e \
  --publisher <dedicated-public-test-address> \
  --state /tmp/monolith-import-state --out /tmp/monolith-import-first \
  --max-networks 100 --batch-size 10 --lifetime-hours 24
```

Repeat the same command with **the same state directory** and a new output directory to
exercise reuse. The state retains the initial local source-acquisition timestamp; a rerun
does not claim a fresh source fetch. For the recorded run the existing prepared source was
`/tmp/monolith-mn008-source-audit-20261106T1301Z/source`, the state was
`/tmp/monolith-mn008-live-1320/state`, and fresh output subdirectories were `first10`, `full100`
and `rerun100`. The first command used `--max-networks 10`; subsequent commands used 100.

Run independent verification in a new process without either test signing-key variable:

```sh
env -u DEBUG -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_FOREIGN_KEY_FILE \
  pnpm registry:import verify \
  --source /tmp/monolith-chains-source \
  --revision e17474286275730fb6b0490b1d7ea1c64a36ed9e \
  --publisher <dedicated-public-test-address> \
  --out /tmp/monolith-import-query --max-networks 100 --batch-size 10
```

`verify` constructs only a public client, checks creator and owner, the production record ID,
full immutable content, readonly flags and both expiry clocks. It ignores the input's newer
local acquisition time when comparing immutable content and validates the stored timestamp.
The recorded separate process returned `READ_BACK_COMPLETE`, found 100/100, with no key access.

## Identity, expiry and recovery

Publications are scoped by **publisher + deterministic record ID**. The ID binds schema/policy
version, immutable source revision/catalog/license and exact normalized candidate fields.
Acquisition time is excluded so loading identical immutable bytes again preserves identity.
The journal additionally binds publisher, source hash/revision and requested lifetime.

Production rows use `importer_version = monolith-import-v1` and indexed `record_id`, excluding
the earlier same-tag MN-005 samples. `status` stays `candidate`, and `measured_chain_id` is empty.
Every string is bounded to 128 UTF-8 bytes before sending; nothing is silently truncated.

`content_expires_at` is the publisher-declared UTC deadline calculated at write time.
`expiresAtBlock` comes from the actual Arkiv entity and remains a block height. The reader
requires both to be fresh and never interprets a block height as Unix time. A future shared
manifest must preserve those checks. The SDK's nominal lifetime conversion is not a guarantee
of wall-clock chain timing.

Writes are serial, with at most ten records per batch, a fixed 16,000,000 gas limit at 1 gwei
and a cumulative 1 test-tGLM maximum fee reservation per process. The recorded ten batches had
a maximum fee bound of 0.16 test tGLM; no new funding or transfers were performed by this task.
The public RPC may rate limit; no transport retry submits a write again.

An exclusive state lock covers the command. Before any batch is sent, the entire batch is
durably marked pending and synced. A crash, timeout, invalid result or failed receipt/read-back
stops the run. Pending records may be reconciled only through matching trusted live entities;
an empty query never permits resubmission. Preserve the state directory. A stale lock after
process termination requires operator inspection and removal only after confirming no writer
is active; the pending journal still governs recovery. Do not replace the state directory to
bypass an uncertain outcome. Separate state stores are not distributed locking.

Known confirmed block-expired rows require explicit `--refresh-expired`. If the content's ISO
deadline expired while the old engine row is still live, refresh fails closed until engine
expiry, preventing duplicate active IDs. Two active matches, changed content, foreign ownership,
incomplete/skipped query results or unstable query counts also block reuse. The ten-minute
CLI deadline leaves reservations intact; it never authorizes another write.

## Validation and boundaries

The final pre-integration `pnpm check` passed lint, strict package builds/typechecks,
**459 tests in 14 files**, and production builds. The importer contributes **116 simulated
boundary tests**, covering source integrity, credential/template filtering, unsafe numeric IDs,
publisher/content/receipt/expiry checks, batch limits, durable reservations, reconciliation,
partial failures and repeat runs. The CLI also passed an explicit strict TypeScript check.
These deterministic tests do not establish live endpoint trust.

After incorporating accepted main `4c14927` (MN-007 and MN-011), the frozen install and full
`pnpm check` passed again: **703 tests in 18 files**, lint, package/consumer typechecks and
production builds. The lockfile merge retained both transport and registry dependency pins.

The actual import, zero-write rerun and independent query are separate live observations.
The source catalog, license, manifests and JSON were checked for hashes, structure and safe
projection; raw rejected URLs, signing keys, signatures and raw upstream errors are absent.
Public origin policy, DNS/IP checks, protected chain-ID probes, a usable registry API and
independent application consumption belong to MN-010/MN-013/MN-015.

SDK semantics were checked against the installed pinned package and the official
[create](https://docs.arkiv.network/writing/create/),
[filter](https://docs.arkiv.network/querying/filter/) and
[expiry](https://docs.arkiv.network/writing/expiration/) documentation.
