# Site Structure — v2 (Editorial Publication)

Nine sections, in this order, all in `src/App.jsx`. Every section lives on the `paper` background — do not switch palette.

Container: `max-w-editorial mx-auto px-6 sm:px-12 lg:px-24` unless the section is full-bleed (marquee, feature-split images, CTA banner).

---

## 1. Masthead Nav

Thin editorial top bar — NOT a pill. Fixed at top; on scroll > 40px shrinks height by ~30% and gains a `bg-paper/95 backdrop-blur-sm` panel with a `border-b border-rule`.

Layout: 3-column flex.
- **Left**: brand slab — small monogram box (24×24, `border border-ink`) + serif brand name in `text-lg font-medium`.
- **Center**: 4 nav links in **mono** `text-[11px] uppercase tracking-[0.28em] text-ink/70 hover:text-ink`.
- **Right**: single "Start a conversation" link — serif italic with a small arrow. No button, no pill.

Mobile (`< lg`): brand + hamburger. Drawer opens full-height paper panel with nav links in serif at `text-3xl`.

## 2. Editorial Hero

Full-viewport (`min-h-[100dvh]`) 12-col asymmetric layout.

```
┌──────────────────────────────────────────────────────┐
│ [MONO EYEBROW] ╱ Amsterdam · Since 2013              │
│                                                      │
│                                                      │
│  Recruitment                        ┌──────────────┐ │
│  is all about                       │              │ │
│  your future.                       │  PORTRAIT    │ │
│                                     │  PHOTO       │ │
│  ─── italic lede ───                │              │ │
│                                     └──────────────┘ │
│                                     Fig. 01 — caption│
│                                                      │
├──────────────────────────────────────────────────────┤
│  [SPLIT-FLAP MASTHEAD WIDGET · byline row]           │
└──────────────────────────────────────────────────────┘
```

- Left content: cols 1–7. Contains eyebrow → hero title (3 lines) → serif italic lede paragraph.
- Right image: cols 8–12. Portrait-oriented aspect ratio (2:3 or 3:4). Below the image: an editorial caption (`Fig. 01 — [description] · Photograph`).
- Bottom byline row: full-width. Border-top `border-t border-rule`. Contains the split-flap masthead widget centered.

Reveal: fade-in-up staggered on all six children (eyebrow, 3 title lines, lede, image, caption) with 0.08s stagger, `power2.out`, `duration: 0.9`.

## 3. Marquee Band

Full-bleed. Height 48px. `bg-paper`, `border-y border-rule`.

Content: a long horizontal strip of one-word service tokens separated by `●`. Wrap in a `translateX(-50%)` animation over 40s linear infinite. Duplicate the token list so the loop is seamless.

Font: `font-mono text-[13px] uppercase tracking-[0.32em] text-ink/75`.

On hover on the parent: animation-direction reverses.

## 4. Manifesto

`py-32 sm:py-48` centered. Max-width 900px.

Structure:
- Small mono eyebrow (`╱ Manifesto`)
- Massive serif italic quote (see design-system type scale)
- One accent-colored word inside the quote gets an **animated SVG underline** drawn on scroll-into-view (`stroke-dashoffset` 100→0 over 1.4s)

Example markup pattern:
```jsx
<h2 className="font-display italic text-[clamp(48px,6vw,96px)] leading-[1.05] text-ink text-balance">
  We treat every candidate as a colleague. Every brief as a
  <span className="relative inline-block">
    conversation
    <svg className="absolute left-0 -bottom-2 w-full" viewBox="0 0 200 8">
      <path d="M 4 4 Q 100 -2 196 4" fill="none" stroke="var(--accent)" strokeWidth="2" pathLength="1"
            className="underline-path" />
    </svg>
  </span>
  — not a transaction.
</h2>
```

The `.underline-path` CSS has `stroke-dasharray: 1; stroke-dashoffset: 1;` initially and transitions to `0` when the section's IntersectionObserver fires.

## 5. Feature Splits (3 alternating)

Three sections stacked. Each is a 12-col row (`grid-cols-12 gap-6`), full-width outer, `py-32 sm:py-48` between them.

Odd rows: image cols 1–6, content cols 8–12.
Even rows: content cols 1–5, image cols 7–12.

