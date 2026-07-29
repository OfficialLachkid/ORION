# Animations

## Hero entrance

Use GSAP stagger for:

- eyebrow
- heading lines
- lede
- chip row
- CTA group
- signal-map container

Suggested timing:

- y: `24`
- opacity: `0 -> 1`
- stagger: `0.08`
- ease: `power3.out`

## Signal-map

Core pieces:

- base path
- active route path
- node circles
- pulse indicator

Behaviors:

- active route draws in on first reveal
- pulse travels on a motion path or timed translation
- nodes brighten briefly as pulse passes
- loop every `2.4s` to `3.2s`

## Reveal masks

Use clipped image or panel reveals for:

- Perspective Split
- Showcase Frames
- CTA image transitions

Avoid revealing everything the same way.

## Capability stack

When the active panel changes:

- opacity shift
- subtle vertical translation
- accent line expansion

## Timeline

Structure it as **two stacked rows**, not one overlapping layer:

- **Row 1 — Marker rail** (desktop only, `hidden lg:block`)
  - a thin horizontal hairline (`h-px`, `bg-line`)
  - an accent-colored line on top of it that scales from `scaleX(0)` → `scaleX(1)` in ~1.8s on scroll
  - a `grid grid-cols-N` overlay where N = number of steps, each cell contains one small marker dot (ring + fill) vertically centered on the rail and horizontally aligned to the LEFT of its cell so it sits directly above the corresponding step content column
  - markers fade + scale in staggered by ~180ms starting at ~400ms after the rail begins drawing
  - give this row a fixed height (`h-4`) and a bottom margin (`mb-8` or `mb-10`) so it never overlaps the content

- **Row 2 — Content grid** (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-N gap-8`)
  - each step is just: mono "Step 0X" eyebrow, display title, muted body
  - do NOT put another dot inside each card — the rail row already owns the marker

Mobile: the rail is hidden; steps stack vertically with just their eyebrow + title + body.

Anti-pattern to avoid:
- absolute-positioning a full-width SVG line inside a `relative` wrapper AND also placing a `-top-4` dot inside each card. The SVG then crosses the card content and the dots don't align to the rail. Use the two-row structure above instead.
