# How Monolith uses Arkiv

This is the Build-on-Arkiv judging criterion described by the [official Mumbai Arkiv page](https://ethglobal.com/events/mumbai/prizes/arkiv). It describes implemented behavior and recorded observations; current entity freshness and final release acceptance remain separate gates.

## Query fields fit the product

Monolith stores public EVM endpoint discovery metadata using [RegistrySource](../packages/registry/src/adapters/arkiv/schema.ts), schema `monolith.rpc.v1`. A chain ID is the user's public discovery key; indexed source revision and catalog hash pin the dataset. The [reader](../packages/registry/src/adapters/arkiv/reader.ts) also filters creator/owner, orders by entity key and bounds pagination. [Schema](schema.md) lists all fields and the exact validation policy.

The recorded production creator/owner is `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` on Rabdi **7794095**. Only that trusted publisher's records matching the pinned source identity are eligible. A matching public schema tag cannot authenticate another publisher. Each URL is still a `candidate`; storage does not establish RPC availability or correct chain identity.

## Ownership and expiry fit the data

The operator publishes `readonly: true`, `permissionlessExtension: false` entities with raw creation flags `1`. Product users cannot edit these records; public ownership is the dataset publisher's, not a claim that shoppers own individual rows. Reader policy validates both creator and owner even if metadata is later presented with unexpected ownership.

Every admitted row must satisfy **both** Arkiv's engine-block `$expiresAt` and the publisher's UTC `content_expires_at`. Equality is expired. The original import requested 24 hours; actual wall-clock expiry can differ with block production. The manifest has its own shorter deadline. [Data quality](data-quality.md) gives actual measurements and makes clear that no recurring refresh service has been deployed.

An unavailable/expired/untrusted query blocks discovery. The implementation has no unsigned/stale-result fallback. [The import guide](../packages/registry/test/importer/README.md) explains reruns, reconciliation and refresh constraints; refresh is not an assumed automatic repair.

## Each used feature changes visible behavior

| Arkiv feature used | Product effect and evidence |
| --- | --- |
| Actual writes and filtered reads | The importer published 100 entities for 100 distinct networks in ten recorded transactions; independent public read-back found those records. [Measurements and receipts](data-quality.md#actual-storage-and-independent-reads) distinguish new writes, reused rows and reruns. |
| Public chain/source queries | [Dashboard registry client](../apps/dashboard/src/composition/registry.ts) consumes the public manifest; [transport composition](../apps/dashboard/src/composition/transport.ts) selects an admitted candidate and requires protected chain validation before a useful read. [The real Nym routing observation](../tests/e2e/registry-routing/live/observed-live-2026-11-06.json) binds an Arkiv entity to the selected endpoint. |
| Publisher/source trust | Forged, mismatched or unsupported records cannot become route choices; [reader tests](../packages/registry/test/reader) exercise rejection and bounds. |
| Expiring records | Expired metadata cannot silently continue authorizing a route; the user sees unavailable/blocked state and must obtain fresh trusted data. |
| Independently readable public data | A separate [key-free consumer](../scripts/registry-query-example.ts) can query the same dataset without the dashboard or observer. [Reach](reach.md) provides its command and recorded output. |

The independent query can be run from the [README](../README.md#query-the-accepted-registry-import-independently). A historical successful query cannot guarantee a successful query today. Protected route validation remains necessary after discovery; raw RPC URLs are never arbitrary proxy destinations.

## What stays off Arkiv

No inspected private wallet addresses, order data, source IPs, signing keys or per-user histories belong in the dataset. Arkiv stores shared public chain metadata and publisher provenance. The observer retains bounded synthetic diagnostics in memory for five minutes; the browser worker handles protected RPC reads. Public metadata retrieval is a separate network contact and does not make a user anonymous to Arkiv or its caller's network provider.

[Why Arkiv](why-arkiv.md) discusses what an ordinary public database could also do, and [friction](friction.md) records actual integration problems. There is no measured adoption claim or invented comparison against alternative databases. Final event eligibility still requires the public-source and AI/human-disclosure gates in the [submission audit](../docs/prize-compliance.md).
