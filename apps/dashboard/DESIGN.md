---
name: Monolith Leak Lab
description: A readable lavender lab with a light, interactive request explanation and separate run evidence.
colors:
  bg: '#f1effa'
  bg-deep: '#e4dff3'
  surface: '#ffffff'
  surface-2: '#f6f4fc'
  line: '#e2deee'
  line-strong: '#cbc4df'
  ink: '#242033'
  ink-2: '#504860'
  ink-3: '#696079'
  accent: '#c8b9f9'
  accent-hover: '#bba7f4'
  accent-press: '#ae97ec'
  accent-ink: '#302149'
  protected: '#6542b3'
  protected-soft: '#eee8fb'
  exposed: '#c9372f'
  exposed-soft: '#fdeceb'
  good: '#17784d'
  good-soft: '#e2f3ea'
  sim: '#8f5c09'
  sim-dot: '#e0a33b'
typography:
  display:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: -0.035em
  headline:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  title:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: -0.01em
  body:
    fontFamily: Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  button:
    fontFamily: Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.55
  label:
    fontFamily: Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.55
  tag:
    fontFamily: Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.55
  mono:
    fontFamily: Fragment Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 0.9em
    fontWeight: 400
    lineHeight: 1.55
  explorer-title:
    fontFamily: Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif
    fontSize: clamp(1.5rem, 2vw, 1.875rem)
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: -0.025em
rounded:
  sm: 10px
  md: 14px
  pill: 999px
  lg: 20px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  page-x: clamp(16px, 3vw, 40px)
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
    typography: '{typography.button}'
    rounded: '{rounded.pill}'
    padding: 12px 26px
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-primary-active:
    backgroundColor: '{colors.accent-press}'
  button-primary-disabled:
    backgroundColor: '{colors.bg-deep}'
    textColor: '{colors.ink-3}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.pill}'
    padding: 12px 26px
  button-secondary-hover:
    backgroundColor: '{colors.surface-2}'
  section-navigation:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.pill}'
    padding: 5px
  section-navigation-current:
    backgroundColor: '{colors.protected-soft}'
    textColor: '{colors.ink}'
  tag:
    backgroundColor: '{colors.surface-2}'
    textColor: '{colors.ink-2}'
    typography: '{typography.tag}'
    rounded: '{rounded.pill}'
    padding: 0 10px
  tag-protected:
    backgroundColor: '{colors.protected-soft}'
    textColor: '{colors.protected}'
  tag-exposed:
    backgroundColor: '{colors.exposed-soft}'
    textColor: '{colors.exposed}'
  tag-good:
    backgroundColor: '{colors.good-soft}'
    textColor: '{colors.good}'
  card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: 24px
  route-card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: 18px 22px 20px
  scenario-selector:
    backgroundColor: '{colors.surface-2}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: 0 38px 0 14px
  switch:
    backgroundColor: '{colors.line-strong}'
    rounded: '{rounded.pill}'
    width: 44px
    height: 26px
  switch-checked:
    backgroundColor: '{colors.protected}'
  guide-step-current:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: 8px 12px
  request-workspace:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
  request-explorer:
    padding: clamp(20px, 2.5vw, 32px)
  route-choice:
    backgroundColor: transparent
    textColor: '{colors.ink-2}'
    rounded: 9px
    padding: 10px 16px
  route-choice-selected:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.protected}'
  route-choice-direct-selected:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.exposed}'
  request-stop-icon:
    backgroundColor: '{colors.surface-2}'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.md}'
    size: 48px
  request-stop-icon-selected:
    backgroundColor: '{colors.protected}'
    textColor: '{colors.surface}'
  request-stop-icon-direct-selected:
    backgroundColor: '{colors.exposed}'
    textColor: '{colors.surface}'
  example-selector:
    backgroundColor: '{colors.surface}'
    rounded: 9px
    padding: 8px 12px
  example-fields:
    backgroundColor: '{colors.surface-2}'
    rounded: '{rounded.sm}'
    padding: 14px 16px
  read-inspector:
    textColor: '{colors.ink-2}'
