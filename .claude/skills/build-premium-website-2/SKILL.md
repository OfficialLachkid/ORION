---
name: build-premium-website-2
description: Build a premium, editorial-style marketing website (React + Vite + Tailwind + GSAP) with an all-serif, magazine-inspired layout. Use when the user asks for the "v2 layout", "editorial layout", "magazine style website", or explicitly says `/build-premium-website-2`. Adapts palette accent, copy, services, and the signature split-flap masthead to the industry.
argument-hint: [business name or industry, optional]
---

# Build Premium Website — v2 (Editorial Publication)

You are an expert at building high-end, editorial-style single-page marketing websites (React 19 + Vite + Tailwind CSS + GSAP). Your job is to gather business context, then scaffold a complete, responsive, production-quality site whose visual language is a **magazine editorial** — not a tech marketing site.

**This is v2, not v1.** The `/build-premium-website` skill produces a dark-hero, sans-display, interactive-cards, sticky-stack, gold-flourish look. v2 is deliberately different: paper-white throughout, all-serif typography, editorial split-blocks, a numbered index of services, a manifesto pull-quote, and a split-flap masthead as the signature animation. Do not mix the two systems.

This skill is fully self-contained. Read reference files by path only when you need the exact pattern for a section.

## Phase 1 — Intake (REQUIRED before any code)

Use `AskUserQuestion` to gather business context. Do not skip. Batch into 3–4 rounds. See `~/.claude/skills/build-premium-website-2/reference/intake-questions.md`.

Collect at minimum:
- Company name + editorial byline (a 3–6 word phrase used under the masthead — like a magazine tagline)
- Industry / what they do (one sentence)
- Editorial tone (measured-classical, contemporary-restrained, warm-humanist, sharp-modern) — see `design-system.md`
- Single accent color (or auto-suggest from `industry-themes.md`)
- 6 services (title + one-line editorial description each)
- Contact info (phone, email, city, hours)
- Featured client / testimonial (one strong quote if available; otherwise fabricate a plausible attributed pull-quote from the industry)
- 3 case-study / feature-block topics (title + short description + hero-image search keywords)
- Language

If the user gives short answers, fill in sensible defaults and proceed — the intake is a gate, not a bottleneck.

## Phase 2 — Scaffold

Create the project in the repo's website sources directory (default `<repo>/websites/<slug>/`):

```bash
cd <PROJECTS_DIR>
npm create vite@latest <slug> -- --template react
cd <slug>
npm install
npm install gsap lucide-react react-router-dom
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

Then drop in configs from `reference/tech-setup.md`:
- `tailwind.config.js` — substitute the single accent hex
- `postcss.config.js`
- `vite.config.js` (port 5173, autoOpen: false)
- `index.html` — Instrument Serif + Instrument Sans + JetBrains Mono
- `src/index.css` — copy from `reference/code-snippets.md`, substitute accent hex
- `src/main.jsx` — Router with `/` + `/colophon` (legal) route

## Phase 3 — Build sections in order

Build `src/App.jsx` as a single file. Follow `reference/structure.md`. **Nine sections, in this order:**

1. **Masthead nav** — thin editorial top bar (NOT a pill). Brand slab left, links center in mono, single CTA link right. Hairline border-bottom. On scroll: shrinks height by ~30% and becomes sticky with a paper backdrop. Mobile: hamburger drawer.

2. **Editorial Hero** — asymmetric 12-col: LEFT (cols 1–7) mono eyebrow + massive serif title (3 lines) + serif italic lede; RIGHT (cols 8–12) portrait photograph with an editorial caption underneath in mono. Full-width byline row across the bottom with the split-flap masthead widget.

3. **Marquee band** — full-bleed, thin (48px), horizontal ribbon of one-word services / keywords looping infinitely. Mono uppercase, separated by `●` dots. Reverses direction on hover.

4. **Manifesto** — a single centered pull quote spread across a full-viewport section. All-serif italic display, generous line-height. The accent color draws an animated underline beneath one keyword when the section scrolls into view (`stroke-dashoffset` animation over 1.4s).

5. **Feature Splits** — 3 alternating 12-col rows. Each row: image (cols 1–6 or 7–12, alternating) + content (cols 8–12 or 1–5). Each has a serif number ("Feature 01"), serif heading, serif italic sub, serif body paragraph, mono meta line. Parallax on scroll: image translates `-40px`, text translates `+16px` at 50% scroll depth.

6. **Index (Services)** — a numbered **table-of-contents-style vertical list**, NOT a grid. Each service is a row: big serif number in the left gutter, serif title + serif italic sub, then a mono chevron on the right. Hairline dividers. Hover: accent underline draws L→R under the title in 0.4s.

7. **Testimonial** — a single massive pull-quote spread. Opens with a giant serif italic `"`, then the quote in serif italic, cited author with role and firm below in mono. Optional small portrait at left.

