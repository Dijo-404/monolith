---
name: Monolith Leak Lab
description: A light lavender interface with clear actions and an original dark route stage.
colors:
  bg: "#f1effa"
  bg-deep: "#e4dff3"
  surface: "#ffffff"
  surface-2: "#f6f4fc"
  line: "#e2deee"
  line-strong: "#cbc4df"
  ink: "#242033"
  ink-2: "#504860"
  ink-3: "#696079"
  accent: "#c8b9f9"
  accent-hover: "#bba7f4"
  accent-press: "#ae97ec"
  accent-ink: "#302149"
  protected: "#6542b3"
  protected-soft: "#eee8fb"
  exposed: "#c9372f"
  exposed-soft: "#fdeceb"
  good: "#17784d"
  good-soft: "#e2f3ea"
  sim: "#8f5c09"
  sim-dot: "#e0a33b"
  stage: "#171326"
  stage-ink: "#f4efff"
  stage-ink-2: "#c7bedb"
  stage-anon: "#c5b5ff"
  stage-direct: "#ffa393"
typography:
  display:
    fontFamily: "Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Wix Madefor Display, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  button:
    fontFamily: "Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.55
  label:
    fontFamily: "Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.55
  tag:
    fontFamily: "Wix Madefor Text, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.55
  mono:
    fontFamily: "Fragment Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.9em"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "10px"
  md: "14px"
  xl: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  page-x: "clamp(16px, 3vw, 40px)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "12px 26px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-press}"
  button-primary-disabled:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.ink-3}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "12px 26px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  section-navigation:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "5px"
  section-navigation-current:
    backgroundColor: "{colors.protected-soft}"
    textColor: "{colors.ink}"
  tag:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
  tag-protected:
    backgroundColor: "{colors.protected-soft}"
    textColor: "{colors.protected}"
  tag-exposed:
    backgroundColor: "{colors.exposed-soft}"
    textColor: "{colors.exposed}"
  tag-good:
    backgroundColor: "{colors.good-soft}"
    textColor: "{colors.good}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  route-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "18px 22px 20px"
  stage-card:
    backgroundColor: "{colors.stage}"
    rounded: "{rounded.xl}"
  scenario-selector:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 38px 0 14px"
  switch:
    backgroundColor: "{colors.line-strong}"
    rounded: "{rounded.pill}"
    width: "44px"
    height: "26px"
  switch-checked:
    backgroundColor: "{colors.protected}"
  guide-step-current:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: Monolith Leak Lab

## Overview

**Creative North Star: "The Guided Lab"**

The light guided surface preserves the owner's requested Phantom-inspired direction: a lavender-grey page, white cards, a restrained purple action, and an original dark route stage. Dark ink and readable labels keep the surrounding interface clear in a lit room; the contained stage carries the expressive geometry. The Monolith mark and route model remain original.

The visual system makes the next action easy to find and keeps results, residual exposure and provenance readable together. [PRODUCT.md](PRODUCT.md) carries product truth; [the guided-lab brief](.impeccable/guided-lab.md) carries this surface's mode and composition. This document merges the established MN-006 shell guidance with the implemented refinement, extracting values from [tokens.css](src/styles/tokens.css), [lab.css](src/styles/lab.css) and the existing components. The frontmatter records implemented primitives; it does not add CSS variables. Sidecar tonal ramps are derived preview swatches, not additional application tokens.

The default app is now the live composition; `?mode=simulated` opens the separate offline fixture walkthrough. The persistent mode badge names the selected mode, while result badges establish a run's provenance. The original [MN-006 review](docs/review/README.md) remains historical SIMULATED shell evidence. Its desktop, 390px, 320px and WebGL-fallback screenshots, and screenshots made for this refinement, establish presentation behavior only; they provide no new live anonymity, registry, payment or sponsor evidence.

**Key Characteristics:**

- Pale lavender ground with dark readable ink and white result surfaces.
- Purple actions and protected-route labels; red exposure and amber simulation labels.
- A contained dark route stage with a readable text counterpart.
- Self-hosted typography, visible keyboard focus and reduced-motion support.

## Colors

The palette uses one purple accent family, lavender neutrals and colors reserved for evidence meanings. Frontmatter names mirror the CSS custom properties, excluding the `--` prefix.

### Primary

- **Soft lavender action** (`accent`, `accent-hover`, `accent-press`, `accent-ink`): filled primary actions and their hover/press feedback, with dark purple text.
- **Deep route purple** (`protected`, `protected-soft`): protected-route text, focus outlines, enabled private switches and selected navigation backgrounds.

### Neutral

