# Overnight product decision — 6 November 2026

The owner requested a built, tested and deployed product by **7 November, 07:00 IST**, and selected **no-cost hosting**. The official [Mumbai submission rules](https://ethglobal.com/events/mumbai/info/details) list a 09:00 IST submission cutoff, leaving two hours for submission. The participant dashboard remains authoritative for the team's actual submission and eligibility.

## Product decision

Finish Monolith as a privacy regression lab: inject a direct RPC leak, detect it, repair the routing, rerun useful reads and export the measured evidence. Preserve the real Nym transport and Arkiv-backed chain registry. Leave Whitechain out of this overnight scope.

Monolith already has merged transport, observer, analyzer, importer, trusted reader and registry-to-protected-transport implementations. [PR #34](https://github.com/Dijo-404/monolith/pull/34) records actual Nym-protected reads selected from a live Arkiv response. These are stronger starting points than new specifications with several untested external integrations. They do not establish a finished dashboard or successful paired-source proof.

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

- [MN-006](https://github.com/Dijo-404/monolith/issues/6): the owner confirmed the original UI session stopped and authorized takeover. Preserve its saved design, correct misleading fixture claims, integrate current public contracts, validate and open a PR.
- [MN-009](https://github.com/Dijo-404/monolith/issues/9): actual distinct-source proof remains unpassed. Investigate a documented, no-cost source topology without relaxing the existing Cloudflare guards. A real worker result alone does not establish this comparison.
- [MN-012](https://github.com/Dijo-404/monolith/issues/12), [MN-014](https://github.com/Dijo-404/monolith/issues/14), [MN-016](https://github.com/Dijo-404/monolith/issues/16) and [MN-017](https://github.com/Dijo-404/monolith/issues/17) retain their acceptance gates. Tests and UI must name live, simulated, blocked and untested states accurately.
- [MN-023](https://github.com/Dijo-404/monolith/issues/36) adds independent deployment preparation. A public URL is not core-release acceptance.

If the actual source comparison cannot pass, publish only the honestly functioning subset and show the unresolved comparison as blocked. Do not mark MN-017 complete or claim the original EF/Arkiv core release on that basis. Any sponsor submission must describe the resulting implementation and its evidence.

The final submission needs human contribution and disclosure of AI assistance. Record human narration if a narrated video is used: the official rules prohibit AI voiceovers.
