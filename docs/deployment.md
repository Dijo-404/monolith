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

The selected Sites project identity is tracked in `.openai/hosting.json`. It has been registered once and remains unpublished at this preparation stage. Generate a new snapshot from the final tested source with the actual current HTTPS backend; never publish the smoke artifact above as the final product. The final packager also emits a hash-bound, served `assets/THIRD-PARTY-NOTICES.txt`, so the published distribution carries the project, dependency and font licenses.

Use the Sites source workflow against that isolated artifact-only snapshot, persist the same Site identity, and pass credentials only through its hidden stdin. Save/deploy the returned exact source commit and unchanged archive. Record the actual saved version, deployment result, public URL, browser check and backend lifetime here when publication runs.

[MN-025 / issue #40](https://github.com/Dijo-404/monolith/issues/40) owns the reusable public observer deployment after the source-proof and fresh-run API gates pass. The final browser UI and release acceptance remain with MN-014/MN-017. A successfully hosted static snapshot does not close those tasks.

## Publication identity check

`scripts/deploy/verify-static.mjs` compares every public distribution file with the retained snapshot's exact bytes, size and SHA-256. It also rejects a worker-host URL that resolves to the application shell, and requires the worker host's local module to be among the verified assets. Its four boundary tests and the eight packager tests passed with pinned tools; these are software checks until the command is run against an actual publication.

After that byte check, execute the production live UI workflow against the published HTTPS origin. Only the deployed browser can establish whether the platform permits the nested worker, bootstrap, blob/WASM/WebRTC runtime and useful protected reads. Record actual failures rather than treating successful static delivery as runtime acceptance.
