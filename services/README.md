# Services Runtime Spine

## Goal

Provide the smallest runtime shape that makes Discord-driven orchestration and Ruflo learning operational.

## Phase-1 Flow

1. `discord-bot` listens to `#commands`, `#voice-commands`, and `#approvals`.
2. `transcription-worker` converts uploaded audio into transcript text and metadata.
3. `task-router` turns text or transcript input into a normalized task and approval decision.
4. Ruflo session wrappers retrieve patterns before execution and store durable outcomes after execution.
5. Human-facing updates are posted back into `#parsed-tasks`, `#task-queue`, `#approvals`, `#alerts`, and `#daily-summary`.

## Services

- `discord-bot`: Discord gateway, validation, acknowledgments, and event publishing.
- `transcription-worker`: audio download, normalization, transcription, and confidence metadata.
- `task-router`: task normalization, approval gating, queue state, and memory write-back preparation.

## Supporting Config

- `config/discord/.env.example`
- `config/discord/channel-map.example.json`
- `config/discord/approval-rules.example.json`
- `config/runtime/memory-namespaces.json`
- `config/supabase/.env.example`

## Supporting Scripts

- `scripts/session-start.mjs`
- `scripts/session-checkpoint.mjs`
- `scripts/session-end.mjs`
- `scripts/session-restore.mjs`
- `scripts/sync-vault.mjs`

Windows compatibility shims remain available:

- `scripts/session-start.ps1`
- `scripts/session-end.ps1`
- `scripts/sync-vault.ps1`

## Phase-1 Constraint

This is a runtime skeleton, not the finished Discord product.

The next implementation step is to build one narrow end-to-end workflow on top of this shape:

- command or voice note intake
- task parsing
- approval gate
- execution
- memory write-back

## Current Narrow Workflow

The repo now includes a text-first validation path for the first phase-1 workflow:

- `services/discord-bot/index.mjs`
- `services/task-router/index.mjs`
- `services/transcription-worker/index.mjs`

Use the example payloads under `services/discord-bot/examples/` to validate:

- command intake from `#commands`
- approval parsing from `#approvals`
- voice-note intake contract from `#voice-commands`

The transcription worker now has a real local `faster-whisper` path, but still needs Mac-side dependency install and a live uploaded-voice-note validation.

That is intentional: phase 1 proves the routing and approval spine first, then replaces the voice stub with the real local `faster-whisper` path on the Mac.
