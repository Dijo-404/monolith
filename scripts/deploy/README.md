# Static source snapshot preparation

Run with Node **24.22.2** and pnpm **12.18.0**, using their installed absolute paths:

```sh
/absolute/node scripts/deploy/prepare-static.mjs \
  --commit <full-clean-HEAD-SHA> \
  --out /absolute/new-snapshot-directory \
  --pnpm /absolute/pnpm \
  --observer-url https://your-configured-observer-origin
```

`--node` defaults to the Node executable running the helper. `--repo` defaults to this
repository. An explicit public HTTPS observer origin is required; its availability
is not implied by syntax validation.

The helper captures a clean exact Monolith commit,
rejects unsafe tracked paths/symlinks/private environment files, and verifies every
extracted Git blob before building. It installs from the frozen lockfile and builds
in a fresh temporary directory with isolated package configuration and an explicit
public environment allowlist. No ambient keys, npm credentials or Node options are
forwarded. Installation lifecycle scripts and pnpmfile hooks are disabled.

Output is a new directory containing:

- `dist/index.html` and `dist/assets/`: the static web root.
- `dist/assets/THIRD-PARTY-NOTICES.txt`: the project and retained dependency/font licenses, available with the public static distribution.
- `LICENSE`, `README.md`, `notices/` when applicable, and `provenance.json`: source commit, internal Git archive/asset hashes,
  versions, public build configuration and scope limitations.

The private source archive exists only inside the temporary build directory and is
deleted afterward; private application source is not copied into the snapshot. License
notices from the dashboard's runtime dependency closure and tracked font/source notices
are retained individually outside the static web root and bundled into the served notice file. The repository was verified private during
MN-023; the helper records that observation without making a GitHub API request.

The helper never deploys. Runtime readiness, browser checks, the configured observer,
privacy evidence, and sponsor acceptance need their own verification before publishing.
It refuses existing output directories and removes its own partial output on failure.

Run the isolated security boundary tests without changing workspace manifests:

```sh
/absolute/pnpm exec vitest run tests/deploy/prepare-static.test.mjs
```
