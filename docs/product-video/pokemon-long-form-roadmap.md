# Pokemon Long-Form Video Roadmap

## Goal

Build original, repeatable Pokemon watch-page videos without changing the established Shorts planners, renderers, template weights, or night-shift backlog.

The first production target is a retention-focused Ultimate Pokemon Quiz. The first preview proved the native 16:9 pipeline at 8:07; V1.1 intentionally shortens the round loop while richer sections are developed.

## Guardrails

- Long-form uses `content_format: long_form` and `content_surface: youtube_watch`.
- Long-form templates live under the `pokemon.long.*` namespace.
- Long-form is manual-generation and manual-review only until retention data supports automation.
- Never add a long-form template to the existing Shorts template-weight or night-shift pool.
- Shorts-only related-video automation is disabled for watch-page publications.
- A long-form render must use a 16:9 media profile and landscape-eligible backgrounds.
- Planning resolves all random choices before rendering so a seed reproduces the same episode.
- Each generated episode must vary materially in subjects, round order, background program, music program, and supported prompt variants.
- Reuse Pokemon data, approved media, TTS, cries, sound effects, animation primitives, publication storage, and review workflow. Do not concatenate rendered Shorts or reuse their 9:16 layouts.

## V1: Ultimate Pokemon Quiz

Status: first 8:07 preview reviewed; V1.1 visual and pacing refinement in progress

Current V1.1 runtime: approximately 3:07; new retention sections will be added after the core round loop is approved

Episode structure:

1. 12-second hook and rules
2. Easy chapter: 8 questions
3. Medium chapter: 8 questions
4. Hard chapter: 8 questions
5. 16-second score/result outro

Each question lasts 6 seconds: 5 seconds to guess and 1 second for the answer reveal. It uses one of the initial round modes:

- Silhouette: identify the Pokemon before the reveal.
- Type clue: identify the matching Pokemon from an animated dual-type grid adapted from the Short template.
- Cry clue: listen to the Pokemon cry before the reveal.

V1 presentation requirements:

- Native 1920x1080 output at 30 fps
- Three landscape backgrounds selected before render
- Three background-music selections, changed at chapter boundaries
- Full-range background scanning at a tighter crop, blur 6, and chapter crossfades without darkening or color adjustment
- Persistent round/chapter progress and self-scored points
- Ding at the answer reveal, followed by the Pokemon cry where appropriate
- No watermark in this long-form format
- Manual upload as an unlisted YouTube watch-page preview
- Discord review card in the selected channel's existing review thread

## V1 Refinement Checklist

- [ ] Review the first full preview for pacing and legibility on desktop and mobile.
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
