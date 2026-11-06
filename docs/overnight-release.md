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
- [MN-014](https://github.com/Dijo-404/monolith/issues/14), [MN-016](https://github.com/Dijo-404/monolith/issues/16) and [MN-017](https://github.com/Dijo-404/monolith/issues/17) retain their integration/release gates. Tests and UI must name live, simulated, blocked and untested states accurately. Fresh public sessions and a reusable observer deployment are tracked in [MN-024](https://github.com/Dijo-404/monolith/issues/38) and [MN-025](https://github.com/Dijo-404/monolith/issues/40).
- [MN-023](https://github.com/Dijo-404/monolith/issues/36) adds independent deployment preparation. A public URL is not core-release acceptance.

If the actual source comparison cannot pass, publish only the honestly functioning subset and show the unresolved comparison as blocked. Do not mark MN-017 complete or claim the original EF/Arkiv core release on that basis. Any sponsor submission must describe the resulting implementation and its evidence.

The final submission needs human contribution and disclosure of AI assistance. Record human narration if a narrated video is used: the official rules prohibit AI voiceovers.

## Measured publication checkpoint — 7 November2026

The public [privacy lab](https://monolith-privacy-lab.madhanxdev.chatgpt.site) version6 uses sourceDFB and the real runtime10 backend. Source-bound static delivery, mobile/WebGL/injectedfailure checks and the actual presenter-button leak/repair workflow passed. The final genuine observation has four fresh runs and13wire rows, with a failing2/4leak and useful passing3/4repair. [Deployment records and limits](deployment.md) distinguish authored assets, hosting bootstrap, original capture source, evidence storage and separately simulated controls.

MN014 and MN025 are accepted; normalMN016owneracceptance andMN017original-evidenceexport/clean-clone are still required at this checkpoint. The current code passed1,550tests/50files plus lint/types/build. A newer owner-requested visual revision remains a separate active lane; this older source-bound capture does not claim to execute it. GitHubsource staysprivate, so public-source prize requirements remain an owner decision after a final audited branch/history is prepared. The official submission deadline and AI-disclosure rules were rechecked on the linked primary pages; participant eligibility and meaningful human contributions are not invented.

No paid hosting is used. The real backend remains dependent on workstation/provider availability; a bounded passive health monitor is observation rather than guaranteed recovery. Keep failed and successful captures unchanged and name the exact selected source when assembling or publishing a later release.
