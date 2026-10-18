# ORION Digital Asset Research

This service is the first bounded implementation slice of issue #149. It observes one public marketplace source, stores timestamped evidence, asks a local Ollama text model for a recommendation only after comparable history exists, and sends that recommendation to Discord for human review.

It does not generate images, create a release, or update itch.io. The guarded collection phase is owned by the existing night-shift orchestrator rather than a separate timer.

## Initial source and evidence limits

The initial adapter reads two public itch.io asset views from the same marketplace source:

- `newest-pixel-art` records visible supply activity;
- `top-sellers-pixel-art` records marketplace rank as a demand proxy.

The adapter does not claim competitor sales, revenue, purchase, or download counts. Raw HTML is retained on the T7 for auditability; Supabase stores compact observations and decisions. Requests are sequential, identify ORION with a user agent, fail closed on HTTP 429, and never access paths disallowed by itch.io's published robots policy.

The first snapshot is baseline-only. Discord receives a monitoring card without approval buttons. At least two snapshots are required before the local model can produce an evidence-backed recommendation.

## Setup

Apply `supabase/migrations/20261016_create_digital_asset_research_tables.sql`. These tables have RLS enabled and are service-role-only.

Run one manual collection on the Mac:

```bash
npm run digital-assets:research -- \
  --archive-root "/Volumes/T7/O.R.I.O.N. Digital Assets/research" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --post-to-discord
```

If marketplace collection succeeds but local recommendation generation fails validation, repair the
model contract and resume from the stored observations without creating an artificial extra snapshot:

```bash
npm run digital-assets:research:analyze -- \
  --archive-root "/Volumes/T7/O.R.I.O.N. Digital Assets/research" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --post-to-discord
```

The `analyze` command never requests marketplace pages. It reuses the timestamped evidence already
stored in Supabase and on the T7.

The bot finds or creates `#asset-research` under the existing `DIGITAL ASSETS` category. A recommendation offers `Approve Planning Handoff`, `Keep Monitoring`, and `Reject`. Approval stores an exact `product-opportunity.json` handoff on the T7 and records the decision in Supabase. The handoff explicitly records `generation_enqueued: false`.

The primary night shift starts at 01:30 and runs this service first, before qualification, video maintenance, and the final detached lead-generation sweep. There is no separate research LaunchAgent. The phase has a ten-minute ceiling, requires the T7, observes a 23-hour minimum snapshot interval, and defers if image generation, rendering, deployment/sync maintenance, another Ollama job, or another night shift is active. A resource-busy start gets one sequential retry after the awaited maintenance phases and immediately before lead generation; non-resource deferrals are not retried. The 07:00 fallback does not repeat research.

For a guarded manual diagnostic using the same cadence and resource checks:

```bash
npm run digital-assets:research:night-shift
```

## New products versus extensions

Every recommendation declares either `new_product` or `extend_existing_product`. Research owns the evidence-backed decision about what deserves work. It does not own release mutation.

For an approved extension, the Digital Asset Engine must:

1. generate and review the new assets in an immutable candidate;
2. rebuild the download and all full-release marketing media from the complete approved asset set;
3. regenerate the cover, inventory image, effects breakdown, and animation montage where applicable;
4. stage those changes against the existing marketplace product;
5. read the listing and media back for verification;
6. request a new package/distribution approval before making the update public.

This keeps the public page visually current as the package grows. New screenshots replace the versioned presentation as a coherent set; ORION should not append unbounded historical screenshots. Release notes and the buyer changelog explain what changed.

The current extension builder already regenerates deterministic full-release marketing media. Updating an already-public itch.io listing through a separately approved maintenance job remains the next marketplace-maintenance slice; it must not reuse the research approval as publication authority.
