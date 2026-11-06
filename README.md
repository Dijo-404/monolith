# Monolith

The privacy crash-test lab for Web3 checkout: detect direct-RPC leaks, route supported reads through Anon-RPC, and show reproducible evidence.

**Current state:** MN-001 workspace scaffold. The React dashboard starts, the Fastify observer exposes a health route, and the four shared packages have buildable entry points. Privacy transport, observer RPC forwarding, registry import/query and checkout are not implemented yet. No live anonymity, Arkiv or payment evidence is claimed.

## Run locally

Use **Node 24.22.2** (pinned in [.node-version](.node-version)) and **pnpm 12.18.0**. Switch your Node version with your preferred version manager, then install the pinned package manager if needed:

```sh
npm install --global pnpm@12.18.0
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
pnpm dev
```

The dashboard runs at `http://127.0.0.1:5173`. The observer runs at `http://127.0.0.1:3001`; `GET /api/health` reports `status: "scaffold"`. It has no RPC forwarding, registry or payment routes. Neither process needs a wallet, signing key or live-network credentials.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run both apps with file watching |
| `pnpm dev:dashboard` / `pnpm dev:observer` | Run one app |
| `pnpm lint` | ESLint and architecture import rules |
| `pnpm typecheck` | Build package declarations, then check all workspace TypeScript |
| `pnpm test` | Offline environment, health, import-boundary and public-bundle tests |
| `pnpm build` | Build packages, observer and dashboard in dependency order |
| `pnpm check` | Run lint, typecheck, tests and production builds |
| `pnpm start:observer` | Start the compiled observer after `pnpm build` |
| `pnpm --filter @monolith/dashboard preview` | Preview the built dashboard locally |

CI runs the locked install and `pnpm check` for every PR and push to `main`. SDK/live-network preflights belong to later tasks and do not run in the foundation checks. Relayer and Solidity workspaces stay disabled.

## Environment boundaries

Copy [.env.example](.env.example) into a local ignored `.env`. Both apps read the root environment file. The browser bundle receives **only** the validated `MONOLITH_PUBLIC_OBSERVER_URL` origin; automatic `VITE_` and prefix-based exports are disabled. Unknown public-looking variables and server settings are excluded. Built-in Vite values such as `MODE`, `DEV` and `PROD` remain available.

`MONOLITH_OBSERVER_HOST` (localhost or an IP) and `MONOLITH_OBSERVER_PORT` (1–65535) are server-only settings. Do not put private keys under a public prefix or add signing keys to this scaffold. Set `NODE_ENV` on the server process when deploying, rather than putting it in the shared `.env` that Vite reads. Invalid configuration fails with sanitized messages.

## Start here

| Read | Purpose |
| --- | --- |
| [Project idea](docs/idea.md) | Product requirements, scope gates and evidence requirements |
| [Delivery plan](docs/plan.md) | Small tasks, four-person lanes, dependencies and merge order |
| [Architecture](docs/architecture.md) | Module boundaries, dependencies and trust model |
| [Integration contracts](docs/contracts.md) | Shared interfaces to agree before parallel implementation |
| [Team workflow](CONTRIBUTING.md) | Claim a task, use a branch, publish progress and hand off a PR |
| [Agent instructions](AGENTS.md) | Instructions teammates' coding agents should follow |
| [Task register](docs/task-register.md) | Published GitHub issue links; live status stays on GitHub |

Use the shared [Agents view](https://github.com/Dijo-404/monolith/issues/views/MDQ6VmlldzI4MjE3). The [filtered task queue](https://github.com/Dijo-404/monolith/issues?q=is%3Aissue%20is%3Aopen%20label%3Aagents) is available if the saved view's filters need adjustment.

Implemented foundation: TypeScript, pnpm, React/Vite, Fastify, ESLint and Vitest. SDKs for viem, the official Anon-RPC browser harness and Arkiv, plus Playwright and Foundry, are added by their owning tasks after feasibility checks. All direct dependency versions and the lockfile are pinned. TypeScript 6.0.3 stays within the lint tooling's [supported TypeScript range](https://typescript-eslint.io/users/dependency-versions/).

The product name follows the repository: **Monolith** (`monolith`, `@monolith/*`). Privacy protects supported RPC transport paths; RPC payloads and public payments remain visible to their respective observers.

New project code uses the [MIT license](LICENSE). No upstream chain dataset is copied by this task; the registry importer must retain the source dataset's license and provenance when it is implemented.
