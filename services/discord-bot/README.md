# Discord Bot Service

## Purpose

Own the Discord gateway layer for phase 1.

## Responsibilities

- validate channel and operator access
- receive typed commands from `#commands`
- receive uploaded voice notes from `#voice-commands`
- receive approval decisions from `#approvals`
- acknowledge accepted work
- post human-facing events back to Discord

## Inputs

- Discord message events
- Discord attachment metadata
- task state updates from the task router
- alert and summary events from orchestration workflows

## Outputs

- parsed task previews in `#parsed-tasks`
- queue updates in `#task-queue`
- approval cards in `#approvals`
- alerts in `#alerts`
- daily rollups in `#daily-summary`

## Required Config

- `config/discord/.env.example`
- `config/discord/channel-map.example.json`
- `config/discord/approval-rules.example.json`
- `config/supabase/.env.example` for later backend-only database integration

## First Build Milestone

Deliver a bot that:

- accepts a text message in `#commands`
- validates the sender and channel
- emits a normalized task request to the task router
- posts a structured preview into `#parsed-tasks`

## Current Repo State

The phase-1 narrow workflow is implemented as a local runtime simulation at:

- `services/discord-bot/index.mjs`
- `services/discord-bot/src/intake.mjs`

Example payloads live under:

- `services/discord-bot/examples/command-message.example.json`
- `services/discord-bot/examples/approval-message.example.json`
- `services/discord-bot/examples/voice-message.example.json`

Validation path:

```bash
npm run discord:simulate -- --input-file services/discord-bot/examples/command-message.example.json
```
