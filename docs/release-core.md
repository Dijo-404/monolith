# Core release evidence candidate

The selected measured core is execution commit `c11dace8107f386e5eceb8356395bfdb23035dd1`, public Site7 and real observer runtime10. Its genuine mounted-presenter observation has four fresh server allocations, thirteen unique wire rows and 248 source/build/SDK input bindings. The [original capture](../evidence/core/2026-11-07/originals/current-core9/browser-live.json), [independent review](../evidence/core/2026-11-07/originals/current-core9/independent-review.json) and [producer redaction/binding audit](../evidence/core/2026-11-07/originals/current-core9/binding-redaction-audit.json) retain the actual scope and times. This candidate still requires its exact clean-clone result, independent review and normal owner acceptance; a procedure or passing hash alone is not release completion.

MN009/012/013/014/015/016 are merged and accepted. The exporter implementation merged separately in PR65 as a source checkpoint. This new evidence change preserves the current C11 observation and its original report identities; it does not replace older DFB8/5CF7 successes, blocked attempts or simulated software evidence. A later held visual revision has its own owner and is not described as executed by this capture. Any selected later runtime needs fresh source-bound observation before that later release is claimed.

## What is preserved

The [core proof index](../evidence/core/2026-11-07/core-proof-index.json) records the original storage commit, selected execution source, all copied original hashes, report/server-ID mappings, backend originals and historical worker/observer/Arkiv/import/software references. The source ledger and original records are pinned in commit `631e3fe33575702f84ee5cf5a6acdad896b176c0`. Execution source, storage source and deployment-tool hashes are distinct; no whole-repository equality to the separately frozen backend469 is asserted.

Four supported [report bundles](../evidence/core/2026-11-07/README.md) contain canonical unchanged `/report` values selected from the complete original UI downloads. Their new standalone bytes are explicitly reviewed projections, not the whole downloaded wrappers. Each bundle's manifest exactly matches its original `report_<UUIDv4>` identity. Server `run-<UUIDv4>` allocations remain separately mapped in the [projection provenance](../evidence/core/2026-11-07/report-projection-provenance.json). No ID, count, finding, scope, label or original observation time was rewritten. The [eight actual offline verify/export operations](../evidence/core/2026-11-07/export-operations.json) preserve the exported bytes exactly.

| Case | Useful reads | Protected credit | Meaning |
| --- | ---: | ---: | --- |
| private | 2/2 | 0/2 | Useful, with no paired-source credit |
| compare | 3/3 | 2/3 | The explicit direct control remains unprotected |
| leak | 4/4 | 2/4 | The intentional direct bypass is detected |
| repair | 4/4 | 3/4 | A fresh same-seed route-only repair passes the bounded checks |

The leak remains a genuinely observed privacy failure. A successful test of that expected failure does not relabel the leaky fixture private. Metadata envelopes, screenshots, SDK/worker proofs, import journals and diagnostics remain original indexed records outside the four supported DTOs. Missing observer durations were not invented, and empty metadata diagnostics are not counted as paired application proof. Follow [the evidence policy](evidence-policy.md) for validation limits.

## Offline reproduction from the exact candidate

Use Node24.22.2 and pnpm12.18.0. The PR and attached validation report must name the exact candidate commit and actual command outcomes. Clone only committed source; do not copy `.env`, runtime/status files, private identity or credential files.

```sh
git clone --no-local /path/to/reviewed/source /tmp/monolith-final-clean
cd /tmp/monolith-final-clean
git checkout --detach <reviewed-candidate-commit>
git rev-parse HEAD
git status --short
pnpm install --frozen-lockfile --offline --store-dir /home/dj/.local/share/pnpm/store --package-import-method copy
pnpm check
pnpm exec tsc -p scripts/tsconfig.evidence.json
pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json --test scripts/export-evidence.test.ts
```

