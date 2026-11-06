# Monolith logo

The mark is an upright, faceted monolith with a broad angular cut suggesting a routed request. It follows the owner's selected geometric pillar and restrained violet direction. The owner supplied three reference images; the initial concept was generated with the built-in imagegen tool, then rebuilt as three flat SVG paths for consistent edges and solid colours. These files are the app-ready vector interpretation, rather than the original shaded raster.

## Assets

| Asset | Use |
| --- | --- |
| [Colour SVG](../../public/assets/brand/monolith-mark.svg) | Dashboard and light backgrounds |
| [Light SVG](../../public/assets/brand/monolith-mark-light.svg) | Dark backgrounds |
| [Monochrome SVG](../../public/assets/brand/monolith-mark-mono.svg) | Single-colour applications on light backgrounds |
| [Transparent PNG](../../public/assets/brand/monolith-mark.png) | 512 × 512 raster export with clear space |
| [Favicon SVG](../../public/assets/brand/favicon.svg) | Simplified mark on a lavender tile for small browser icons |
| [32px favicon](../../public/assets/brand/favicon-32.png) | PNG browser fallback |
| [Touch icon](../../public/assets/brand/apple-touch-icon.png) | 180 × 180 opaque launcher icon |

The full mark uses charcoal `#17151D`, violet `#8D6AB8`, and lavender `#B7A3D3`. The dark-background variant replaces the charcoal face with `#F0EBF8`. Backgrounds and the routing cut stay transparent. The favicon simplifies the routing cut into a wider seam so it survives small raster sizes; its light tile remains visible against dark browser chrome.

Keep the 1:2 mark aspect ratio. Reserve clear space of at least one quarter of its width on all sides, use the full mark at 28px height or larger, and use the simplified tile at 16–32px. Do not stretch, add shading, or fill the routing cut. The existing `Mark({ size })` component uses the canonical SVG with explicit dimensions and Vite's base URL. It remains decorative beside the visible Monolith name; standalone images need `alt="Monolith"`.

To reproduce the raster exports with ImageMagick 7, run from the repository root:

```sh
magick -background none -density 768 apps/dashboard/public/assets/brand/monolith-mark.svg -resize x440 -gravity center -extent 512x512 apps/dashboard/public/assets/brand/monolith-mark.png
magick -background none -density 384 apps/dashboard/public/assets/brand/favicon.svg -resize 32x32 apps/dashboard/public/assets/brand/favicon-32.png
magick -background '#F0EBF8' -density 384 apps/dashboard/public/assets/brand/favicon.svg -resize 180x180 -alpha remove -alpha off apps/dashboard/public/assets/brand/apple-touch-icon.png
```

The logo and all exported icons are local assets under `assets/brand/`, matching the existing static packager's `index.html` + `assets/**` distribution boundary. This change affects branding only and does not establish any live transport, privacy, registry, payment, hosting or sponsor outcome. The separate UI redesign remains under its existing owner review hold.
