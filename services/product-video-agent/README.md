# O.R.I.O.N. Product Video Agent

A durable, short-form-first product research and video production workflow.

## What exists

The service imports one manual fixture, normalizes it into provider-independent records, scores the product, creates local script/TTS/caption/render plans, applies asset-rights and content-hash gates, creates workflow and publication approvals, and writes a reviewable manifest.

The default dry run executes no marketplace API, browser automation, model, TTS, FFmpeg, Supabase, affiliate, Discord, or publishing call. An explicit local-preview command may call only the loopback Ollama endpoint. Approved narration and rendering are separate commands that reject unresolved workflow approvals. The fixture is synthetic and no credentials are required.

`spoken_text` is the only script field passed to local TTS. Affiliate disclosure is stored separately as publication and review metadata and is never appended to narration or captions.

The active targets are YouTube Shorts, Instagram Reels, and TikTok. Script jobs are limited to 10-60 seconds. Long-form output is disabled and deferred; its current planning target is 2-5 minutes.

## Run

From the repository root:

```bash
npm run product-video:dry-run
```

The default manifest is written under `data/runtime/product-video-agent/<run-id>/manifest.json`. That runtime directory is already ignored by Git.

Useful options:

```bash
node services/product-video-agent/index.mjs --no-persist --print-manifest
node services/product-video-agent/index.mjs --input-file path/to/manual-product.json
node services/product-video-agent/index.mjs --run-at 2026-07-20T12:00:00.000Z
```

Run the first real single-product package without calling Amazon or downloading media:

```bash
node services/product-video-agent/index.mjs \
  --input-file services/product-video-agent/fixtures/cyboris-s11-amazon-nl.json \
  --no-persist
```

This fixture records ASIN `B0F1CCLZGT`, supported product facts, research timestamps, and the absence of an observed listing video. The Amazon price is deliberately `null` because it could not be verified; price-dependent ROI remains zero until a later permitted refresh. The render plan uses an owned synthetic card, not an Amazon product image.

Inspect the Mac-local stack without generating content:

```bash
npm run product-video:doctor
```

Generate three local scripts with the configured Ollama model:

```bash
npm run product-video:local-preview
```

This opt-in command sets the manifest mode to `local_preview`. Generated scripts remain pending operator approval. It cannot start TTS, FFmpeg, asset acquisition, or publishing.

Scripts are editorial product-discovery content, not advertisements. They start with a problem, visible behavior, or surprising mechanism; omit brand/company names and marketplace-style introductions; and end with a concrete observation or visual payoff. The local model emits `closing_line`; persistence maps it to the legacy `call_to_action` field for schema compatibility. Deterministic validation rejects purchase prompts, promotional superlatives, generic engagement questions, and requests for comments, follows, or ratings.

Product imports may define `claim_guardrails.script_facts`, an explicit narration-safe allowlist. When present, only those facts enter the model prompt; raw titles, brands, prices, reviews, and excluded specifications remain in structured product state but are not exposed as script material. This is preferred over asking the model to ignore irrelevant facts after receiving them.

Generate Discord-compatible approval payloads without sending anything:

```bash
npm run product-video:approval-cards
node services/product-video-agent/index.mjs --approval-cards --manifest data/runtime/product-video-agent/<run-id>/manifest.json
```

The checked-in `config.example.json` contains no secrets. It uses the Mac's installed `llama3.1:8b`, Kokoro, faster-whisper, and FFmpeg. Local execution has no per-run model, TTS, or rendering API fee, but still uses Mac electricity, disk, and network bandwidth. Execution must be explicitly requested.

The local script prompt and validation rules have been hardened for editorial, non-advertorial narration. The model sees only narration-safe facts; brand introductions, purchase prompts, engagement questions, unsupported outcomes, inferred performance, and missing punctuation fail closed.

The first two-product A/B was too small to select a model. The expanded 2026-07-26 corpus uses five products and three angles each, including synthetic fact-allowlisted cases for compatibility, cleaning, app requirements, and consumable supplies. With thinking disabled, Llama passed 14/15 deterministic cases versus Qwen's 10/15; Llama also produced eight duration-fit scripts versus Qwen's two. Qwen thinking mode produced non-JSON output in all 15 bounded structured-output cases, so it is not a production profile.

