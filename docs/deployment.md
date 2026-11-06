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

The selected Sites project identity is tracked in `.openai/hosting.json` and was registered once. A first public core build was published on 7 November at approximately01:04IST: [Monolith Privacy Lab](https://monolith-privacy-lab.madhanxdev.chatgpt.site). This is an intermediate deployment for actual HTTPS verification, not final core-release acceptance. Generate each later snapshot from its exact tested source with the current HTTPS backend; never publish the packaging smoke above as the final product. The packager emits a hash-bound, served `assets/THIRD-PARTY-NOTICES.txt`, so the published distribution carries the project, dependency and font licenses.

Use the Sites source workflow against that isolated artifact-only snapshot, persist the same Site identity, and pass credentials only through its hidden stdin. Save/deploy the returned exact source commit and unchanged archive. Record the actual saved version, deployment result, public URL, browser check and backend lifetime here when publication runs.

The first publication is saved version3, opaque ID `appgprj_6aedf7106c2081919627f07802438881~appgver_1a8998b96eb88191b13b4661d0792cbe`, artifact-source commit `4bbbfbd59a39c39c0cd125c059f1af71e727304f`, from Monolith application source `d0eb4baa89b6d5d0421abfdbc346b5cd165cb2bd`. Native deployment `appgdep_6aee2ba3c5dc81918f88a3674b25d020` returned `succeeded` at19:34:14UTC November6. All nine Vite files match the source-bound rebuilt distribution; the snapshot retains ten static files and26notices. A selected actual server-key byte scan found no exposure in any of its39regular files. Private source/archive and credentials are absent. Source GitHub visibility remains unchanged.

That build targets the then-working free backend `https://12f93bbae336b6.lhr.life`. A later check returned public502 while local API/edge health remained200; the exact cause is unproven. The previous complete genuine workflow remains historical evidence, and a later attempt correctly blocked after private/comparison succeeded. Do not infer current backend liveness or final release acceptance from the successful static deployment. The owner confirmed free SSH-key registration; paid-domain billing remains inactive.

Actual Sites requests return same-origin307 HTML canonicalizations: `/index.html` to `/`, and `/assets/worker-host.html` to `/assets/worker-host`. This matches [Cloudflare's documented HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/). The verifier's explicit `--allow-canonical-html-redirects` policy supports only those exact one-step307 mappings, records them and rechecks final bytes/MIME/module identity. Its default still rejects every redirect; application privacy routing is unchanged. Browser execution and final release verification remain outstanding at this checkpoint.

An additional actual hosting observation found a1,114-byte Cloudflare JavaScript Detection insertion before the closing body tag in both authored HTML documents. The explicit `--allow-reviewed-sites-html-addition` policy verifies the unchanged authored bytes and the entire reviewed normalized template, allowing only its matched ray ID and canonical numeric timestamp to vary. The template SHA-256 is `5c4f4c7822215cd0625b3ee9a67def801a05caa4891443116af3e81fa371c9b6`. It records full observed-document hashes and authored hashes separately. It does not generically remove tags or describe modified HTML as byte-identical to the authored file.

The actual version3 check passed eleven HTTPS GETs: every static file plus the root document, exact authored hashes, both canonical redirects, separately recorded hosting additions, correct executable MIME and distinct worker module. The46 focused deployment cases and scoped ESLint also passed. The retained result is `/tmp/monolith-static-verification-20261107-attempt4.json`. A real Chromium rendering diagnostic separately passed1440/390/320 widths with zero page errors or application network attempts, and observed the expected hidden hosting challenge frame. These results do not establish protected worker execution or current backend availability. The hosting security script, its fetched challenge runtime and hidden frame are non-anonymous bootstrap outside Monolith transport verification; unknown frames and ordinary target requests remain separate browser-test failures.

[MN-025 / issue #40](https://github.com/Dijo-404/monolith/issues/40) owns the reusable public observer deployment after the source-proof and fresh-run API gates pass. The final browser UI and release acceptance remain with MN-014/MN-017. A successfully hosted static snapshot does not close those tasks.

## Publication identity check

`scripts/deploy/verify-static.mjs` compares every public distribution file and the root document with the retained snapshot's exact bytes, size and SHA-256. It checks executable content types, rejects a worker-host URL that resolves to the application shell, and requires the worker host's local module to be among the verified assets. Its seven boundary tests and the eight packager tests passed with pinned tools; these are software checks until the command is run against an actual publication.

After that byte check, execute the production live UI workflow against the published HTTPS origin. Only the deployed browser can establish whether the platform permits the nested worker, bootstrap, blob/WASM/WebRTC runtime and useful protected reads. Record actual failures rather than treating successful static delivery as runtime acceptance.
