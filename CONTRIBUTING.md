# Team and agent workflow

## Shared tracking

The [Agents view](https://github.com/Dijo-404/monolith/issues/views/MDQ6VmlldzI4MjE3) is the team's entry point. Every planned task has the `agents` label and a link in [docs/task-register.md](docs/task-register.md). GitHub issues own live status, assignment, blockers, PR links and evidence. [docs/tasks.json](docs/tasks.json) owns the versioned work breakdown; change scope there and in the issue together through a PR.

The saved view's current filter could not be read or edited through the available GitHub APIs. If tasks are missing, save this filter in that view:

```text
repo:Dijo-404/monolith is:issue is:open label:agents
```

Use [the equivalent filtered queue](https://github.com/Dijo-404/monolith/issues?q=is%3Aissue%20is%3Aopen%20label%3Aagents) immediately. GitHub documents label and assignee filters in its [issue search guide](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests).

Useful extra filters: `label:status:ready no:assignee`, `assignee:@me`, `label:lane:a`, `label:status:blocked`, and `label:conditional:whitechain`. Lane letters describe responsibility, not actual assigned people.

## Status and ownership

Exactly one status label belongs on each task:

| Label | Meaning |
| --- | --- |
| `status:backlog` | Planned; dependencies or evidence gates remain |
| `status:ready` | Dependencies merged, gate passed, available to claim |
| `status:in-progress` | One owner and their agent are working on its branch |
| `status:blocked` | Active work stopped; blocker and next action recorded |
| `status:review` | PR and evidence ready for the repository owner's review |
| `status:done` | Merged and acceptance/evidence criteria accepted; issue closed |

Claim one task at a time. Keep roughly one active task per engineer. A blocked task may be handed off explicitly or retained while the engineer takes a non-conflicting task; document this on both issues. `priority:*`, `phase:*`, `lane:*` and `conditional:whitechain` describe planning, never readiness by themselves.

## Claim and start

MN-003 and MN-005 have a narrow early-experiment exception: their owners may claim a bounded isolated preflight while the formal issue remains `status:backlog`. Say **experiment only** in the claim, use the listed spike/report paths and an isolated temporary environment, and branch from `origin/docs/monolith-team-plan`. Leave shared manifests/lockfiles alone. Do not run the ready-to-in-progress transition below for that experiment; normal integration, review and acceptance still require MN-002 merged and the task's evidence. All other tasks follow normal readiness.

Set the issue number for the task you selected; `123` below is only an example. Authenticate `gh` with your own GitHub account.

```sh
task_issue=123
gh issue view "$task_issue" --repo Dijo-404/monolith --comments
gh issue edit "$task_issue" --repo Dijo-404/monolith --add-assignee @me
gh issue view "$task_issue" --repo Dijo-404/monolith --json assignees,labels
```

Recheck after assignment. GitHub assignment is not an atomic claim; if another person is already assigned or posted a claim, resolve ownership before coding. Only the agreed owner proceeds. Post a claim using a body file (replace its placeholders first):

```md
Claim: <GitHub username>, agent <name/session>, <UTC timestamp>
Branch: <task branch from docs/task-register.md>
Paths: <task ownership>
Dependencies/gates checked: <merged PRs and observed evidence links>
Next: <first acceptance criterion>
Next update: <time within one working hour>
```

```sh
gh issue comment "$task_issue" --repo Dijo-404/monolith --body-file /tmp/monolith-claim.md
gh issue edit "$task_issue" --repo Dijo-404/monolith --remove-label status:ready --add-label status:in-progress
git fetch origin
git switch -c feat/mn-NNN-short-name origin/main
```

Use the actual branch listed on the task, replacing `feat/mn-NNN-short-name`. For multiple local agents, keep independent worktrees:

```sh
git worktree add ../monolith-mn-NNN -b feat/mn-NNN-short-name origin/main
```

If another working tree already owns a branch, choose a separate checkout/branch and record it. Do not run both branch-creation examples for the same task.

## Parallel changes and handoffs

- MN-001 serializes root tooling, lockfile and CI setup. MN-002 freezes shared contracts before adapter integration. After their merges, the task graph exposes parallel lanes.
- Task paths describe ownership. For shared manifests, fixtures, APIs or composition files, agree on a single editor on the affected issues before starting. Ask the foundation owner for dependencies instead of editing the lockfile on every branch.
- Shared interface changes include an updated contract document and notes on dependent tasks. Consumers use fakes while providers are incomplete; fakes never satisfy live-evidence gates.
- Keep branches small. Before opening a PR, fetch and integrate `origin/main` (merge is fine); rerun relevant checks after resolving conflicts. Never force-push a teammate's branch.
- To unblock dependents, the task owner checks their prerequisites and evidence, then replaces `status:backlog` with `status:ready`. No automatic readiness engine is installed by this plan.
- If a gate fails, record diagnostics, keep dependent issues in backlog or blocked, and follow the plan's fallback. Do not mark a task ready because its issue number is next in sequence.

Use this progress or handoff format in an issue comment, including when an agent stops:

```md
Status: in-progress | blocked | review
Owner/agent: ...
Branch + last pushed commit/PR: ...
Completed: ...
Validation/evidence: <exact commands, outcomes, redacted artifact links>
Blocker/dependency: <issue link or none>
Next action + next update: ...
```

Keep handoff text outside the repository when temporary; GitHub comments are shared across teammates' machines. Updating a local todo file alone does not hand off work.

## Review and merge

Push your feature branch and open a PR against `main`; include `Refs #<issue>` and complete the PR template. Replace `status:in-progress` with `status:review` on its issue. The repository owner reviews and merges; neither agents nor teammates enable auto-merge unless the owner later changes this policy.

After merge, verify acceptance criteria and live evidence. Replace `status:review` with `status:done`, close the issue, and review downstream readiness. A merged preflight that reports a failed live integration remains a failed gate. The core release can complete with Whitechain cut; record that decision and close optional issues as not planned, rather than completed implementations.

## One-time empty-repository bootstrap — repository owner

The owner authorized adopting the planning baseline on 6 November 2026. `main` now exists at that baseline and is the default branch. New task branches and PRs target `main`; the steps below are historical bootstrap instructions for a fresh empty remote, not a setup step teammates need to repeat.

At planning time, the remote had no commits and no `main`. The planning work was published on `docs/monolith-team-plan`. To establish `main` from that accepted baseline in an empty remote:

```sh
git fetch origin
git switch -c main origin/docs/monolith-team-plan
git push -u origin main
gh repo edit Dijo-404/monolith --default-branch main
```

These commands are for the owner on a checkout without a local `main`. If you already have a local unborn `main`, switch to the published planning branch first; confirm the actual local/remote state before adapting commands. The planning agent does not push or merge `main`. GitHub may initially select the first pushed planning branch as its default; the final command corrects that after owner adoption.

Teammates should branch from `origin/main` after bootstrap. If work must start earlier, branch from the published planning branch, record that base on the issue, then retarget/rebase onto `main` after bootstrap. Keep the planning branch unchanged once others use it.

Configure branch protection/rulesets for `main` after bootstrap if available: PR required, no force pushes, owner review and required checks once MN-001 introduces them. This plan does not claim repository rules have been installed. Choose the project's open-source license deliberately in MN-001; upstream dataset license obligations remain separate.
