# Working on Monolith

Read [docs/idea.md](docs/idea.md), [docs/plan.md](docs/plan.md), [docs/architecture.md](docs/architecture.md), [docs/contracts.md](docs/contracts.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before implementing a task. These are planning specifications until code proves otherwise.

## Coordinate through GitHub

- Live shared task state is the GitHub issue, visible in the [Agents view](https://github.com/Dijo-404/monolith/issues/views/MDQ6VmlldzI4MjE3). Local agent memory is a personal working aid; it never replaces GitHub updates.
- Find a `status:ready` issue. Check its dependencies are merged and its evidence gate has passed. Unassigned is not the same as ready.
- Narrow exception: MN-003 and MN-005 permit bounded isolated preflight experiments before foundation merges. Claim experiment ownership on the issue, keep the formal task in `status:backlog`, and use only its spike/report paths plus a temporary isolated environment. Do not edit shared manifests/lockfiles or mark integrated acceptance ready; rebase and pass the normal dependencies before formal review.
- Read the latest issue body, assignees, comments and linked PRs before claiming. Follow the claim procedure in CONTRIBUTING.md; a command sequence is not an atomic lock. If another claim appears, coordinate before editing.
- One human owner and one active agent per issue; record the agent/session name in the claim. Use the task's branch or a separate worktree. Never switch a teammate's shared working directory while they are working.
- Maintain exactly one `status:*` label. Update GitHub when starting, blocked, handing off, or ready for review, and at least once per working hour. Record next action, branch, commit/PR and test evidence.
- Work only in the task's listed paths. Coordinate interface or ownership changes on the affected issues before editing. One task owns root manifests/lockfile at a time; ask that owner to add dependencies.
- Do not regenerate issues from `docs/tasks.json`; the register already links published tasks. JSON records scope and dependencies, not changing assignment/status.
- Use a feature branch and a PR targeting `main`. The repository owner merges to `main`; agents must not push to `main`, merge PRs, or enable auto-merge. The empty-repo bootstrap belongs to the owner.

## Architecture and implementation rules

- Use Monolith / `monolith` / `@monolith/*` for project names and `MonolithTransport` for the transport facade.
- Domain and application code depend on small ports and shared contracts. Keep React, Fastify, viem, Arkiv and browser-worker SDKs in adapters/composition roots. Import only public package exports; no deep imports into another package's internals.
- Use domain/application/adapter folders where they separate real business rules from external systems. Avoid empty architectural layers and speculative abstractions.
- Browser RPC reads and endpoint chain-ID probes under required privacy go through a real verified worker or fail closed. No direct fallback on timeout, retry or SDK convenience paths. Disclose non-anonymous worker bootstrap separately.
- Keep the observer read-only with configured upstreams. Never accept arbitrary proxy URLs or treat client-supplied forwarding/route headers as evidence of origin or anonymity.
- Registry records require trusted publisher, provenance, expiry, safe URL and chain-ID validation. Arkiv schema tags alone do not establish trust.
- Publish no private keys, raw IP logs, private wallet/order data or fabricated evidence. Label mocks, recorded evidence, live observations and untested states accurately.
- Whitechain work is conditional. Do not claim sponsor eligibility or settlement from configuration, mocks or a prefunded vault without the required evidence/eligibility confirmation.

## Verification and handoff

- Implement the acceptance criteria and run relevant checks. Use the commands added by the foundation task and document exact commands/results; before that, do not claim nonexistent scripts passed.
- Add meaningful tests for routing, trust, payment, and cross-module boundaries. Validate documentation changes with links/schema/whitespace checks; avoid tests that merely repeat implementation.
- A PR contains the linked task, behavior changed, changed boundaries, validation results, evidence and remaining limits. Use `Refs #N` so human acceptance controls task closure.
- Review state means ready for the owner, not done. Close a task only after its PR is merged and evidence criteria are accepted. Update downstream readiness after merge; gates require observed evidence, not just merged spike code.
