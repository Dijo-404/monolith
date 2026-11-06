# Deploying Monolith

Deployment preparation is tracked in [MN-023 / issue #36](https://github.com/Dijo-404/monolith/issues/36). The owner selected no-cost hosting for the overnight release.

The dashboard is a static Vite build. The read-only observer and Arkiv registry API are a separate process. `MONOLITH_PUBLIC_OBSERVER_URL` is the only browser configuration value currently exposed by the Vite configuration. It is public and must contain an HTTP(S) origin without credentials, a path, query or fragment. A public deployment needs a reachable HTTPS backend; the local development default is not a deployed backend.

Build artifacts must be generated from an exact clean Git commit with the repository's pinned Node and pnpm versions. Do not upload `.env`, keys, local cloud credentials, dependency trees or private working files. Source provenance and content hashes describe what was built; they do not establish that privacy or chain reads succeeded.

The GitHub repository was verified **private** during deployment preparation. Publishing the compiled static application is authorized; making the source repository public is a separate owner decision. The Sites source snapshot contains compiled assets, license notices and provenance only. The exact source archive used internally to build is not uploaded with that snapshot. Hackathon source-publication requirements remain outstanding until the owner deliberately authorizes and performs that disclosure.

The connected Sites service hosts the static-dashboard release workflow. MN-009's historical paired-source observation was accepted in PR #41. The reusable production observer and live UI retain their own final-stack gates. A free tunnel depends on the workstation staying online and may change its hostname; its public endpoint must not be described as permanent infrastructure.

## Verified preparation

The deployment helper is documented in [scripts/deploy/README.md](../scripts/deploy/README.md). At source `d8c326ef1438b0d05f30629e437aa227469b5004`, this exact command completed a fresh Git archive, frozen dependency installation and Vite build:

```sh
/home/dj/.local/share/monolith-pr-watcher/toolchain/node-v24.22.2-linux-x64/bin/node scripts/deploy/prepare-static.mjs \
  --commit d8c326ef1438b0d05f30629e437aa227469b5004 \
  --out /tmp/monolith-mn023-packaging-smoke2-20261106 \
  --pnpm /home/dj/.local/share/monolith-pr-watcher/toolchain/pnpm-12.18.0-linux-x64/pnpm \
  --observer-url https://6101bf2f6b5186.lhr.life
```

This was a **packaging smoke check only**. The observer origin was a recorded, already-stopped preflight endpoint; no backend availability or public product deployment is claimed for that artifact. The actual output contains six static files and 26 retained notices, including all three bundled font licenses. Independent file size/SHA-256 checks matched every asset and notice; the private Git source archive is absent. The helper's eight security-boundary tests and scoped ESLint passed after the final pnpm-path and font-notice fixes.

With the accepted UI merged, the preceding combined `pnpm check` passed 1,173 tests in 31 files, lint, type checks and builds. It used Node 24.22.2 and pnpm 12.18.0 with both executable directories on `PATH`. The last font-notice-only adjustment then passed the focused tests and the actual fresh packaging smoke above. These are preparation checks, not core release or live privacy acceptance.

## Publication state

[Monolith Privacy Lab](https://monolith-privacy-lab.madhanxdev.chatgpt.site) is public on the original Sites project. The current measured presenter build is saved **version6**, deployed successfully at21:44:29UTC November6 (03:14:29IST November7). It uses Monolith application source `dfb08028da0fac156b9940dd117d892642717355`, artifact-source commit `4d6c2b4e223d63e106e49ecb8167763f7f1fffb1`, and real observer `https://d06045ae660681.lhr.life`. See the [native deployment receipt](../deploy/sites/evidence/2026-11-07/version6/deployment.json).

The [input audit](../deploy/sites/evidence/2026-11-07/version6/input-audit.json) verifies39snapshot files: ten static assets,26notices and nine compiled Vite files matching the final UI build. The private Git source archive is absent, and selected actual server-key bytes are absent from every snapshot file. SourceDFB passed1,550tests/50files plus lint/types/build and all exact-head CI. Changing only the public backend origin then produced a fresh explicit-public-only Vite build; seven assets stayed identical, the app changed only that origin string and the index changed its app filename. The independent archive rebuild matched every UI byte. GitHub source remains private.

The [actual HTTPS verification](../deploy/sites/evidence/2026-11-07/version6/static-verification.json) passed eleven requests, all authored sizes/hashes, executable MIME and a distinct worker-host module. The [local archive audit](../deploy/sites/evidence/2026-11-07/version6/archive-local-audit.json) separately verifies its ten authored files and records local compressed/decompressed hashes. The API storage object was not retrieved; its returned metadata does not establish service-container byte identity. The native source/archive association and actual served-file comparison are recorded separately.

Sites canonicalizes `/index.html` to `/` and `/assets/worker-host.html` to `/assets/worker-host`. The explicit `--allow-canonical-html-redirects` policy permits only those exact one-step same-origin307 mappings, matching [Cloudflare's HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/). Redirects remain rejected by default. A separately enabled policy preserves every authored HTML byte and pins the complete1,114-byte normalized hosting addition to SHA256 `5c4f4c7822215cd0625b3ee9a67def801a05caa4891443116af3e81fa371c9b6`; only its matched ray ID and canonical numeric timestamp vary. Full served-document and authored hashes remain distinct; unknown additions fail.

The actual mounted-presenter workflow passed at21:47:01UTC: four fresh server runs and13unique wire rows. The leaky fixture fails at2/4protected; the independently recomputed repaired fixture passes privacy and function at3/4, preserving the original failing report and useful reads. Private-only remains uncredited0/2; explicit direct controls remain in the denominator. The [root independent retained audit](../deploy/sites/evidence/2026-11-07/version6/presenter-independent-audit.json) verifies246inputs, four original reports and six screenshots, source classes, worker entry/bundle integrity, forged-header control, same-seedroute-onlypatch, actual presenter CTA/outcome/report IDs, six strict frame checks,390/320layouts and cleanup, with zero ordinary fallbacks/pageerrors. Original capture hash is `d8685e097e487b50148e513777c4288aa9681a6fc8d3c1e1a68cca5ecb5f9ef2`; immutable [MN016 evidence](https://github.com/Dijo-404/monolith/tree/9255183bc6533460498d11f4bf1aae42f9c371fc/tests/e2e/break-fix/observed-live/2026-11-07/attempt-8) records execution sourceDFB separately from storage commit9255183.

The exact version6 [browser fault/layout result](../deploy/sites/evidence/2026-11-07/version6/browser-fault/browser-deployed.json) passed1440/390/320widths, forced WebGL fallback and injected worker-host unavailability: visible BLOCKED/WORKER_UNAVAILABLE, disabled export, zero external sends/pageerrors, removed owned iframe and destroyed context. All five screenshots were rehashed. This injection explicitly permits no real worker and grants no privacy-read credit; normal execution is established by the separate genuine workflow above.

Hosting security bootstrap, its fetched challenge runtime and its positively identified hidden frame remain non-anonymous and outside transport verification. Unknown/duplicate/unreadable frames fail. The worker's two ordinary specifier lookups and public API metadata contacts are disclosed separately. Observed distinct egress through the verified worker does not establish universal anonymity; provider, host and bootstrap assumptions remain explicit.

Real backend runtime10 uses reviewed source469 with161frozen public inputs and the configured server-side access key. It passed actual trusted Arkiv lookup, fresh run allocation/empty diagnostics and the final real-worker capture. Earlier runtime9 returned502 publicly despite local health; its final shutdown counters were unavailable. A separate health-only SIMULATED control stayed reachable for200seconds with three PROXY envelopes and no LOCAL commands. That observation does not prove a failure cause or relax production source policy. The control was stopped before real runtime10 reused its hostname; source469 was unchanged. Old failures, controls and historical version4/5 observations remain named and unchanged.

The free observer requires this workstation and its SSH/provider connection. Key registration is confirmed; billing and the paid custom domain remain unused. Its12-hour process cap does not guarantee uptime or a permanent hostname. A separate five-hour passive monitor checks only real configured HTTPS health once per minute through approximately08:21IST, with TLS verification, no redirects, no RPC/Arkiv/credential access and coarse0600status. It does not recover outages or guarantee future availability.

MN014 and MN025 have accepted evidence. MN016's final proof is handed off for normal owner acceptance; MN017's bundle/clean-clone and participant submission checks remain separate. The newer visual revision has its own active owner and is not described as executed by this DFB capture. Use the Sites workflow against the isolated artifact-only snapshot, preserve project identity/public audience and pass credentials only through hidden stdin. Never relabel an old capture as a newer build.

## Publication identity check

`scripts/deploy/verify-static.mjs` compares every public distribution file and the root document with the retained snapshot's exact bytes, size and SHA-256. It checks executable content types, rejects a worker-host URL that resolves to the application shell, and requires the worker host's local module to be among the verified assets. The80deployment tests cover packaging, exact hosted-document policy and strict frame classification; they passed with pinned tools and independent review. Offline software checks remain distinct from the retained actual HTTPS observations.

After that byte check, execute the production live UI workflow against the published HTTPS origin. Only the deployed browser can establish whether the platform permits the nested worker, bootstrap, blob/WASM/WebRTC runtime and useful protected reads. Record actual failures rather than treating successful static delivery as runtime acceptance.
