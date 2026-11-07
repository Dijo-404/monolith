# Product

<!-- impeccable:product-schema 1 -->

Scope: the Monolith dashboard app (`@monolith/dashboard`). Repository-wide truth lives in [docs/idea.md](../../docs/idea.md), [docs/architecture.md](../../docs/architecture.md) and [docs/contracts.md](../../docs/contracts.md); this file distils what the dashboard surface must honour.

## Platform

web

## Users

- **ETHGlobal judges** watching the live demo, including on a projector in a lit room. They must understand the one comparison (direct read vs Anon-RPC read, and what the endpoint still sees) within about 15 seconds.
- **Web3 checkout and wallet engineers** who run the lab locally to see which of their JSON-RPC reads are protected, catch direct-RPC regressions, and export evidence.
- **Privacy and application-security reviewers** who need reproducible, honestly labelled artifacts rather than a privacy score.

## Product Purpose

Monolith is the privacy crash-test lab for Web3 checkout: it shows exactly what an RPC provider learns, routes supported reads through real Anon-RPC transport, catches newly introduced direct-RPC leaks, and proves the legitimate read still works after repair. Success is a judge or engineer who can say which path a read took, what the endpoint still saw, and whether that claim is observed, simulated or untested.

## Positioning

Route-coverage contracts plus adversarial, replayable privacy tests: a privacy-required read either goes through a verified anonymizing worker or fails closed, and an injected direct read is caught with its callsite. The dashboard visualises protection and residual exposure together; it never claims payload confidentiality or anonymous payments.

## Operating Context

- The default live lab has four steps: private read, explicit source comparison, intentional bypass, and repair/rerun. The separately labelled offline walkthrough includes a worker-outage scenario. A light request explorer explains each boundary; separate result cards lead into actual read details, checks, worker state, registry provenance and activity.
- Demo arc (docs/idea.md §15): direct read exposed → private read via worker with Arkiv-selected endpoint → reveal residual payload exposure and bootstrap note → inject leak, test fails → sandbox repair, rerun passes → optional Whitechain checkout → report.
- Browser-only Anon-RPC harness; worker bootstrap is slow and observable as BOOTSTRAPPING / READY / DEGRADED / BLOCKED / CLOSED.

## Capabilities and Constraints

- Private mode starts enabled. The direct negative control is a separate, explicit action and never a fallback.
- Worker outage blocks protected reads; the UI offers retry only, never a silent downgrade.
- Payload visibility (`rpc-endpoint-can-read`) and the non-anonymous worker bootstrap lookup are always disclosed.
- Passthrough is labelled NOT_ANONYMIZED and earns no protected credit.
- Coverage shows its denominator and scope and exists only for a measured run; zero eligible reads is "unavailable", never 100 percent.
- Whitechain checkout is conditional (MN-018–MN-022) and stays disabled until its gates pass; the payment path is never depicted as anonymous.
- The browser bundle receives only `MONOLITH_PUBLIC_OBSERVER_URL`. Fonts are self-hosted. The request explorer sends no requests; the live lab's explicit run actions retain their existing network behavior.
- The accepted MN-014 composition connects the observer/registry/transport to the default live view. `?mode=simulated` opens the MN-006 offline fixture walkthrough. Switching modes is explicit. Live network mode names the selected mode; individual result badges establish the actual provenance of a run.
- `?page=docs` opens developer documentation inside the same bundle (the static deploy accepts only `index.html` and `assets/`). It mounts no lab controller and sends no requests. Its facts are taken from the source and docs, with citations; only `@dijo-404/monolith-cli` is described as published.
- The header's optional wallet button discovers installed wallets through EIP-6963, renders only inline `data:image` icons, and calls only `eth_requestAccounts`, `eth_chainId` and best-effort `wallet_revokePermissions`, all user-initiated. It never reconnects on load, never reads chain state through the wallet and never supplies the address to a lab read. The wallet's own RPC traffic is disclosed as outside Monolith's protection.
- Private/Direct buttons in the request explorer change a local explanation, not the privacy policy or network route. Clickable stops, Previous/Next, the balance/receipt example and its marked example body send nothing. The worker-status strip reflects caller state separately; actual read metadata and observer evidence belong in the result cards.

## Brand Commitments

- Name: Monolith (`monolith`, `@monolith/*`). Tagline: "Break your checkout's privacy. Fix the leak. Prove the payment still works."
- The current owner direction (chosen 7 November 2026, superseding the lavender build) is a light **test-report instrument** that stays readable on a projector: warm report paper, near-black ink, hairline rules, mono annotations, a ruled "Fig. 1" request route, deep violet for the protected route and signal red for exposure. The owner called the lavender pill-and-icon-box look generic, and earlier rejected the complete dark 3D card; neither returns. Preserve the original Monolith mark; copy no other product's mascot or assets.
- Self-hosted Wix Madefor Text/Display and Fragment Mono, with their OFL notices beside the font assets.

## Evidence on Hand

- The offline walkthrough uses local `SIMULATED` scenarios and authored timing; its controls dispatch no blockchain requests. Coverage stays unmeasured and payment stays disabled there.
- The default live view receives actual controller results and independent observer receipts. Fresh configuration starts `UNTESTED`; missing required configuration blocks execution. A successful worker alone does not establish the paired source comparison.
- MN-014's named deployed workflow was separately accepted on issue #14. The presentation follow-up #86 verifies browser usability and offline behavior; its screenshots and fixture journeys provide no new live anonymity, registry, payment or sponsor-eligibility evidence.
- Both dark-stage presentation reviews are historical after the owner's rejection. Their software results remain attached to their named builds; they do not approve the replacement explorer. Its review is recorded separately without upgrading local explanations into network evidence.

## Product Principles

1. Label every number and state with its provenance: OBSERVED LIVE, SIMULATED, UNTESTED or BLOCKED.
2. Show protection and residual exposure together; never one without the other.
3. Fail closed, visibly: a blocked read is a correct outcome, not an error to hide.
4. Explicit consent for anything that weakens privacy.
5. One comparison a judge understands in 15 seconds beats a feature tour.

## Accessibility & Inclusion

WCAG 2.2 AA is the accessibility target: keyboard-operable route and stop buttons, visible focus, named native selects/disclosures, polite selected-stop updates, state conveyed by words as well as colour, and `prefers-reduced-motion` respected. Mobile lays the route stops vertically. The explorer uses ordinary DOM and SVG icons, with no GPU, parallax or moving packet scene.
