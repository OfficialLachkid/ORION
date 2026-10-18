# Digital Asset Engine — Issue #146 Implementation Roadmap

## Purpose

This document is the durable handoff for ORION's Digital Asset Generation and Multi-Marketplace Distribution Engine. It records what is implemented, why the boundaries exist, and which steps remain. Future sessions should read this file before changing the pipeline.

The original issue intent, requirement coverage, approval boundary, and MVP checklist are summarized in [issue-146-product-brief.md](./issue-146-product-brief.md).

## Current decision

The Digital Asset Engine is a native ORION service under `services/digital-asset-engine`.

It is separate from the Product Video Agent because its canonical output is a downloadable product rather than a video publication. It follows the same operational patterns:

- deterministic planning before expensive work;
- explicit execution flags;
- local-first providers behind adapters;
- persisted manifests and validation reports;
- human approval before external publication;
- no scheduling until manual runs are reliable.

The marketplace-independent product is always primary. Marketplace exports are derived artifacts.

## Proven technical baseline

- Runtime: Mac mini M4 with 16 GB unified memory.
- Image provider: local Ollama `x/flux2-klein:4b`.
- Model footprint: 5,726,794,301 bytes (5.73 GB / 5.33 GiB).
- License: FLUX.2 Klein 4B is Apache 2.0 and supports commercial use.
- Cost: local generation has no per-image or API fee. Electricity, hardware time, and storage remain operational costs.
- Feasibility preview: the issue #146 science-fiction rifle was visually sufficient to continue implementation.
- Known generation limitation: the model produced a colored background rather than alpha transparency.
- Pipeline response: request a solid chroma background, remove only edge-connected chroma pixels, resize with nearest-neighbor sampling, quantize the palette, and validate the resulting PNG.

Ollama image generation is experimental and currently Mac-only. The provider therefore remains replaceable and cannot leak into canonical product or marketplace models.

## Implemented vertical slice

```text
Validated Opportunity JSON
        ↓
Final deterministic validation
        ↓
Canonical Product Specification
        ↓
Explicit local generation (--execute)
        ↓
Original FLUX source image
        ↓
Connected chroma removal
        ↓
Nearest-neighbor sprite normalization
        ↓
Palette-limited transparent PNG
        ↓
Automated validation report
        ↓
Human asset review required
```

The canonical product workspace contains:

```text
<output-root>/<product-slug>/
├── product.json
├── opportunity-validation.json
├── README.md
├── LICENSE.md                 # intentionally draft
├── CHANGELOG.md
├── assets/
│   ├── source/               # untouched model output
│   └── items/                # normalized distributable candidates
├── previews/                 # checkerboard transparency previews
├── validation/               # per-asset machine-readable reports
└── exports/
    ├── generic/
    └── itch/
```

## Safety and integration boundaries

- The default Ollama endpoint must resolve to localhost. There is no silent cloud fallback.
- Generation requires `--execute`; planning alone cannot invoke the model.
- A generation lock prevents two Digital Asset Engine runs from overlapping.
- Ollama preflight defers when another model is loaded, protecting lead generation and other local workloads.
- Assets are generated sequentially on the 16 GB Mac.
- `keep_alive` defaults to `0`, allowing memory to be released after generation.
- Distribution remains false even when every automated check passes.
- The generated product license is a blocking draft, not legal approval.
- Digital-asset research now runs as the first bounded phase of the 01:30 primary night shift. Image generation remains manually approved and unscheduled.

## Commands

Plan the included issue #146 opportunity without generating an image:

```bash
npm run digital-assets:plan
```

Generate locally on the Mac:

```bash
npm run digital-assets:generate -- --execute
```

Write canonical products to the T7:

```bash
export DIGITAL_ASSET_ARCHIVE_ROOT="/Volumes/T7/O.R.I.O.N. Digital Assets"
npm run digital-assets:generate -- --execute
```

Run focused tests:

```bash
npm run digital-assets:test
```

## Automated checks in V0.1

- opportunity freshness and expiry;
- demand and competition gate;
- confidence threshold;
- IP risk and prohibited-reference context;
- internal duplicate input hook;
- maximum generation scope;
- marketplace candidate presence;
- valid PNG decoding;
- exact final dimensions;
- alpha-channel presence;
- minimum transparent area;
- palette-color maximum;
- non-empty asset content;
- SHA-256 content fingerprint.

