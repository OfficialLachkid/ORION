# Video Template Migration

## Goal

Move the current Pokemon short generator from a channel-owned implementation to a reusable ownership model:

- channel config chooses publication target and style
- program config chooses the active template pool
- template config describes the gameplay contract
- Pokemon-domain logic lives outside the channel folder

## What This First Slice Does

- keeps the existing dual-type reveal flow fully intact
- introduces `config/channels/`, `config/programs/`, `config/style-packs/`, and `config/templates/`
- moves the dual-type planner under `src/domains/pokemon/templates/dual-type-reveal/`
- keeps the old planner import path as a compatibility facade
- moves the dual-type renderer contract under `src/domains/pokemon/templates/dual-type-reveal/renderer.mjs`
- keeps `src/poke-quizz-renderer.mjs` as the stable compatibility facade
- makes the current Poke Quizz scripts resolve defaults through the new channel/program/style/template stack

## What It Deliberately Does Not Do Yet

- no new templates
- no universal template DSL
- no attempt to make every mechanic combinable with every other mechanic
- no publication workflow rewrite
- no renderer rewrite into a fully generic engine yet

## Next Recommended Slices

1. Lift more copy/layout metadata from Poke Quizz-specific code into the style pack where it belongs.
2. Normalize naming so `poke-quizz-*` service files become channel facades over generic Pokemon template flows.
3. Add a second template only after the current dual-type flow is fully stable under the new ownership model.