- **Lavender paper** (`bg`, `bg-deep`): page ground and the disabled primary-action fill.
- **White and pale lavender surfaces** (`surface`, `surface-2`): cards, navigation, fields, notes and quiet tags.
- **Lavender dividers** (`line`, `line-strong`): section boundaries, list rows, secondary-action outlines and idle controls.
- **Plum ink** (`ink`, `ink-2`, `ink-3`): primary, supporting and muted text. The live stylesheet's `text-muted` is an alias of `ink-2`, not another palette color.
- **Night stage** (`stage`, `stage-ink`, `stage-ink-2`): the dark stage container and high-contrast overlay text. The renderer's RGB materials and shader lighting are separately authored in [renderer.ts](src/components/stage/renderer.ts); these CSS values describe the container, labels and SVG fallback, not an exact shader palette.

The meaning colors are **exposure red** (`exposed`, `exposed-soft`), **passing green** (`good`, `good-soft`) and **simulation amber** (`sim`, `sim-dot`). The stage uses lighter route-label counterparts (`stage-anon`, `stage-direct`) against its dark ground. Meaning always has a text label or icon beside it.

**The Meaning Rule.** Use purple for the primary action and protected route, red for direct exposure, green for a passing check, and amber for simulated data. A color or animation never grants evidence credit.

## Typography

**Display Font:** Wix Madefor Display with system sans-serif fallbacks.

**Body Font:** Wix Madefor Text with system sans-serif fallbacks.

**Label/Mono Font:** Fragment Mono with system monospace fallbacks.

All three faces are self-hosted with `font-display: swap`; their OFL notices remain [beside the font files](src/styles/fonts/). Headings use close spacing and medium weight; supporting text stays open and readable. There is no remote font dependency.

### Hierarchy

- **Display:** the introductory statement uses `display`; its second phrase takes the protected-route color. At widths up to 520px it becomes 2.5rem and wraps within 15ch.
- **Headline:** the step title uses `headline`, constrained to 13ch on desktop; it becomes 2.25rem below 900px and 2rem up to 520px. Evidence section headings use the same display face at 2rem.
- **Title:** evidence-card headings use `title`; route values use the display face at 1.5rem, weight 600 and line-height 1.15.
- **Body:** the base uses `body`. Guide explanations use line-height 1.6 and a 42ch maximum; the introductory explanation uses a 46ch maximum on wide screens.
- **Label:** `label` supports route metadata, controls and stage overlays. Tags use the smaller `tag` style with explicit words.
- **Mono:** method names, code and technical identifiers use `mono` with tabular numerals; long evidence values wrap within their containers.

## Layout

Main content and the introduction are centered within a maximum width of 1520px. The horizontal gutter uses `page-x`. Spacing repeats the extracted 4/8/16/24/32px steps, with contextual values such as 10px control gaps and 18px result spacing retained in the source.

The wide lab grid gives the guide `minmax(340px, 0.83fr)` and the stage `minmax(0, 1.5fr)`, separated by `clamp(24px, 3vw, 48px)`. The stage column places two equal comparison cards below its scene. Evidence cards use three columns, with designated cards spanning two columns.

- **Up to 1180px:** the introduction stacks, the guide/stage ratio changes to 0.9fr/1.3fr with a 300px guide minimum, and evidence becomes two columns.
- **Up to 899px:** the lab becomes one column, steps form a compact two-column sequence, and evidence becomes one column. Section navigation moves to a second header row and stays visible. Stage height becomes `clamp(300px, 62vw, 460px)`; compact labels replace long stage labels.
- **Up to 640px:** existing live-only error/footer and activity layouts adapt to narrow widths in [live.css](src/features/lab/live.css).
- **Up to 520px:** comparison cards stack, guide actions fill the available width, evidence-card padding becomes 20px and controls wrap. The mode badge and explicit mode link remain available beside the brand.

The sticky header stays above content. A focusable skip link leads to the lab. A ResizeObserver in the header publishes its actual border-box height to `--lab-header-height`; anchor scrolling reserves that measured height plus 16px, with a 94px fallback before measurement. Status, comparison and evidence text remain usable independently of the 3D scene.

## Elevation & Depth

White cards and soft shadows separate working surfaces from lavender paper. The stage has the strongest ambient shadow and clips its scene inside the largest rounded rectangle. Navigation and the current step float slightly; list rows use dividers rather than another layer of cards. The exact shadow values live in the [sidecar](.impeccable/design.json) and CSS source.

### Shadow Vocabulary

- **Card:** `shadow-card` supports comparison and evidence surfaces.
- **Stage:** `shadow-stage` anchors the contained dark scene.
- **Float:** `shadow-float` supports section navigation and the current guide step.

