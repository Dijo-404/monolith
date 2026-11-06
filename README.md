# Monolith

The privacy crash-test lab for Web3 checkout: detect direct-RPC leaks, route supported reads through Anon-RPC, and show reproducible evidence.

**Current state:** project planning only. No application, deployed contract, successful live anonymity test, Arkiv import, or payment settlement is represented as implemented.

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

Proposed stack: TypeScript, pnpm, React/Vite, Fastify, viem, official Anon-RPC browser harness, Arkiv SDK, Vitest and Playwright. Foundry and the merchant relayer activate only if the conditional Whitechain gate passes. The foundation task will pin versions and add runnable commands; they do not exist yet.

The product name follows the repository: **Monolith** (`monolith`, `@monolith/*`). Privacy protects supported RPC transport paths; RPC payloads and public payments remain visible to their respective observers.
