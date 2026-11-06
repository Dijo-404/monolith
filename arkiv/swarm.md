# Arkiv + Swarm integration

Target: the ETHGlobal Mumbai from-scratch Arkiv + Swarm bonus alongside Monolith's Arkiv track. [Official requirements](https://ethglobal.com/events/mumbai/prizes/arkiv). Implementation tracking: [#99](https://github.com/Dijo-404/monolith/issues/99); actual frontend upload and browser evidence: [PR #101](https://github.com/Dijo-404/monolith/pull/101).

**Current state:** the compiled frontend was uploaded to Swarm and passed exact-file and real-worker browser checks. One Arkiv release entity was published, its transaction confirmed, and a separate key-free read verified all ten files against its descriptor. [Retained release evidence](../deploy/swarm/evidence/2026-11-07/arkiv-release/README.md) includes the initial verification failure and its read-only reconciliation. Actual postage batch provenance and the demo-video timestamp remain missing. This document does not claim qualification or an award.

## What each system stores

Swarm stores the compiled dashboard HTML, JavaScript, CSS, fonts, worker-host document and dependency/font notices. The observer and trusted registry API run separately; Swarm does not execute Node code or receive their credentials. No private Git source archive was uploaded.

Arkiv already supplies the trusted licensed RPC registry used by Monolith. The new, separate `monolith.release.v1` release entity is designed to make the frontend discoverable and independently verifiable. Its `swarm_reference` field holds the exact public frontend collection reference. `inventory_json` holds canonical reviewed paths, byte sizes and SHA-256 values; `inventory_sha256` binds it. `release_id`, `source_commit`, `published_at` and `content_expires_at` bind source, content and lifetime. This does not change the frozen RPC endpoint DTO or grant RPC routing admission.

The uploaded collection has no public inventory JSON. Keeping the ten-file inventory in the release entity avoids claiming a nonexistent Swarm file or rebuilding content merely to embed its own reference. A key-free reader checks the explicitly trusted creator and owner, readonly flags, current chain/block and UTC expiry, then derives the fixed CID gateway and verifies every declared file, including notices. Schema tags alone do not authenticate data.

## Actual references and provenance

