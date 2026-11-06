# Core release verification

MN-017 is an **offline implementation checkpoint with release acceptance still blocked**. The owner authorized isolated evidence-export validation and clean-clone checks in [the claim](https://github.com/Dijo-404/monolith/issues/17#issuecomment-6692959668). This document records the procedure and remaining evidence requirements; it does not announce a completed release.

The release requires accepted MN-009, MN-012, MN-013, MN-014, MN-015 and MN-016 evidence. At this checkpoint, the actual MN-014 live workflow and the complete MN-016 walkthrough remain outstanding under their existing owners. Recheck [issue #17](https://github.com/Dijo-404/monolith/issues/17) and its dependencies before accepting a release; this document is not live task state. Whitechain, a relayer and payment credentials are outside the core gate.

## Offline checkpoint

The [exporter](../scripts/export-evidence.ts) validates supported public DTOs and original-byte hashes, then copies validated bytes into a new local bundle. Its [policy](evidence-policy.md) defines supported types, limits, labels and remaining privacy review. There is no automatic source-data projection, anonymity verification, task closure, sponsor submission or release publication.

The checkpoint's validation results must name the exact commit or source tree, tool versions, commands and outcomes. A procedure below is not a passing result. Record failures as failures and preserve their logs. Full clean-clone acceptance also needs the genuine core demo and redacted actual evidence; deterministic tests alone do not satisfy it.

## Clean-clone procedure

Start from the reviewed commit after it exists in Git. Use a new destination that does not already contain files. A local clone avoids contacting GitHub or the active runtime; `--no-local` avoids reusing the source repository's object files through hardlinks.

```sh
git rev-parse HEAD
git clone --no-local . /tmp/monolith-core-clean
cd /tmp/monolith-core-clean
git rev-parse HEAD
git status --short
node --version
pnpm --version
pnpm install --frozen-lockfile --offline
pnpm check
pnpm exec tsc -p scripts/tsconfig.evidence.json
pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json --test scripts/export-evidence.test.ts
git status --short
```

Run this from the intended source worktree. Confirm the two commit IDs match; otherwise stop and check out the reviewed commit in the clone before validation. Use Node 24.22.2 and pnpm 12.18.0. The offline package store must already contain the lockfile's pinned packages. Missing cached dependencies are an installation blocker, not permission to report an offline PASS after a network download.

When the clone is on another filesystem, pnpm may select a different, empty store. Keep the failed offline result and explicitly select the already populated store with copy imports before retrying. For example, on this validation host the command is `pnpm install --frozen-lockfile --offline --store-dir /home/dj/.local/share/pnpm/store --package-import-method copy`. Use the actual populated store on another host; this option does not download missing packages.

No `.env`, signer, Arkiv access key, Whitechain account or live observer service is required for these commands. Do not copy credentials or untracked runtime files into the clone. `pnpm check` covers the workspace lint/type/test/build commands; run the dedicated exporter type/test commands as well because the root Vitest pattern excludes `scripts/`.

The tests use temporary synthetic inputs. They must preserve the `SIMULATED` label, verify original-byte export and reject unsafe paths, symlinks, unexpected fields, label/hash/identity/time mismatches, sensitive content and invalid output destinations. No test output is production release evidence. See [the policy commands](evidence-policy.md#commands) for verify-only and local-export usage.

## Evidence required for acceptance

| Required proof | What the reviewer needs |
| --- | --- |
| Real worker and paired observer | The selected verified Tor/Nym worker, actual useful read, explicitly consented direct control, independent trusted source comparison, time and retained artifacts. Passthrough and mock success provide no protected credit. |
| Registry use | Actual licensed import and public query, publisher/source/expiry evidence, admitted endpoint selection and the protected chain-ID probe used by the application. A manifest is discovery metadata. |
| Leak and repair | A useful read that independently fails privacy after the injected bypass, followed by a fresh rerun of the same intent after the reviewed repair. Preserve the original failure and the functional result. |
| Fail-closed behavior | Worker outage, expired/untrusted registry or wrong chain blocks required reads without an ordinary HTTP fallback. Inventory attempted and blocked reads truthfully. |
| Public export | Reviewed redacted bytes, source references, original-byte hashes, coherent times/labels and the verification manifest; no private keys, raw IPs, private wallet/order data or stable user identifiers. |
| Reproduction | Exact clean-clone commit, tool versions and command outputs, plus instructions that reproduce the actual core demo without conditional payment credentials. |

Export only supported, reviewed public DTOs using [the evidence policy](evidence-policy.md). A successful `--verify` or `--export` does not prove a bundle includes every required core artifact. Worker/independent browser/Arkiv source artifacts outside the first exporter's supported DTOs still need their separate original references and review. Do not discard them or force them into an incompatible DTO.

Keep report identities distinct from server allocations. A supported privacy report with an original `report_<UUIDv4>` ID belongs in a bundle with that exact ID; an observer's `run-<UUIDv4>` belongs in a separate matching bundle. If the original UI download wraps the public DTO, use only the separately reviewed [structural projection procedure](evidence-policy.md#reviewing-a-nested-privacy-report). Preserve the complete original wrapper, capture hash and `/report` pointer in the original-proof index, with the exact server-run/report-ID mapping and projected-byte hash. Do not rewrite IDs, fabricate missing observer durations, relabel a measured failure or count a metadata-only empty observer DTO as paired application proof.

Privacy reporting must disclose the measured read denominator, retries, injected bypass, unexplained traffic and bootstrap exclusions. Zero eligible reads is `null` coverage and cannot pass functional acceptance. The destination continues to see RPC payloads, and worker bootstrap is separately disclosed as non-anonymous. A recorded screenshot or report must show its observation time and scope.

## EF and Arkiv submission checklist

These are review items, not qualification claims or completed checks. Confirm current rules, partner selections and the exact cutoff in the participant dashboard before submission. This offline checkpoint neither opens that dashboard nor verifies eligibility or a deadline.

- [ ] Default application RPC reads use the real verified Anon-RPC worker or fail closed; the explicit direct control is labelled and consented.
- [ ] The genuine paired comparison, useful fail/repair rerun and independent egress inventory support the privacy claim.
- [ ] Worker version/integrity, non-anonymous bootstrap and residual payload/correlation limits are stated.
- [ ] Actual Arkiv import/query and application route selection have accepted source, publisher, expiry and entity evidence.
- [ ] Dataset licensing, importer rerun, independent consumer and the required [Arkiv documents](../arkiv) match the actual accepted work.
- [ ] README instructions, the demo and all public artifacts describe current behavior and unresolved limits accurately.
- [ ] The clean-clone result and public bundle have been reviewed against every core requirement.
- [ ] The participant dashboard's current partner choices, eligibility and exact submission cutoff are checked by the owner.

Keep MN-017 open until the required implementation is merged and its full evidence is accepted. A draft PR, an offline test result or an exported manifest alone does not make MN-027/MN-028 or any other downstream gate ready. Follow [CONTRIBUTING.md](../CONTRIBUTING.md#review-and-merge) for the final handoff.
