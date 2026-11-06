# MN-005 Arkiv preflight

Status: **LIVE_PREFLIGHT_PASSED — prepared for independent review**. On 6 November 2026,
the dedicated Rabdi publisher created a real one-hour sample entity, a separate public-client-only
process read it back under creator+owner filters, and a real same-tag foreign publisher was
observed and rejected. Current accepted main `ff8cac0` is incorporated by a normal merge.
This establishes bounded storage/query feasibility, not an imported dataset, endpoint chain
verification, product integration, or Arkiv sponsor qualification. PR merge and final issue
acceptance remain separate actions on [MN-005](https://github.com/Dijo-404/monolith/issues/5).

## Observed configuration and connectivity

On 6 November 2026, the [official network reference](https://docs.arkiv.network/networks/rabdi/)
and published SDK agreed on Rabdi, chain `7794095` (`0x76edaf`), gas token tGLM and
`https://rpc.rabdi.db-chain.testnet.arkiv.network`. The
[official faucet](https://hub.arkiv.network/faucet) requires wallet sign-in and CAPTCHA;
neither was automated. An access key is optional for this bounded experiment: the documented
public endpoint is heavily rate limited. An operator can supply `ARKIV_ACCESS_KEY` locally.

Actual [connectivity observation](../../packages/registry/src/spikes/arkiv-connectivity-2026-11-06.json):

| Observation at 2026-11-06T12:30:50.311Z | Result |
| --- | --- |
| SDK / viem | `@arkiv-network/sdk@1.0.1` / `viem@2.57.16` |
| Chain ID / block number | `7794095` / `291241` |
| Dedicated public test publisher | `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` |
| Publisher balance | `0` wei tGLM |
| Real schema + run + creator + owner query | Completed, zero rows |
| Actual transaction hash / entity key / expiry | **UNTESTED**; no write attempted |

A successful empty query establishes RPC/query compatibility only; the table above is the original
unfunded observation and remains unchanged. The funded continuation below supplies actual writes.
The publisher is a new
disposable test account; its private key is kept outside the repository. No private user data,
signatures, credentials, source IPs or raw exception bodies belong in exported artifacts.

## Actual funded write and independent query

Both entities use run ID `mn005-be64df48-2377-4697-942e-bc44cced7d4b` and schema tag
`monolith.rpc.v1`. Each requested one hour with `readonly: true`; the engine's actual expiry
is recorded as a block height. No write was retried or duplicated.

| Public test role | Publisher | Transaction | Entity | Created / expiry block |
| --- | --- | --- | --- | --- |
| Trusted sample | `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` | [eef2add4…fe540e](https://rabdi.explorer.arkiv.network/tx/0xeef2add4106865f02ba8fb7ff4cfa5854c0f572891b2006f1699d2ec49fe540e) | `0x7c7e00b8713897cfcf5a7c78a7d15ad2dcf0501153fbbc7ec20dd8b4bd4a080c` | `292410` / `294210` |
| Same-tag foreign control | `0xa518ca2D1A7a3697855ad5075f999115E1551E01` | [b85556d8…dce680](https://rabdi.explorer.arkiv.network/tx/0xb85556d824247c60fc4d59597ebab1716d04709276555feeadd91be9c4dce680) | `0x57a59e686d880ffaba5c7efaa10d97e0f26e345141efeab7b3c634805c5516e6` | `292445` / `294245` |

The unchanged generated [primary write](../../packages/registry/src/spikes/arkiv-primary-write-2026-11-06.json),
[foreign write](../../packages/registry/src/spikes/arkiv-foreign-write-2026-11-06.json),
[final independent query](../../packages/registry/src/spikes/arkiv-independent-query-2026-11-06.json),
and [receipt summaries](../../packages/registry/src/spikes/arkiv-live-receipts-2026-11-06.json)
record these actual references. Receipt summaries were obtained with public clients after the
writes; their `role` fields retain the original temporary journal filenames. No key, signed
transaction payload, inbound funding sender, or private user wallet data is included.

The first key-free [query before the foreign control](../../packages/registry/src/spikes/arkiv-before-control-query-2026-11-06.json)
at `2026-11-06T13:10:24.385Z` found the expected trusted entity but correctly returned
`LIVE_PREFLIGHT_INCOMPLETE` because no foreign entity existed yet. After the actual foreign
write, another separate process with both signing-key environment variables removed returned
`LIVE_PREFLIGHT_PASSED` at `2026-11-06T13:11:32.340Z`, current block `292463`:

- creator+owner-filtered rows: **1**; expected entity trusted and all filtered rows valid;
- unfiltered same-schema/same-run query: **1 actual foreign row**; **1 rejected** by publisher policy;
- both entity expiries remained above the independently read current block;
- each query was capped at 20 rows and is not an exhaustive index scan.

The disposable foreign account was funded with **0.1 test tGLM** from the dedicated test
publisher after pinning Rabdi and estimating a plain transfer at 21,000 gas / 1 gwei. The
[actual controlled funding receipt](https://rabdi.explorer.arkiv.network/tx/0xd0efb4c1de9dc55107988a619de624949515ff8b36af32e1b9d4ebc7a15f21cd)
is included in the receipt summary. This was test-only account setup, not a product payment.
The two writes plus that transfer consumed **0.000393984 tGLM in actual fees**; the 0.1 tGLM
transfer stays in the separate test account except its own write fee. Setup plus fees were
bounded below the 1 tGLM experiment budget; unused test balances were retained. Initial SDK
fee estimation and the observed protocol gas cap were inspected before submitting. The foreign
funding operator journal was exclusive and its known hash was saved before receipt waiting.

These are time-stamped live observations. The entities expire after their one-hour test life;
a later reproduction should publish fresh samples rather than relabel expired records as live.
The candidate payload deliberately remains `SIMULATED`, `candidate`, and unprobed even though
its storage transaction and independent read are `OBSERVED_LIVE`.

## Reproduce in isolation

Use Node `24.22.2`. No workspace dependency or lockfile changes are needed. The
[launcher](../../packages/registry/src/spikes/run-isolated.sh) copies the `.mts` scripts into a
temporary environment and pins the SDK, viem, TypeScript `6.0.3` and Node types `24.19.2` there.
The `.mts` entry points are standalone ESM experiments, outside the production library's
`src/**/*.ts` build. They are not exported by `@monolith/registry`.

From the repository root:

```sh
export MONOLITH_ARKIV_ENV="$(mktemp -d /tmp/monolith-mn005-XXXXXX)"
spike=packages/registry/src/spikes/run-isolated.sh
bash "$spike" selfcheck
bash "$spike" new-publisher "$MONOLITH_ARKIV_ENV/publisher.key"
export ARKIV_PUBLISHER_KEY_FILE="$MONOLITH_ARKIV_ENV/publisher.key"
```

The last command prints only the dedicated public address. Fund that address with test tGLM
through the faucet. Existing experiment owners should retain their existing protected key file,
rather than create a replacement address. Then run:

```sh
bash "$spike" check <publisher-address> "$MONOLITH_ARKIV_ENV/connectivity.json"
bash "$spike" write "$MONOLITH_ARKIV_ENV/run.json"
```

`write` pins Rabdi before signing, refuses an unfunded publisher, and requests a one-hour,
read-only sample entity. It writes an exclusive submission journal before sending; HTTP retries
are disabled. Known returned transaction/entity identifiers are persisted before the extra receipt
verification. A 90-second process deadline bounds a stuck SDK receipt wait. Uncertain outcomes
must be reconciled; a new output filename is not authorization to submit another entity.
An unfunded run is explicitly `BLOCKED` and has no submitted transaction to reconcile.

For the independent query, use a separate process with the signing-key variables removed:

```sh
env -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_FOREIGN_KEY_FILE \
  bash "$spike" query "$MONOLITH_ARKIV_ENV/run.json" "$MONOLITH_ARKIV_ENV/query.json"
```

This path constructs only a public client. It applies both `.createdBy(publisher)` and
`.ownedBy(publisher)` and revalidates returned metadata/content locally. It also queries the same
run without publisher filters to observe the negative control. Each query is limited to 20 rows;
the result explicitly disclaims an exhaustive scan.

For an actual same-tag foreign-publisher negative control, use a second dedicated funded test
account, retain the original run ID, and explicitly write its sample:

```sh
bash "$spike" new-publisher "$MONOLITH_ARKIV_ENV/foreign.key"
export ARKIV_FOREIGN_KEY_FILE="$MONOLITH_ARKIV_ENV/foreign.key"
# Fund this second public test address with test tGLM first.
bash "$spike" write-foreign "$MONOLITH_ARKIV_ENV/run.json" "$MONOLITH_ARKIV_ENV/foreign-run.json"
env -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_FOREIGN_KEY_FILE \
  bash "$spike" query "$MONOLITH_ARKIV_ENV/run.json" "$MONOLITH_ARKIV_ENV/final-query.json"
```

The query cannot report `LIVE_PREFLIGHT_PASSED` without a valid matching trusted entity,
valid filtered rows and an actually observed foreign entity rejected by the trust policy.
The recorded live foreign control above passed. Simulated rejection is never substituted for
that actual observation.

After an uncertain submission, the following read-only command can recover candidate entity
keys by publisher/run ID even if the SDK did not return a key:

```sh
env -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_FOREIGN_KEY_FILE \
  bash "$spike" reconcile "$MONOLITH_ARKIV_ENV/run.json" "$MONOLITH_ARKIV_ENV/reconcile.json"
```

Reconciliation always reports uncertainty and exits nonzero. Empty or incomplete query output
does not authorize resubmission. Check the dedicated publisher's transactions/receipt in the
[explorer](https://rabdi.explorer.arkiv.network) before any further write.

## Schema, trust and evidence limits

[The sample schema](../../packages/registry/src/spikes/arkiv-schema.mts) uses tag
`monolith.rpc.v1`, the proposed source fields, an indexed synthetic `run_id` and an `evidence`
field. This experiment does not freeze the production import schema; MN-008/MN-010 own that.
Anyone can copy the tag. The [official filter guide](https://docs.arkiv.network/querying/filter/)
distinguishes immutable creator identity from transferable ownership; this experiment requires both.

SDK `1.0.1` returns flat selected rows with typed attribute wrappers. `$expiresAt` and
`createEntity().expiresAt` are **block heights**, not Unix seconds or ISO timestamps.
The trust helper rejects expiry at or before an independently observed current block.
An adapter must deliberately derive any wall-clock expiry for a shared manifest rather than
copying the block height into the shared ISO field.

The single source sample is Ethereum Mainnet metadata from `ethereum-lists/chains`, revision
`e17474286275730fb6b0490b1d7ea1c64a36ed9e`. Its source file SHA-256 is
`2cded1d8854ffecda7ca17752eb482592eacf66cd62907117128fefe2cedecf3`.
The pinned [source](https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/_data/chains/eip155-1.json)
and [MIT notice](../../packages/registry/src/spikes/SOURCE-NOTICE.md) are retained.
No source RPC endpoint was contacted or chain-verified. Stored sample values remain
`SIMULATED`, `candidate`, with empty `measured_chain_id`; an actual future storage receipt can
be `OBSERVED_LIVE` without upgrading those application claims. This is not the substantive
dataset import required by MN-008 and does not authorize browser routing.

## Validation and remaining gate

`bash packages/registry/src/spikes/run-isolated.sh selfcheck` passed strict TypeScript checks
and **16 SIMULATED tests** using the pinned isolated environment. Tests cover foreign creator,
foreign owner, block expiry boundaries, malformed typed data, unsafe URL forms, exact provenance,
truthful unprobed labels, safe projections, SDK query construction/escaping and writer/query
sample compatibility. `bash -n` passed for the launcher. A real public query returned zero rows
as recorded above; no write success is implied.

The original `4bbd38b` integration passed 151 workspace tests. This funded continuation merged
current accepted main `ff8cac0` normally, then ran Node **24.22.2** / pnpm **12.18.0**:

```sh
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:/tmp/monolith-pnpm/node_modules/.bin:$PATH pnpm install --frozen-lockfile
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:/tmp/monolith-pnpm/node_modules/.bin:$PATH pnpm check
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:$PATH MONOLITH_ARKIV_ENV=/tmp/monolith-mn005-env bash packages/registry/src/spikes/run-isolated.sh selfcheck
```

All passed: lint, source/public-consumer typechecks, **343 tests in 10 files**, production
builds, and the isolated strict compiler plus **16 SIMULATED tests**. Only report and actual
JSON observations were added after these checks; no executable source changes were needed. The launcher refused a
repository directory as its dependency environment before editing dependencies. Markdown
links/fences and `git diff origin/main --check` passed. Shared manifests and lockfile are unchanged.

Actual commands for the recorded write/query sequence used the launcher above with its existing
protected publisher file, new protected foreign file, and exclusive output journals:

```sh
bash "$spike" write "$MONOLITH_ARKIV_ENV/live-primary-run.json"
env -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_FOREIGN_KEY_FILE bash "$spike" query "$MONOLITH_ARKIV_ENV/live-primary-run.json" "$MONOLITH_ARKIV_ENV/live-before-control-query.json"
# After explicit bounded funding of the separate public test account:
bash "$spike" write-foreign "$MONOLITH_ARKIV_ENV/live-primary-run.json" "$MONOLITH_ARKIV_ENV/live-foreign-run.json"
env -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_FOREIGN_KEY_FILE bash "$spike" query "$MONOLITH_ARKIV_ENV/live-primary-run.json" "$MONOLITH_ARKIV_ENV/live-final-query.json"
```

The before-control query intentionally exited 2 with `LIVE_PREFLIGHT_INCOMPLETE`; both writes
and the final query exited 0. Keys were available only in the respective writing processes;
query processes constructed public clients only. A separate read-only reviewer can verify the
public receipts and run the same creator/owner and unfiltered queries without either key.

**Handoff:** actual write/read-back/foreign rejection and current-main validation are ready for
independent review. After merge and accepted MN-005 evidence, assess MN-008 readiness separately.
Substantive licensed import, product query/route use, endpoint protection and sponsor claims
remain gated on their own later tasks. No production registry export or shared tooling changed.
