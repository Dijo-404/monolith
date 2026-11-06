# Request explorer browser-helper compatibility review

Disposition: no findings in this bounded compatibility diff.

Reviewed the current working-tree versions of `tests/e2e/lab-ui/browser-layout.mjs` and `scripts/deploy/browser-deployed.mjs` against accepted commit `69c22ba`. Source inspection only; this review did not execute either browser helper or contact a published site.

The changes replace obsolete `.stage` / `data-webgl` readiness checks with the `Follow a request` heading, zero-canvas assertions, and local Direct path / Private path `aria-pressed` checks. The future screenshots receive descriptive `no-webgl-required` filenames. The existing forced-WebGL-unavailable setup remains, so the new explorer is exercised under that condition rather than claiming a WebGL fallback still exists.

I independently reversed only those visualization-compatibility blocks in memory and obtained a byte-for-byte match with both baseline files. All other source is unchanged, including:

- Local preview: pinned Node/Playwright and loopback-origin gates; external-request abort/capture and application-API accounting; source/dist/runner/screenshot hashing; viewport checks; unconfigured fail-before-bootstrap check; same-origin worker-host check; reduced-motion and clearly simulated walkthrough checks; zero-error/external/API assertions; and context/browser teardown.
- Deployed helper: static-verification prerequisite, source/evidence metadata, frame classification/policy and frame-removal assertions, external-request abort guard, injected worker-host network abort, external-guard self-check, timeout and `WORKER_UNAVAILABLE` assertions, disabled measured export, final frame checks, teardown conditions, and evidence promotion/failure conditions.

The explanation selectors call only local `setRoute` / `setSelected` state setters in `Stage.tsx`. They neither dispatch reads nor call `onSelect`; the latter remains a separate details action. No fetch, worker creation or routing-policy mutation is introduced by these toggles.

Existing local evidence at `apps/dashboard/docs/review/lavender-20261107/request-explorer/layout-compatibility/browser-layout.json` records eight passing checks, zero page errors, zero external requests and zero application API requests. Its runner SHA-256 matches the reviewed current local helper (`d8970d56b11c51587aac9d4953dd714df939fa11e7bccca544ae779473f22a07`). The artifact correctly retains `evidence: UNTESTED`, layout/disabled-configuration scope, and `liveRpcAcceptance: false`.

The deployed helper SHA-256 is `87475321186e9a502845255b3ef655f20017652a2dc47a02552b925b95502c3c`. Its revised path was not executed, and this review establishes no published-site or live-RPC acceptance. No source files, historical artifacts or GitHub state were changed by this review.
