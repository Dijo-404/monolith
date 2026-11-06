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

[Monolith Privacy Lab](https://monolith-privacy-lab.madhanxdev.chatgpt.site) is public on the same registered Sites project. The current intermediate dashboard is saved **version4**, deployed successfully at20:53:55UTC November6 (02:23:55IST November7). It uses Monolith source `5cf16137d60bd2d274a4eb3b2fe078765d0ecc70`, artifact-source commit `a9ebaff98e3b7ba96835e87d0a1c760bb0ccf1a0`, and the registered free observer `https://e964181cf62d29.lhr.life`. The exact version/deployment IDs and unchanged archive binding are in the [deployment receipt](../deploy/sites/evidence/2026-11-07/version4/deployment.json).

The [publication input audit](../deploy/sites/evidence/2026-11-07/version4/input-audit.json) verifies all39snapshot files: ten static assets and26notices, with nine compiled Vite files matching the live-UI build. The internally used private source archive is absent and a selected actual server-key byte scan found no exposure. The dashboard build passed1,494offline tests in47files plus lint, types and build. GitHub source visibility remains private.

The [actual HTTPS verification](../deploy/sites/evidence/2026-11-07/version4/static-verification.json) passed eleven requests at20:54:14UTC, matching every authored asset byte, executable MIME and distinct worker module. Sites canonicalizes `/index.html` to `/` and `/assets/worker-host.html` to `/assets/worker-host`; the explicit `--allow-canonical-html-redirects` policy permits only these exact one-step same-origin307 mappings. This matches [Cloudflare's documented HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/). Redirects remain rejected by default.

Actual hosting inserts a1,114-byte JavaScript Detection script before the closing body tag. The explicit `--allow-reviewed-sites-html-addition` policy preserves every authored byte and pins the complete normalized template to SHA256 `5c4f4c7822215cd0625b3ee9a67def801a05caa4891443116af3e81fa371c9b6`. Only its matched16hex ray ID and canonical numeric timestamp may vary. Full served-document hashes, authored hashes and additions are recorded separately; modified HTML is not claimed to equal authored HTML. Unknown additions fail. This hosting bootstrap, its fetched challenge runtime and hidden frame are non-anonymous and outside Monolith transport verification.

The genuine four-action HTTPS workflow passed against version4: four fresh runs,13wire rows, intentional leak2/4fails and freshrepair3/4passes, with zero ordinary fallback/pageerrors. Independent retained review verified all245inputs, four reports and six screenshots. The actual [deployed layout/fault result](../deploy/sites/evidence/2026-11-07/version4/browser-fault/browser-deployed.json) also passed1440/390/320widths, forced WebGL fallback and an injected worker-host outage: visible BLOCKED/WORKER_UNAVAILABLE, disabled export, zero external sends/pageerrors, ownediframecleanup and contextdestruction. Its five screenshot hashes were rechecked. Final presenter integration and release evidence remain open; successful static hosting does not establish worker execution, privacy acceptance or task completion. The separate browser checks strictly distinguish the owned disposable worker, the one recognized hosting frame and unknown frames. An injected worker-host network failure is explicitly labelled and grants no real-worker credit.

The registered backend remains dependent on this workstation and the SSH/provider connection. The owner confirmed registering the dedicated public key; billing and the paid custom domain remain unused. Its12-hour process cap does not guarantee uptime or a permanent hostname. Earlier anonymous-route failures and a BLOCKED later workflow are preserved; their precise provider cause remains unproven. The previous complete13-read workflow is historical evidence, not proof of current availability.

Use the Sites source workflow against the isolated artifact-only snapshot, preserve `.openai/hosting.json` and the existing public audience, and pass credentials only through hidden stdin. Save/deploy the returned exact source commit and unchanged archive. [MN-025](https://github.com/Dijo-404/monolith/issues/40) owns backend evidence; MN-014/MN-016/MN-017 retain normal live/demo/release acceptance.

## Publication identity check

`scripts/deploy/verify-static.mjs` compares every public distribution file and the root document with the retained snapshot's exact bytes, size and SHA-256. It checks executable content types, rejects a worker-host URL that resolves to the application shell, and requires the worker host's local module to be among the verified assets. The80deployment tests cover packaging, exact hosted-document policy and strict frame classification; they passed with pinned tools and independent review. Offline software checks remain distinct from the retained actual HTTPS observations.

After that byte check, execute the production live UI workflow against the published HTTPS origin. Only the deployed browser can establish whether the platform permits the nested worker, bootstrap, blob/WASM/WebRTC runtime and useful protected reads. Record actual failures rather than treating successful static delivery as runtime acceptance.
