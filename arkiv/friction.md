# Arkiv integration friction

These are observed integration constraints and implemented responses from
MN-005, MN-008 and MN-010. Live observations retain their original timestamps;
deterministic failure cases are `SIMULATED` software tests. No outage frequency,
throughput benchmark or SDK defect rate was measured.

| Constraint encountered | Evidence and response |
| --- | --- |
| Documentation sketches were not the pinned production interface | [MN-005 preflight](../docs/preflight/arkiv.md) records the tested public API. Workspace pins SDK 1.0.1/viem 2.57.16; the [implemented schema](schema.md) supersedes the idea's illustrative fields. |
| Typed rows and system metadata need explicit validation | [Reader adapter](../packages/registry/src/adapters/arkiv/reader.ts) checks typed string wrappers, all selected system fields, creator/owner and readonly flags. Strict mismatch handling prevents silently accepting a partial decoded page. |
| Schema tags can be copied by another publisher | [Actual preflight control](../packages/registry/src/spikes/arkiv-independent-query-2026-11-06.json) recorded a same-tag foreign publisher and rejection. Production additionally checks its importer discriminator and recomputed immutable record identity. |
| Strings have a smaller storage boundary than the shared URL DTO | [Source policy](../packages/registry/src/domain/source-policy.ts) checks every stored string at 128 UTF-8 bytes; it never truncates URLs or names. A structurally valid shared URL alone is insufficient for SDK storage. |
| Expiry uses two different units | Actual [entity read](../packages/registry/test/importer/observed-live-2026-11-06/sample-entity-evidence.json) includes engine block 336579 and a separate UTC content deadline. [Freshness policy](../packages/registry/src/domain/freshness.ts) checks both; block height is never treated as Unix time. |
| Pagination is not an atomic snapshot | [Reader tests and explanation](../packages/registry/test/reader/README.md) cover explicit limits, cursor ordering, skipped rows, counts and block drift. Each page is a separate observation; changing/incomplete sets block the scan. |
| A timeout after submission is ambiguous | [Importer recovery](../packages/registry/test/importer/README.md) durably reserves batches before network submission and requires trusted reconciliation. Transport retries are disabled for writes; an empty query does not authorize another submission. |
| Discovery success must not grant arbitrary RPC access | [Actual API observation](../packages/registry/test/reader/observed-api-2026-11-06.json) returned 403 when the discovered ID was tried on the operator-controlled observer map. Origin/DNS admission and protected browser probes remain distinct boundaries. |

## Concrete review findings

The importer review found and corrected two real guard problems: canonical
signing-file containment needed path-segment checks, and a row with an expired
UTC deadline but live engine blocks had to block duplicate publication even
without a local journal. [The review follow-up](../packages/registry/test/importer/README.md)
records nine expected failing regressions before the fixes, 65 targeted passes
afterward, and a fresh key-free 100/100 read at **2026-11-06T14:12:19.316Z**.
Those live fresh-row reads do not exercise expiry-error branches; the latter
were checked with simulated clocks and SDK responses.

The reader review corrected preservation of a real imported name's trailing
space, which participates in immutable identity, and retained in-flight capacity
after a timeout until underlying work settled. [Reader validation](../packages/registry/test/reader/README.md)
records 194 simulated reader/API cases and the actual key-free API observation.
Changing a name merely for display must not change the authenticated record.

## Reproduction and remaining work

Use [registry setup](../docs/registry-setup.md) for the direct public query and
[the importer guide](../packages/registry/test/importer/README.md) for preview,
write, zero-write reuse and independent verification commands. Source previews
perform no fetch or endpoint probe. Public queries require no signing-key file.
The original import/rerun artifacts predate the review fixes and remain
unchanged; the corrected reader's later observation is linked separately.

Public infrastructure can be unavailable or rate limited. The query reports a
fixed sanitized failure without old-data substitution; these documents promise
no uptime or latency. A recurring refresh operator, production maintenance
schedule, long-term retention and external-user feedback are **pending**.

Primary API references are the official [select](https://docs.arkiv.network/querying/select/),
[filter](https://docs.arkiv.network/querying/filter/),
[create](https://docs.arkiv.network/writing/create/) and
[expiration](https://docs.arkiv.network/writing/expiration/) guides. Public docs
can evolve; the committed lockfile, adapter source and timestamped observations
identify the version actually exercised here.
