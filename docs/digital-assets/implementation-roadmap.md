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
- [ ] Generate and visually review all eight candidates on the Mac/T7.
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
3. Run the example `plan` command and inspect the canonical product directory.
4. On the Mac, verify `ollama list` includes `x/flux2-klein:4b` and `/api/ps` shows no conflicting loaded model.
5. Set the T7 archive root and run one explicit generation.
6. Open the transparency preview and validation report.
7. Record the human verdict before expanding to a pack.

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
