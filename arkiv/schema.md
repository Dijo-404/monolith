# Registry schema and public query

Monolith publishes licensed EVM chain/RPC **discovery metadata** under
`monolith.rpc.v1`. The implemented definition is
[RegistrySource](../packages/registry/src/adapters/arkiv/schema.ts), using
`@arkiv-network/sdk` **1.0.1** and viem **2.57.16**. The earlier MN-005
[preflight schema](../packages/registry/src/spikes/arkiv-schema.mts) is a
different experiment with the same tag; production readers reject those samples.

The recorded production deployment uses Arkiv **Rabdi, chain 7794095**, public
RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, and dedicated test
creator/owner `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4`. This address is a
public dataset publisher, never a shopper address. Readers need no signing key.

## Stored attributes

Every attribute uses `str()` and is bounded to **128 UTF-8 bytes** before write.
The names and indexing below describe the production code, including its
conservative `candidate` status.

| Attribute | Indexed | Meaning |
| --- | --- | --- |
| `record_id` | yes | Lowercase SHA-256 of the exact immutable normalized content |
| `chain_id` | yes | Canonical decimal chain ID; stored as a string |
| `chain_name` | no | Upstream name preserved exactly, including admitted whitespace |
| `rpc_host` | no | Full normalized HTTPS URL, despite the historical field name |
| `network_type` | yes | `evm` |
| `status` | yes | `candidate`; no imported row asserts endpoint verification |
| `source_url` | no | Immutable upstream chain-file URL |
| `source_commit` | yes | Forty-character upstream Git revision |
| `source_license` | no | Immutable upstream MIT license URL |
| `license_sha256` | no | SHA-256 of retained license bytes |
| `snapshot_sha256` | yes | SHA-256 of the sorted selected-source catalog |
| `observed_at` | no | UTC ISO timestamp of loading the local source snapshot |
| `measured_chain_id` | no | Empty string: importer did not probe the endpoint |
| `importer_version` | no | `monolith-import-v1`, distinguishing production imports |
| `content_expires_at` | no | Publisher-declared UTC ISO content deadline, set at write time |

The catalog covers `LICENSE`, `README.md` and canonical `_data/chains/eip155-*.json`
files, including their raw byte lengths and hashes. It is not the hash of the
entire Git archive or an import manifest. See [source measurements](data-quality.md).

The [identity implementation](../packages/registry/src/domain/source-policy.ts)
hashes JSON fields in this order: `chain_id`, `chain_name`, `rpc_host`,
`network_type`, `status`, `source_url`, `source_commit`, `source_license`,
`license_sha256`, `snapshot_sha256`, `measured_chain_id`, `importer_version`.
`observed_at` and write-time content expiry are excluded so identical source
bytes retain identity across local reloads. Reproduction should use the public
package helpers rather than invent a different serialization.

## System metadata and trust

The reader selects and validates `$key`, `$creator`, `$owner`, `$expiresAt`
and `$creationFlags` as well as all attributes. Accepted entities must have
`readonly: true`, `permissionlessExtension: false` and raw creation flags `1`.
Creator and owner each match the configured publisher policy. Matching a schema
tag or server-side query predicate alone never authenticates a row.

The [production reader](../packages/registry/src/adapters/arkiv/reader.ts) uses
`select('*')`, `from(RegistrySource, { onMismatch: 'throw' })`, exact chain/source
revision/catalog predicates, `.createdBy(...)` and `.ownedBy(...)`. It orders by
`$key`, explicitly limits pages to 100, and advances with a key cursor. It checks
every returned row locally, rejects skipped/incomplete/duplicate/inconsistent
results, and bounds scans to ten pages, 1,000 rows and 128 blocks of drift.
`importer_version` is checked locally because it is not indexed.

`$expiresAt` is a **block height**; `content_expires_at` is a **UTC deadline**.
Both must exceed the independently observed current block/time. Equality is
expired. Neither field can be substituted for the other. Arkiv's duration helper
converts a requested lifetime into blocks; actual wall-clock lifetime can vary.
The [official expiration guide](https://docs.arkiv.network/writing/expiration/)
describes this distinction. Monolith also validates ordered content timestamps
and exact source, license, immutable identity, URL and configured origins.

## Independent consumption and routing boundary

From a built workspace, run the read-only public consumer:

```sh
env -u DEBUG -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_PUBLISHER_PRIVATE_KEY \
  pnpm exec tsx scripts/registry-query-example.ts --chain-id 10
```

[Setup and exact output](../docs/registry-setup.md) describe the public policy,
network contact and reproduction limits. The consumer uses the public
`@monolith/registry/reader` entry point and queries Rabdi directly, independently
of the dashboard, observer backend and their generation metadata. It constructs
no signing client and never contacts a discovered destination RPC.

Storage discovery does not authorize routing. The shared
[RegistryManifest contract](../docs/contracts.md) contains a short-lived public
projection; server discovery applies configured origins/current DNS admission,
while browser application reads still require approved hosts and a protected
live `eth_chainId` probe through `MonolithTransport`. Arkiv outage or expired
data fails closed; no stale or unsigned JSON fallback is implemented.

The accepted [API observation](../packages/registry/test/reader/observed-api-2026-11-06.json)
contains real historical chain-10 discovery/provenance, not current route
freshness. [The importer guide](../packages/registry/test/importer/README.md)
links all actual transactions, entities and independent read-back evidence.
