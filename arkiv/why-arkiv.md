# Why Monolith uses Arkiv

Monolith needs public, attributable chain/RPC discovery metadata that a second
client can query independently of its dashboard and backend. Arkiv supplies a
shared query surface with entity keys, publisher creator/owner metadata and
expiring storage. The mirror retains a redistributable upstream source, exact
revision, content catalog and license instead of maintaining private endpoint
lists with no provenance.

The implemented path is the
[licensed importer](../packages/registry/test/importer/README.md) → public
Rabdi entities → [trusted reader/API](../packages/registry/test/reader/README.md).
The independent [consumer CLI](../scripts/registry-query-example.ts) reads the
same production entities directly through `@monolith/registry/reader`, with
no Monolith HTTP service, dashboard cache or signing key. See
[reproduction](../docs/registry-setup.md) and [observed consumption](reach.md).

## What the integration contributes

| Requirement | Implemented contribution |
| --- | --- |
| Reusable metadata beyond the application | Public chain-scoped queries and entity references from a dedicated publisher |
| Attribution and reproducibility | Exact creator/owner policy, immutable upstream revision, recomputed record identity, retained MIT notice and source catalog |
| Bounded freshness | Independent checks of Arkiv block expiry and publisher UTC content deadline; unavailable/expired data fails closed |
| Honest operating cost | [Ten actual import receipts](../packages/registry/test/importer/observed-live-2026-11-06/receipt-evidence.json) created 100 readonly entities for 0.018453639 test tGLM in observed fees |

A public conventional database or signed static catalog can provide many of
these features. Arkiv is useful here because third parties can query the
wallet-published, expiring records through its common public interface; this is
not a claim that conventional storage cannot support provenance or open access.
The tradeoffs are testnet availability, query limits, expiring data that needs
refresh, indexing constraints and operator-funded writes. [Friction](friction.md)
records the constraints encountered and the implemented responses.

## Trust and privacy limits

Arkiv supplies system metadata, while Monolith configures which
publisher/source to trust and checks returned content. A copied schema tag is
not permission to route traffic. Importing a URL proves neither endpoint chain
identity nor uptime, provider behavior or anonymity-network compatibility.
The application must apply approved host policy and a real protected
`eth_chainId` probe before ordinary reads. [Schema](schema.md) describes those
separate boundaries and the lack of stale/unsigned fallback.

Only public configuration belongs in the mirror. Wallets being inspected,
private orders, signatures, raw IPs and stable user-session identifiers never
belong in registry queries or entities. A direct public metadata lookup exposes
ordinary network contact with Arkiv; no anonymous storage query is claimed.

The completed storage/import/API observations are linked above with timestamps.
External adoption, unattended refresh and final product/release acceptance are
**pending**. These documents explain a working storage/discovery integration
without asserting sponsor eligibility, application-wide privacy coverage or
conditional Whitechain settlement.
