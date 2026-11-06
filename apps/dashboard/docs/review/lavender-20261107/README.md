# Guided lavender lab review

Presentation follow-up [#86](https://github.com/Dijo-404/monolith/issues/86), based on accepted main `79054dc`. The owner requested a light Phantom-inspired interface and confirmed a guided lab with a clear next action.

The shared presentation now explains the lab immediately, exposes live/offline mode switching, keeps section navigation available on mobile, and gives the original WebGL stage readable lavender materials. Long results wrap; interactive targets, focus, disabled states, fallback and reduced motion retain the same working flows. Navigation reserves the measured sticky-header height plus 16px so the step indicator stays visible.

The live controller, transport, registry, observer and sandbox implementation are unchanged. This review verifies browser usability and **SIMULATED** workflows; it makes no new live anonymity, Arkiv availability, payment, hosting or sponsor-eligibility claim. Default local live mode starts untested and refuses missing configuration before network activity.

## Captures and evidence

- [Desktop opening](browser/current/desktop-live-viewport.png), [full page](browser/current/desktop-live-initial.png).
- [390px mobile](browser/current/mobile-live-full.png), [mobile stage detail](browser/current/mobile-live-stage.png), [320px](browser/current/narrow-live-full.png), [tablet](browser/current/tablet-live-full.png), [1280px laptop](browser/current/laptop-live-full.png).
- [Simulated leak](browser/current/desktop-offline-leak.png), [simulated outage](browser/current/desktop-offline-outage.png), [unconfigured live failure](browser/current/desktop-live-blocked.png), [WebGL fallback](browser/current/webgl-fallback.png).
- [Equivalent reflow](browser/current/zoom-200-percent.png): 720×500 CSS viewport at 2× device scale, representing 1440×1000 output. This approximates 200% layout reflow; it does not claim an actual browser/OS zoom-setting test.
- [Source-bound browser results](browser/current/browser-result.json): **26/26 passed**, 52 source files and 9 build files identical before/after; Node 24.22.2, Playwright 1.65.0, Chromium 158.0.8127.18. Zero page errors, external requests or application API requests. Result SHA-256: `dd97185b2c85ea667c82136e393d58697649336a532d42820a9e487a3e508bc7`.
- Actual post-keyboard-skip frames: [320px](browser/navigation/320.png), [390px](browser/navigation/390.png), [768px](browser/navigation/768.png), with [source-bound positions and hashes](browser/navigation/navigation-result.json). These retain the scrolled viewport and directly show the repaired anchor behavior.

The browser stage intentionally parks when offscreen. Capture code visits it first and inspects the rendered geometry before taking document-top full-page captures; stage closeups show the actual visible WebGL output.

## Validation

Using Node 24.22.2 and pnpm 12.18.0:

```sh
pnpm install --frozen-lockfile --offline
pnpm check
pnpm --filter @monolith/dashboard preview --host 127.0.0.1 --port 5196 --strictPort
```

Install reused 242 packages with zero downloads and left manifests/lockfile unchanged. Final `pnpm check` passed ESLint, all package/dashboard/observer type checks and builds, plus **1,517 tests in 47 files**. A separate offline browser-tool environment supplies Playwright without changing project dependencies:

```sh
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
MONOLITH_UI_PREVIEW_URL=http://127.0.0.1:5196/ \
MONOLITH_UI_REVIEW_OUTPUT=/tmp/monolith-ui-review-new \
node apps/dashboard/docs/review/lavender-20261107/browser-journey.mjs
```

Use a new output directory; the runner refuses an existing one. It tests the live opening/configuration refusal, explicit offline mode, direct/private comparison with residual payload visibility, bypass detection, fresh useful repair, managed outage/retry, a surviving bypass during outage, keyboard focus and skip link, section tracking, stage detail links, five viewport sizes, equivalent reflow, reduced motion and WebGL fallback. No external service is contacted.

The Impeccable detector ran once over all six changed UI source targets and returned `[]`. Eleven semantic text/surface token pairs exceed 4.5:1 contrast: the lowest tested light pair is 5.20:1; tested stage pairs are at least 9.43:1. Geometry inspection found finite vertices, unit normals, valid indices and preserved endpoint/widget bounds. Self-hosted fonts and their original OFL notices are unchanged.

## Review history and limits

The independent finish review inspected desktop/mobile/narrow/stage, blocked, simulated leak/outage and fallback states. It found one material issue: responsive sticky-header stacking covered the progress indicator after an anchor jump. The fixed header measures its actual border-box height with ResizeObserver; cleanup removes the observer and custom property. The final browser suite checks actual progress/count bounds, rather than only the active navigation label. Measured mobile results: header bottom 151.59px, progress top 176px, step count top 194px. Tablet: header bottom 127px, progress top 151.11px, step count top 169.11px.

Preliminary runs were superseded while the build/runner was changing. Their summaries are retained as historical software diagnostics; they are not accepted final evidence. An earlier CSS `zoom: 2` screenshot was rejected because it did not change media-query layout; it is not used to substantiate browser zoom or reflow. Existing live evidence elsewhere in the repository is unchanged.

The first visual review is bounded UI review, and any subsequent verdict scores its specific finding. Chromium is the tested browser; physical projector testing, other browsers, new live-network execution, final MN-016 integration and deployment remain outside this presentation follow-up.

The same independent reviewer inspected the corrected source, seven current views and all three actual post-navigation frames. Final disposition: **ship**, with the original anchor finding scored **resolved** and corrected equivalent-reflow evidence accepted. This is a verdict on that finding and its correction, not a broader live-privacy or sponsor-acceptance claim. See the [retained verdict](review-verdict.json).