---

# Design System: Monolith Leak Lab

## Overview

**Creative North Star: "The Guided Lab"**

The current world is a clean, light interface for a lit room or projector: lavender-grey paper, white working surfaces, dark plum ink and restrained purple actions. A readable request explorer replaces the complete dark 3D card. The owner rejected both earlier stage revisions; their visual approvals do not carry forward. Keep the original Monolith mark and self-hosted typography, with no copied mascot or assets.

The explorer explains a request through local route choices, clickable stops and expandable fields. Separate run actions, worker status and comparison cards carry the actual lab state. An example is useful without pretending to be a measurement. [PRODUCT.md](PRODUCT.md) carries product truth and [the guided-lab brief](.impeccable/guided-lab.md) carries the surface flow. Tokens are extracted from [tokens.css](src/styles/tokens.css) and [lab.css](src/styles/lab.css); sidecar tonal ramps are derived preview swatches, not extra application tokens.

The default app is the live composition; `?mode=simulated` opens the offline fixture walkthrough. Mode names identify the selected mode; result badges identify run provenance. The [MN-006 review](docs/review/README.md), [first lavender review](docs/review/lavender-20261107/README.md) and [sculptural-stage review](docs/review/lavender-20261107/stage-v2/README.md) remain historical records for their named builds. The replacement is documented separately in [request-explorer/README.md](docs/review/lavender-20261107/request-explorer/README.md). Presentation screenshots and local examples establish no new live anonymity, registry, payment or sponsor evidence.

**Key Characteristics:**

- Lavender paper, white working surfaces and dark readable ink.
- Purple primary/private controls, red direct exposure and explicit provenance words.
- A light request explanation beside separate run results.
- Ordinary DOM controls, SVG icons, visible focus and responsive reading order.

## Colors

Use one purple accent family, lavender neutrals and colors reserved for their meanings. Frontmatter names mirror the used CSS custom properties without the `--` prefix.

### Primary

- **Soft lavender action** (`accent`, `accent-hover`, `accent-press`, `accent-ink`): the main run action and its feedback.
- **Deep route purple** (`protected`, `protected-soft`): private explanation choices, selected stops, supporting actions and keyboard focus. This color describes a role; it does not prove a protected read.

### Neutral

- **Lavender paper** (`bg`, `bg-deep`): page ground, quiet hover feedback and disabled primary actions.
- **White and pale surfaces** (`surface`, `surface-2`): request workspace, cards, controls and expanded example fields.
- **Lavender dividers** (`line`, `line-strong`): route connectors, disclosure boundaries, lists and control outlines.
- **Plum ink** (`ink`, `ink-2`, `ink-3`): primary, supporting and muted text. `text-muted` remains an alias of `ink-2`.

Exposure red (`exposed`, `exposed-soft`), passing green (`good`, `good-soft`) and simulation amber (`sim`, `sim-dot`) retain their meanings. Direct explanation choices use red while their disclosure continues to say that nothing is sent.

**The Meaning Rule.** Use purple for the primary action and protected route, red for direct exposure, green for a passing check, and amber for simulated data. A color or animation never grants evidence credit.

The CSS source may retain `stage`, `stage-ink`, `stage-ink-2`, `stage-anon`, `stage-direct`, `shadow-stage` and the 28px `radius-xl` as unused legacy declarations. They belong to the rejected dark scene and are excluded from this normative extracted system. Do not restore the 3D card from those leftovers.

## Typography

**Display Font:** Wix Madefor Display with system sans-serif fallbacks.

**Body Font:** Wix Madefor Text with system sans-serif fallbacks.

**Label/Mono Font:** Fragment Mono with system monospace fallbacks.

All faces are self-hosted with `font-display: swap`; OFL notices remain [beside the files](src/styles/fonts/). Display type gives the introduction and current task a clear hierarchy. Monospace belongs to methods, code and identifiers.

