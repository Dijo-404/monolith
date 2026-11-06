# Interactive request explorer

The owner rejected the entire dark 3D card and requested a clearer visualization with more interaction. This revision removes the WebGL scene and replaces it with a light, accessible request explorer. It preserves the confirmed guided lab, lavender shell, self-hosted type and one primary run action.

Select **Private path** or **Direct path**, then choose a stop or move with Previous/Next. Switch the example between balance and receipt lookups, expand the zeroed example fields, or follow links to the real run results and endpoint/transport details. These controls explain the routes locally; they send no requests and never change the actual privacy policy. Private network hops are not depicted or inferred.

The selected endpoint explains what remains visible: method and request parameters. A worker-ready state grants no measured protection; independent source comparisons remain authoritative. The bottom strip shows caller-supplied worker state separately from the example. Actual comparison cards now offer native **Inspect read** disclosures for safe method, route, evidence, outcome, duration, callsite and read ID metadata. They do not render raw RPC parameters.

The live controller, composition, transport, registry, observer, measurement/export logic and mounted sandbox presenter retain their behavior. The bounded LiveLabApp changes replace the old wrapper/HUD and render the shared read inspector; they do not alter run actions or evidence conditions. Accepted main `b020f8d` was integrated at `69c22ba` before implementation. No dependencies or lockfiles changed.

## Evidence scope

Browser verification uses the production build at local loopback. Offline guide/read/leak/repair cases are **SIMULATED**. Unconfigured live mode is checked for honest initial state and fail-closed errors without application network traffic. No new live privacy, Arkiv availability, public hosting, payment, sponsor or physical-device claim is made. Earlier [v1](../README.md) and [v2](../stage-v2/README.md) captures remain historical; their visual approvals were superseded by the owner's rejection.

## Validation

Pinned Node 24.22.2 / pnpm 12.18.0 `pnpm check` passed: lint, workspace type checks, **1,895 tests in 57 files**, and all production builds. Current runtime assets are `app-NXfADppi.js` and `app-Dfc0eyNx.css`. The complete command output is preserved in [workspace-check.txt](workspace-check.txt).

PR89 remains draft and carries the owner's personal-review hold. This revision does not release that hold or authorize a merge or deployment.

Production Chromium 158 / Playwright 1.65.0 verification:

- [42/42 real browser journey checks](browser-verified/browser-result.json), driven by the [retained runner](browser-journey.mjs); [journey review](journey-review.md). Local controls leave real policy/activity unchanged; actual fixture metadata, guide/leak/repair/failure scenarios, unconfigured live actions, the accepted sandbox mount, keyboard/focus/anchors, five widths, reduced motion and equivalent 200% reflow pass.
- [8/8 existing layout compatibility checks](layout-compatibility/browser-layout.json). The two existing layout/deployed helpers now wait for the DOM explorer and exercise local route choices with WebGL forced unavailable. All original source/frame/network/fault/teardown guards are preserved; [independent diff review](runner-compatibility-review.md) found no issue. The deployed helper was syntax/lint checked, not executed against a published site.
- [Retained-byte audit](evidence-audit.json): all 51 source and 9 build files identical before/after; 33 current PNG hashes and both runner bindings verified. Zero canvas/graphics-context initialization, page errors, external requests or application API requests.
- [Single detector result](detector.json): zero primary findings; 44 advisory font/radius/color mismatches with the compact extracted design context. These are retained for the independent review, not reported as a zero-finding scan.

## Current captures

- [Desktop opening](browser-verified/desktop-live-viewport.png), [full page](browser-verified/desktop-live-initial.png).
- Actual viewport tops at [320px](browser-verified/initial-320-top.png), [390px](browser-verified/initial-390-top.png), [768px](browser-verified/initial-768-top.png), [1280px](browser-verified/initial-1280-top.png) and [1440px](browser-verified/initial-1440-top.png).
- Unobscured explorer close-ups at [320px](browser-verified/initial-320-explorer-tall.png), [390px](browser-verified/initial-390-explorer-tall.png) and [768px](browser-verified/initial-768-explorer-tall.png). These use recorded tall viewport heights to show the entire component; the actual phone/tablet viewport tops are linked separately. Product header and styles remain intact.
- [Keyboard explorer focus](browser-verified/keyboard-explorer-focus.png), [primary action focus](browser-verified/keyboard-primary-focus.png), [actual simulated read inspector](browser-verified/desktop-read-inspector.png), [leak](browser-verified/desktop-leak.png), [worker outage](browser-verified/desktop-worker-outage.png), [live configuration blocked](browser-verified/desktop-live-blocked.png).

The first [browser attempt](browser/browser-result.json) sampled layout immediately during a viewport resize; the [diagnostic measurements](diagnostic/layout.json) show it settles after two native frames and is absent in a fresh 390px context. The [second attempt](browser-final/browser-result.json) stopped on a stale selector for a duplicate status paragraph removed before the final build. Both failed harness results remain unchanged. Only `browser-verified` is the complete current journey result. Diagnostic close-ups with a sticky-header overlay are excluded from the valid review packet. No product correction was required for either harness issue.

The equivalent 200% check uses 720×500 CSS pixels at 2× device scale; it is a reflow approximation, not an actual browser/OS zoom-setting test. Browser/headless checks do not establish physical-device or projector testing.

## Independent review

The [fresh full review](independent-review.md) returns `disposition: ship` for this bounded Operate/Read refinement, with no material fixes. It inspected the final desktop/narrow/tall/focus/fields/read-inspector evidence and found the user-requested replacement present, readable and truthful. It records the 44 detector advisories and missing comp/seed/card as inapplicable to the retained visual world; no comp reproduction is claimed. Its earlier bounded browser batch timed out on a selector and provides no final functional acceptance. Current acceptance comes from the complete 42-check helper and the reviewed final captures. The owner's personal-review/deployment hold remains intact.
