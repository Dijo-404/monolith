---
name: Monolith Leak Lab
description: A light test-report instrument. Report paper, ink rules and mono annotations around one ruled request route, separate run evidence and developer docs.
colors:
  bg: '#f2f0ea'
  bg-deep: '#e6e3da'
  surface: '#fbfaf7'
  surface-2: '#ece9e1'
  line: '#dcd8cc'
  line-strong: '#b3ae9f'
  rule: '#16151b'
  ink: '#16151b'
  ink-2: '#45424d'
  ink-3: '#625e6b'
  protected: '#4a2e9e'
  protected-soft: '#e7e2f4'
  protected-line: '#b8acdb'
  exposed: '#b8321a'
  exposed-soft: '#f8e4dd'
  exposed-ink: '#6e1d0f'
  good: '#1c6842'
  good-soft: '#dcebdf'
  sim: '#7e5300'
  sim-soft: '#f6ebd3'
  sim-dot: '#d9a030'
  code-plate: '#1b1a20'
typography:
  display:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: clamp(2.5rem, 4.6vw, 3.75rem)
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: -0.045em
  headline:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 2.375rem
    fontWeight: 650
    lineHeight: 1.06
    letterSpacing: -0.035em
  title:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 1.0625rem
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: -0.015em
  body:
    fontFamily: Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  annotation:
    fontFamily: Fragment Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 0.6875rem
    fontWeight: 400
    letterSpacing: 0.08em
    textTransform: uppercase
  mono:
    fontFamily: Fragment Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 0.9em
    fontWeight: 400
    fontVariantLigatures: none
rounded:
  xs: 2px
  sm: 3px
  md: 4px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  page-x: clamp(16px, 3vw, 40px)
  page-max: 1440px
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.surface}'
    rounded: '{rounded.sm}'
    minHeight: 50px
  button-primary-hover:
    backgroundColor: '{colors.protected}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    border: 1px solid {colors.rule}
    hover: 2px 2px 0 {colors.rule} offset, lifted 1px
  figure-plate:
    backgroundColor: '{colors.surface}'
    border: 1px solid {colors.rule}
    shadow: 3px 3px 0 {colors.rule}
  card:
    backgroundColor: '{colors.surface}'
    border: 1px solid {colors.line-strong}
    rounded: '{rounded.xs}'
  tag:
    typography: '{typography.annotation}'
    border: 1px solid {colors.line-strong}
    rounded: '{rounded.xs}'
  wallet-button:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.surface}'
    connected: surface fill, ink border, wallet icon + mono address + chain
---

# Design System: Monolith Leak Lab

## Overview

**Creative North Star: "The test report."** Monolith is a privacy crash-test lab, so the interface reads like an instrument's printed report: warm paper, near-black ink, hairline and heavy rules, small mono annotations and one numbered figure that does the explaining. It stays light for a projector in a lit room.

The owner chose this direction on 7 November 2026, calling the previous lavender pill-and-icon-box interface generic. That build, the earlier dark 3D card and their review records under [docs/review/](docs/review/) are historical; none of their approvals carry forward. [PRODUCT.md](PRODUCT.md) carries product truth. Tokens live in [tokens.css](src/styles/tokens.css); components in [lab.css](src/styles/lab.css) and [docs.css](src/features/docs/docs.css). The [.impeccable/design.json](.impeccable/design.json) sidecar still describes the lavender build and should be regenerated before it is relied on.

**Key characteristics**

- Report paper (`bg`, `surface`) with ink (`rule`) for structure: a 1px rule under the header, 2px rules over data lists, hairlines (`line`) between rows.
- Mono uppercase annotations for labels, provenance tags, figure captions and step numbers. Ligatures are off so code shows exactly what is typed.
- Square, machined corners (2–4px). Elevation is a hard ink offset, never a soft glow.
- Hatching marks anything that is an example or simulated, as on a technical drawing.

## Colour

Colour carries meaning only.

- **Protected violet** (`protected`): the private route, the selected private stop, current navigation markers in docs, primary-button hover. It never proves a protected read on its own.
- **Signal red** (`exposed`): the direct route, readable payload fields, bypasses and the non-anonymous bootstrap disclosure.
- **Green** (`good`): a passing check. **Amber** (`sim`): simulated data, always with hatching and the word.
- Everything else is ink on paper. All text pairs clear WCAG AA (lowest 4.73:1, `exposed` on `protected-soft`).