The audit-derived editorial-v4 prompt reduced unsafe passes but did not make Llama autonomous: it passed 13/15 mechanically while manual review still found repetition and unsupported product behavior. `llama3.1:8b` is therefore the better local draft model, not a final writer. Configuration requires operator review, the runtime doctor reports `unattended_script_generation_ready: false`, and duplicate wording across angles blocks the entire preview. TTS and rendering stay locked until an operator approves a specific script. The separate leadgen extractor already uses Llama; O.R.I.O.N. does not modify that workflow. Qwen was not referenced by another Mac job and was removed after the evaluation, reclaiming about 6.6 GB.

Run the current-model corpus:

```bash
npm run product-video:benchmark-models
```

For an explicit two-model comparison after both models are installed:

```bash
node services/product-video-agent/scripts/benchmark-script-models.mjs --models llama3.1:8b,qwen3.5:9b-q4_K_M
```

The benchmark runs five products and every configured script angle through seeds `42-49`, temperature `0.2`, duration and duplication signals, and the deterministic quality gate. Its report is written under `data/runtime/product-video-agent/model-benchmarks/`. Every passing script still requires factual and editorial review; pass rate alone never selects a model.

## Contracts and adapters

`src/schemas.mjs` defines product, source, score, product-page media candidate, asset provenance, voice-license, script, voice-over, word timing, caption, render, workflow approval, affiliate, publication, analytics, and output-manifest contracts.

`ProductProviderAdapter` is the marketplace/provider boundary. The first implementation is `FixtureProductProviderAdapter`; future permitted marketplace integrations must normalize to the same contracts without leaking provider-specific payloads downstream.

`ProductPageMediaIntakeAdapter` is the boundary between page observation and editor assets. It records an image or video candidate with its source page, optional direct media URL, observation method, timestamp, retrieval method, rights state, approval, local path, SHA-256, and intended usage. A page reference without a direct media URL stays reference-only. A direct URL can create an asset-provenance record, but all existing acquisition and render gates still apply; promotion never means download or publication approval.

`ProductVideoStateStore` is the persistence boundary. `FileProductVideoStateStore` is active for local manifests, and `SupabaseProductVideoStateStore` is active for the compact video tables described below. Backend Supabase credentials must remain runtime-only.

## Asset and Amazon video policy

A visible product video is not automatically reusable media. Amazon-, merchant-, customer-, or creator-hosted assets stay blocked when rights are unverified, evidence is absent, operator approval is pending, or the local file is unavailable.

The dry run creates an asset-acquisition plan for each referenced file. A plan may become download-eligible only after all of these are true:

- the source permits the retrieval method and no anti-bot control is bypassed;
- the rights holder or applicable license explicitly permits the planned reuse;
- the evidence and attribution requirements are stored on the asset record;
- the asset-usage approval state is `approved`.

The fixture deliberately includes an Amazon video reference with `rights_status: unverified`; its acquisition plan is blocked and it is excluded from publication-candidate render jobs. Three repository-authored PPM images are rights-verified, operator-approved, and SHA-256 checked so the multi-clip renderer can be tested without third-party media. Validated remote download execution remains deferred.

Amazon footage may be used only in the isolated internal editor-test mode when an operator supplies the local file or explicitly authorizes a normal permitted-browser acquisition test. That mode accepts only `manual_upload`, `permitted_browser`, or fixture files with a matching SHA-256 hash and explicit internal approval, forces an `INTERNAL TEST - DO NOT PUBLISH` watermark, sets `publication_eligible: false`, and cannot unlock a publication. A `permitted_browser` record must preserve the observed page/media URL and may not involve login, CAPTCHA, DRM, or anti-bot bypass. It never becomes publication-download eligible. Use `fixtures/internal-editor-test-asset.example.json` as the manual asset-record template or `fixtures/vantrue-t150-amazon-nl-internal-test.json` as the browser-observed example. Never upload the resulting render to a third-party platform.

Mac preparation for an internal editor test:

