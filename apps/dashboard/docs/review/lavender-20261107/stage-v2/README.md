# Revised stage: browser verification

> **Historical — rejected dark-stage presentation.** The owner subsequently rejected the complete dark 3D card, including this sculptural revision. The scoped reviewer verdict and software results below remain records of this named build, not current visual approval. The replacement removes 3D and uses a light DOM/SVG request explorer; its [separate review](../request-explorer/README.md) is being prepared. Preserve the existing captures and JSON; none establishes validation or live privacy for the replacement.

The assembled candidate, including accepted-main integration, passed **13 stage interaction checks**, the unchanged **26 user journeys**, and targeted navigation, fallback and overlay checks. All four current results bind the same 54 dashboard source files and nine production build files before and after capture: `app-Dw5fWw7-.js` and `app-DBCLKKsN.css`. This is software verification for owner review; it does not accept a live anonymity or release gate.

The owner rejected the original orb/diamonds/slab screenshot. The [replacement scene](scene-design.md) adds recognizable dimensional forms, layered materials, pointer depth and elapsed-time transitions. The unchanged public scene/flight contract and existing run controllers still supply the state. Accepted main `cf13a9d` was integrated at merge `1370a99` before the final build. Pinned Node 24.22.2/pnpm 12.18.0 `pnpm check` passed lint, types, all builds and **1,862 tests in 54 files**; all new capture scripts pass focused ESLint and parse checks.

The fresh independent full review found three responsive issues: narrow fallback clipping, tablet status/control overlap and a compact bootstrap-label collision. One bounded fix batch resolved all three. The reviewer inspected actual Starting-state disclosure, fallback and tablet frames plus genuine intermediate model poses and returned a scoped **ship** verdict. A separate comparison confirmed the 52 previously reviewed UI source files stayed identical through accepted-main integration; final workflow verification binds all 54 current source files. This is a source/capture review, not user aesthetic approval. See the [retained review record](review-verdict.json).

[Evidence index](evidence-index.json) records hashes and limits. Final results:

- [Stage controls and rendering](integration-interactions/stage-result.json): normal motion, pointer parallax restricted to the stage, keyboard reset/pause/resume, identical idle paused pixels, offscreen parking, reduced motion, touch controls, useful simulated reads while paused, initialization fallback and forced runtime WebGL context loss.
- [User journeys](integration-journeys/browser-result.json): direct/private comparison, leak/repair, outage/recovery, live configuration failure, five viewport sizes, keyboard navigation, mode switching and equivalent reflow. Every context had zero page errors, external requests and application API requests.
- [Actual post-anchor frames](integration-navigation/navigation-result.json): keyboard skip to the lab at 320, 390 and 768 CSS pixels, with measured header/progression/count/title bounds and viewport captures that preserve the scrolled position.
- [Native transition and bounded fixes](integration-native/transition-result.json): actual framebuffer images and 42 model matrices captured synchronously after native animation-frame draw callbacks. The fixture changes from ready to worker unavailable while the stage stays in view. Actual after-change times are approximately 2.7, 121.7, 316.9 and 1028 ms; early/middle/late geometry changes are measured separately from DOM readouts. This result also checks every visible fallback child and both keyboard links at 320/390, nonoverlapping HUD/control bounds at 521/768/899, and a real Starting-state bootstrap disclosure at 320.

Useful views: [desktop](integration-journeys/desktop-live-initial.png), [mobile](integration-journeys/mobile-live-full.png), [narrow fallback](integration-native/fallback-320.png), [tablet controls](integration-native/tablet-768-stage.png), [bootstrap disclosure](integration-native/bootstrap-320.png), [ready pose](integration-native/before-ready.png), [early pose](integration-native/after-change-target-0ms.png), [middle pose](integration-native/after-change-target-100ms.png), and [late pose](integration-native/after-change-target-1000ms.png).

The three `integration-*-contact.png` contact sheets are derived from final browser PNGs with ImageMagick montage, without content edits. They assist capture-validity review; use individual images for detailed visual judgment.

## Exact local execution

Node `v24.22.2`, Playwright `1.65.0`, Chromium `158.0.8127.18`; preview `http://127.0.0.1:5196/`. The isolated Playwright installation is `/tmp/monolith-mn003-env`. Each runner refuses an existing output directory.

```sh
MONOLITH_STAGE_OUTPUT=/home/dj/Projects/monolith-lavender-ui/apps/dashboard/docs/review/lavender-20261107/stage-v2/integration-interactions /tmp/monolith-node24/node-v24.22.2-linux-x64/bin/node apps/dashboard/docs/review/lavender-20261107/stage-v2/stage-interactions.mjs
MONOLITH_TRANSITION_OUTPUT=/home/dj/Projects/monolith-lavender-ui/apps/dashboard/docs/review/lavender-20261107/stage-v2/integration-native /tmp/monolith-node24/node-v24.22.2-linux-x64/bin/node apps/dashboard/docs/review/lavender-20261107/stage-v2/capture-transition.mjs
MONOLITH_UI_REVIEW_OUTPUT=/home/dj/Projects/monolith-lavender-ui/apps/dashboard/docs/review/lavender-20261107/stage-v2/integration-journeys /tmp/monolith-node24/node-v24.22.2-linux-x64/bin/node apps/dashboard/docs/review/lavender-20261107/browser-journey.mjs
MONOLITH_NAV_BASELINE=/home/dj/Projects/monolith-lavender-ui/apps/dashboard/docs/review/lavender-20261107/stage-v2/integration-journeys/browser-result.json MONOLITH_NAV_OUTPUT=/home/dj/Projects/monolith-lavender-ui/apps/dashboard/docs/review/lavender-20261107/stage-v2/integration-navigation /tmp/monolith-node24/node-v24.22.2-linux-x64/bin/node apps/dashboard/docs/review/lavender-20261107/stage-v2/capture-integrated-navigation.mjs
```

Focused ESLint and Node parse checks passed for the new runners. No source, root manifest, lockfile, production runtime, deployment or pre-existing canonical evidence was edited by the browser-validation agent.

## Limits and preserved diagnostics

Fixture reads and worker states are **SIMULATED**. The live view is tested only in its unconfigured, fail-closed state; no real RPC or privacy measurement is claimed. Initialization fallback is injected, and runtime context loss is forced through `WEBGL_lose_context`.

Headless tab switching left `document.hidden` false. The visibility-handler check therefore uses an explicitly simulated property and event; it does not establish OS background throttling. Local draw counts and timings establish bounded behavior, not device FPS or general GPU performance. Equivalent 200% reflow is a 720×500 CSS viewport at 2× device scale, not a browser zoom-setting claim.

Earlier JSON summaries and scripts remain historical checkpoints or preliminary diagnostics. They are not evidence for the integrated build; their superseded PNGs were removed after review. Their transition captures were already settled because Playwright waited for capture stability, so they were not early animation poses. One preliminary bootstrap image captured Ready after its bounds were measured. The authoritative replacement is the immediate CDP viewport capture in `integration-native`, whose Starting state is checked before and after capture. No earlier JSON summary was rewritten.
