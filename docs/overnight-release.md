# Overnight product decision — 6 November 2026

The owner requested a built, tested and deployed product by **7 November, 07:00 IST**, and selected **no-cost hosting**. The official [Mumbai submission rules](https://ethglobal.com/events/mumbai/info/details) list a 09:00 IST submission cutoff, leaving two hours for submission. The participant dashboard remains authoritative for the team's actual submission and eligibility.

## Product decision

Finish Monolith as a privacy regression lab: inject a direct RPC leak, detect it, repair the routing, rerun useful reads and export the measured evidence. Preserve the real Nym transport and Arkiv-backed chain registry. Leave Whitechain out of this overnight scope.

Monolith already has merged transport, observer, analyzer, importer, trusted reader and registry-to-protected-transport implementations. [PR #34](https://github.com/Dijo-404/monolith/pull/34) records actual Nym-protected reads selected from a live Arkiv response, and [PR #41](https://github.com/Dijo-404/monolith/pull/41) adds an accepted genuine paired-source observation. These are stronger starting points than new specifications with several untested external integrations. Final live dashboard integration and deployment have separate acceptance gates below.

The Downloads alternatives were assessed as supplied specifications, not implemented products:

| Option | Product appeal | Decision for tonight |
| --- | --- | --- |
| Antibody | Consumer scam explanation and shared corroborated patterns | New inference, payment, trust and evaluation integrations make this an expensive restart |
| ShipSeal | A tampered frontend script is blocked before execution | Strong demonstration, but new browser enforcement and ENSv2 writes remain unproven |
| Bhookha | A companion with an emotionally clear demonstration | Native macOS application, agent adapters and several sponsor integrations exceed the overnight scope |
| ChainPulse | Public chain/RPC provenance and freshness | Reuses Monolith's registry if needed, but has weaker differentiation as a standalone directory |
| Monolith | A concrete leak caught and repaired with reproducible tests | Finish the focused existing product |

This is a hackathon delivery decision. Customer demand and willingness to pay remain unvalidated.

## Gates and coordination

- [MN-006](https://github.com/Dijo-404/monolith/issues/6): after the owner-authorized takeover, the preserved UI and honesty fixes were accepted in [PR #37](https://github.com/Dijo-404/monolith/pull/37). Its shell walkthrough is explicitly simulated; live wiring is separate.
- [MN-009](https://github.com/Dijo-404/monolith/issues/9): the original infrastructure blocker was resolved with an actual, independently reviewed distinct-source Nym comparison in [PR #41](https://github.com/Dijo-404/monolith/pull/41). The controlled observation is recorded with exact source/build bindings, no ordinary protected-target fallback and disclosed provider/SSH/local-host/header-bridge assumptions. Its temporary tunnel is stopped; a permanent backend is not claimed.
- [MN-012](https://github.com/Dijo-404/monolith/issues/12): [PR #43](https://github.com/Dijo-404/monolith/pull/43) was accepted with same-seed failing leak/passing repair commands, independent browser capture and a functional gate that rejects blocking all useful reads. This is simulated software-regression evidence, separate from the real worker proof.
- [MN-014](https://github.com/Dijo-404/monolith/issues/14) and [MN-016](https://github.com/Dijo-404/monolith/issues/16) have accepted live integration/presenter evidence. [MN-017](https://github.com/Dijo-404/monolith/issues/17) retains the final export/clean-clone gate. Tests and UI must name live, simulated, blocked and untested states accurately. Fresh public sessions and a reusable observer deployment are tracked in [MN-024](https://github.com/Dijo-404/monolith/issues/38) and [MN-025](https://github.com/Dijo-404/monolith/issues/40).
- [MN-023](https://github.com/Dijo-404/monolith/issues/36) adds independent deployment preparation. A public URL is not core-release acceptance.

If the actual source comparison cannot pass, publish only the honestly functioning subset and show the unresolved comparison as blocked. Do not mark MN-017 complete or claim the original EF/Arkiv core release on that basis. Any sponsor submission must describe the resulting implementation and its evidence.

The final submission needs human contribution and disclosure of AI assistance. Record human narration if a narrated video is used: the official rules prohibit AI voiceovers.

## Current publication checkpoint — 7 November2026

The public [privacy lab](https://monolith-privacy-lab.madhanxdev.chatgpt.site) version7 uses exact source `c11dace8107f386e5eceb8356395bfdb23035dd1` and the real runtime10 backend. It includes the accepted post-trace transport guard; the earlier DFB/version6 proof remains explicitly historical. Source-bound static delivery, desktop/mobile/graphics-fallback/injected-failure checks and a fresh genuine presenter-button workflow passed. Capture9 contains four fresh runs and13observed RPC rows, including a failing2/4leak and useful passing3/4repair. Independent review verifies248input bindings and all11original files. [Current deployment records and limits](deployment.md#current-publication--version7) distinguish execution, evidence storage, authored assets, hosting bootstrap and separate injected controls.

MN014, MN025 and MN016 are accepted. PR59 and PR92 merged normally; their owned reviewed blobs were verified unchanged. MN017 owns the final unchanged report-ID projections, export bundles and exact intended-stack clean-clone acceptance. Its acceptance and participant submission checks remain separate. The requested request-explorer revision is held in PR89 for owner personal review and has not been merged or deployed. Current proof does not claim to execute it.

The source repository is now public, as observed at22:32UTC November6; this deployment task did not change its visibility. Bounded committed-source audits do not cover every repository surface, and public visibility does not establish prize eligibility. The official submission deadline and AI-disclosure rules were rechecked on the linked primary pages; participant eligibility and meaningful human contributions are not invented. Human contribution details remain deferred at the owner's request.

No paid hosting is used. The real backend remains dependent on workstation/provider availability; a bounded passive health monitor is observation rather than guaranteed recovery. Keep failed and successful captures unchanged and name the exact selected source when assembling or publishing a later release.