Content pattern per block:
- Serif number top: `Feature 01` in `text-muted font-mono text-[11px] uppercase tracking-wide28`
- Serif heading: `text-[clamp(28px,3.5vw,44px)] font-semibold`
- Serif italic sub: `text-2xl italic text-muted`
- Serif body paragraph (2–4 lines): `text-base leading-[1.6]`
- Mono meta line at bottom: `font-mono text-[11px] uppercase tracking-wide28 text-muted`

Image pattern:
- `aspect-[4/5]` container with `overflow-hidden`
- `<img>` with `object-cover`, `data-parallax` attribute
- Below (or overlaid at the bottom with a paper band): editorial caption `Fig. 0X — ...`

Parallax: on scroll, image `translateY(-40px)` and text `translateY(+16px)` between scroll positions 0 and 100vh of the section (`gsap.to(...)` with `ScrollTrigger` `scrub: true`).

## 6. Index (Services)

A numbered **vertical list**, not a grid. Full-width inside container. Hairlines between rows.

Header:
- Mono eyebrow (`╱ Index`)
- Section head (`Services`) in serif

Rows: 6 items. Each row is a grid: `grid-cols-[80px_1fr_auto]` with:
- Left: big serif number (`I. II. III.` or `01 02 03`) at `text-3xl text-muted`
- Middle: serif title on line 1, serif italic sub on line 2
- Right: a mono chevron / arrow (`↗` in mono, `text-muted`)

Row hover:
- Background lightens by 2% (`bg-ink/[0.02]`)
- Under the title: an accent-colored line draws L→R over 0.4s (use pseudo-element or SVG path)
- The chevron rotates 45° or slides right by 4px

Do NOT use icons in the left slot. This is a magazine contents page, not an icon grid.

## 7. Testimonial

Centered pull-quote spread. `py-32 sm:py-48`. Max-width 1000px.

- Optional small portrait at left (aspect square, 120px), cropped tight
- Or a giant serif opening quotation mark `"` at 8rem in muted
- The quote itself: serif italic, `text-[clamp(28px,3vw,42px)] leading-[1.35]`
- Below the quote: separator (14px accent-colored dot), then in mono the attribution: `NAME · ROLE · FIRM`

Reveal: fade-in-up on scroll.

## 8. CTA Banner

Full-bleed section. Height `min-h-[70vh]`.

- Background: full-bleed `<img>` with a subtle `filter: grayscale(0.15) contrast(0.98)`.
- Overlay: a **centered paper-color horizontal band** — `bg-paper` at `w-[min(720px,90%)]`, `py-16 px-12`, hairline border top+bottom in accent color.
- Inside the band:
  - Mono eyebrow (`╱ Begin`)
  - Serif italic prompt (`text-[clamp(28px,3.5vw,48px)]`) — one sentence
  - Single CTA link (see design-system CTA component)

Reveal: fade-in on scroll.

## 9. Colophon Footer

Editorial colophon on paper. Border-top hairline. `pt-24 pb-12`.

Grid: 4 columns on desktop (`lg:grid-cols-4`), stacks to single column at 375.

Column 1 — **Masthead**: brand monogram + serif brand name + editorial byline in italic + small split-flap widget (echo). Copy: 2 sentences about the firm.

Column 2 — **Contact**: phone (mono), email (mono), address (serif).

Column 3 — **Index**: 4 service links in serif italic.

Column 4 — **Social + Legal**: LinkedIn / Email / any social. Then Privacy / Terms / Colophon links.

Bottom row across all columns: full-width closing line in mono uppercase center-aligned:
`Set in Instrument Serif · Published in <CITY> · MMXXVI · <COMPANY NAME>`

Directly below: hairline, then copyright `© 2026 Company Name` in mono at 11px, left-aligned.

---

## App root

```jsx
<div className="relative bg-paper text-ink font-serif antialiased selection:bg-accent selection:text-paper">
  <MastheadNav />
  <main>
    <EditorialHero />
    <MarqueeBand />
    <Manifesto />
    <FeatureSplits />
    <Index />
    <Testimonial />
    <CTABanner />
  </main>
  <ColophonFooter />
</div>
```

Register ScrollTrigger. On mount, `ScrollTrigger.refresh()` after 200ms and again after 1000ms so images loading doesn't offset the parallax start positions.
