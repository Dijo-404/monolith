# MN006 UI acceptance

This is **SIMULATED** software/UI evidence. The production-built shell uses local scenarios, authored timings and synthetic registry metadata. It makes no application API or external network request and establishes no live anonymity, Arkiv or payment result.

The existing owner's saved light design was preserved and integrated with accepted main. The takeover fixes two reproduced misleading claims: receipt payloads now show transaction-hash exposure, and the outage result distinguishes the blocked managed read from a bypassing widget that still sends directly. A 320px Activity-header overflow was also fixed.

Use Node 24.22.2 and pnpm 12.18.0 from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @monolith/dashboard preview --port 5194
```

Run the browser check in another shell with an isolated Playwright 1.65.0 installation, kept outside this workspace:

```sh
MONOLITH_BROWSER_TOOLS=/absolute/path/to/playwright-tools \
  node apps/dashboard/docs/review/browser-check.mjs
```

`MONOLITH_UI_PREVIEW_URL` can change the preview origin. `MONOLITH_UI_REVIEW_OUTPUT` can point to a separate output directory to preserve this recorded run.

The [browser result](browser-result.json) records the actual run timestamp, script pass state, production JS/CSS hashes and interception results. It covers the four-step walkthrough, the active-bypass outage regression, transaction-hash copy, private default, disabled payment, no horizontal overflow at 1440/390/320px, reduced motion and a functioning WebGL2-unavailable fallback. Every context records zero page errors, external requests and application API requests.

Screenshots:

- [Desktop initial](desktop-initial.png)
- [Injected receipt bypass](desktop-leak.png)
- [Blocked managed read](desktop-outage.png)
- [Active bypass during outage](desktop-bypass-during-outage.png)
- [Mobile 390px](mobile-initial.png)
- [Narrow 320px](narrow-initial.png)
- [WebGL fallback](fallback-initial.png)

The entire pinned `pnpm check` passed 1,165 tests in 30 files plus lint, types and builds after integrating main. Those deterministic tests and this fixture walkthrough do not satisfy MN009's independent source proof, MN012's application bypass interception, MN014's live UI or MN017's final release acceptance. No root manifest/lockfile, shared DTO, package internal or production transport/registry composition was changed by MN006.
