# Design System — v2 (Editorial Publication)

## Color slots

Only 5 tokens. Substitute `<ACCENT>` per intake; keep the neutrals fixed.

| Token | Hex | Role |
|---|---|---|
| `paper` | `#F4F1EA` | Background — every section |
| `ink` | `#141414` | Headings + body text |
| `muted` | `#6C6A66` | Secondary text, captions, eyebrows |
| `rule` | `#D8D3C8` | Hairline dividers |
| `accent` | `<ACCENT>` | Single spot color — underlines, key metadata, CTA |

**Do not add a dark section token.** v2 has no dark inverse zones. The entire site lives on `paper`.

### Accent by industry (default suggestion — user can override)

See `industry-themes.md` for the full table. Common defaults:

| Industry | Accent |
|---|---|
| Finance / legal / recruitment | Ink blue `#1F3A5F` |
| Publishing / editorial / arts | Rust `#B45A3C` |
| Hospitality / wellness | Terracotta `#C56A4A` |
| Fashion / gallery | Charcoal `#2A2A2A` (near-black accent) |
| Advisory / consulting | Ochre `#B58A2E` |
| Real estate / architecture | Forest `#2F4A3A` |
| Beauty / spa | Burgundy `#7A2E2E` |

## Typography

The defining rule of v2: **all display + body copy is set in a single serif**. Sans is never used. Mono is only for captions, metadata, split-flap values, eyebrows, and legal.

### Fonts per tone

| Tone | Display / Body (same font) | Mono |
|---|---|---|
| Measured classical | `Fraunces` (opsz 9–144) | `JetBrains Mono` |
| Contemporary restrained (default) | `Instrument Serif` | `JetBrains Mono` |
| Warm humanist | `Libre Caslon Display` + `Libre Caslon Text` for body | `JetBrains Mono` |
| Sharp modern | `Playfair Display` | `JetBrains Mono` |

### Type scale (contemporary restrained, default)

| Role | Size | Line-height | Notes |
|---|---|---|---|
| Hero title | `clamp(48px, 8vw, 128px)` | `0.98` | 3 lines, tight tracking |
| Section head | `clamp(40px, 5vw, 72px)` | `1.02` |  |
| Manifesto quote | `clamp(48px, 6vw, 96px)` | `1.05` | Italic |
| Feature heading | `clamp(28px, 3.5vw, 44px)` | `1.1` |  |
| Body serif | `clamp(16px, 1.15vw, 19px)` | `1.55` |  |
| Small serif | `15px` | `1.55` | Case caption, small paragraph |
| Mono eyebrow | `11px` | `1` | uppercase, `letter-spacing: 0.28em` |
| Mono caption | `12px` | `1.4` | Under images |
| Split-flap character | `18px` | `1` | Fixed-width mono, weight 500 |

### Weights

Serif — 400 body, 500 italics, 600 for feature headings, 700 for hero title only. **Never bold everything.** Italics carry the "flourish" role.

### Kerning

- Hero title: `-0.02em`
- Section head: `-0.015em`
- Mono eyebrow: `+0.28em`
- Mono caption: `+0.14em`

## Grid

- 12 columns, `gap-6` (24px)
- Container `max-w-[1440px]` centered
- Outer padding: `px-6 sm:px-12 lg:px-24` (mobile → editorial-margin at desktop)
- Hairline vertical column guides can be toggled on demand — leave off for production.

## Motion vocabulary

Very restrained by design.

- `fade-in-up` — 24px + opacity, 0.9s `power2.out`. Used for section entries.
- `parallax-image` — image translateY `-40px`, text `+16px` over 100vh scroll. Feature splits only.
- `underline-draw` — `stroke-dashoffset` from 100% → 0 over 1.4s `power2.out`. Manifesto + Services Index hover.
- `marquee-loop` — `translateX(-50%)` over 40s linear infinite. Marquee band.
- `split-flap` — see `animations.md`. Hero signature.

No sticky-stack. No count-ups. No interactive cards. No floating particles. This restraint is the point.

## Components

### Rule (hairline divider)
```jsx
<div className="h-px bg-rule w-full" />
```

### Mono eyebrow
```jsx
<span className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
  ╱ Section label
</span>
```

### Editorial caption
Always in mono, prefixed with a figure number. Placed directly under an image, no gap.
```jsx
<p className="font-mono text-[12px] tracking-[0.14em] text-muted mt-3">
  Fig. 01 — Description of image · Photograph
</p>
```

### Primary CTA (single style, used sparingly)
```jsx
<a className="inline-flex items-center gap-2 border border-ink text-ink px-6 py-3 hover:bg-ink hover:text-paper transition-colors duration-500">
  <span className="font-serif italic">Read the brief</span>
  <ArrowUpRight className="h-4 w-4" />
</a>
```
No pills. No shadows. Sharp corners (or tiny 2px rounded at most). The CTA feels like a magazine link, not a marketing button.

### Split-flap masthead widget
See `animations.md`. Four columns, each a labelled dial with 6 flipping characters.
