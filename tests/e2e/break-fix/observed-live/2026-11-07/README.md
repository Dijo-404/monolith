# Actual mounted walkthrough, 7 November 2026 IST

[Attempt 8](attempt-8/browser-live.json) passed the complete real workflow against
the published [Monolith lab](https://monolith-privacy-lab.madhanxdev.chatgpt.site)
from `2026-11-06T21:45:23.106Z` to `21:47:01.419Z`. Its original SHA-256 is
`d8685e097e487b50148e513777c4288aa9681a6fc8d3c1e1a68cca5ecb5f9ef2`.
The clean source was `dfb08028da0fac156b9940dd117d892642717355`, including the
reviewed mounted presenter, accepted MN014 and accepted transport PR73. All 246
source, compiled, lockfile and official SDK inputs remained unchanged.

The frontend was Site version 6, artifact commit
`4d6c2b4e223d63e106e49ecb8167763f7f1fffb1`. Before this run, the deployment owner
verified authored asset bytes through 11 actual HTTPS GETs and separately pinned
the hosting security HTML addition. The real backend was runtime 10 at
`https://d06045ae660681.lhr.life`, independently bound by its owner to reviewed
source `469f49d27ba9e2c40578b6bb18fc9e23cd71c4a4`. Current configured health and
trusted metadata passed before capture. No diagnostic control or local preview was
active, and no SDK or response was mocked.

| Fresh action | Actual UI control | Wire rows | Protected credit | Result |
| --- | --- | ---: | ---: | --- |
| Private read | Guide: Run private read | 2 | 0/2 | Useful read returned; source comparison deliberately not run |
| Source comparison | Guide: Compare direct and private | 3 | 2/3 | Direct baseline differs from protected sources |
| Deliberate leak | Presenter: Run leaky fixture | 4 | 2/4 | Useful read returned; widget privacy failed and visible outcome was `leak-observed` |
| Repair and rerun | Presenter: Run repaired fixture | 4 | 3/4 | Fresh useful result passed widget privacy and functional acceptance; visible outcome was `repaired` |

Repair started disabled. The presenter displayed the fixed-fixture disclaimer and
route diff, then the actual measured report IDs. Repair kept failing
`report_5687d8aa-47c7-458d-85b5-75057eacee5d` visible alongside distinct new
`report_5cd386b9-5b12-42dc-bbcb-7ac678f80af6`. The original failing report is also
retained unchanged in the [repaired export](attempt-8/repair-report.json). Four
fresh allocations and 13 distinct wire UUIDs prevent stale result reuse. Direct
controls remain counted and earn no protected credit. The analyzer retains
functional status `unresolved` for the deliberately untraced leak; independent
receipts record its completed useful requests. Repair's functional status is `pass`.

The same scenario and seed `monolith-zero-address-balance-v1` were preserved. The
[derived diff](repair.diff) and [exported patch](fixture-patch.json) come from the
original reports. Their only replacement changes `/route` from `direct-debug` to
`anon-nym`; chain, method, synthetic fixture, block tag, callsite and required
privacy stay unchanged. This is a controlled fixture, not an arbitrary source edit.

Worker bundle verification and two disclosed non-anonymous bootstrap calls passed.
Forged forwarding/case labels affected only the counted native leak POST, with its
body and ID preserved; the independent source remained baseline. Zero ordinary
protected-target fallback requests and zero page errors were observed.

Six strict frame inventories passed with zero unknown frames. Startup had no
Monolith host; each completed action had one exact worker host and one separately
identified hosting frame. Navigation removed both and destroyed the browser
context. Two coarse Cloudflare security-bootstrap requests are outside protected
RPC coverage; no challenge identifiers, URLs, parameters or payloads are retained.
Active 390- and 320-pixel layouts passed without horizontal overflow. Stage hops
remain illustrative, not measured.

The [binding and bounded redaction audit](binding-and-redaction-audit.json) rehashes
246 inputs and 11 capture files, cross-checks four reports and six PNGs, and checks
unique wire IDs, source classes, CTA outcomes and prior-failure retention. Bounded
JSON/PNG inspection found no forbidden raw-IP/payload/credential fields or private
PNG metadata. The [copy index](copy-bindings.json) binds unchanged original files
and separately derived fixture artifacts. This inspects retained files, rather
than recapturing network traffic. Credential files were neither read nor hashed.

The separate [independent review](independent-review.json) passed all 246 input
bindings, file/report/screenshot hashes, fresh wire/source correlation, presenter
outcomes, prior failure, layouts and teardown. The backend owner authorized
unchanged copies of its [161 input bindings](backend-runtime-10/source-bindings.json),
[metadata preflight](backend-runtime-10/public-metadata.json) and
[pre-capture health](backend-runtime-10/pre-capture-health.json), bound by a
[copy index](backend-runtime-10/copy-bindings.json). Their original times and
metadata-only scopes remain historical; actual privacy credit comes from this
capture's own fresh generations and receipts.

All earlier successful and blocked observations remain unchanged, including
[pre-mount public attempt 7](../../../lab-ui/deployed-live/2026-11-07/README.md).
They keep their original source/runtime bindings and labels.

## Reproduction and limits

Follow the [runner setup](../../../lab-ui/README.md) with Node24.22.2,
pnpm12.18.0 and Playwright1.65.0. Use clean committed source/build files, explicit
actual `MONOLITH_DEPLOYED_UI_ORIGIN`, the matching public observer origin, no
`MONOLITH_PREVIEW_URL`, and a new output directory. Check deployment provenance,
authored assets and any reviewed hosting addition first. The
[core demo](../../../../../docs/demo-core.md) explains the no-payment flow.

This is one bounded synthetic observation. Normal owner review/merge and task
acceptance are tracked on issue16; evidence packaging and clean-clone release
remain MN017's responsibility. It does not prove universal anonymity, sponsor
eligibility, settlement, external-provider retention or a hosting SLA. The endpoint,
observer and tunnel provider can see source or request payloads. Ordinary hosting,
registry, allocation, diagnostics and worker bootstrap are disclosed separately.
Worker WebRTC/KPS, extensions, wallets, unrelated pages and arbitrary applications
are outside capture. The free backend requires the workstation, its bounded service
lifetime and working external connections.