The explicit store is this validation host's populated cache. Another host needs the same lockfile's cached packages or an explicitly separate dependency-install step; a failed offline install is not an offline PASS. The validation execution uses a minimal environment and `/dev/null` npm user configuration. Manifests and lockfile remain unchanged. Root Vitest excludes `scripts/`, so the dedicated exporter type/test commands remain required.

Validate each retained report plan against its exported DTO directory with the actual current UTC clock, for example:

```sh
pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json scripts/export-evidence.ts --verify --plan evidence/core/2026-11-07/plans/repair.plan.json --input evidence/core/2026-11-07/reports/repair --now <actual-UTC-ISO>
```

Repeat for private/compare/leak/repair. The CLI validates supported shape, exact identity/time/labels, original-byte hashes and its configured redaction checks. It cannot establish live truth, complete core-proof coverage, universal anonymity or eligibility. Packaging/validation time never renews an old registry generation or observation. Clean-clone tests use labelled synthetic inputs and make no new live-evidence claim.

For the selected public build, rebuild only with the explicit public observer URL and compare the nine Vite output hashes with the retained Site7 provenance:

```sh
MONOLITH_PUBLIC_OBSERVER_URL=https://d06045ae660681.lhr.life pnpm --filter @monolith/dashboard build
```

This is build reproduction, not a new SDK run. The original real workflow already binds the selected runtime inputs. Instructions for a further real run and the bounded no-payment demo remain in [the core demo guide](demo-core.md); live observation must be deliberately source-frozen and coordinated with the runtime owner.

## Publication, source and remaining limits

The [Site7 native receipt](../evidence/core/2026-11-07/originals/site7/deployment.json), [input audit](../evidence/core/2026-11-07/originals/site7/input-audit.json), [actual HTTPS verification](../evidence/core/2026-11-07/originals/site7/static-verification.json) and [controlled fault/layout result](../evidence/core/2026-11-07/originals/site7/browser-fault/browser-deployed.json) are preserved unchanged. Authored asset hashes are separate from modified served-HTML hashes and the pinned hosting addition. Local gzip/tar hashes and returned opaque service-container metadata are separate; service-container byte identity was not independently retrieved or asserted. The injected worker-host fault grants no real-worker credit.

GitHub repository metadata was observed PUBLIC at `2026-11-06T22:34:11Z`; earlier original records retain their earlier recorded visibility. Public source availability does not establish participant or sponsor eligibility. README status/roadmap text at accepted basebd43 still contains older pending states; #83 owns that factual correction before final handoff. This guide does not claim README has already been refreshed.

Hosting/security bootstrap, its fetched challenge runtime and worker bootstrap are non-anonymous and outside transport verification. Destinations see RPC payloads. Source comparison is bounded to the trusted provider, verified worker, chosen endpoint and observation window. The free backend depends on this workstation and provider; process caps and passive health checks do not guarantee uptime, recovery or permanent hostname retention. Historical controls and failed routes remain named evidence rather than erased or explained without proof.

## Submission checklist

Use the [official Mumbai information](https://ethglobal.com/events/mumbai/info/) and [prize requirements](https://ethglobal.com/events/mumbai/prizes/) plus the participant dashboard for the current deadline, registration, eligibility and selected partner tracks. The core evidence demonstrates the privacy lab and actual Arkiv discovery/import/query/selection; configuration, merged code, mocks and metadata alone do not establish sponsor qualification.

- Confirm dashboard eligibility, permitted track selections and exact cutoff.
- Review the [actual Arkiv evidence and provenance](../arkiv/why-arkiv.md) and [registry reproduction](registry-setup.md).
- Provide accurate human-contribution and AI-assistance/spec/prompt disclosure without invented participant work.
- Complete the required qualifying video and submission forms; do not represent uncompleted items as done.
- Describe Uniswap/Whitechain development and any unfinished runtime requirements according to their own current task/evidence records. They are not inferred completed from this core package.

Normal review means ready for the owner. MN017 closes only after its new PR is merged and its complete bounded release criteria are accepted; no task closure, form submission or sponsor qualification follows automatically from this document.