| Item | Observed value/state |
| --- | --- |
| Frontend source | `bd43ff315aa1d98552a7f117f91b4afb56adefd4` |
| Swarm collection | `8a2a3e73a09b68306cd4a6ff1935a2492017f7a2c918ede926822d37aa132db1` |
| Openable frontend | [Swarm CID origin](https://bah5acgzarivd445atnuda3guu37rsnncjeqbp55czemo32jgqiwtpkqtfwyq.bzz.limo/) |
| Actual uploading service | `https://api.gateway.ethswarm.org` |
| Buying wallet or batch provider | Gateway-provided postage; purchasing wallet not exposed |
| Actual postage batch ID | **Unknown: required provenance remains outstanding** |
| Request stamp selector | `NULL_STAMP`; this is not the actual batch ID |
| Arkiv release entity key | `0xfc1627a9bf52005565d74111403477cc08c89d584a954da02371ffe73018179d` |
| Arkiv chain | Rabdi, chain ID `7794095` |
| Trusted publisher (creator and owner) | `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` |
| Create transaction | `0x5f22569bf2158e00f1be1b3b7f3cdf6c0bbcf06b9023a2bdd0f39e37df36ba28` |
| Confirmed block / actual fee | `310566` / `174479000000000` wei (test-network token) |
| Descriptor release ID | `088cc81e88de8f5c1a723dcbc50ea776c6bf927458d93535b4a00cbb9698ede9` |
| Canonical inventory SHA-256 | `a932f30c7a6113d3a66896d046254b54728f719d71fea6bb5ed3924d979df70b` |
| Key-free observed content read | `2026-11-06T23:21:25.158Z`: ten files, 673,482 bytes verified |
| Entity block expiry / descriptor UTC expiry | `353315` / `2026-11-07T23:00:00.000Z` (either expiry ends trust) |

The observed upload used the gateway's supplied postage without an operator account or payment. Its public API does not return a content-to-batch binding. Aggregate TTL/usage and global chain batch lists cannot establish which batch stamped this content. A provider-issued receipt or a known operator batch is needed; no batch ID or buying wallet is invented here. No paid postage/top-up/domain was purchased, and retention is not guaranteed.

The descriptor was prepared at `2026-11-06T23:05:21.502Z` and published unchanged. Its original preview receipt still says `DESCRIPTOR_PREVIEW_ONLY`, accurately describing that earlier operation; the separate transaction and independent-read receipts establish the later observations. Availability and remaining lifetime must be checked again when reading. An expired entity must fail closed.

The single create ran from frozen code `c4469171763853fc9d21058572a09665ef211846`. Its immediate verification failed because the adapter expected `Uint8Array` while Arkiv SDK 1.0.1 returns a hex string for a bytes field. The durable journal had already retained the entity and transaction identifiers. The adapter was corrected in `a48b750`, with a regression using the SDK's public `bytes()` helper; a read of the known transaction receipt and a fresh key-free entity/content read confirmed the existing publication. No second transaction or automatic replay was used. The original uncertain publication and incomplete first reconciliation receipts remain unchanged.

## Repository upload and read files

- `deploy/swarm/upload.mjs`: verifies the clean snapshot's exact distribution/provenance, creates a bounded regular-file USTAR, and optionally performs one explicit gateway upload after durable intent. Default preview is non-mutating. The original observed upload used a separately reviewed fixed temporary command before this reusable tool existed; the original receipt is preserved in PR #101.
- `scripts/deploy/prepare-static.mjs`: existing clean-commit packager; only compiled assets/notices/public build configuration leave its private temporary source tree.
- `scripts/deploy/verify-static.mjs`: existing served-byte, executable-MIME and distinct-worker verification.
- `scripts/deploy/arkiv-release.ts`: offline descriptor preview, explicit bounded publication and key-free entity-to-content verification.
- `packages/registry/src/domain/swarm-release.ts`: canonical inventory/descriptor validation.
- `packages/registry/src/adapters/arkiv/swarm-release.ts`: separate fixed-Rabdi schema, trusted entity reads and bounded fixed-origin file checks.
- `.github/workflows/swarm-release.yml`: explicit manual candidate build/optional upload; checks accepted-main ancestry and successful workspace/privacy checks for the selected exact SHA. No signing key or Arkiv write is available to this workflow.

Use only public package exports. The new `@monolith/registry/swarm-release` entry point uses the registry package's already declared SDK dependencies; root manifests/lockfile and existing endpoint policies are unchanged.

## Reproduce one upload and one read

Use pinned Node 24.22.2 and pnpm 12.18.0. Start with a clean accepted source commit and a currently qualified public observer origin. Source and backend can change, so do not assume a recorded origin is still available.

```sh
node scripts/deploy/prepare-static.mjs \
  --commit "$MONOLITH_ACCEPTED_SOURCE_SHA" \
  --out "$MONOLITH_NEW_SNAPSHOT" --pnpm "$MONOLITH_PNPM_PATH" \
  --observer-url "$MONOLITH_OBSERVER_ORIGIN"

node deploy/swarm/upload.mjs --snapshot "$MONOLITH_NEW_SNAPSHOT" \
  --out "$MONOLITH_NEW_UPLOAD_DIRECTORY" --upload
```

All directory variables must select new absolute paths. Successful upload yields `UPLOADED_NOT_VERIFIED`, a collection reference and CID origins. Default omission of `--upload` writes a preview/archive only. Inspect the receipt and independently verify authored bytes plus actual browser/worker behavior before publishing discovery. An uncertain upload leaves intent/receipt; reconcile it rather than reusing the directory or blindly repeating the POST.

Build public package exports, then prepare a descriptor using the upload preview's reviewed inventory:

```sh
pnpm --filter './packages/**' -r build
pnpm exec tsx scripts/deploy/arkiv-release.ts preview \
  --inventory "$MONOLITH_UPLOAD_PREVIEW_JSON" --reference "$MONOLITH_SWARM_REFERENCE" \
  --source "$MONOLITH_ACCEPTED_SOURCE_SHA" --expires-at "$MONOLITH_RELEASE_EXPIRY_UTC" \
  --out "$MONOLITH_NEW_DESCRIPTOR_DIRECTORY"
```

Expected output: a canonical `descriptor.json`, deterministic release/inventory digests, and `DESCRIPTOR_PREVIEW_ONLY`, with zero network contact and no signer loaded. With an explicitly selected existing authorized Arkiv publisher, a secure key file outside the checkout and a reviewed descriptor, publication is a separate command:

```sh
pnpm exec tsx scripts/deploy/arkiv-release.ts publish \
  --descriptor "$MONOLITH_DESCRIPTOR_JSON" --publisher "$ARKIV_PUBLISHER_ADDRESS" \
  --key-file "$ARKIV_PUBLISHER_KEY_FILE" --access-key-file "$ARKIV_ACCESS_KEY_FILE" \
  --max-total-fee-wei 2000000000000000 \
  --state "$MONOLITH_PRIVATE_PERSISTENT_STATE" --out "$MONOLITH_NEW_PUBLICATION_DIRECTORY"
```

The access-key file is optional; if selected it must be a restrictive regular file containing one `ARKIV_ACCESS_KEY=...` assignment. It is sent only in the fixed Rabdi header, never a URL. The signing file is read only for `publish`, not preview/read; values and credential paths are excluded from artifacts. Debug logging is refused. Never paste keys into commands or publish them in Arkiv.

Publication permits one create with a fixed gas limit of 2,000,000 and gas price of 1,000,000,000 wei; the explicit ceiling is 2,000,000,000,000,000 wei. This is a bound, not a successful fee estimate or funding assertion. Durable state is reserved before broadcast, known entity/transaction identifiers are synced as soon as available, and uncertain or failed results do not permit automatic retry. Recreating descriptor timestamps does not bypass the same-content journal. Retain state, reconcile actual chain results and use the read command when an entity key is known.

```sh
pnpm exec tsx scripts/deploy/arkiv-release.ts read \
  --entity "$MONOLITH_RELEASE_ENTITY_KEY" --publisher "$ARKIV_PUBLISHER_ADDRESS" \
  --release-id "$MONOLITH_EXPECTED_RELEASE_ID" --access-key-file "$ARKIV_ACCESS_KEY_FILE" \
  --out "$MONOLITH_NEW_READ_DIRECTORY"
```

Expected successful result: the actual trusted entity resolves to the fixed Swarm CID origin, all declared sizes/hashes and executable MIME types verify, and final entity/expiry checks still pass. This is useful release discovery and integrity verification, not proof of anonymity or storage retention. The current gateway's exact WOFF2 bytes are verified while its nonstandard literal `false` MIME is explicitly marked unverified with a warning; that exception never applies to executable files.

## Demo moment and integration friction

The final demo video has not been recorded/submitted for this integration; its timestamp is **pending**. It must show the actual Swarm frontend, real Arkiv entity/reference resolution and observed verified read while the entity remains live. A later expired read must be presented as expired.

Observed difficulties: no initial Swarm setup; provided-gateway postage avoids an immediate purchase but hides actual batch provenance; a first `bzz.link` verification fetch failed; new-site moderation/origin/worker behavior needed actual qualification; font MIME is nonstandard; an interrupted browser attempt had to remain incomplete while fresh source-bound attempts were captured; the real Arkiv SDK bytes response exposed an incorrect adapter fixture after creation, requiring read-only reconciliation. The successful candidate's real workflow and injected worker-failure checks are retained separately from simulated tool tests.

Source-repository publication, license/AI-disclosure acceptance, final partner selection and video submission remain the owner's normal event decisions. A compiled public frontend does not complete those submission requirements. The prior Site/backend and separately owned UI revision were not changed by this task.