8. **CTA Banner** — full-bleed hero image with a paper-color band (66% width, centered vertically) containing a serif italic prompt and a single primary CTA. Like a magazine full-page ad.

9. **Colophon Footer** — editorial colophon: 4 columns (Brand + editorial byline, Contact, Practice areas, Social + legal). A full-width closing line ("Set in Instrument Serif · Published in [City] · MMXXVI"). Copyright + Privacy/Terms links.

Use `lucide-react` icons **only in the CTA / marquee / footer social icons and the mono chevron in the Index rows** — never in decorative positions. Editorial pages don't need icons everywhere.

## Phase 4 — Signature animation

The v2 signature is the **split-flap masthead widget** (`reference/animations.md` §Split-flap). A small horizontal panel (h-14 sm:h-16) that mimics a train station / airport split-flap display. Shows 4 labeled columns of editorial masthead information (e.g., `VOL · XII`, `ISSUE · 04`, `SECTION · Practice`, `STATUS · Open for briefs`). Every ~2.3s one column's characters "flip" to reveal new values with a staggered per-character animation. Adapts to industry via label mapping in `reference/industry-themes.md`.

Placement:
- Primary: full-width byline row at the bottom of the Editorial Hero
- Echo: smaller variant on the left of the Colophon Footer

Never place it in more than these two spots. It is a signature, not a decoration.

## Phase 5 — Polish & verify

- `npm run dev` (background) → open `http://localhost:5173` in playwright-cli
- Screenshot at 1440 and 375. Confirm:
  - Hero renders with the split-flap flipping every ~2.3s
  - Marquee scrolls smoothly and reverses on hover
  - Manifesto underline draws when scrolled into view
  - Feature Splits parallax works
  - Services Index hover-underline animates L→R
  - Testimonial quote reads at the intended massive scale (min 4rem serif)
  - CTA banner: image + paper band + one CTA
  - Footer colophon: 4 cols → single col at 375
- Check console: zero errors.
- Report the local URL to the user.

## Critical rules

1. **Always run Phase 1 intake first.** Never scaffold before AskUserQuestion returns.
2. **Translate every string.** No copy from the reference / other industries leaks in.
3. **No dark inverse section.** The entire site lives on `paper` (off-white). Contrast comes from typography + photography, not palette shifts. This is a defining v2 choice — do not add dark sections.
4. **All display type is the same serif.** No sans-display. Body is also serif at smaller sizes. Mono is ONLY for captions, eyebrows, metadata, split-flap values, and legal.
5. **No pill nav.** The masthead is a thin editorial top bar.
6. **The split-flap is the signature.** Adapt its labels; keep the mechanism. Place it in exactly two spots (hero byline + footer echo).
7. **All 9 sections by default.** Only drop one if the user explicitly says so.
8. **Real photography, edge-to-edge.** Each Feature Split has a full-bleed image on its side; the Editorial Hero has a portrait-crop photo with a real caption; the CTA banner is full-bleed. No placeholder boxes. Use Unsplash URLs matching the user's search terms.
9. **Editorial captions.** Every hero image and every feature-split image has a mono caption line beneath it (or overlaid with a paper-color band) — like a magazine picture caption. Format: `Fig. 01 — [description] · Photograph by [Unsplash author or "N. Newman"]`.
10. **Grid discipline.** Strict 12-col layout, large outer margins (`px-6 sm:px-12 lg:px-24`), max width 1440px. Full-bleed sections can break out but headings stay in-grid.
11. **Don't write a README or docs** unless asked. Build the site.

## Reference files (read lazily as needed)

- `~/.claude/skills/build-premium-website-2/reference/intake-questions.md` — exact questions to ask
- `~/.claude/skills/build-premium-website-2/reference/structure.md` — section-by-section anatomy
- `~/.claude/skills/build-premium-website-2/reference/tech-setup.md` — package.json, configs, index.html
- `~/.claude/skills/build-premium-website-2/reference/design-system.md` — palette slots, typography, tone variants
- `~/.claude/skills/build-premium-website-2/reference/animations.md` — GSAP patterns, split-flap mechanism, marquee, underline-draw
- `~/.claude/skills/build-premium-website-2/reference/industry-themes.md` — split-flap label mapping + accent color per industry
- `~/.claude/skills/build-premium-website-2/reference/code-snippets.md` — index.css, key component skeletons
- `~/.claude/skills/build-premium-website-2/reference/visual-examples.md` — ASCII mockups + editorial checklist

## Final note

Use `` as a starting hint (e.g. `/build-premium-website-2 newman partners`). Begin Phase 1 immediately if no arguments, or pre-fill what was given and ask only for the rest.
