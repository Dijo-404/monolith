# AI assistance, reused work and prompt inventory

**Disclosure status: incomplete; owner verification required before submission.** This records known assistance and available artifacts, not a claim of complete per-line authorship. The [official Mumbai guide](https://ethglobal.com/events/mumbai/info/details) requires specific AI attribution, meaningful human involvement and the specs/prompts/planning artifacts for spec-driven workflows.

## Known assistance

AI coding assistants, including OpenAI Codex in this audit, contributed project research/planning, implementation, tests, documentation, troubleshooting and review. Multiple agent sessions are identified in the linked GitHub task histories. Do not infer all tools/models used, or human authorship, from Git author names.

The following identifies concrete assisted areas and representative files. It does not assert that every line in a directory was generated, or that these examples exhaust the repository.

| Area | Assisted files / retained review context |
| --- | --- |
| Planning and architecture | [idea](idea.md), [plan](plan.md), [architecture](architecture.md), [contracts](contracts.md), [tasks](tasks.json), [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Transport, worker integration and routing tests | [transport application](../packages/transport/src/application/transport.ts), [browser host adapter](../packages/transport/src/adapters/browser/host.ts), [transport tests](../packages/transport/test), [task #7](https://github.com/Dijo-404/monolith/issues/7) |
| Registry import, trust and reads | [importer](../scripts/import-evm-registry.ts), [Arkiv reader](../packages/registry/src/adapters/arkiv/reader.ts), [schema](../packages/registry/src/adapters/arkiv/schema.ts), [registry tests](../packages/registry/test), [task #15](https://github.com/Dijo-404/monolith/issues/15) |
| Observer, analysis and shared contracts | [observer](../apps/observer/src), [analyzer](../packages/privacy-analyzer/src), [shared package](../packages/shared/src), [task #4](https://github.com/Dijo-404/monolith/issues/4), [task #11](https://github.com/Dijo-404/monolith/issues/11) |
| Dashboard and browser checks | [live controller](../apps/dashboard/src/features/lab/live-controller.ts), [dashboard](../apps/dashboard/src), [privacy checks](../tests/privacy/egress), [task #14](https://github.com/Dijo-404/monolith/issues/14) |
| CLI and deployment tooling | [CLI](../packages/cli/src), [deployment scripts](../scripts/deploy), [task #50](https://github.com/Dijo-404/monolith/issues/50), [task #36](https://github.com/Dijo-404/monolith/issues/36) |
| This compliance audit | [README](../README.md), [prize audit](prize-compliance.md), this file, [Arkiv usage](../arkiv/how-you-use-arkiv.md), [task #83](https://github.com/Dijo-404/monolith/issues/83) |

AI-assisted preparation or interpretation does not establish a live result. Actual run artifacts retain their timestamps and evidence kinds; mocks/fixtures remain `SIMULATED`. Human narration and an actual product demonstration are still needed for the submission video.

## Reused software, data and assets

Monolith integrates the upstream Anon-RPC harness/workers and Arkiv SDK rather than inventing those systems. [Dependency versions](../pnpm-lock.yaml), [project MIT license](../LICENSE), the [retained chain-data MIT notice](../packages/registry/src/adapters/source/LICENSE.ethereum-lists-chains), and [bundled font notices](../apps/dashboard/src/styles/fonts) record reused materials. Source data comes from the immutable revision linked in [data quality](../arkiv/data-quality.md). Dashboard screenshots show the labeled simulated interface where stated; they are not live-privacy proof.

Full provenance of any other generated images, designs, screenshots or external assets must be verified by the owner. This audit did not generate images, audio or video, and does not attribute unknown assets to a particular model or person.

## Available specifications and prompts

The repository retains [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [idea](idea.md), [plan](plan.md), [architecture](architecture.md), [contracts](contracts.md), [task definitions](tasks.json), [task register](task-register.md), [dashboard product plan](../apps/dashboard/PRODUCT.md) and [design plan](../apps/dashboard/DESIGN.md). Their Git history and linked issues/PRs provide planning context. They are not a substitute for missing original prompts.

The following are the exact task inputs available to this audit, recorded on 7 November 2026 IST. They are a **partial prompt record**, not the project's complete historical prompt archive.

User request:

```text
[https://ethglobal.com/events/mumbai/prizes/](https://ethglobal.com/events/mumbai/prizes/)

make sure the repo follows all the rules and standards and requirements and rules and conitions for all the tracks this project is eligible for
```

Registration clarification:

```text
Question: Which ETHGlobal track is your team registered in? This determines whether the new-project or Continuity prizes apply.
Answer: Classic / new project
```

This audit also followed the repository instructions in [AGENTS.md](../AGENTS.md). No complete archive of earlier implementation prompts or every internal agent delegation has been assembled here. Do not export raw conversations: they may contain keys, private account details or unrelated private information. Retain the relevant actual project prompts/planning artifacts after removing secrets; identify any material redaction or unavailable history honestly.

## Owner completion still required

| Item | Status |
| --- | --- |
| All AI tools used, specific assisted files/assets and any corrections to the scope above | Partial; owner confirmation pending |
| Meaningful human contributions, attributed to actual participants with concrete design/implementation/test decisions | Details not supplied in this audit; no human contribution is invented |
| Complete relevant historical prompt/spec/planning inventory | Existing specs linked; historical prompts incomplete |
| Classic timing and prior work | Owner selected Classic; absence of pre-event project-specific work still needs confirmation |
| Team membership, accepted/staked registration and participant submission | Outside repository verification |

Complete these with verifiable facts before representing the AI/human disclosure requirement as satisfied. Attribution alone cannot establish meaningful human participation or organizer approval.