### Hierarchy

- **Display:** the introductory statement uses `display`; its second phrase uses route purple. It becomes 2.5rem at widths up to 520px.
- **Headline:** the guided run-step title uses `headline`, constrained to 13ch on desktop, 2.25rem below 900px and 2rem up to 520px.
- **Explorer title:** “Follow a request” uses `explorer-title`. Selected-stop headings use the display face at 1.25rem with line-height 1.25.
- **Title and values:** evidence headings use `title`; comparison values use 1.5rem, weight 600 and line-height 1.15.
- **Body:** base prose uses `body`; guide copy uses line-height 1.6 and a 42ch maximum. Explorer explanations use 0.875rem within 68ch.
- **Labels and mono:** `label` supports controls and metadata; `tag` names provenance. `mono` uses tabular numerals and wraps long identifiers.

## Layout

Main content and the introduction are centered within 1520px with the `page-x` gutter. The wide lab pairs a `minmax(340px, 0.83fr)` guide with a `minmax(0, 1.5fr)` explorer/results column, separated by `clamp(24px, 3vw, 48px)`. The request workspace uses its own white surface and fluid inner padding; comparison cards sit below it with a 16px gap. Evidence uses three columns, with designated cards spanning two.

- **Up to 1180px:** the introduction stacks, the guide/explorer ratio becomes 0.9fr/1.3fr with a 300px guide minimum, and evidence becomes two columns.
- **Up to 899px:** the lab and evidence become single-column; run steps use a compact two-column sequence. Section navigation moves to a second header row and remains available.
- **Up to 640px:** explorer stops become a vertical sequence, connectors become short vertical lines, supporting stop captions are hidden and the selected-stop facts become one column. Stop names and controls remain readable. Existing live-only error/footer layouts also adapt here.
- **Up to 520px:** comparison cards stack, main run actions fill the width, card padding becomes 20px and controls wrap. The mode badge and explicit mode link remain available.

The sticky header publishes its measured height through `--lab-header-height`; anchor scrolling reserves that height plus 16px, with a 94px fallback before measurement. The skip link leads to the lab. The explorer's “See run results” link leads to the comparison section; transport/endpoint detail controls navigate to the existing evidence panels.

## Elevation & Depth

White surfaces and soft shadows separate useful work from lavender paper. The request workspace and comparison/evidence cards use `shadow-card`. Navigation, the current run step and the selected route choice use `shadow-float`. Selected stop icons use small purple or red offset shadows, carrying the chosen explanation's meaning. Dividers organize the selected-stop explanation and read disclosures without nested cards. Exact shadow values live in the [sidecar](.impeccable/design.json).

Primary-button feedback remains 0.2s with a 0.98 pressed scale; switches retain 0.25s fill and 0.3s thumb transitions. Route choices change text/fill over 180ms and shadow over 240ms. Stop icons use a 350ms eased hover lift; the facts have a brief 350ms blur/position reveal. These effects describe local interaction, never traffic. Reduced motion disables smooth scrolling and reduces CSS animation/transition duration to 0.01ms with one iteration. There is no GPU scene, parallax, moving packet playback or scene Pause/Reset control.

## Shapes

The white request workspace uses the now-active `lg` radius; cards and guide rows use `md`; notes, fields and the skip link use `sm`. Main actions, section navigation, tags and switches use pill ends. Explanatory route buttons have modest 9px corners inside a 12px grouped control. Stop icons use 14px corners on desktop and 12px on mobile.

SVGs are crisp authored icons inside ordinary buttons. The connected stops express application boundaries rather than network topology: no relay counts, 3D devices, portal geometry, lighting or particle field belongs to the current world.

## Components

### Buttons

