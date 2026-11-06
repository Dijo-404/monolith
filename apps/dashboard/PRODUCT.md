# Product

<!-- impeccable:product-schema 1 -->

Scope: the Monolith dashboard app (`@monolith/dashboard`). Repository-wide truth lives in [docs/idea.md](../../docs/idea.md), [docs/architecture.md](../../docs/architecture.md) and [docs/contracts.md](../../docs/contracts.md); this file distils what the dashboard surface must honour.

## Platform

web

## Users

- **ETHGlobal judges** watching the four-minute live demo, usually on a projector in a dim hall. They must understand the one comparison (direct read vs Anon-RPC read, and what the endpoint still sees) within about 15 seconds.
- **Web3 checkout and wallet engineers** who run the lab locally to see which of their JSON-RPC reads are protected, catch direct-RPC regressions, and export evidence.
- **Privacy and application-security reviewers** who need reproducible, honestly labelled artifacts rather than a privacy score.

## Product Purpose

Monolith is the privacy crash-test lab for Web3 checkout: it shows exactly what an RPC provider learns, routes supported reads through real Anon-RPC transport, catches newly introduced direct-RPC leaks, and proves the legitimate read still works after repair. Success is a judge or engineer who can say which path a read took, what the endpoint still saw, and whether that claim is observed, simulated or untested.

## Positioning

Route-coverage contracts plus adversarial, replayable privacy tests: a privacy-required read either goes through a verified anonymizing worker or fails closed, and an injected direct read is caught with its callsite. The dashboard visualises protection and residual exposure together; it never claims payload confidentiality or anonymous payments.

## Operating Context

- Single-screen lab (docs/idea.md §11): route lanes (Direct RPC, Anon-RPC via Tor/Nym, Whitechain settlement), worker status, Arkiv registry provenance, and a run timeline with privacy tests.
- Demo arc (docs/idea.md §15): direct read exposed → private read via worker with Arkiv-selected endpoint → reveal residual payload exposure and bootstrap note → inject leak, test fails → sandbox repair, rerun passes → optional Whitechain checkout → report.
- Browser-only Anon-RPC harness; worker bootstrap is slow and observable as BOOTSTRAPPING / READY / DEGRADED / BLOCKED / CLOSED.

## Capabilities and Constraints

- Private mode starts enabled. The direct negative control is a separate, explicit action and never a fallback.
- Worker outage blocks protected reads; the UI offers retry only, never a silent downgrade.
- Payload visibility (`rpc-endpoint-can-read`) and the non-anonymous worker bootstrap lookup are always disclosed.
- Passthrough is labelled NOT_ANONYMIZED and earns no protected credit.
- Coverage shows its denominator and scope and exists only for a measured run; zero eligible reads is "unavailable", never 100 percent.
- Whitechain checkout is conditional (MN-018–MN-022) and stays disabled until its gates pass; the payment path is never depicted as anonymous.
- The browser bundle receives only `MONOLITH_PUBLIC_OBSERVER_URL`. No third-party requests from the page (fonts are self-hosted).
- Undecided: the final observer/registry/transport adapters (MN-007, MN-010, MN-014) replace the shell's fixtures.

## Brand Commitments

- Name: Monolith (`monolith`, `@monolith/*`). Tagline: "Break your checkout's privacy. Fix the leak. Prove the payment still works."
- Visual references supplied by the owner: activetheory.net, phantom.com, igloo.inc, earthwallet.com, genesisfxmarkets.com — immersive dark WebGL stages, particle fields, light leaking through seams. Phantom's ghost mascot is their brand and is not reused.

## Evidence on Hand

- Synthetic contract fixtures from MN-002 (in flight, `tests/fixtures/contracts`), all `SIMULATED`.
- No live Anon-RPC read, observer run, Arkiv entity or Whitechain settlement exists yet. The dashboard must not display any of these as observed.

## Product Principles

1. Label every number and state with its provenance: OBSERVED LIVE, SIMULATED, UNTESTED or BLOCKED.
2. Show protection and residual exposure together; never one without the other.
3. Fail closed, visibly: a blocked read is a correct outcome, not an error to hide.
4. Explicit consent for anything that weakens privacy.
5. One comparison a judge understands in 15 seconds beats a feature tour.

## Accessibility & Inclusion

WCAG 2.2 AA: keyboard operation of every control, visible focus, text alternatives for the WebGL stage (state is always readable in the HUD panels), state never conveyed by colour alone, and `prefers-reduced-motion` respected.