```bash
mkdir -p data/runtime/product-video-agent/internal-tests
shasum -a 256 data/runtime/product-video-agent/internal-tests/<filename>.mp4
```

Add the local file and resulting hash to the product import record. Do not implement unattended broad marketplace downloading, and never bypass login, anti-bot, DRM, or access controls. A browser-observed internal test is one explicitly approved acquisition with full provenance, not a reusable-media decision.

The CYBORIS import demonstrates the intake contract. Its observed Amazon image gallery is stored as a reference-only media candidate and remains blocked. Its repository-owned visual fixture is promoted through the same adapter into an approved asset and appears in the FFmpeg timeline. When a permitted browser session, marketplace API, merchant media package, or manual upload supplies real media metadata, it plugs into this same contract without changing script, TTS, caption, or rendering modules.

SHA-256 is a deterministic fingerprint of a file. O.R.I.O.N. stores the 64-character digest when an asset is approved, recomputes it before rendering, and blocks the file if one byte has changed or the wrong file was supplied. It verifies asset identity and integrity; it does not establish copyright ownership or usage rights.

Research note, 2026-07-20: Amazon's current [Operating Agreement](https://affiliate-program.amazon.com/help/operating/agreement/), [Program Policies and IP License](https://affiliate-program.amazon.com/help/operating/policies), and [Participation Requirements](https://affiliate-program.amazon.com/help/operating/participation/) do not provide a clear grant to download arbitrary page-visible listing videos and repost them to third-party short-form platforms. The IP license is limited to Program Content Amazon makes available under its program and restricts downloading, redistribution, and sublicensing. Treat a listing video as unverified unless the specific Amazon program/API terms or the rights holder provide written permission for the intended platform use. This operational rule is not legal advice and must be rechecked against the applicable marketplace and account terms.

## Selected voices

The default local engine is [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), an Apache-2.0 82M-parameter model that is substantially more natural than the current Piper voices while remaining practical on the Mac mini. The default US female voice is `af_heart`; the alternating US male profile blends `am_fenrir,am_onyx`. Local sample analysis measured the blend near 111 Hz versus about 140 Hz for Fenrir alone, giving the requested deeper baseline without adding another model. The upstream model card states that its training sources are permissive or non-copyrighted. The operational license review is recorded under `voices/` and must be revisited if the upstream model or intended use changes.

`voice.assignment_strategy` is `round_robin`, so the example's three script variants use female, male, female narrators. Set it to `default_only` to use `voice.default_profile_id` for every video. Each voice job records its profile, model, speaker, synthesis settings, and license record.

Piper remains supported as an offline fallback, but it is no longer the example default because the tested US voices sound more synthetic. The four downloaded Piper model/config files were removed after the tuned Kokoro profiles were accepted, reclaiming about 170 MB; restoring the fallback requires downloading them again. Do not remove `.venv-product-video`, because that shared environment runs faster-whisper caption timing. Voice quality remains subjective; listen to both selected Kokoro profiles before production use. Adding another model requires a reviewed license record.

## Local assembly

The recommended local stack is:

- Ollama with the locally installed `llama3.1:8b` model for operator-reviewed short-form script drafts;
- Kokoro with alternating US female and male profiles for local speech generation without an inference fee;
- faster-whisper `small.en` for word-level narration timing;
- ASS active-word captions driven by faster-whisper word starts;
- FFmpeg for deterministic 1080x1920 H.264/AAC assembly;
- a JSON editing template such as `vertical-product-v1.template.json` for pacing, safe zones, captions, and audio rules.

This keeps deterministic work outside the language model. The renderer consumes an ordered timeline of approved image/video assets. Each clip records its role, media type, source trim start, duration, 9:16 cover crop, and following transition. FFmpeg normalizes clips to 1080x1920 at 30 fps, crossfades the sequence, overlays word-timed captions, and maps the approved narration. Every timeline asset must pass the applicable rights, approval, local-file, and SHA-256 gates; one missing or invalid clip blocks the entire render. The checked-in three-card sequence validates this graph without third-party footage. Video trimming is implemented and covered by compiler tests; operator-supplied or explicitly licensed footage is the next visual input. Music is disabled until an input and mixing path are implemented. Remotion remains a later option only if template complexity outgrows maintainable FFmpeg filters.

