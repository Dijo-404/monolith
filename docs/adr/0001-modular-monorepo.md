# ADR 0001: Modular TypeScript monorepo with explicit adapters

Status: proposed; implementation begins after the foundation task is reviewed.

Date: 6 November 2026 (Asia/Kolkata).

## Context

[The project idea](../idea.md) assumes four engineers and prioritizes real Anon-RPC privacy evidence, then an Arkiv registry, then conditional Whitechain payment. Browser worker, public dataset operator, controlled observer and payment relayer have different trust boundaries. Teammates need stable interfaces and small independent branches, while the project has no application code yet.

## Options

| Option | Benefit | Cost |
|---|---|---|
| One app with direct SDK calls in features | Fast first page | Routing bypasses, shared-file conflicts, server keys and browser dependencies become easy to mix |
| Modular monorepo with small ports and adapters | Shared DTOs, independent feature ownership, testable policy, explicit runtime boundaries | Workspace/import rules and interface reviews require initial work |
| Independently versioned microservices and event bus | Independent deployment and scaling | Distributed contracts, queues, operations and coordination exceed current needs |

## Decision

Use a pnpm TypeScript monorepo with `apps/dashboard`, `apps/observer`, conditional `apps/relayer`, and the four packages specified in [architecture.md](../architecture.md). Compose the read-only public registry API in the observer process; keep registry logic in its package. Use HTTP for process boundaries and ordinary function calls within a process. Add Foundry only if the chosen payment route requires contracts.

Separate policy/domain and application use cases from external SDK adapters. Introduce ports only at actual side-effect boundaries: read transport, clock/trace sink, registry source/entity client, controlled upstream and payment submission. Domain code imports inward-facing types only. Composition roots supply concrete adapters; do not add a dependency injection framework or generic persistence abstraction.

Freeze versioned DTOs and fixtures before implementation lanes diverge. Shared type changes name their consumers and update them in a coordinated PR. Publish package entry points and enforce import boundaries during foundation work. Follow the human-owned merge and branch workflow in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Consequences

- Transport policy, coverage and registry trust checks can run offline against deterministic adapters while owners prove live SDK integration independently.
- Browser-only Anon-RPC code and server-only keys stay outside pure modules and away from each other.
- The observer and registry share a process and therefore a failure domain; this is acceptable for the hackathon. Route separation and scoped capabilities prevent the observer read route from becoming a write/signing service.
- Maintaining public DTOs costs coordination. Small exports, generated schemas/fixtures, and explicit ownership keep that cost bounded.
- These boundaries do not establish anonymity, sponsor qualification, SDK availability or contract safety. Those require the live acceptance evidence described in the task plan.

## Revisit triggers

Split the registry API into a new deployable only if its load, availability or security isolation needs justify it. Add durable job/storage infrastructure only when importer/relayer concurrency or recovery requires it. Change the stack only with demonstrated incompatibility or a team-supported simpler option; record the replacement decision and affected tasks.