These checks prove technical usability, not artistic quality. Silhouette, visual coherence, animation quality, and buyer value still require human review.

## Phase status

### Phase 1 — Architecture and technical proof

Status: **in progress**

- [x] Confirm a local model can produce a useful source image.
- [x] Select native ORION service architecture.
- [x] Define the first Product Opportunity schema.
- [x] Define the canonical Product Specification.
- [x] Add local-only Ollama adapter.
- [x] Add deterministic transparency, sizing, and palette processing.
- [x] Add initial automated validation.
- [x] Keep generation manual and distribution blocked.
- [x] Run the complete V0.1 pipeline against the Mac Ollama runtime and review its final transparent asset.
- [ ] Tune chroma tolerance and palette limits using at least five varied assets.
- [ ] Record generation duration and peak resource use.

### Phase 2 — First coherent asset pack

Status: **in progress**

- [x] Define the first coherent eight-item `Neon Plasma Armory` pilot.
- [x] Make generation resumable using each candidate's final SHA-256 validation record.
- [x] Add deterministic internal-preview packaging with actual-asset cover, sprite sheet, file inventory, and manifest hash.
- [x] Generate and visually review all eight candidates on the Mac/T7.
- [x] Upload the export to the existing hidden itch.io Butler channel and verify the returned build and draft page.
- Add a master style reference and shared seed/prompt vocabulary.
- Add silhouette, scale, outline, and perceptual-similarity checks.
- Add duplicate and near-duplicate detection.
- [x] Add sprite-sheet assembly and inventory validation.
- [x] Review every weapon and effect proof and resolve the identified quality holds.
- Add the review-ready customer license to the immutable package and approve its exact hash with the final package.

Exit criterion: one coherent, useful, original pack whose files can be imported into a game engine without manual repair.

### Expansion capability proof — 2026-10-18

- Generated ten isolated 128x128 Neon Plasma Armory expansion candidates on the Mac/T7: power cell, pickup, grenade, mine, shield emitter, two VFX keyframes, crate, chair, and workbench.
- The first pass completed in 10m 47.09s (about 64.7 seconds per asset), passed all automated PNG, alpha, palette, and chroma checks, and incurred EUR 0 in provider cost.
- Human review placed the first energy pickup and proximity mine on semantic quality hold even though both passed technical validation. Their immutable V2 revisions completed in 2m 07.54s and resolved the misleading weapon-like pickup silhouette and the mine's ground smear.
- Generalized internal-preview packaging now preserves the existing weapon-specific copy while supporting mixed asset kinds, square sprites, transparent contain-padding, more than eight preview cells, and longer labels.
- None of these candidates modifies the approved public release. Promoting selected items requires a versioned static-asset extension, a Discord review decision, regenerated full-release media, and a separate marketplace publication approval.
- The first static-expansion review selects eight buyer-ready additions and deliberately excludes the two VFX keyframes until they have complete runtime frame sequences, sprite sheets, metadata, and preview GIFs. Its immutable manifest is reviewed in the existing product channel, with per-asset feedback stored in Supabase before any `0.3.0` candidate may be assembled.

### Retention decision

- T7 is the canonical large-file store; Supabase stores metadata, hashes, decisions, and publication state only.
- Keep approved individual assets, release manifests, covers, sprite sheets, and exact marketplace exports while the product remains supported.
- Delete Mac scratch copies only after a byte-for-byte SHA-256 match against T7.
- Retain raw model sources and rejected candidates through review and revisions, then make them eligible for a later verified retention sweep.
- Never treat itch.io or another marketplace as the backup of record.
- Add a second backup target before the catalog becomes commercially important because one T7 remains a single point of failure.

### Phase 3 — itch.io adapter

Status: **in progress; draft staging and verification implemented**