The existing local faster-whisper worker is the caption-timing source after local TTS produces narration. O.R.I.O.N. disables VAD for clean synthesized input because VAD can discard valid speech; other transcription workflows keep the worker's existing VAD default. Approved-script tokens replace same-length recognition substitutions, while faster-whisper remains the timing authority. Caption phrases are balanced into two to four words and split at sentence boundaries, so a new sentence never appears in the previous sentence's caption. Each active-word event lasts until the next measured word start, so pauses do not make the highlight run ahead of narration.

Kokoro now synthesizes the full narration context so punctuation can drive pitch, emphasis, energy, and natural sentence pauses. No artificial sentence silence is added. The female profile runs at speed `1.04`; the deeper male blend runs at `1.08`. The optional `sentence_isolated` mode and `sentence_pause_ms` setting remain available for scripts that require deterministic pauses, but they are not the default because short isolated utterances reset prosody and sounded monotonous in testing.

Mac engine setup:

```bash
brew install ffmpeg-full espeak-ng
python3 -m venv .venv-product-video
.venv-product-video/bin/python -m pip install --upgrade pip
.venv-product-video/bin/python -m pip install -r services/product-video-agent/requirements.txt
.venv-product-video/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"
/opt/homebrew/bin/python3.12 -m venv .venv-product-video-kokoro
.venv-product-video-kokoro/bin/python -m pip install --upgrade pip
.venv-product-video-kokoro/bin/python -m pip install -r services/product-video-agent/requirements-kokoro.txt
npm run product-video:doctor
```

`ffmpeg-full` is keg-only and can coexist with the smaller Homebrew `ffmpeg` formula. O.R.I.O.N. auto-detects its Apple Silicon or Intel Homebrew path because the regular formula omits the ASS/libass caption filter. The doctor rejects FFmpeg builds without that filter.

The first approved Kokoro narration downloads and caches the model under `data/runtime/product-video-agent/models/kokoro/`; later generations reuse it. `82M` means 82 million parameters, not 82 MB. On the validated Mac, the model cache is about 313 MB and the isolated Python/Torch environment is about 1.0 GB. Additional Kokoro voice packs are about 523 KB each and reuse the same model. The faster-whisper prefetch downloads the local alignment model once. None of these operations uses paid inference. The resulting WAV paths and selected profiles are recorded in the manifest.

### Mac resource profile

The lead Mac mini is an Apple M4 with 10 CPU cores and 16 GB unified memory. Its durable O.R.I.O.N. worktree is `/Users/Agent/Workspace/ruflo-product-video-agent`; phase-numbered worktree names are not used. Keep local assembly sequential: Llama used about 5.0 GB while loaded at a 4096-token context in the 2026-07-26 benchmark. Production sends `keep_alive: 0s` to unload it after each script response; Kokoro, faster-whisper `small.en` on CPU with `int8`, and FFmpeg then run one after another.

O.R.I.O.N. serializes its own local model, narration, caption, and render work with a service-local media lock. It also calls Ollama's local `/api/ps` endpoint immediately before work and stops when any model is already loaded. It does not inspect, reschedule, lock, or modify leadgen, qualification, or other agent workflows.

```bash
npm run product-video:preflight
```

The command exits with status `0` when the local model is free and `75` when video work should not start. Scheduling is intentionally deferred until repeated manual end-to-end tests prove the workflow and resource profile.

## Media storage strategy

Current Mac scratch files are under `data/runtime/product-video-agent/`:

- `<run-id>/manifest.json` and named decision/revision manifests contain structured workflow state;
- `assets/*.wav` contains local narration and future active-job media;
- `captions/*.words.json` and `captions/*.ass` contain timing and rendered-caption inputs;
- `renders/*.mp4` contains active render outputs only until verified T7 cleanup;
- `models/kokoro/` contains the reusable Kokoro model cache.

The directory is Git-ignored active-job scratch space, not an archive. Ollama and faster-whisper also maintain reusable model caches outside this directory. Do not move or clean active files while FFmpeg is using them.

Use a three-layer layout when Supabase persistence and the external SSD are enabled:

