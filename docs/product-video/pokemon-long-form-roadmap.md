# Pokemon Long-Form Video Roadmap

## Goal

Build original, repeatable Pokemon watch-page videos without changing the established Shorts planners, renderers, template weights, or night-shift backlog.

The first production target is a retention-focused mixed Pokemon challenge compilation. The first Ultimate Quiz previews proved the native 16:9 pipeline; V1.2 now reuses the complete behavior of the established Short templates through isolated landscape adapters.

## Guardrails

- Long-form uses `content_format: long_form` and `content_surface: youtube_watch`.
- Long-form templates live under the `pokemon.long.*` namespace.
- Long-form is manual-generation and manual-review only until retention data supports automation.
- Never add a long-form template to the existing Shorts template-weight or night-shift pool.
- Shorts-only related-video automation is disabled for watch-page publications.
- A long-form render must use a 16:9 media profile and landscape-eligible backgrounds.
- Planning resolves all random choices before rendering so a seed reproduces the same episode.
- Each generated episode must vary materially in subjects, round order, background program, music program, and supported prompt variants.
- Reuse Pokemon data, approved media, TTS, cries, sound effects, animation primitives, publication storage, and review workflow.
- Long-form sections call the original Short planners and renderers with cloned 16:9 template layouts. Never mutate or render the production 9:16 template JSON as landscape.
- Assemble native 16:9 sections only; never concatenate already-rendered 9:16 Shorts.

## V1.2: Mixed Landscape Challenge Compilation

Status: implementation complete; first nine-template landscape preview pending review

The episode renders one native landscape edition of every existing Pokemon Short template except Tournament:

1. Dual Type Reveal
2. Find the Shiny
3. Know Your Shiny
4. Progressive Reveal
5. Stat Clash
6. Build Your Team
7. Memory
8. Type Quiz
9. Cry Match

Section order, Pokemon, backgrounds, music, and supported variants remain seeded and dynamic. Tournament stays excluded until its bracket layout receives a dedicated landscape design.

V1 presentation requirements:

- Native 1920x1080 output at 30 fps
- Landscape-only backgrounds rotate between sections
- Every section keeps its original music, SFX, narration, cries, GIF/sprite fallback, overlays, timers, HP bars, soundbars, grids, reveals, and transitions
- Full-range background roaming uses continuous sinusoidal motion, blur 6, and no darkening or color/contrast adjustment
- No watermark in this long-form format
- Manual upload as an unlisted YouTube watch-page preview
- Discord review card in the selected channel's existing review thread

## V1 Refinement Checklist

- [ ] Review the first full preview for pacing and legibility on desktop and mobile.
- [x] Add isolated 1920x1080 layout adapters for all nine supported Short templates.
- [x] Reuse the original planner and renderer contract for each landscape section.
- [x] Keep Tournament out of the compilation.
- [x] Replace the sharp triangle-wave background scan with continuously eased motion.
- [x] Preserve the production 9:16 templates and their default watermark behavior.
- [x] Tune the core question loop to 5 seconds guessing plus a 1-second reveal.
- [x] Prefer animated Pokemon GIFs and fall back to static sprites only when unavailable.
- [x] Adapt the dual-type Short's icon, Pokeball-grid, and reveal animations to native 16:9.
- [x] Remove the long-form watermark and background darkening; use blur 6 instead.
- [ ] Add new retention-focused sections to build the approved core loop back toward eight minutes.
- [ ] Confirm music transitions and narration/music balance.
- [x] Enforce landscape dimensions before selection; the first live scan found 11 eligible backgrounds.
- [ ] Confirm the selected backgrounds remain sharp and composed well after cover cropping.
- [ ] Confirm all question modes are understandable without narration on every round.
- [ ] Add or replace weak question modes based on viewer experience.
- [ ] Add custom 16:9 thumbnail generation and upload.
- [ ] Add playlist assignment for approved long-form publications.
- [ ] Split long-form analytics from Shorts analytics.
- [ ] Record average view duration, average percentage viewed, impressions, CTR, and subscriber gain.

## Future Episode Formats

Recommended order after V1:

1. Higher or Lower
2. Stat Battle
3. Increasing Clues
4. Tournament bracket
5. Pokemon Bingo

Lives mode should be an Ultimate Quiz ruleset. Which Came First should be a Higher-or-Lower mode rather than a separate rendering foundation.

## Automation Exit Criteria

Do not enable long-form night shift until all of the following are true:

- At least three manually reviewed episodes have rendered and uploaded successfully.
- The asset catalogue reliably identifies landscape backgrounds and approved music.
- Long-form publications are excluded from Shorts-only related-video and scheduling behavior.
- Analytics can report long-form separately.
- A failed render can be resumed or regenerated deterministically from its saved plan.
- The operator has approved the first template's pacing and visual quality.

When enabled, long-form replenishment must have its own per-channel target and cadence, initially no more than one episode per channel per week.

## Decision Log

- 2026-09-16: Chose a native long-form engine instead of concatenating existing Shorts.
- 2026-09-16: Chose an 8–9 minute V1 target to optimize for retention before expanding duration.
- 2026-09-16: Chose Ultimate Pokemon Quiz as the first production format.
- 2026-09-16: Kept long-form manual-only and isolated from the existing Shorts pools.
- 2026-09-16: Generated the first 487-second Poke Quizz preview with seed `ultimate-quiz-v1-preview-20260916`; review task `TASK-ORION-PQ-PUBLISH-20260916141505-D3B739A8D6E7`.
- 2026-09-16: Shortened V1.1 to a 5-second guess and 1-second reveal, reused the dual-type grid language, removed the watermark, and changed background treatment to blur-only full-range scanning.
- 2026-09-17: Replaced the simplified quiz-only direction with native 16:9 editions of all existing Pokemon Short templates except Tournament.
- 2026-09-17: Kept the original planners and renderers as the behavior source, added cloned landscape-only layout adapters, and assembled their 16:9 outputs into one watch-page video.
- 2026-09-17: Changed background roaming to continuous sinusoidal motion so direction changes remain smooth to the eye.
