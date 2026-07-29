# Transcription Worker

## Purpose

Convert uploaded voice notes into clean text plus confidence metadata for downstream task routing.

## Responsibilities

- download Discord audio attachments
- normalize supported audio formats
- run local transcription
- return transcript text, confidence, and basic timing metadata

## Preferred Phase-1 Stack

- Python
- `faster-whisper`

## Input Contract

- source message URL
- submitted by
- audio attachment path or download URL
- original filename
- content type

## Output Contract

- transcript
- confidence estimate
- warnings or fallback reason
- normalized attachment metadata

## Phase-1 Constraint

Support uploaded voice notes first.

Do not depend on live Discord voice-room streaming for the first working version.

## Current Repo State

The repo provides the transcription worker at:

- `services/transcription-worker/index.mjs`

It can:

- accept a voice-note request payload
- return a mock or provided transcript
- download a supported audio attachment
- invoke a local Python `faster-whisper` worker
- optionally emit word-level timestamps for O.R.I.O.N. ASS caption generation
- return transcript text, confidence, and attachment metadata
- return blocked or failed status when local transcription is unavailable or incomplete

Local Python entrypoint:

- `services/transcription-worker/local-transcribe.py`

Local Python requirements:

- `services/transcription-worker/requirements.txt`