The main run action uses soft lavender fill, dark purple text, pill ends and a 52px minimum height. Hover and press use the extracted accent variants. Disabled actions remain muted. Secondary actions use white fill and an inset divider; small actions have a 44px minimum height. Keyboard focus uses a 2px route-purple outline with 3px offset. Keep run actions visibly distinct from the explorer's local explanatory controls.

### Chips

Quiet tags have a 26px minimum height and explicit words. Protected/exposed/passing variants use their meaning colors and pale fills. The simulation tag adds an amber dot and “Simulated” text; its pale amber background remains a component literal. Neutral tags do not imply a successful read.

### Cards / Containers

Comparison/evidence cards retain `route-card`/`card`, their white surfaces, moderate corners and wrapping identifiers. Unmeasured values remain muted. The request workspace uses `request-workspace`; its selected-stop explanation uses horizontal dividers rather than another card. The bottom status strip names caller-supplied worker state, endpoint context and live/simulated run status separately from the example above.

### Inputs / Fields

The offline scenario selector remains a native select. The explorer has a separate “Example request” native select for balance or receipt lookups, with a 44px minimum height. Changing it sends nothing. “Show example fields” uses native details/summary and displays zeroed example identifiers, never sent. The balance example includes `latest`; the receipt example uses a transaction hash. Expanded values wrap within the pale field surface.

Private-mode and leak-injection switches remain actual lab controls, with named help text, a 44×26px track, 20px white thumb and extended hit area. They are distinct from the explorer's Private/Direct explanation buttons.

### Navigation

The white section pill contains “The lab” and “Evidence”, with a pale-purple current state. [Header.tsx](src/components/Header.tsx) tracks the evidence section at 45% of the viewport. “Live network”/“Try offline” and “Simulated data”/“Go live” make mode changes explicit. The original Monolith mark remains.

### Request Explorer and Read Inspector

[Stage.tsx](src/components/stage/Stage.tsx) now renders the light explorer. Private/Direct are local `aria-pressed` buttons: the private explanation shows Your app → Monolith policy → Private worker → RPC endpoint; the direct explanation shows Your app → RPC endpoint. Clicking a stop or Previous/Next changes only the selected explanation, announced through a polite live region. Endpoint content explains that methods and identifiers remain readable and source differences require independent verification. Worker content keeps the separate non-anonymous bootstrap disclosure. The explorer does not change policy, dispatch requests or play back caller flights.

Actual comparison cards expose [ReadInspector.tsx](src/components/ReadInspector.tsx) only when a read exists. Its native “Inspect read” disclosure shows the supplied method, route, evidence kind, outcome, round trip (or Pending), optional callsite and read ID. It never renders raw RPC parameters. In live mode those values come from the live read; in the offline walkthrough they remain SIMULATED. Example fields in the explorer are never promoted into these records.

The historical MN-006 walkthrough retains its direct control, protected fixture read, bypass/repair and managed outage. A bypass may still send during a managed outage; the guide and checks disclose it. Offline timings, route origins, registry entries and checks remain SIMULATED, coverage stays unmeasured and payment disabled, and no action contacts the observer, Arkiv or RPC. The shared worker/method/error vocabulary continues to use public `@monolith/shared` exports.

## Do's and Don'ts

### Do:

- **Do** keep dark readable ink on lavender paper and white working surfaces.
- **Do** preserve one clear next run action and a separate local request explanation.
- **Do** pair meaning colors with words, pressed states and explicit provenance.
- **Do** keep mobile stops vertical, native disclosures usable and focus visible.
- **Do** show residual payload exposure beside route protection and actual result evidence.

### Don't:

- **Don't** restore the rejected dark 3D card, GPU effects, parallax or moving packet scene.
- **Don't** make Private/Direct explanation buttons send a read or change the real privacy policy.
- **Don't** treat example fields, a mode label or a screenshot as observed anonymity evidence.
- **Don't** invent traffic, hop counts, successful reads, full coverage or privacy scores.
- **Don't** hide a bypass during an outage or depict payment as anonymous.
