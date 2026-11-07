# README UI screenshots — 7 November 2026

Source: committed PR [#112](https://github.com/Dijo-404/monolith/pull/112) head
`2e35b852ee347c6b4627944d41376c2b32b09e42` (presentation preview under review at capture time).
These images do not include subsequent uncommitted wallet or review changes.

- `dashboard-simulated.png`: initial `?mode=simulated` walkthrough. The visible SIMULATED labels apply to all results; no run action or wallet connection was used.
- `developer-docs.png`: initial `?page=docs` view. Reading this view mounts no lab controller.

These are software presentation captures, not live anonymity, registry availability,
payment settlement or sponsor-eligibility evidence.

## Capture

An isolated `git archive` snapshot contained no `.env`. Existing lockfile-installed
dependencies were linked into that snapshot; its shared, registry, privacy-analyzer
and transport package exports were rebuilt from the archived source with TypeScript.
The server ran with a minimal environment, no application environment variables,
and only the default local observer origin. No observer server was started.

Commands used (paths expressed as local variables):

```sh
git archive --format=tar 2e35b852ee347c6b4627944d41376c2b32b09e42 | tar -xf - -C "$snapshot"
# Link installed dependencies, then build these archived package exports in order:
for package in shared registry privacy-analyzer transport; do
  "$node24" "$snapshot/node_modules/typescript/bin/tsc" -p "$snapshot/packages/$package/tsconfig.json"
done
env -i PATH="$node24_bin:/usr/bin:/bin" HOME="$capture_home" \
  "$node24" "$snapshot/apps/dashboard/node_modules/vite/bin/vite.js" \
  --config "$snapshot/apps/dashboard/vite.config.ts" --host 127.0.0.1 --port 5189 --strictPort
# In another terminal:
"$node24" docs/images/readme-ui-20261107/capture.mjs "$playwright_module" \
  http://127.0.0.1:5189 docs/images/readme-ui-20261107
```

Node 24.22.2; Vite 8.3.6; Playwright 1.65.0; headless Chromium 158.0.8127.18.
Viewport: 1440 × 1050 CSS pixels at device scale 1, reduced motion,
`en-GB`, Asia/Kolkata. Captured 2026-11-07T02:32:21.555Z.
The capture script blocks and counts every non-loopback page request and WebSocket;
service workers are blocked. Result: **0 external attempts, 0 page errors, 0 console
errors**. Both screenshots were visually inspected. The temporary server was stopped
after capture. See [capture-result.json](capture-result.json) and [capture.mjs](capture.mjs).

## SHA-256

| File | SHA-256 |
| --- | --- |
| [dashboard-simulated.png](dashboard-simulated.png) | `acb78c39a25021c9561e0453ea0705dd5eb5b7ea30b9e28f7b595d01bea64beb` |
| [developer-docs.png](developer-docs.png) | `14560cd5f95e3932e96e583839cf9959f441a954daa8cdbd5aab28c6e2df62a5` |