- Supabase Postgres is the authoritative structured state. One `videos` row holds the subject package and temporary workflow documents for scripts, TTS, captions, rendering, approvals, costs, and archives.
- The external SSD is the authoritative media archive for source footage, images, narration, captions, previews, masters, music, and sound effects. Postgres stores paths, hashes, sizes, and verification state, never file blobs.
- The Mac internal disk is a bounded active-job cache and fallback spool. If the SSD is absent, a completed file remains in the spool with archive status pending; it cannot be evicted until an SSD copy exists and its SHA-256 is verified.
- YouTube may hold an unlisted review copy after the external-action gate passes. It is a review/publication location, not the only master archive.
- Keep reusable rights-approved assets addressable by content hash so identical media is not repeatedly copied or downloaded.

Real renders invoke the archive manager after FFmpeg output verification. Set `VIDEO_GENERATION_ARCHIVE_ROOT` to `/Volumes/T7/O.R.I.O.N. Video Generation`. If it is unset or unavailable, the manager copies the render to `/Users/Agent/Desktop/Video Generation Fallback/`, verifies the copy by SHA-256, leaves the working copy intact, and records `pending_external_ssd`.

Approved source images and footage use the same verified archive mechanism. Internal test downloads are stored flat under `Assets/Temporary Product Footage/`; test outputs are stored under `Archive/Tests/Test Renders/`, directly beside `Previous Renders/`. Publication candidates use `Assets/Source Media/` and `Masters/`. Names include `ORION`, the product slug, and a stable hash or render ID.

The first editor template detects hard scene changes with local FFmpeg, targets four short shots per product, distributes the narration duration across those source ranges, and crossfades between them. It does not loop or slow video. `setpts=PTS-STARTPTS` only resets each trimmed clip's timestamps so FFmpeg can join it correctly; no speed multiplier or `atempo` filter is used.

Archive every downloaded source asset referenced by the render timeline before persisting the final manifest:

```bash
VIDEO_GENERATION_ARCHIVE_ROOT="/Volumes/T7/O.R.I.O.N. Video Generation" \
  npm run product-video:archive-assets -- \
  data/runtime/product-video-agent/<run-id>/manifest.json \
  --write-manifest data/runtime/product-video-agent/<run-id>/assets-archived.json
```

After Supabase persistence succeeds, remove verified duplicate Mac MP4s:

```bash
npm run product-video:cleanup-local-media -- \
  data/runtime/product-video-agent/<run-id>/rendered.json \
  --write-manifest data/runtime/product-video-agent/<run-id>/cleaned.json
```

Cleanup fails closed unless both the T7 copy and Mac copy match the recorded SHA-256. It never removes a Desktop fallback, an unverified file, or the T7 archive. If a revision later needs deleted source footage, narration/render execution restores the verified T7 asset into scratch automatically; the same action is available explicitly with `product-video:restore-local-assets`.

Temporary internal-test source footage can receive an explicit expiry and a separate verified sweep:

```bash
npm run product-video:set-source-retention -- \
  data/runtime/product-video-agent/<run-id>/manifest.json \
  --retention-hours 1 \
  --write-manifest data/runtime/product-video-agent/<run-id>/retained.json

npm run product-video:sweep-expired-media -- \
  data/runtime/product-video-agent/<run-id>/retained.json \
  --write-manifest data/runtime/product-video-agent/<run-id>/swept.json
```

The sweep runs only after a generated render is verified on T7, recalculates the source SHA-256 immediately before deletion, and never deletes generated renders or masters.

For a one-shot delayed test, `product-video:run-retention-sweep` waits until the manifest's earliest recorded expiry before sweeping. It can also persist the resulting metadata with `--persist-supabase`. This is a foreground worker suitable for a one-shot `launchctl submit` job; it does not create or alter a recurring schedule.

Retention policy:

- remove verified Mac source and render copies immediately after T7 archival and Supabase persistence;
- keep temporary downloaded footage on T7 through review and revisions, then 14 days after final approval/publication;
- keep footage for rejected/cancelled videos for 7 days, then require a verified retention sweep before deletion;
- keep generated masters and publication history on T7 long-term;
- keep metadata, hashes, provenance, rights status, and workflow history in Supabase after media expiry.

