# Issue #146 Product Brief

## Purpose

This document preserves the product intent of issue #146 while the implementation evolves. Use it together with [implementation-roadmap.md](./implementation-roadmap.md): this brief defines the destination and decision boundaries; the roadmap records the current implementation and next executable steps.

## Product goal

ORION should turn a validated market opportunity into an original, coherent, professionally packaged digital asset product, then adapt that canonical product for one or more marketplaces without coupling generation to any marketplace.

The first product type is a pixel-art game asset pack. The initial technical proof is a transparent science-fiction weapon sprite generated locally on the Mac mini.

Trend discovery is deliberately outside this service. A future Trend Research Engine supplies the opportunity; the Digital Asset Engine performs final validation, planning, generation, packaging, approval, distribution, maintenance, and feedback.

## Non-negotiable principles

- Create one canonical product before any marketplace exports.
- Keep marketplace logic behind capability-aware adapters.
- Prefer useful, coherent packs over high-volume output.
- Generate original work without artist, franchise, or protected-property imitation.
- Require human approval before external publication.
- Preserve immutable source output and trace derived assets through manifests.
- Keep local generation explicit, resource-aware, and free of silent cloud fallback.
- Increase autonomy only after repeated manual runs demonstrate reliability.

## Target flow

```text
Validated opportunity
  -> product plan and style system
  -> original asset generation
  -> deterministic processing
  -> automated validation
  -> canonical product package
  -> human pack approval
  -> marketplace-specific exports
  -> explicit distribution
  -> marketplace state and analytics
  -> feedback to trend research
```

## Scope and status

| Capability | Issue intent | Current status |
| --- | --- | --- |
| Opportunity input | Accept structured demand, competition, audience, format, pricing, and risk evidence | Implemented for the V0.1 schema and fixture |
| Final opportunity gate | Reject stale, weak, duplicative, or high-risk opportunities before generation | Implemented for deterministic freshness, demand, competition, confidence, scope, and IP checks; internal catalog similarity is still a hook |
| Originality controls | Avoid protected names, copied compositions, and artist imitation | Prompt/input rules implemented; perceptual comparison and richer audit evidence remain |
| Product planning | Produce theme, inventory, dimensions, palette, naming, folder plan, and generation prompts | Implemented for the first product specification |
| Pixel-art generation | Generate useful sprites through a replaceable provider | One local Ollama/FLUX asset proven end to end |
| Style consistency | Hold palette, outline, scale, lighting, perspective, and silhouette consistent across a pack | Not yet proven across a pack |
| Automated validation | Validate structure, dimensions, transparency, palette, corruption, completeness, and similarity | Core PNG, alpha, dimension, palette, content, chroma, and hash checks implemented; pack-level and perceptual checks remain |
| Canonical product | Maintain marketplace-independent metadata, version, assets, previews, validation, license, and exports | Initial workspace and manifest implemented |
| Packaging | Produce clean folders, documentation, versioning, license, and ZIP archives | Initial folders and documents implemented; ZIP and reviewed license remain |
| Preview generation | Produce accurate cover, overview, sheet, and usage previews | Checkerboard transparency preview implemented; marketing preview set remains |
| Human approval | Approve, request changes, or reject before distribution | State is blocked awaiting review; durable Discord interaction and audit record remain |
| Marketplace adapters | Convert canonical products using declared platform capabilities | Not started |
| First marketplace | Prove publish, update, and available state reading for itch.io | Pending a coherent approved pack and current policy/API research |
| Distribution state | Persist external IDs, URLs, versions, review state, prices, errors, and capability level | Not started |
| Maintenance | Update products, previews, listings, versions, and changelogs | Canonical version/changelog placeholders exist; lifecycle automation remains |
| Analytics and feedback | Normalize available sales metrics and return performance to trend research | Deferred until a marketplace integration exists |
| Scheduling | Run safely during low-contention periods on the Mac worker | Deliberately disabled until manual reliability is established |

## Human approval boundary

Approval must apply to an immutable pack build, not merely a product name. A decision record should contain:

- canonical product ID and version;
- manifest hash;
- validation summary and preview references;
- decision: `approved`, `changes_requested`, or `rejected`;
- approving Discord user ID;
- timestamp and optional reason;
- selected marketplace targets, recorded separately from creative approval.

Creative approval and distribution approval are distinct gates. Approving the pack means its contents are accepted; it does not by itself authorize publication. Any asset, metadata, license, price, or manifest change invalidates the earlier approval and creates a new reviewable build.

## Proposed Discord review experience

This is a proposal for discussion, not an implemented decision.

Use one pack-level review card in the existing ORION Discord operations environment and create a thread for asset-level inspection and feedback. The card should show the pack name/version, overview preview, asset count, automated validation result, generation cost, manifest hash, and intended marketplaces.

Suggested actions:

- **Approve pack** - records creative approval for the exact manifest hash.
- **Request changes** - records a reason and returns the build to generation/rework.
- **Reject** - closes the candidate without permitting distribution.
- **Open manifest** - exposes the full inventory, validation report, and individual previews.

After pack approval, a separate distribution card can ask which marketplaces to publish to and show marketplace-specific warnings, pricing, packaging, and automation capability. This keeps "the product is good" separate from "publish this product now."

## MVP completion check

Issue #146 defines the complete MVP as all of the following. The current branch is an architecture and vertical-slice milestone, not the completed business engine.

- [x] Receive a validated opportunity.
- [x] Create a coherent product specification for the first asset.
- [ ] Generate an original, coherent asset pack.
- [ ] Validate the complete pack, including consistency and duplicates.
- [ ] Package it professionally with final license and archives.
- [ ] Generate the complete, accurate preview set.
- [x] Create initial canonical metadata.
- [ ] Adapt it for marketplace #1.
- [ ] Publish and update through supported mechanisms.
- [ ] Persist product and marketplace state.
- [x] Handle core local generation and validation errors.
- [ ] Collect available marketplace performance data.
- [ ] Feed performance back to Trend Research.
- [x] Remain marketplace-independent internally.

## Prioritized next steps

1. Decide the Discord pack-approval experience and persistence model, especially whether creative and distribution approvals require different roles.
2. Expand the single-asset proof into a deliberately designed 8-16 item mini-pack with a shared style reference.
3. Tune chroma removal, palette, scale, silhouette, and consistency checks against at least five varied assets while recording generation time and peak resource use.
4. Add pack inventory validation, near-duplicate detection, sprite-sheet assembly, and complete preview generation.
5. Implement immutable build manifests and auditable approval records keyed by manifest hash.
6. Review and finalize ORION's customer-facing asset license.
7. Research current itch.io requirements and capabilities, then implement the first export adapter and ZIP package.
8. Add publication only after pack approval is proven; add scheduling and analytics in later phases.

## Open decisions

- Discord channel, roles, thread behavior, and approval persistence backend.
- Permanent canonical storage on the T7 versus a mirrored working copy.
- Final customer license terms and disclosure wording.
- Minimum pack size and quality threshold by asset category.
- Marketplace #2 after itch.io.
- Whether and when a cloud/GPU worker is warranted.