- Verify current itch.io seller requirements and AI-generated-content policies.
- Implement capability declaration rather than assuming full API support.
- [x] Upload the buyer directory through Butler as an itch.io build.
- [x] Generate honest listing copy and protected previews from the included assets.
- [x] Populate and read the itch.io draft back through an authenticated browser session.
- [x] Require exact package approval while keeping publication separately blocked.
- [x] Persist the external URL, version, publication status, price, hashes, and verification receipts as marketplace release state.
- [x] Implement explicit distribution approval and public-state verification.
- [x] Add a guarded public-slug migration that preserves the approved title and reconciles Butler, T7, and Discord references.
- [x] Add a local, versioned built-in-theme proposal with deterministic media and Discord approval.
- [x] Apply only the exact approved theme and verify the public result on desktop and mobile.
- Improve the buyer-facing description formatting with stable sections and lists.
- Collect the first analytics baseline after the storefront presentation is complete.

### Phase 4 — Second marketplace

Status: **blocked by Phase 3**

Add a second adapter without modifying opportunity validation, asset generation, canonical product metadata, or core packaging. If those areas must change, revisit the adapter boundary first.

### Phase 5 — Scheduling and analytics

Status: **research collection scheduled; generation deferred**

- [x] Run evidence collection and local recommendation analysis first inside the existing 01:30 night-shift sequence, with a ten-minute ceiling and no separate timer.
- [x] Enforce a 23-hour minimum snapshot interval and defer when the T7, Ollama, generation, rendering, deployment/sync, or another night-shift resource is busy.
- Add a dedicated low-contention generation window only after manual reliability is proven and a recommendation receives human approval.
- Never overlap image generation with lead qualification, video rendering, or another Ollama model.
- Report generated products and failures in the existing morning/Discord operational flow.
- Normalize marketplace sales metrics while retaining provider-specific details.
- Feed actual product performance back to the future Trend Research Engine.

## Next session checklist

1. Read this document and `services/digital-asset-engine/README.md`.
2. Run `npm run digital-assets:test`.
3. [x] Build the sale-ready immutable candidate with corrected runtime metadata and the review-ready customer license.
4. [x] Update and verify the existing itch.io draft, then reconcile the existing Discord package message in place.
5. [x] Approve the exact package manifest, including its buyer files, listing, price, previews, and license hash.
6. [x] Complete seller setup and pass seller preflight.
7. [x] Apply the distribution-review migration and reconcile the separate manifest-bound distribution gate.
8. [x] Record the separate manifest-bound itch.io distribution approval.
9. [x] Run the approved publish adapter, verify the public page and paid download presentation, and persist the external marketplace release receipt.
10. Merge and deploy the guarded slug/theme workflow, then apply the theme-review Supabase migration.
11. Migrate `asset-pack-test` to `neon-plasma-armory`, create a local theme candidate, and review it in Discord.
12. Apply and verify the approved theme before starting issue #149 research implementation.

## Deferred decisions

- Whether the review-ready VBJServices Digital Asset License 1.0 needs legal revision before final package approval.
- Whether canonical products live permanently on T7 or are mirrored there.
- Supabase schema for product and marketplace state.
- Discord review-card design and approval roles.
- Trend Research Engine input transport.
- Marketplace #2.
- Cloud/GPU worker selection.

None of these deferred decisions block validating the first local generation pipeline.

## Proposed Discord pack approval

Status: **package-level interaction and verified itch.io draft staging implemented on the feature branch**

The current vertical slice discovers or reuses the pack channel, edits one overview message, maintains one asset-review thread, and attaches each numbered asset with its exact hash. The overview owns the only approval gate. Its actions are `Approve Pack`, `Request Changes`, `Reject Pack`, `Open itch.io Draft`, and `Open Manifest`. Individual asset messages are visual references without approval buttons. The change-request modal contains a selectable/deselectable numbered asset list and one shared feedback field; selected assets require changes and unselected assets are accepted for that revision.

The first live attempt on 2026-10-14 reached the configured guild and category but Discord rejected channel creation with `403 Missing Permissions` (`50013`). After `Manage Channels` was granted at the category level, the retry created `#neon-plasma-armory`, posted the overview, created the `asset-review` thread, and attached all eight sprites. The exact channel, thread, message, and manifest identifiers are stored in `review/discord.json` on the T7. The pack remains at `awaiting_asset_review`; this preview does not authorize marketplace publication.

The first asset-level decisions remain immutable in `digital_asset_review_decisions`. New reviews use `digital_asset_release_reviews`, which records the exact manifest hash, listing hash, review revision, package decision, affected asset IDs, and every asset's resulting decision in one append-only row. Row-level security denies anonymous access and permits the service role to select and insert but not rewrite prior decisions.