```bash
export VIDEO_GENERATION_ARCHIVE_ROOT="/Volumes/T7/O.R.I.O.N. Video Generation"
export VIDEO_GENERATION_FALLBACK_ROOT="/Users/Agent/Desktop/Video Generation Fallback"
mkdir -p "$VIDEO_GENERATION_ARCHIVE_ROOT"
```

For normal Mac operation, create the ignored `config/product-video/.env` from `config/product-video/.env.example`. Product-video commands load this dedicated file automatically, so scheduled/manual jobs prefer T7 without changing shared leadgen or Supabase configuration.

The initial normalized migration created 21 tables plus one view and was too granular for the current scale. The operator confirmed that `supabase/migrations/20260726_compact_video_generation_tables.sql` was applied on 2026-07-26, replacing it with five durable tables.

- `video_channels`: one logical ORION channel/account such as `techy-gadgets` or `poke-quizz`, including its destination-account settings plus the workflow family it uses.
- `videos`: one row per planned or produced video; subjects and temporary pipeline state are compact JSONB documents.
- `video_assets`: lightweight metadata only. Actual footage lives on the external SSD; the row stores paths, SHA-256, rights, approval, size, and archive verification.
- `video_publications`: lightweight per-platform state. A YouTube, TikTok, Instagram, or Facebook upload has its own external ID, URL, visibility, schedule, status, error, and timestamps, so these records should not become platform-prefixed columns on `videos`.
- `video_analytics`: append-only metric snapshots linked to a publication.

This follows the compact principle used by `leads`: one primary entity row with flexible extraction/workflow documents. The four supporting tables remain because assets, publications, and analytics are genuine one-to-many records rather than columns of one video. `Techy Gadgets` and `Poke Quizz` both use `videos.subjects`; their niche-specific assembly workflows can differ while the same ORION core persists scripts, narration, captions, renders, approvals, archives, publications, and analytics. One finished `Poke Quizz` master is one `videos` row. Publishing it to YouTube, TikTok, Instagram, and Facebook creates four `video_publications` rows linked to that master, not four duplicate video rows. RLS remains enabled, `anon`/`authenticated` access is revoked, and only `postgres` plus backend `service_role` receive access.

Every ORION channel should keep the same production pillars so expansion stays plug-and-play:

- strategy and ideation, including niche, channel format, hooks, and later analytics-driven iteration;
- subject grounding, so product facts or Pokemon facts are structured before script generation;
- script generation with deterministic review and approval gates;
- narration and timing, including Kokoro speech plus faster-whisper alignment;
- visual assembly, including approved templates, backgrounds, sprites, footage, captions, music, and sound effects;
- render, archive, and verification, including FFmpeg output checks plus T7-first media storage;
- publication and analytics, including per-platform state, review copies, metric snapshots, and strategy switching.

Each niche-specific assembly workflow should reuse these pillars rather than introduce a parallel engine. Product-specific scoring, affiliate links, marketplace metadata, source-footage intake, Pokemon type-pair selection, and sprite-driven reveal rules remain optional workflow modules layered on top of the same core workflow.

The Poke Quizz channel needs one additional catalog table, not a second video-state schema. The live follow-up migration renames the first draft `pokemon_species` table to `pokedex`. That `pokedex` table holds Gen 1+ canonical facts such as national dex number, generation, types, and local asset paths for sprite, silhouette, shiny sprite, and cry. Those rows give script and render jobs a deterministic selector while keeping actual media files on T7 instead of in Supabase storage.

Use the repeatable generation sync when the table needs refreshing:

```bash
npm run product-video:sync-pokedex -- --generation 1 --write-json data/runtime/product-video-agent/pokedex/gen1-serebii.json
npm run product-video:sync-pokedex -- --generation 2 --write-json data/runtime/product-video-agent/pokedex/gen2-serebii.json
npm run product-video:sync-pokedex -- --generation 1 --persist-supabase
npm run product-video:sync-pokedex -- --generation 2 --persist-supabase
```

