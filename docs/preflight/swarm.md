# Swarm deployment access preflight

Date: 7 November 2026, Asia/Kolkata. Owner: `codex-swarm-deployment-20261107`. Tracking: [issue #96](https://github.com/Dijo-404/monolith/issues/96). This is resource qualification for the owner-selected Swarm frontend, with the backend kept separate.

## Resource inventory

The owner confirmed no existing Swarm setup. Relevant process environment names, repository environment-file key names and standard Bee/Swarm CLI configuration locations revealed no configured batch or upload service. No credential values were printed. No Bee or Swarm CLI executable was installed; the preflight uses Node built-ins without workspace dependency changes.

The [official client example](https://github.com/ethersphere/bee-js#usage) offers a provider-stamped gateway route. The bounded actual uploads below succeeded without an operator account or purchase. This is observed access, not a free allocation or permanent retention promise. No new account, wallet or paid domain was created.

## Actual observations

At **04:03:57 IST**, a single bounded health GET to `https://d06045ae660681.lhr.life/api/health` returned HTTP 200 and the exact real observer `configured` DTO, with no simulated marker. Runtime10's recorded source `469f49d27ba9e2c40578b6bb18fc9e23cd71c4a4` and all 161 public source/dist/lock bindings matched the frozen operator checkout. The existing operator retains ownership. This is configured health at that time, not a new Arkiv freshness, worker or durable-hosting result.

At **04:04–04:05 IST**, bounded read-only HTTPS observations of the documented public gateway found:

| Check | Observation | Limit |
| --- | --- | --- |
| `/health`, `/readiness` | HTTP 200, `OK` | Reachability, not upload permission |
| `/gateway` | HTTP 200, gateway mode true | No batch ID, entitlement or lifetime contract |
| `/stamps`, `/tags` | HTTP 404 | Public API does not expose this node metadata |
| Selected aggregate metrics | One usable stamp; 118,444 seconds reported TTL; usage 0.015625 | Provider aggregates at that instant; actual selected batch identity unknown |
| Public guide example | 10,359 bytes of HTML at matching CID roots on `bzz.link` and `bzz.limo`; no redirect | Known content only; new HTML/worker moderation and behavior untested |

The example's reference is `bc9b942212421e2a19fe1ffdf0add641ae530923041ea8f549381747b14b2f2d`, encoded as CID `bah5acgzaxsnziiqsiipcugp6d767blowigxfgcjdaqpkr5kjhalupmklf4wq`. The [official gateway](https://github.com/ethersphere/swarm-gateway) supports CID routing and can moderate new HTML or rewrite missing-file paths. Distinct worker documents and rejected shell fallback therefore still require actual candidate tests.

## Reproduction and pending gates

Use [the bounded preflight command](../../deploy/swarm/README.md) with the current operator-confirmed backend origin and a new output path. Do not assume that the historical origin or a previous health result remains available.

The initial candidate preparation attempt correctly failed because the requested source did not match that checkout's clean HEAD. Preparation moved to a separate detached checkout of accepted `bd43ff315aa1d98552a7f117f91b4afb56adefd4`; no guard or teammate checkout was changed. The unmodified `scripts/deploy/prepare-static.mjs` passed its clean archive/frozen install/build with Node 24.22.2 and pnpm 12.18.0. It prepared ten public files, 673,482 bytes, and retained 26 dependency/font notices. The source archive was excluded. Every prepared file matched its provenance, and a separate clean build reproduced all nine Vite output files exactly; the tenth file is packaged notices.

## Bounded actual uploads and candidate

The owner authorized proceeding with deployment, and the exact operational scope was recorded on issues #96/#36/#40. Each upload command and its archive/payload were independently reviewed before one invocation; exclusive intent records prevent blind replay after uncertainty. No purchase/top-up/dilution, signing key, private environment or backend operation was used.

At **04:13:10–04:13:13 IST**, the single 46-byte public synthetic connectivity upload returned HTTP 201. Both CID gateway roots returned HTTP 200 with identical payload bytes/SHA-256. The [synthetic receipt](../../deploy/swarm/evidence/2026-11-07/synthetic-upload.json) describes connectivity only, with no deployment/privacy claim.

At **04:15:38–04:15:39 IST**, one 686,080-byte tar containing exactly the ten reviewed compiled public files returned HTTP 201. The [candidate receipt](../../deploy/swarm/evidence/2026-11-07/candidate-upload.json) binds source, archive, provenance and origin. The [public inventory](../../deploy/swarm/evidence/2026-11-07/public-inventory.json) lists every authored file; it is retained here and was not silently added to the uploaded collection.

Candidate reference: `8a2a3e73a09b68306cd4a6ff1935a2492017f7a2c918ede926822d37aa132db1`.

[Swarm frontend candidate](https://bah5acgzarivd445atnuda3guu37rsnncjeqbp55czemo32jgqiwtpkqtfwyq.bzz.limo/).

The unchanged static verifier passed **eleven HTTPS checks** against that CID origin: every authored asset, root/index equality, executable MIME types and distinct worker document/module. No redirect or HTML-addition exception was enabled. The [static receipt](../../deploy/swarm/evidence/2026-11-07/static-verification.json) retains exact observed hashes. The first `bzz.link` verification failed at fetch without a completed receipt; it is not relabeled as success.

The [final GET-only report](../../deploy/swarm/evidence/2026-11-07/get-preflight.json) passed all seven observations at **04:15:52–04:15:54 IST**, including configured backend health and known example retrieval. It reports deployment readiness false. Provider aggregates showed one usable stamp and 117,821 seconds TTL at that instant; those values do not bind a specific batch to Monolith.

The first browser validation was interrupted by the conversation turn before either runner wrote a final report. Four layout screenshots and an empty live-output directory are [recorded as incomplete](../../deploy/swarm/evidence/2026-11-07/interrupted-attempts.json). No runner process remained before distinct fresh attempt directories were started. Actual browser and privacy results are recorded separately after completion; incomplete output is not acceptance.

## Actual candidate browser acceptance

The fresh [live attempt](../../deploy/swarm/evidence/2026-11-07/live-attempt2/browser-live.json) passed from **04:19:43 to 04:21:38 IST** against the Swarm CID origin and current frozen runtime10. All 248 source/compiled/SDK bindings remained unchanged. Four fresh allocations produced thirteen independently inventoried wire reads: private two, comparison three, leak four and repair four. The intentional leak failed at two protected reads out of four; repair passed at three out of four while preserving useful behavior and the previous failing report. Private-only mode did not claim a source comparison. Zero ordinary fallback target requests and zero page errors were observed. The verified worker bytes matched their expected hash; frame inventory contained only the owned worker, which was removed on navigation with context destruction. No hosting bootstrap requests were observed in this bounded run.

The separate [deployed fault/layout attempt](../../deploy/swarm/evidence/2026-11-07/fault-attempt2/browser-deployed.json) passed from **04:19:43 to 04:22:49 IST**. Desktop 1440 and narrow 390/320 layouts, forced WebGL fallback and exact frame checks passed. An explicitly injected worker-document failure yielded `WORKER_UNAVAILABLE`, disabled export and zero external sends/page errors, with one intercepted worker document and full context teardown. This is an injected failure check, not a real provider outage or worker-execution proof. Five screenshots are hash-bound to that result; six screenshots and four reports are retained with the live attempt.

Independent review approved all 248 source bindings, authored-file/static identities, four reports, eleven screenshots, actual wire/worker/teardown assertions and bounded JSON redaction checks. Its [evidence index](../../deploy/swarm/evidence/2026-11-07/README.md) records the limits, including no screenshot OCR and three font MIME values reported as `false`; exact font bytes and executable MIME checks passed.

These observations qualify this exact Swarm frontend candidate and capture-time backend path. They do not make the temporary backend durable, prove all browser traffic anonymous, or satisfy missing Arkiv/batch/submission evidence.

## Tool validation

Pinned-toolchain `pnpm check` passed lint, types, **1,907 tests in 58 files**, and all builds after the final source correction. The focused preflight suite passed twelve tests, including an expired-batch regression that failed before the fix. Scoped ESLint passed with zero warnings. The independently reviewed CLI remains GET-only even though separately reviewed temporary operational commands staged the candidate.

Remaining bonus/release gates include exact batch/provider provenance, a demonstrated usable retention window and useful trusted Arkiv release discovery. Capture-time registry trust, worker execution and measured privacy behavior passed in the specific live workflow above; current health/freshness still require rechecking. `NULL_STAMP` is not the uploaded batch's real ID. Gateway source confirms its batch is selected internally; public metadata and chunk downloads do not expose a content-to-batch binding. Do not infer the ID from TTL or global chain batch lists. A provider-issued receipt or a known operator batch is needed for that bonus requirement.

The candidate is staged and static files are verified; the prior public Site and frozen backend remain unchanged. No bonus eligibility, final release, source-publication or permanence claim follows from these observations.

Source publication, external submission, postage spending and modifications to the current backend or held UI remain outside this preflight. Missing provider metadata must be reported rather than invented.
