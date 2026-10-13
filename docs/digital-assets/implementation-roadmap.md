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
- Nothing is registered with night shift in this phase.

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
- [ ] Upload the export to a new hidden itch.io Butler channel and verify the returned build.
- Add a master style reference and shared seed/prompt vocabulary.
- Add silhouette, scale, outline, and perceptual-similarity checks.
- Add duplicate and near-duplicate detection.
- Add sprite-sheet assembly and inventory validation.
- Review every asset and record accepted/rejected reasons.
- Replace the draft product license with reviewed terms.

Exit criterion: one coherent, useful, original pack whose files can be imported into a game engine without manual repair.

### Retention decision

- T7 is the canonical large-file store; Supabase stores metadata, hashes, decisions, and publication state only.
- Keep approved individual assets, release manifests, covers, sprite sheets, and exact marketplace exports while the product remains supported.
- Delete Mac scratch copies only after a byte-for-byte SHA-256 match against T7.
- Retain raw model sources and rejected candidates through review and revisions, then make them eligible for a later verified retention sweep.
- Never treat itch.io or another marketplace as the backup of record.
- Add a second backup target before the catalog becomes commercially important because one T7 remains a single point of failure.

### Phase 3 — itch.io adapter

Status: **blocked by Phase 2**

- Verify current itch.io seller requirements and AI-generated-content policies.
- Implement capability declaration rather than assuming full API support.
- Create generic and itch-specific ZIP exports from the canonical product.
- Generate honest listing copy and previews from the included assets.
- Require explicit approval before any upload or publication.
- Persist external product ID, URL, version, status, price, and errors.

### Phase 4 — Second marketplace

Status: **blocked by Phase 3**

Add a second adapter without modifying opportunity validation, asset generation, canonical product metadata, or core packaging. If those areas must change, revisit the adapter boundary first.

### Phase 5 — Scheduling and analytics

Status: **deferred**

- Add a dedicated low-contention generation window only after manual reliability is proven.
- Never overlap image generation with lead qualification, video rendering, or another Ollama model.
- Report generated products and failures in the existing morning/Discord operational flow.
- Normalize marketplace sales metrics while retaining provider-specific details.
- Feed actual product performance back to the future Trend Research Engine.

## Next session checklist

1. Read this document and `services/digital-asset-engine/README.md`.
2. Run `npm run digital-assets:test`.
3. Confirm the hidden itch.io `assets-preview` build has finished processing, then inspect it from the Edit game page without making it public.
4. Record per-asset human decisions and the pack-level creative decision against the exact manifest hash.
5. Replace the draft license with reviewed customer terms.
6. Prepare and approve the itch.io listing copy, price, tags, screenshots, cover, and built-in theme.
7. Keep publication blocked until a separate distribution approval is recorded.

## Deferred decisions

- Final ORION customer license language.
- Whether canonical products live permanently on T7 or are mirrored there.
- Supabase schema for product and marketplace state.
- Discord review-card design and approval roles.
- Trend Research Engine input transport.
- Marketplace #2.
- Cloud/GPU worker selection.

None of these deferred decisions block validating the first local generation pipeline.

## Proposed Discord pack approval

Status: **decision pending; not implemented**

The recommended shape is one pack-level review card in ORION's existing Discord operations environment, with a thread for individual asset previews and feedback. The card should show the product/version, overview preview, asset count, automated validation state, local generation cost, intended marketplaces, and manifest hash.

Suggested actions are `Approve pack`, `Request changes`, `Reject`, and `Open manifest`. Each decision must record the Discord actor, timestamp, reason, product version, and exact manifest hash. Any change to an asset, metadata, pricing, license, or manifest invalidates the earlier approval.

Creative approval and distribution approval should remain separate gates:

```text
Generated pack -> automated validation -> creative approval
Creative approval -> marketplace export preview -> distribution approval
Distribution approval -> adapter execution
```

This avoids an accidental interpretation that approving the art also authorizes immediate external publication. The fuller proposal and open decisions are in [issue-146-product-brief.md](./issue-146-product-brief.md).

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

## Research-engine boundary - issue #149

Issue #149 remains valuable as the architecture charter for answering *what should ORION make?* It must stay separate from this engine, which answers *how do we generate, review, package, and distribute an approved opportunity?*

Before implementation, split the epic into bounded work items for source capability research, historical observations, opportunity scoring, Discord research digests, the handoff contract, and first-party sales feedback. Do not assume that public competitor sales or download counts are available: each source adapter must distinguish observed evidence from inferred proxies and document its allowed access method and cadence. Research creates proposals; only human-promoted opportunities enter the generation backlog.

## itch.io product-page presentation

Butler owns build/channel uploads only. The official itch.io API does not currently provide documented operations for creating a project or changing its title, description, price, screenshots, cover, or visual theme. Those page fields must be managed through the authenticated Edit game and Theme editor interfaces.

For the pilot, use itch.io's built-in theme editor before requesting custom CSS access:

- keep the generated 630x500 cover as the honest product thumbnail;
- add three to five deterministic screenshots made from the included assets;
- use a dark navy background with cyan and violet accents matching the pack palette;
- provide a short benefit-led description, exact file inventory, dimensions, format, license, engine compatibility, and the statement `Side-view sprites; one direction, horizontally mirrorable.`;
- keep the page and upload private/hidden until creative, license, pricing, and distribution approval are complete.

ORION can generate all copy and visual presentation assets deterministically. Applying them can later be browser-automated in an authenticated session, but publication remains an explicit human-approved action.