The current sources are Serebii's Generation I and Generation II pages. On July 28, 2026, Playwright verification confirmed that those pages expose both current small-sprite URLs and type-icon URLs for the listed species. The sync stores those truth-safe fields in `sprite_source_url` and `metadata.type_icon_source_urls`. Current canonical typings shown on the page are preserved, so species such as Magnemite/Magneton (`electric`,`steel`) and Mr. Mime (`psychic`,`fairy`) remain truthful to the current Pokédex rather than the original 1996-only typings. Missing silhouette, shiny-sprite, or cry sources stay null until a later verified source is added.

The first Poke Quizz workflow contract now lives at `services/product-video-agent/pokemon-type-challenge-v1.template.json`. It locks the shared rules for type-pair eligibility, impossible pair exclusions, countdown timing, silhouette presentation, SFX hooks, battle-intro music timing, and reveal behavior without turning one Pokemon prompt into the engine itself.

Generate a deterministic first video package without calling any hosted model:

```bash
npm run product-video:plan-poke-quizz -- \
  --catalog-json data/runtime/product-video-agent/pokedex/gen1-serebii.json \
  --output data/runtime/product-video-agent/poke-quizz/first-type-challenge-plan.json
```

The planner uses only grounded `pokedex` rows, no paid API, and no hosted inference. It selects an observed dual-type pair, samples one to four matching species, records the exact T7 asset directories, and flags what is still missing before narration or render execution should begin.

Create and use these Poke Quizz asset directories on T7:

