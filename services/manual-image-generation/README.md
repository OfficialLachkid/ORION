# ORION Manual Image Generation

Issue #222 adds an operator-only `/generate-image` command to the live Discord bot. The command acknowledges immediately, writes a durable job to the Samsung T7, and starts one detached queue worker. The worker uses local Ollama planning plus the existing local Flux image adapter, then replaces the originating Discord status message with the generated attachments.

No cloud image API is used and the recorded API cost is always EUR 0. The Mac still consumes local compute, electricity, and disk space.

## Discord command

```text
/generate-image prompt:<required> count:<optional 1-8> aspect_ratio:<optional>
```

Supported aspect ratios are `1:1`, `16:9`, `9:16`, `3:2`, and `2:3`.

- With an explicit `count`, that number is authoritative. Local planning may decompose the request, but a deterministic same-prompt fallback remains available if the text model is unavailable.
- Without `count`, local `llama3.1:8b` must infer the smallest useful set. It may return a clarification instead of spending a Flux call.
- Prompts that request transparency are rendered against a flat chroma background and converted to transparent PNG with border-connected spill cleanup plus bounded global chroma cleanup. This matches the production asset processor and clears key-colored negative spaces such as trigger guards and gaps between limbs while retaining subject colors outside the configured key tolerance.

The bot finds or creates `#manual-image-generation` under `DIGITAL ASSETS`. The command can still be invoked from another channel; progress and results stay in that originating channel and mention the requesting operator.

## Queue and storage

The default scratch root is a sibling of the permanent product archive:

```text
/Volumes/T7/O.R.I.O.N. Manual Image Jobs/
  jobs/<job-id>/
    job.json
    plan.json
    outputs/               # temporary image bytes
```

`DIGITAL_ASSET_ARCHIVE_ROOT` must already exist. ORION refuses to create the scratch root when that T7-backed product root is unavailable, preventing accidental writes to an unmounted `/Volumes/T7` directory.

Each `job.json` contains an immutable request hash, the structured decomposition, per-image seed and SHA-256, progress, delivery receipt, attempts, and any failure. Requests are idempotent by Discord interaction ID.

The worker and the Digital Asset Engine share the same generation lock. It also checks Ollama for a conflicting loaded model, so manual work waits instead of overlapping asset generation, video work, lead generation, or another local inference job.

## Delivery and cleanup

The public status message is edited after planning and after each completed image. Successful delivery is a Discord multipart `PATCH` against that same message, which makes retries idempotent at the message level.

Only after Discord confirms the attachment response does ORION:

1. store the Discord message and attachment receipt;
2. mark delivery durable;
3. delete the local `outputs/` directory;
4. retain the small `job.json` and `plan.json` audit records.

Generation failures retain completed files for diagnosis. Delivery failures retain the complete image set for bounded retry. Startup recovery requeues interrupted work. A six-hour cleanup sweep removes undelivered scratch bytes after the configurable seven-day default TTL and marks the job abandoned.

## Configuration

Optional environment variables are documented in `config/discord/.env.example`. The useful overrides are:

- `MANUAL_IMAGE_GENERATION_ROOT`
- `MANUAL_IMAGE_PLANNER_MODEL`
- `MANUAL_IMAGE_MODEL` (defaults to `DIGITAL_ASSET_IMAGE_MODEL`, then `x/flux2-klein:4b`)
- `MANUAL_IMAGE_MAX_COUNT`
- `MANUAL_IMAGE_MAX_QUEUE_DEPTH`
- `MANUAL_IMAGE_MAX_ATTACHMENT_BYTES`
- `MANUAL_IMAGE_MAX_DELIVERY_ATTEMPTS`
- `MANUAL_IMAGE_ABANDONED_TTL_HOURS`
- `MANUAL_IMAGE_CLEANUP_INTERVAL_HOURS`

The separate `MANUAL_IMAGE_MODEL` override permits controlled model comparisons without changing the production Digital Asset Engine model. Keep a candidate out of production until its output quality, peak unified-memory use, latency, and commercial license have all been verified with representative ORION prompts.

Register the new guild command after deployment:

```bash
npm run discord:register-commands
```

Run focused tests with:

```bash
npm run manual-images:test
npm run test:discord-spine
```

## Local model benchmark

Compare two installed local image models under the same production controls:

```bash
npm run manual-images:benchmark
```

Use the controlled photorealistic profile to compare the same camera scene, seed,
resolution, steps, and realism-specific negative prompt across both configured
models. This profile retains its complete photographic environment and does not
run chroma-key transparency processing:

```bash
npm run manual-images:benchmark -- --profile photorealistic
```

The default comparison is `x/flux2-klein:4b` against `x/flux2-klein:4b-fp8`. Two difficult fixtures are generated with identical per-fixture prompts, seeds, dimensions, steps, and negative prompt. Model order is counterbalanced across the fixtures. The shared generation lock prevents overlap with another ORION generation job.

Raw images, processed output, timings, hashes, and transparency diagnostics are retained under the T7 manual-image benchmark directory. The existing message in `#manual-image-generation` is updated with every labeled output and its timing results.
