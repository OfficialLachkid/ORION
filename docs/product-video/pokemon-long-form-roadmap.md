# Pokemon Long-Form Video Roadmap

## Goal

Build original, repeatable Pokemon watch-page videos without changing the established Shorts planners, renderers, template weights, or night-shift backlog.

The first production target is an 8–9 minute Ultimate Pokemon Quiz. Eight minutes is the minimum target, not padding: a planned episode may run slightly longer when narration or a final challenge benefits from it.

## Guardrails

- Long-form uses `content_format: long_form` and `content_surface: youtube_watch`.
- Long-form templates live under the `pokemon.long.*` namespace.
- Long-form is manual-generation and manual-review only until retention data supports automation.
- Never add a long-form template to the existing Shorts template-weight or night-shift pool.
- Shorts-only related-video automation is disabled for watch-page publications.
- A long-form render must use a 16:9 media profile and landscape-eligible backgrounds.
- Planning resolves all random choices before rendering so a seed reproduces the same episode.
- Each generated episode must vary materially in subjects, round order, background program, music program, and supported prompt variants.
- Reuse Pokemon data, approved media, TTS, cries, sound effects, watermarking, publication storage, and review workflow. Do not concatenate rendered Shorts or reuse their 9:16 layouts.

## V1: Ultimate Pokemon Quiz

Status: first 8:07 preview generated; awaiting visual and pacing review

Target runtime: approximately 8:07

Episode structure:

1. 12-second hook and rules
2. Easy chapter: 8 questions
3. Medium chapter: 8 questions
4. Hard chapter: 8 questions
5. 16-second score/result outro

Each question lasts 18.5 seconds and uses one of the initial round modes:

- Silhouette: identify the Pokemon before the reveal.
- Type clue: identify it from its type combination and silhouette.
- Cry clue: listen to the Pokemon cry before the reveal.

V1 presentation requirements:

- Native 1920x1080 output at 30 fps
- Three landscape backgrounds selected before render
- Three background-music selections, changed at chapter boundaries
- Background roaming and chapter crossfades
- Persistent round/chapter progress and self-scored points
- Ding at the answer reveal, followed by the Pokemon cry where appropriate
- Channel-aware watermark after the intro
- Manual upload as an unlisted YouTube watch-page preview
- Discord review card in the selected channel's existing review thread

## V1 Refinement Checklist

- [ ] Review the first full preview for pacing and legibility on desktop and mobile.
- [ ] Tune question time, reveal hold, hook length, and outro length while preserving at least eight minutes.
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