- `Backgrounds`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Pokemon/Poke Quizz/Backgrounds`
- `Sprites`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Pokemon/Poke Quizz/Sprites`
- `Silhouettes`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Pokemon/Poke Quizz/Silhouettes`
- `Type Icons`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Pokemon/Poke Quizz/Type Icons`
- `Overlays`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Pokemon/Poke Quizz/Overlays`
- `Transitions`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Pokemon/Poke Quizz/Transitions`
- `Battle Intro Music`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Audio/Music/Poke Quizz`
- `Sound Effects`: `/Volumes/T7/O.R.I.O.N. Video Generation/Assets/Audio/Sound Effects/Poke Quizz`
- `Preview Outputs`: `/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz`
- `Master Outputs`: `/Volumes/T7/O.R.I.O.N. Video Generation/Masters/Poke Quizz`

Live compact persistence is explicit:

```bash
npm run product-video:persist-supabase -- data/runtime/product-video-agent/<run-id>/rendered.json
```

The command requires the ignored backend `config/supabase/.env` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. It upserts the logical channel, one `videos` row, lightweight `video_assets` metadata, and per-platform `video_publications` rows in foreign-key order. It never uploads media bytes. Missing backend credentials fail closed.

For Discord review, an unlisted YouTube upload is link-shareable but is not private: anyone with the URL can view it. A private upload requires explicitly invited Google accounts. Uploading, changing visibility, scheduling, publishing, and deleting remain separate external approval actions. The intended state flow is `planned -> preview_upload_approved -> unlisted_preview -> publication_approved -> scheduled -> published`; rejection moves the publication to revision without publishing it.

## Music and sound effects

The current renderer has no background-music or sound-effect input and contains no song-specific blacklist. When audio mixing is implemented, the editor should choose a useful highlight or high-energy section based on beats/onsets instead of always starting at timestamp zero, duck music below narration, and use sparse transition/impact effects rather than constant sound effects.

`Paris` by Else remains a requested creative option, not a hardcoded rejection. The implementation decision is still open: add it later through a platform's own licensed Shorts/Reels audio workflow, or bake an operator-supplied track into a reusable master with recorded source and usage context. Those routes are not equivalent. YouTube states that music added outside its Shorts creation tools can receive standard Content ID claims or copyright removal requests, while its in-product Shorts library has Shorts-specific licensing. Instagram states that some business accounts and commercial posts cannot use its licensed music library. See [YouTube Shorts rights-holder guidance](https://support.google.com/youtube/answer/13053317) and [Instagram licensed music access](https://www.facebook.com/help/instagram/402084904469945).

## Discord channels

Create one category named `O.R.I.O.N. Video Factory` with these text channels:

- `orion-intake`: product candidates, manual imports, and commands.
- `orion-review`: operator-only script, asset-rights, music/SFX, render, spending, and publishing approval cards.
- `orion-renders`: publication-candidate previews and completed local render links after the applicable gates pass.
- `orion-lab`: internal editor-test footage, voice comparisons, template experiments, and watermarked non-publishable renders.
- `orion-ops`: runtime readiness, manual-run status, model/lock stops, failures, disk/cache status, and production costs.
- `orion-analytics`: later platform views, retention, clicks, conversions, revenue, and per-video ROI.

Put the six channel IDs in `config/discord/.env` using the `DISCORD_ORION_*_CHANNEL_ID` variables. The bot does not need the category ID. Product-video approval cards now target the `orionReview` channel key; live posting remains disabled until the IDs and persistence handler are connected.

## Approval sequence

1. Run the local preview and inspect script cards.
2. Apply a script decision to the saved manifest.
3. Execute approved narration; Kokoro and faster-whisper run locally and the render approval changes from `blocked` to `pending`.
4. Regenerate the render card from the narrated manifest.
5. Apply the render decision.
6. Execute the approved FFmpeg render.

Example commands:

```bash
node services/product-video-agent/index.mjs --create-operator-script data/runtime/product-video-agent/<run-id>/manifest.json --script-job-id script-job-... --script-file services/product-video-agent/fixtures/example-product-editorial-script.json --actor operator-name --reason "All local-model retries failed deterministic validation" --write-manifest data/runtime/product-video-agent/<run-id>/operator-fallback.json
node services/product-video-agent/index.mjs --revise-script data/runtime/product-video-agent/<run-id>/manifest.json --script-variant-id script-variant-... --script-file services/product-video-agent/fixtures/cyboris-s11-operator-script.json --actor operator-name --reason "Rewrite approved by operator" --write-manifest data/runtime/product-video-agent/<run-id>/revised.json
node services/product-video-agent/index.mjs --decide-workflow data/runtime/product-video-agent/<run-id>/revised.json --task-id TASK-ORION-SCRIPT-... --decision approve --actor operator-name --reason "Approved for local narration" --write-manifest data/runtime/product-video-agent/<run-id>/script-approved.json
npm run product-video:approved-narration -- data/runtime/product-video-agent/<run-id>/script-approved.json --script-variant-id script-variant-... --write-manifest data/runtime/product-video-agent/<run-id>/narrated.json
node services/product-video-agent/index.mjs --approval-cards --manifest data/runtime/product-video-agent/<run-id>/narrated.json
node services/product-video-agent/index.mjs --decide-workflow data/runtime/product-video-agent/<run-id>/narrated.json --task-id TASK-ORION-RENDER-... --decision approve --actor operator-name --reason "Approved for local fixture render" --write-manifest data/runtime/product-video-agent/<run-id>/render-approved.json
npm run product-video:approved-render -- data/runtime/product-video-agent/<run-id>/render-approved.json --script-variant-id script-variant-... --write-manifest data/runtime/product-video-agent/<run-id>/rendered.json
```

`--create-operator-script` is the audited fail-closed path when the local model produces no valid variant after all deterministic retries. It creates one pending script tied to an existing script job; narration still requires a separate approval.

Discord cards reuse the existing Ruflo embed and button format. Blocked asset and render cards disable approval. This increment builds and validates card payloads but does not automatically post them or persist button decisions; live Discord-to-manifest persistence is the next integration step.

The target production flow removes unnecessary pre-render friction for zero-cost local jobs: approve the script/assets, render locally, upload the preview to private storage or `orion-renders`, then request a separate publication approval in `orion-review`. Approval publishes through the selected platform adapter; rejection retains or deletes the preview according to the configured retention policy. Do not upload private drafts to social platforms before approval when a Discord attachment or short-lived signed object-storage URL can provide the same review surface without an external platform action.

## Approval gates

Script use, asset use, rendering, paid usage, publishing, account changes, and external actions require the applicable approval. A publication draft can never become publish-ready merely because a local render exists. Supabase writes, licensed remote acquisition, Discord posting, and publishing remain non-operational.

## Test

```bash
npm run test:product-video-agent
```