Before Discord review is created, Butler updates the existing itch.io package channel and Playwright populates the existing draft with the generated title, descriptions, price, tags, cover, and screenshots. ORION reads the page back and stores a verified listing hash in `review/itch.json`. Discord fails closed if the draft is missing, unverified, public, or belongs to another manifest. A corrected revision updates the same itch.io draft and the existing Discord overview and asset messages; it does not create duplicate review messages.

The review card shows the revision, overview preview, bold numbered asset list, asset count, local generation cost, populated draft link, listing hash, and manifest hash. The attached `manifest.json` is a machine-readable receipt of the exact file list and SHA-256 hashes covered by the decision; it is not buyer-facing marketing content.

Any change to an asset, metadata, pricing, license, listing hash, or manifest invalidates the earlier approval and creates a new revision on the same review surfaces.

Creative approval and distribution approval should remain separate gates:

```text
Generated pack -> automated validation -> creative approval
Creative approval -> marketplace export preview -> distribution approval
Distribution approval -> adapter execution
```

This avoids an accidental interpretation that approving the art also authorizes immediate external publication. The fuller proposal and open decisions are in [issue-146-product-brief.md](./issue-146-product-brief.md).

The distribution-gate implementation also fails closed on seller readiness. It reads itch.io payout mode and tax-interview state into `review/itch-seller.json`; an incomplete interview produces a blocked Discord card with a setup link and no approval action. A ready account exposes a distinct `Approve itch.io Publish` action. Its immutable decision is stored in `digital_asset_distribution_reviews`; actual visibility change remains a subsequent adapter step.

The publish adapter consumes that exact authorization once. It rechecks all creative, listing, seller, and distribution gates; changes only `game[published]` from draft to public; verifies the editor and clean public page; and stores the idempotent external receipt in `review/itch-release.json`. Discord channel cleanup remains separate until every configured marketplace has an equivalent verified receipt.

## Live V0.1 verification — 2026-10-12

The pipeline generated the example rifle through the Mac's local Ollama runtime and processed it into a distributable candidate:

- final dimensions: 128×64;
- format: PNG with alpha;
- palette: 15 colors against a maximum of 32;
- transparent canvas: 63.49%;
- residual chroma-colored pixels: 0.29%;
- per-image/API cost: EUR 0;
- state: awaiting human asset review;
- distribution: blocked.

The first processing attempt exposed a false-positive validation case: FLUX produced a flat pink near the requested `#FF00FF`, leaving a halo when removal used only the requested color. The implementation now detects the actual median border color, verifies that the border is sufficiently flat and resembles the requested chroma family, removes only edge-connected background pixels, and rejects excessive residual chroma. The repeated live run produced a visually clean transparent asset.

## Live V0.2 pack verification - 2026-10-13

The Mac generated and packaged the complete `Neon Plasma Armory` pilot on the T7:

- eight of eight side-view weapon sprites passed the current automated checks;
- elapsed generation time: 8 minutes 40.77 seconds (about 65.1 seconds per asset);
- local API/per-image cost: EUR 0;
- deterministic cover and sprite sheet were assembled only from included assets;
- package manifest hash: `417a98420c193c931c631f0e6f2dd1525d0500fd3dfc7db0384a313cd04abca6`;
- Butler accepted a first hidden upload to `vbjservices/asset-pack-test:assets-preview`;
- a repeat push was rejected because the latest build was still processing, so the upload remains unverified until the Edit game page or a later remote-signature comparison shows the completed build.

Human visual review on 2026-10-14 rejected this first package as a release candidate. Enclosed chroma-colored regions inside trigger guards and skeletal stocks remained opaque because V0.1 removed only chroma connected to the outer border, and the sprite sheet used zero gutter between cells. The hidden itch.io upload is therefore superseded and must not be published. Processing V2 removes detected chroma globally, requires zero residual chroma pixels, reprocesses saved source images without calling the model again, and gives every sprite-sheet cell 16 transparent pixels of padding on each side.

The saved source images were reprocessed and repackaged on 2026-10-14 without another model call. All eight candidates passed with zero residual chroma pixels. The corrected manifest hash is `12e8fcf449c9cd2170c3311b5409505615aa0552ba7f0f34ed4985619f87a536`, and Butler accepted it as hidden version `0.2.0-internal-preview`. This version remains awaiting human visual review and is not distribution-ready.

