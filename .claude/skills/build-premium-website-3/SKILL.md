---
name: build-premium-website-3
description: Build a premium, cinematic marketing website (React + Vite + Tailwind + GSAP) with a spatial showroom layout, layered scene transitions, and a signature animated signal-map motif. Use when the user asks for the v3 layout, a cinematic website, a showroom-style website, a spatial premium landing page, or explicitly says /build-premium-website-3.
argument-hint: [business name or industry, optional]
---

# Build Premium Website - v3 (Cinematic Showroom)

You are an expert at building high-end, cinematic, single-page marketing websites (React 19 + Vite + Tailwind CSS + GSAP). Your job is to gather business context, then scaffold a complete, responsive, production-quality site whose visual language feels like a **premium showroom or spatial brand presentation**.

This is **v3**, not v1 or v2.

- `build-premium-website` is dark, interactive, card-heavy, and centered around a reskinned particle or pipe signature.
- `build-premium-website-2` is paper-white, editorial, serif-led, and centered around the split-flap masthead.
- `build-premium-website-3` must feel like a cinematic brand environment: layered surfaces, restrained geometry, chapter-based storytelling, a signal-map signature, masked reveals, and a more spatial productized rhythm.

Do not mix those design systems.

Read reference files by path only when needed.

## Phase 1 - Intake (required before any code)

Use `AskUserQuestion` to gather business context. Do not skip. Batch into 3-4 rounds. See `~/.claude/skills/build-premium-website-3/reference/intake-questions.md`.

Collect at minimum:

- company name + short promise line
- industry / what they do in one sentence
- tone:
  - architectural-minimal
  - kinetic-modern
  - warm-premium
  - technical-confidence
- primary color + accent color, or auto-suggest from `reference/industry-themes.md`
- 5-7 services with one-line outcome descriptions
- contact info:
  - phone
  - email
  - city
  - hours
- 3 trust signals:
  - years
  - certifications
  - notable clients or projects
- 3 showcase or proof modules:
  - title
  - short summary
  - image search keywords
- one strong CTA outcome:
  - book call
  - request quote
  - schedule visit
  - start project
- language
- hero image search terms
- signal-map theme from `reference/industry-themes.md`

If the user gives short answers, fill sensible defaults and proceed. Intake is a quality gate, not a bottleneck.

## Phase 2 - Scaffold

Create the project in the repo's website sources directory. Default to `<repo>/websites/<slug>/` unless the user says otherwise.

```bash
cd <PROJECTS_DIR>
npm create vite@latest <slug> -- --template react
cd <slug>
npm install
npm install gsap lucide-react react-router-dom
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

Then apply the files described in `reference/tech-setup.md`:

- `tailwind.config.js`
- `postcss.config.js`
- `vite.config.js`
- `index.html`
- `src/index.css`
- `src/main.jsx`

Use the font stack from v3, not v1 or v2.

## Phase 3 - Build sections in order

Build `src/App.jsx` as a single file. Follow `reference/structure.md`.

The v3 site has **nine sections** in this order:

1. **Command Nav**
   - floating transparent nav
   - thin progress line
   - sticky on scroll
   - mobile drawer

2. **Scene Hero**
   - full viewport
   - layered background image with scrim and depth planes
   - oversized display heading
   - short outcome-focused lede
   - trust chips
   - right-side or bottom signal-map signature

3. **Proof Ribbon**
   - horizontal strip with metrics, client markers, or capabilities
   - slow motion or marquee-like drift
   - should feel quiet and premium, not noisy

4. **Perspective Split**
   - left: strategic copy block
   - right: sticky animated visual or secondary image stack
   - reveal masks on scroll

5. **Capability Stack**
   - 4 spotlight panels or accordion chapters
   - each panel explains one service cluster
   - active panel gets the accent glow or line treatment

6. **Showcase Frames**
   - 3 showcase modules
   - browser frame, device frame, or spatial card shell
   - each one demonstrates proof, not generic placeholders

7. **Process Timeline**
   - 3 or 4 steps
   - line-draw animation
   - sticky chapter indicator or active-step marker while scrolling

8. **Trust Matrix**
   - credentials, testimonial, and practical reassurance
   - combine one strong quote with a compact matrix of facts

9. **Contact Dock + Footer**
   - high-contrast CTA band
   - short form or direct contact block
   - structured footer with legal links

Use `lucide-react` icons sparingly. They belong in chips, utility labels, or service markers, not everywhere.

## Phase 4 - Signature animation

The v3 signature is the **signal-map**.

This is a horizontal or square SVG-based motion system made from:

- anchor nodes
- connecting paths
- a sweeping pulse
- one highlighted route
- industry-shaped markers or glyphs

Behavior:

- one pulse travels the route every 2.4s to 3.2s
- nodes brighten as the pulse passes
- one path can redraw on first reveal
- motion must stay elegant, not arcade-like

Adapt the signal-map to the industry using `reference/industry-themes.md`.

Examples:

- electrical: circuit path and spark nodes
- legal or finance: precise grid path and trust checkpoints
- hospitality: journey route and destination pins
- construction: site-plan route and structural markers

Placement:

- primary in the Scene Hero
- optional smaller echo in the Process Timeline or Footer

Do not overuse it.

## Phase 5 - Polish and verify

- run `npm run dev`
- open `http://localhost:5173` in `playwright-cli`
- verify at `375`, `768`, and `1440`
- confirm:
  - hero entrance stagger works
  - signal-map pulse loops cleanly
  - reveal masks trigger on scroll
  - capability stack interactions work
  - timeline line-draw works
  - CTA/footer remain readable on mobile
- check console for errors
- report the local URL

## Critical rules

1. Always run Phase 1 intake first.
2. Do not mix v1, v2, and v3 systems.
3. The v3 site must feel spatial and cinematic, not editorial and not generic SaaS.
4. Keep the palette restrained.
   - one primary
   - one accent
   - one deep surface color
5. Use real imagery.
6. Build all 9 sections by default unless the user explicitly removes one.
7. The signal-map is the signature and must be reskinned by industry.
8. Scroll reveal and motion should feel deliberate, not constant.
9. Mobile-first still applies. The scene hierarchy must survive at `375px`.
10. Do not write README or docs unless asked.

## Reference files

- `~/.claude/skills/build-premium-website-3/reference/intake-questions.md`
- `~/.claude/skills/build-premium-website-3/reference/structure.md`
- `~/.claude/skills/build-premium-website-3/reference/tech-setup.md`
- `~/.claude/skills/build-premium-website-3/reference/design-system.md`
- `~/.claude/skills/build-premium-website-3/reference/animations.md`
- `~/.claude/skills/build-premium-website-3/reference/industry-themes.md`
- `~/.claude/skills/build-premium-website-3/reference/code-snippets.md`
- `~/.claude/skills/build-premium-website-3/reference/visual-examples.md`

## Final note

Use `$ARGUMENTS` as the starting hint. Begin intake immediately, then scaffold and build the site in the v3 system without drifting back into v1 or v2 patterns.
