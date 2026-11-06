# MN-005 Arkiv preflight

Status: **INCOMPLETE — publisher funding pending**. The live write, independent read-back of
that write and live foreign-publisher rejection have not run. This report does not pass the
Arkiv feasibility gate. MN-002 has merged as [PR #24](https://github.com/Dijo-404/monolith/pull/24).

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

A successful empty query establishes RPC/query compatibility only. The publisher is a new
disposable test account; its private key is kept outside the repository. No private user data,
signatures, credentials, source IPs or raw exception bodies belong in exported artifacts.

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
The live foreign control is currently **UNTESTED**. Simulated rejection is not substituted.

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

To finish MN-005: fund the dedicated publishers, execute the real writes, independently query
the expected entity and actual foreign control, record transaction/entity/expiry references,
then rerun integration checks on the merged foundation. Keep MN-008 and registry-dependent
downstream tasks behind their evidence gates until that observed evidence is accepted.