Motion follows the implemented `ease-out`. Buttons transition over 0.2s and press to scale 0.98; toggles change fill over 0.25s and move their thumb over 0.3s. Bootstrapping uses a 1.4s pulse, and a focused evidence card has a temporary 1.6s outline animation. Reduced motion disables smooth scrolling and reduces CSS animation/transition duration to 0.01ms with one iteration; the renderer also receives the reduced-motion state. The stage pauses while offscreen.

## Shapes

The stage uses the large `xl` radius; cards and guide rows use `md`; fields, notes and the skip link use `sm`. Primary actions, section navigation, tags and switches use pill ends. The declared 20px `radius-lg` has no current consumer and is intentionally absent from the extracted frontmatter. Keep the original slab, browser orb and relay geometry in the stage; no reference mascot or branding is copied.

## Components

### Buttons

Primary actions have soft lavender fill, dark purple text, pill ends, a minimum height of 52px and the frontmatter padding. Hover darkens the lavender; press uses the deeper fill and scale feedback. Disabled actions use muted lavender/ink and a not-allowed cursor. Secondary actions use white fill and an inset lavender outline; hover uses the pale surface. Small actions have a 44px minimum height, 16px horizontal padding and 0.875rem text. All keyboard-focusable controls inherit a 2px protected-purple outline with 3px offset.

### Chips

Quiet rounded tags have a 26px minimum height and 10px horizontal padding. Protected, exposed and passing variants pair meaning text with matching pale fills. The simulation tag adds an amber dot and explicit “Simulated” text; its existing pale amber fill is a component literal in CSS, not a new shared palette token. Neutral tags remain neutral rather than implying a successful run.

### Cards / Containers

Evidence cards use the `card` token, card shadow and 16px grid gaps. Comparison cards use `route-card` and show direct/protected meanings side by side; unmeasured values stay muted. Card notes use the pale surface with smaller corners. Field/value lists wrap long identifiers. Preserve readable result and exposure text outside the stage.

### Inputs / Fields

The offline scenario selector is a native select: a pale lavender surface, inset strong divider, smaller corners and a 44px minimum height, with room for an inline chevron. Switches use a 44×26px track, a 20px white thumb and an extended 44px-high hit area. Checked private mode is purple; checked leak injection is red. Names and help text remain associated with the control. There is no general text-input component to infer from this select.

### Navigation

The white pill contains “The lab” and “Evidence”. Its current-location fill is pale purple; hover uses the pale surface. [Header.tsx](src/components/Header.tsx) updates the current section as the evidence section passes 45% of the viewport. The header shows “Live network” with “Try offline”, or “Simulated data” with “Go live”; switching modes follows an explicit link. The brand retains the original Monolith mark. Mobile keeps both section links available.

### Guided Steps and Route Stage

Guide rows have a minimum height of 48px. The current step gets a white surface, float shadow and dark number marker; completed markers become green with an icon. Preserve labels and state text rather than relying on their color alone.

The original dark route stage has a desktop minimum height of 410px, bright labels, readable HUD text and explicit direct/private routes. Its drawn path and hop geometry are illustrative, never measured traffic credit. Clickable endpoint and transport labels remain accessible controls. When WebGL2 is unavailable, the SVG schematic preserves route controls and state; text panels carry the same information. Payment geometry remains hidden while the feature is disabled.

The historical MN-006 fixture walkthrough still shows a direct control, protected fixture read, bypass/repair and managed outage. A bypass can continue during that outage, which the guide and checks disclose. Receipt payloads expose a transaction hash; balance payloads expose an address. In that offline mode route origins, timings, registry entries and checks remain SIMULATED, coverage is unmeasured, payment is disabled and no action contacts the observer, Arkiv or an RPC endpoint. The shared worker/method/error vocabulary continues to use public `@monolith/shared` exports. Live composition supplies actual controller state under the same visual system; the selected live-mode badge alone is not proof of a successful run.

## Do's and Don'ts

### Do:

- **Do** preserve the lavender ground, white working surfaces and contained original dark route stage.
- **Do** keep the next primary action visible and give secondary evidence a readable hierarchy.
- **Do** pair meaning colors with text or icons and preserve explicit mode and result provenance.
- **Do** retain self-hosted fonts, keyboard focus, reduced motion and the SVG/text fallback.
- **Do** show both route protection and the payload information the endpoint can still read.

### Don't:

- **Don't** treat a live-mode label, route animation or presentation screenshot as observed anonymity evidence.
- **Don't** turn unavailable or unmeasured results into green success, full coverage or a fabricated score.
- **Don't** hide a direct bypass when a managed read fails closed during an outage.
- **Don't** depict payment as anonymous or activate it from visual styling alone.
- **Don't** copy another product's mascot, mark or visual assets into the original Monolith stage.
