# Public observer deployment

The actual four-case browser walkthrough passed on 7 November 2026 IST against
`https://31921fa593eb26.lhr.life`, using backend commit
`072741195c8c01d22156336bf3eaf32b20046f2f` and reviewed UI commit `d5a1e0a3`.
The [canonical MN014 capture](../tests/e2e/lab-ui/observed-live/2026-11-07/attempt-5/browser-live.json)
is byte-identical to the original, SHA-256
`deb812bc3cff570fa999eefcb8061555f1d2c45b5e60045313f0241f331a687b`.
Companion reports/screenshots and four earlier BLOCKED captures belong to MN014;
the accepted MN009 proof remains historical evidence for its own runtime.

| Fresh run | Exact independent rows | Observed result |
| --- | ---: | --- |
| Private | 2 | Nym probe and useful read succeed; no baseline source claim. |
| Comparison | 3 | Two protected reads differ from baseline; coverage 2/3. |
| Deliberate leak | 4 | Useful widget leaks directly and fails; coverage 2/4. Forged labels still classify as baseline. |
| Repair | 4 | Three protected reads succeed, including the repaired useful widget; coverage 3/4. |

All 13 wire IDs match their trace and independent diagnostic inventory. The direct
baseline stays in coverage denominators. The capture reports zero ordinary
protected-target fallback calls and page errors; mobile layouts and browser/iframe
cleanup passed. The real Nym bundle was 18,283,862 bytes with Keccak
`0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`.

[Runtime bindings](../deploy/observer/evidence/2026-11-07/runtime-bindings.json)
pin 161 source/compiled/lock inputs and public tool/SSH-pin hashes; every input
still matched after capture. [Public metadata](../deploy/observer/evidence/2026-11-07/public-metadata.json)
recorded health200, trusted registry200 with an exact 120-second generation,
allocation201 and empty diagnostics200. No new live read is needed for this record.

The [launcher and route contract](../deploy/observer/README.md) document the fixed
chain10 upstream, accepted registry pins, per-visitor five-minute run allocation,
strict diagnostic query bridge, resource bounds and controlled teardown. Public
metadata uses ordinary HTTP; protected browser RPCs use the verified Nym driver
or fail closed. No forwarding/case label establishes source, and no SDK or worker
patch is needed to bridge the observed missing headers.

Only the explicit public lab uses a 120-second registry generation and the UI's
60-second chain-validation policy. The normal registry default remains 30 seconds.
Each query revalidates actual storage, publisher/source, chain, current engine
block and DNS; real content expiry clamps the window. Received leases are never
retimestamped or extended, and checks before/after exchanges remain enforced.
All four earlier blocked results remain BLOCKED, including the measured
30-second in-flight generation expiry that prompted this explicit timing policy.

Server-only Rabdi header authentication addresses the observed anonymous quota
failure. The [authenticated preflight](../deploy/observer/evidence/2026-11-07/authenticated-metadata-preflight.json)
recorded five HTTP200 responses. The fixed provider URL rejects redirects, and
explicit missing/invalid credential configuration fails without anonymous
fallback. Only the configured boolean is retained; no credential file, path,
value or hash is included.

Pinned Node24.22.2/pnpm12.18.0 `pnpm check` passed 1,453 tests in 46 files plus
lint, types and builds. Independent timing review passed 51 focused policy/public
HTTP cases, alongside the earlier edge/parser/launcher and server-key reviews.
Simulated socket tests remain separate from the actual observation above.

The trust scope remains the pinned SSH provider, its TLS/source transform,
initial TOFU enrollment, and a trusted single-user localhost. The provider's
actual supported flag is preserved in [the earlier sanitized help observation](../tests/privacy/live-observer/observed-localhost-run-provider-help-2026-11-06.json).
Provider retention and hostname lifetime are unverified; the workstation/user
service must stay online. Other local processes can forge loopback frames or
private-hop XFF. Provider and observer can see source and request payloads.
Evidence retains no raw source addresses, RPC parameters, credential or provider
message. The original installed Nym/header limitation is bridged explicitly; no
SDK/worker fix is claimed.

The capture-time service was `monolith-public-observer-mn025-20261107-6.service`, with a
12-hour cap and an unprivileged sleep/idle inhibitor. Prior owned processes were
fully stopped first; the [shutdown record](../deploy/observer/evidence/2026-11-07/prior-runtime-shutdown.json)
preserves their last READY snapshot separately from actual inactive/PID0/cgroup0
checks. These retained records do not establish current availability. Follow
[the latest operational updates](https://github.com/Dijo-404/monolith/issues/40)
and verify the current user service and backend origin before final dashboard QA;
a READY JSON alone is not liveness proof. Historical runtime6 teardown:

```sh
systemctl --user stop monolith-public-observer-mn025-20261107-6.service
```

This is temporary no-cost hosting, without permanent availability or a guaranteed
07:00 lifetime. Static dashboard publication and final release acceptance remain
separate tasks. This result does not establish universal anonymity, unrelated
application coverage, payments or sponsor eligibility.

## Registered free runtime8

After later anonymous tunnel failures, the owner confirmed registering the
dedicated public SSH key in a free account. Runtime8 started from independently
reviewed source `469f49d27ba9e2c40578b6bb18fc9e23cd71c4a4` on
6 November at 20:39 UTC (7 November, 02:09 IST), using the existing provider host pin and free assigned
origin `https://e964181cf62d29.lhr.life`. The optional launcher now selects the
explicit identity and safe SSH user; it disables the agent and refuses failed
authentication without anonymous fallback. Its metadata checks reject unsafe
permissions, ownership, symlinks, and OpenSSH expansion syntax in both the
selected and resolved paths. Only OpenSSH reads the private identity. No identity
path, contents or hash is retained in public status or evidence.

The [runtime8 record](../deploy/observer/evidence/2026-11-07/runtime8/deployment-record.json)
links the original new [161-file binding](../deploy/observer/evidence/2026-11-07/runtime8/source-bindings.json),
[startup status](../deploy/observer/evidence/2026-11-07/runtime8/startup-status.json)
and [public metadata capture](../deploy/observer/evidence/2026-11-07/runtime8/public-metadata.json).
That capture passed health 200, trusted actual Arkiv registry 200 with a 120-second
generation, fresh allocation 201 and empty diagnostics 200. It made no observer
target RPC and is not a new worker or privacy proof. All 160 other runtime source
and compiled inputs remain unchanged; only the reviewed launcher differs from
the earlier runtime. A separate genuine browser capture must bind this origin.

The [three-minute health check](../deploy/observer/evidence/2026-11-07/runtime8/continuity-health-1.json)
and [owned-unit inspection](../deploy/observer/evidence/2026-11-07/runtime8/owned-unit-state.json)
record a detached, active user service with the 12-hour cap and sleep/idle
inhibitor. It was launched without `--scope`, `--wait` or a controlling TTY.
The predecessor was absent at resumption; its stale READY snapshot does not
establish an exit cause. These are timestamped observations, not a future
availability guarantee. Keep this workstation and its user manager available,
and check current health before the demonstration.

The explicit-key launcher suite passed 32 synthetic cases after four new token
path regressions failed against the preceding source. Full pinned `pnpm check`
passed 1,453 tests in 46 files plus lint, types and builds. The implementation and
the 32-case suite received separate root review before activation. The existing
full runtime6 workflow and every blocked attempt remain unchanged historical
records. Billing remains inactive; no paid plan or custom domain is used.