## Versioned package extensions

An approved product is never updated by copying new files directly into its current export. An extension plan pins the approved base version and manifest, the exact effects-review bundle, the target semantic version, release notes, and any unresolved quality holds. ORION verifies those inputs and builds a content-addressed candidate under `releases/<target-version>/candidates/<input-hash>/`. Corrections create another immutable candidate; they do not erase the earlier review evidence.

The buyer-facing effects layout keeps muzzle flashes, stationary projectiles, and impact/decay animations independent for every weapon. It includes transparent PNG frames, sprite sheets, animation JSON, and weapon-local muzzle anchors. Combined firing GIFs remain review previews, and projectile travel remains game-engine-controlled. Model source images and internal validation files never enter the buyer package.

The first `0.2.0` plan carries an open quality hold because two decay animations were reported as resembling miniature weapons. The candidate may be assembled for inspection, but it remains `blocked_quality_review` until the affected weapons are identified and the sequences are explicitly accepted or replaced. Only a hold-free candidate can proceed to itch.io draft staging and the existing package-level Discord approval gate.

## Research-engine boundary - issue #149

Issue #149 remains valuable as the architecture charter for answering *what should ORION make?* It must stay separate from this engine, which answers *how do we generate, review, package, and distribute an approved opportunity?*

Before implementation, split the epic into bounded work items for source capability research, historical observations, opportunity scoring, Discord research digests, the handoff contract, and first-party sales feedback. Do not assume that public competitor sales or download counts are available: each source adapter must distinguish observed evidence from inferred proxies and document its allowed access method and cadence. Research creates proposals; only human-promoted opportunities enter the generation backlog.

The research reasoner is a local text/reasoning model served through Ollama, separate from the local image model. The first vertical slice uses one itch.io adapter with newest and top-seller pixel-art views, stores raw evidence on the T7 and compact observations in Supabase, and requires two comparable snapshots before analysis. Marketplace rank is labelled as a proxy rather than a sales count. Discord approval writes a `ProductOpportunitySchema` planning handoff but explicitly does not enqueue generation.

The first safe cadence is enabled inside the existing 01:30 primary night shift. Collection and short analysis run before qualification, video maintenance, and lead generation; lead generation remains the final and most intensive phase. A resource-busy start gets one sequential retry after awaited maintenance and immediately before lead generation. The research phase has no independent LaunchAgent, does not run in the 07:00 fallback, and skips the night if that bounded retry also finds shared resources unavailable. Nightly snapshots feed the same rolling evidence history; future weekly/monthly scoring should aggregate that history rather than creating a separate one-time “evergreen map.”

Research recommendations distinguish a new product from an extension to an existing product. Research selects what is worth making; the release pipeline owns how it is represented. Every approved extension must rebuild the complete versioned download and a coherent full-release cover/screenshot/animation set from all approved assets, update the existing marketplace listing, verify the resulting public presentation, and pass a separate publication gate. Marketplace media should represent the current release rather than accumulating an unbounded screenshot history.

Do not create those child issues yet. Finish the issue #146 pilot first and keep #149 as one parked architecture epic. When research work actually starts, create at most two implementation issues initially: one for the research foundation plus first source, and one for scoring, digest, handoff, and first-party feedback. Split further only when an active implementation becomes too large to review safely.

## itch.io product-page presentation

Butler owns build/channel uploads only. The official itch.io API does not currently provide documented operations for creating a project or changing its title, description, price, screenshots, cover, or visual theme. Those page fields must be managed through the authenticated Edit game and Theme editor interfaces.

For the pilot, use itch.io's built-in theme editor before requesting custom CSS access:

- keep the generated 630x500 cover as the honest product thumbnail;
- add three to five deterministic screenshots made from the included assets;
- use a dark navy background with cyan and violet accents matching the pack palette;
- provide a short benefit-led description, exact file inventory, dimensions, format, license, engine compatibility, and the neutral statement `Right-facing side-view sprites supplied as transparent PNG files.`;
- keep the page and upload private/hidden until creative, license, pricing, and distribution approval are complete.

ORION can generate all copy and visual presentation assets deterministically. Applying them can later be browser-automated in an authenticated session, but publication remains an explicit human-approved action.
