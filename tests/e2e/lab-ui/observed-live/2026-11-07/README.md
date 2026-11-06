# Actual browser workflow, 7 November 2026 IST

[Attempt 5](attempt-5/browser-live.json) passed the complete actual production-browser workflow from `2026-11-06T19:08:04.629Z` to `19:10:21.278Z`. Its SHA-256 is `deb812bc3cff570fa999eefcb8061555f1d2c45b5e60045313f0241f331a687b`. The target was a local production preview, **not a deployed public frontend**. It used the actual public backend at `https://31921fa593eb26.lhr.life`.

The clean UI commit was `d5a1e0a38fe9f21d7237e09ce9bc9c05ed129132`. The backend owner independently bound runtime 6 to `072741195c8c01d22156336bf3eaf32b20046f2f`, with runtime inputs identical to reviewed `b3c46cc7d105461c0e20e93d9acf36da012e4336`. Backend provenance, the trusted PROXY-v2 source edge, private server-only registry authentication and operational lifetime remain MN-025's separate evidence obligations. These browser files contain no credential file or credential hash.

| Fresh action | Independent wire rows | Protected credit | Actual result |
| --- | ---: | ---: | --- |
| Private read | 2 | 0/2 | Probe and balance returned; source comparison deliberately not run |
| Explicit source comparison | 3 | 2/3 | Direct baseline differs from both protected sources |
| Intentional widget leak | 4 | 2/4 | Useful calls returned; independent baseline receipt reveals `DIRECT_BYPASS` and `MISSING_TRACE` |
| Repair and rerun | 4 | 3/4 | Useful widget read returned through Nym; previous failing leak report retained |

Each action has a fresh server-generated run UUID and distinct wire UUIDs. The explicit direct controls remain in the denominator and earn no protected credit. The private-only run does not claim independently demonstrated source separation. The shared analyzer's functional status for the deliberately untraced leak is unresolved; the independent observer records its actual RPC completion. The repaired report has functional acceptance `pass`.

The actual worker response was 18,283,862 bytes, SHA-256 `df6fea22272705a340c23fb6949d782ad72f45029a9f5a2b5c88faf1e37e692f`, Keccak-256 `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`, matching the verified worker metadata. Two exact, disclosed non-anonymous bootstrap lookups preceded worker readiness. The runner observed **zero ordinary protected-target fallback requests and zero page errors**, checked active 390/320-pixel layouts, removed the host iframe on navigation and destroyed the browser context. Its interception self-check passed.

The test runner added forged forwarding/protected-case labels only to the already-counted explicit native leak POST. It preserved that request's body and ID, retained only the body hash/categories, and required the independent source to remain baseline. This is a source-spoofing control, not a worker or SDK modification. No RPC response or backend response was mocked.

The four downloaded reports and six screenshots retain their original bytes and relative filenames. [The bounded redaction and binding audit](redaction-and-bindings.json) records all capture-file hashes, successful verification of all 244 current source/compiled/lockfile/SDK input hashes, and matching report/screenshot hashes. It found no raw observed-IP fields, RPC parameter/header objects, credential patterns or PNG private metadata. The explicit `127.0.0.1` preview URL is infrastructure metadata, not an observed client source. Historical captures retain the source hashes recorded at their own commits; they are not re-labelled as the current runtime.

## Earlier blocked captures

All four complete earlier directories are preserved byte-for-byte. They remain `BLOCKED`, `passed: false`; a later successful capture does not change their results.

| Capture | Recorded boundary | Subsequent correction |
| --- | --- | --- |
| [Attempt 1](blocked/attempt-1/browser-live.json) | Comparison returned actual wire responses but exhausted a partly aged 30-second registry generation | Public metadata factory created a fresh trusted generation for each GET |
| [Attempt 2](blocked/attempt-2/browser-live.json) | Public tunnel mapping returned unavailable allocation metadata before application RPC | Superseded tunnel stopped; new temporary origin independently checked |
| [Attempt 3](blocked/attempt-3/browser-live.json) | Registry metadata unavailable before application RPC | Backend separately diagnosed public Arkiv query HTTP 429; server-only authentication and bounded typed metadata retries were reviewed |
| [Attempt 4](blocked/attempt-4/browser-live.json) | Fresh 30-second generation expired during a 21.6-second probe plus 9.6-second balance read | Explicit reviewed public-lab generation maximum 120 seconds and probe validity 60 seconds; actual entity deadlines and before/after trust/expiry checks retained |

No failure was converted to a direct fallback, a stale lease or fabricated success. The source of attempt 2's provider mapping loss remains unproven; subsequent provider recovery does not establish its cause.

## Limits and reproduction

Use the unchanged runner and pinned tools documented in [the test README](../../README.md). The public frontend's final HTTPS asset identity and the same actual workflow must be verified separately after publication. This capture alone neither accepts an unmerged dependency nor establishes sponsor eligibility, a durable hosting SLA or universal anonymity.

The observer and tunnel provider can see source and request payloads; their retention is unverified. Ordinary allocation/registry/diagnostic metadata and worker bootstrap are disclosed. Capture covers this fixed synthetic workflow and ordinary page/frame HTTP; worker WebRTC/KPS, wallets, extensions, unrelated pages and arbitrary applications are outside scope. The stage's hop count is illustrative and unmeasured. The free backend is temporary and depends on the workstation, service lifetime and external providers.