## Typography

Wix Madefor Display for headings (weight 650, tight tracking), Wix Madefor Text for body, Fragment Mono for annotations, identifiers and code. All self-hosted with OFL notices beside the files.

## Layout

Content is centred within 1440px with the `page-x` gutter. The lab pairs a sticky guide (desktop) with the Fig. 1 plate and two result cards; evidence cards sit in three columns below. The intro pairs the headline with a three-row spec sheet (mode, reads sent, wallet).

- **≤1180px:** intro stacks; evidence becomes two columns; the stop explanation stacks above its ledger.
- **≤899px:** primary navigation moves to a second header row; one column; guide steps form a 2×2 grid; docs move their contents into an "On this page" disclosure.
- **≤640px:** the route becomes a vertical track; the wallet button shows only its icon (its accessible name stays complete); the wallet dialog becomes a bottom sheet; the mode badge stacks above the mode switch and stays visible.
- **≤520px:** main actions fill the width; result cards stack.

## Components

### Fig. 1: request route

[Stage.tsx](src/components/stage/Stage.tsx). A ruled plate titled "Follow a request" with an `Example only · nothing is sent` hatched chip. A segmented control selects the private or direct explanation (`aria-pressed`). Stops sit on a measured track: solid violet for private (app → policy → worker → endpoint), dashed red for direct (app → endpoint). Each stop has a mono index, a 54px square node with its domain glyph, a name and a one-line role. The selected node fills with the route colour and lifts on a hard offset.

Below the track, the selected stop's explanation (polite live region) sits beside a ledger of facts. The example body shows the zeroed JSON-RPC payload with the method and identifier marked in red as readable by the endpoint on either route. Nothing in the figure dispatches a read or changes policy.

### Icons

[Icon.tsx](src/components/Icon.tsx). One authored set on a 24-unit grid: square caps, mitred joins and a constant 1.5px non-scaling stroke. Route glyphs are specific to Monolith: `app` (client window with prompt), `gate` (striped barrier: the policy), `mix` (shuffled paths: the mixnet worker), `node` (rack: the RPC endpoint), `observer` (the crash-test calibration target), `registry` (ledger). Icons are decorative unless given a `label`.

### Buttons and links

Primary: ink fill, paper text; hover turns violet and nudges the arrow. Secondary: paper with an ink border; hover lifts onto a 2px ink offset. Text links are underlined ink and turn violet on hover. Every control is at least 44px tall. Focus is a 2px violet outline with 3px offset.

### Wallet

[WalletButton.tsx](src/features/wallet/WalletButton.tsx) over a framework-free [wallet store](src/features/wallet/wallet-store.ts). Disconnected: an ink "Connect wallet" button. The picker is a native modal `<dialog>` listing EIP-6963 wallets with their own inline icon (or a monogram when the icon is not an inline image), reverse-DNS id and an arrow; a pending wallet says "Approve in wallet…". Connected: the wallet icon, mono short address and chain name; the account dialog shows the full address, network and provider with Copy and Disconnect. Both dialogs end with "What connecting shares".

### Tags, cards and lists

Provenance tags are mono caps with a 1px border: violet, red, green, or hatched amber for SIMULATED. Cards are paper with a `line-strong` border and a hairline under the head. Notes use a 3px left rule. Fact lists use hairline rows; data lists start with a 2px ink rule.

### Docs

[DocsPage.tsx](src/features/docs/DocsPage.tsx) at `?page=docs`. A sticky numbered contents rail, `§ NN` section numbers, code on ink plates with a language chip, title, copy action and a source caption, and tables with mono caps headers. Content is limited to facts verified in the source.

## Do and don't

- **Do** keep ink-on-paper contrast, words beside every meaning colour, and explicit provenance.
- **Do** keep one clear next run action, separate from the local Fig. 1 explanation.
- **Don't** reintroduce lavender pills, soft drop shadows, rounded icon tiles or the dark 3D card.
- **Don't** let the wallet, the figure or a screenshot stand in for observed evidence, or depict payment as anonymous.
