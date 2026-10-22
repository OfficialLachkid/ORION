# ORION Digital Asset Engine

The first vertical slice converts a validated product opportunity into a canonical, marketplace-independent product and can generate pixel-art assets locally through Ollama.

Safety defaults:

- planning is separate from execution;
- generation requires `--execute`;
- Ollama must be on the local machine;
- no cloud fallback or per-image API billing;
- output is blocked from distribution until human review;
- generation is not connected to night shift yet;
- canonical license text remains a draft until reviewed.

Plan the included issue #146 opportunity:

```bash
npm run digital-assets:plan
```

Generate on the Mac after confirming Ollama is idle:

```bash
npm run digital-assets:generate -- --execute
```

Generate the eight-item pilot pack on the T7:

```bash
npm run digital-assets:generate -- \
  --execute \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

Generation automatically resumes assets whose final PNG and validation hash still match. Assemble a deterministic, unapproved itch.io connection-test export with:

```bash
npm run digital-assets:package -- \
  --internal-preview \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The preview export contains a buyer-download directory with only distributable candidates, a sprite sheet, README, and draft license. The marketplace cover, listing metadata, and review hashes remain beside that directory and are not uploaded as buyer files. Full-resolution model source images are never included.

Upload the buyer package with Butler, populate the existing itch.io draft through the dedicated authenticated Playwright profile, and verify the saved page before opening Discord review:

```bash
npm run digital-assets:itch-draft -- \
  --stage-itch-draft \
  --itch-url "https://vbjservices.itch.io/asset-pack-test?secret=..." \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The command updates the same Butler channel and the same itch.io project on every revision. It writes `review/itch.json` only after title, descriptions, price, tags, cover, screenshots, and draft visibility have been read back successfully. A first run may stop with `login_required`; log into itch.io once in the dedicated `~/.orion/playwright-profile-itch` browser profile and rerun it.

Post the packaged pilot into a pack channel under the existing `DIGITAL ASSETS` Discord category, create its asset-review thread, and attach every individual sprite:

```bash
npm run digital-assets:discord-review -- \
  --post-to-discord \
  --itch-url "https://vbjservices.itch.io/asset-pack-test" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The overview message owns the single package gate: `Approve Pack`, `Request Changes`, `Reject Pack`, `Open itch.io Draft`, and `Open Manifest`. It derives its attachments from the versioned listing's cover, optional static cover fallback, and complete `screenshot_paths` array rather than assuming a fixed image count. When the media, manifest, and license exceed Discord's ten-attachment limit, ORION keeps the first group on the overview and posts deterministic continuation messages for every remaining image. Individual thread messages are numbered visual previews without decision buttons. `Request Changes` opens one form with a selectable/deselectable numbered asset list and one shared feedback field. Unselected assets are accepted for that revision; selected assets receive `request_changes`.

Before a decision is stored, the live bot verifies the operator allowlist, overview message, populated itch.io listing hash, package manifest hash, and every exported asset hash against the canonical T7 files. It appends one atomic decision to `digital_asset_release_reviews`, including each asset's resulting outcome. This creative decision does not approve marketplace distribution.

For a newly generated product that does not have an itch.io page yet, creative approval now creates a separate `Marketplace Setup Required` card in the same pack channel. `Create itch.io Draft` authorizes only this setup job: ORION discovers or creates the canonical project through the authenticated Playwright profile, pins it to downloadable game assets with AI disclosure and draft visibility, applies the generated listing and media, uploads the buyer package through Butler, and reads the result back. The job is durable on the T7 and is resumed after a bot restart if its worker was interrupted. Nothing is published by this action.

Reconcile that card manually for a package that was approved before the bot deployed this workflow:

```bash
npm run digital-assets:marketplace-setup-review -- \
  --post-to-discord \
  --slug arcane-relics-potions \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

After the draft, download, cover, screenshots, listing fields, price, and draft visibility are verified, ORION updates the setup card and posts the independent publication card. `Approve itch.io Publish` remains a separate manifest-bound decision; the setup button can never make the page public.

After creative approval, verify the seller account and reconcile the separate distribution gate:

```bash
npm run digital-assets:seller-preflight -- \
  --release-version 0.2.0 \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"

npm run digital-assets:distribution-review -- \
  --post-to-discord \
  --release-version 0.2.0 \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The seller preflight reads payout mode and tax-interview readiness without modifying the itch.io account. The distribution gate uses a dedicated message in the pack channel so package approval and marketplace authorization remain visibly separate and old package cards do not exhaust Discord's edit limit. A ready initial release exposes `Approve itch.io Publish` and `Keep Draft`; a versioned update exposes `Approve itch.io Update` and `Keep Current Release`. Published updates are bound to both the exact approved candidate and the verified current public-release receipt. The append-only decision in `digital_asset_distribution_reviews` durably queues the manifest-bound publisher. Interrupted approved jobs are recovered when the Discord bot restarts.

After `Approve itch.io Publish` is recorded for the exact release, run the explicit publication adapter:

```bash
npm run digital-assets:itch-publish -- \
  --publish-itch \
  --headless \
  --release-version 0.2.0 \
  --playwright-profile "/Users/Agent/.orion/playwright-profile-itch" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

For an initial release, the adapter revalidates creative approval, seller readiness, distribution approval, manifest hash, listing hash, title, price, cover, screenshots, and current draft visibility before changing only the itch.io visibility control.

For an already-public versioned update, the same command fails closed unless the distribution approval is bound to the exact new candidate and exact current public-release receipt. It then verifies that the existing project is still public, pushes the approved buyer package to the existing Butler channel, replaces the cover and the complete dynamic screenshot list, updates the listing fields without changing visibility, and reads the editor back. In both modes it opens the clean public URL, verifies the title, paid purchase action, price, downloadable ZIP, payment actions, and public accessibility, stores `review/itch-release.json`, captures `review/itch-public.png`, advances the existing Discord card, and makes exact verified retries idempotent.

## Public URL and storefront theme

The product title belongs to ORION's versioned listing metadata. Operators should not maintain a second manual title in itch.io: draft staging and verification keep the itch.io title equal to the approved listing title. The public URL slug is separate and is migrated once through the guarded browser workflow:

```bash
npm run digital-assets:itch-slug -- \
  --migrate-itch-slug \
  --target-itch-slug neon-plasma-armory \
  --release-version 0.2.0 \
  --playwright-profile "/Users/Agent/.orion/playwright-profile-itch" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The migration requires the exact verified public release. It preserves the approved title, verifies the new anonymous URL, updates the Butler target and T7 marketplace receipts together, and patches the existing Discord public link. The explicit migration flag prevents an accidental URL change.

itch.io does not require approval for its built-in Theme editor. Only custom CSS access requires separate itch.io approval. ORION therefore uses built-in theme controls first. Generate deterministic banner/background media, ask the local `llama3.1:8b` model for a constrained color and typography recipe, simulate desktop and mobile views without saving, and post those previews to Discord:

```bash
npm run digital-assets:itch-theme-review -- \
  --post-to-discord \
  --theme-model llama3.1:8b \
  --release-version 0.2.0 \
  --playwright-profile "/Users/Agent/.orion/playwright-profile-itch" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The banner uses only approved packaged assets and carries preview markings; the procedural background contains no invented product artwork. The text model runs locally through Ollama, has no cloud fallback, and incurs no per-call API cost. The preview action does not mutate the public page. After `Approve Theme` is stored for the exact manifest, listing, and theme hashes, apply and read the built-in theme back on desktop and mobile:

`Request Theme Changes` stores the operator feedback, queues a durable local revision job, and includes the previous design plus that binding feedback in the next Ollama prompt. Rejected candidates remain immutable on the T7. The worker replaces the two preview attachments on the existing Discord message, increments the visible revision, and restores the approval controls. Queued or interrupted revisions are recovered after a Discord bot restart rather than creating duplicate messages.

```bash
npm run digital-assets:itch-theme-apply -- \
  --apply-itch-theme \
  --release-version 0.2.0 \
  --playwright-profile "/Users/Agent/.orion/playwright-profile-itch" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

Apply `supabase/migrations/20261016_create_digital_asset_theme_reviews.sql` before enabling the Discord theme gate. Theme decisions are append-only and service-role-only. The applied receipt is stored as `review/itch-theme-release.json`; retries reuse an exact verified receipt.

After publication, improve the existing description presentation without reopening the release or touching its price, title, files, cover, screenshots, or visibility:

```bash
npm run digital-assets:itch-description -- \
  --update-itch-description \
  --release-version 0.2.0 \
  --playwright-profile "/Users/Agent/.orion/playwright-profile-itch" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

This command requires the exact `verified_public` receipt, converts the canonical plain-text sections and bullets into itch headings and lists, reads the public DOM back, and stores the idempotent presentation receipt as `review/itch-description.json`.

When a corrected package is staged, ORION increments the review revision and edits the existing itch.io draft, Discord overview message, and numbered asset messages. It does not create another channel, thread, or message set.

Apply `supabase/migrations/20261014_create_digital_asset_release_reviews.sql` before enabling the package gate and `supabase/migrations/20261016_create_digital_asset_distribution_reviews.sql` before enabling the distribution gate. The earlier `digital_asset_review_decisions` table remains as immutable audit history for the first asset-level pilot. The Discord runtime requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DIGITAL_ASSET_ARCHIVE_ROOT`. Do not use the publishable key for these service-role-only tables.

The ORION bot needs `View Channel`, `Send Messages`, `Embed Links`, `Attach Files`, `Create Public Threads`, and `Send Messages in Threads` in the `DIGITAL ASSETS` category. It also needs `Manage Channels` when ORION is expected to create the per-pack channel itself. Grant these as category permissions so each new pack channel inherits them.

Set `DIGITAL_ASSET_ARCHIVE_ROOT` for both generation and the live Discord bot, for example `/Volumes/T7/O.R.I.O.N. Digital Assets`.

Canonical approved assets, release manifests, covers, sprite sheets, and marketplace exports remain on the T7 while a product is supported. Mac working copies can be removed after their T7 hashes are verified. Model source images and rejected candidates are retention-managed separately; marketplace uploads are delivery copies, not backups.

## Isolated effects proof

Generate the Arc Launcher effects proof without changing the approved product, Discord review, or itch.io draft:

```bash
npm run digital-assets:effects-pilot -- \
  --execute \
  --pilot services/digital-asset-engine/fixtures/arc-launcher-effects-v2.pilot.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The proof writes to `neon-plasma-armory/experiments/arc-launcher-effects-proof-v2`. The local model generates the projectile plus one peak keyframe for each animation; ORION derives the remaining phases deterministically around the fixed origin to prevent identity drift. It produces four fixed-origin muzzle-flash frames, four fixed-center impact/decay frames, transparent PNG sprite sheets, `animation.json` metadata, isolated GIF previews, a weapon-composited muzzle GIF, a wider looping weapon-and-projectile travel GIF, and a combined attack-cycle GIF containing the weapon, muzzle sequence, travelling projectile, and impact/decay at the projectile endpoint. By default, ORION detects the barrel exit from the rightmost opaque terminal band and stores the resolved weapon-local anchor plus its detection evidence in the manifest; a manual anchor remains available for unusual silhouettes. Compositing uses that resolved anchor without baking movement into either asset. GIF files and projectile travel are previews only; buyer/runtime formats are the stationary transparent PNG frames, PNG sprite sheets, and animation metadata. All animation metadata declares zero root motion. The approved pack is extended only through a later versioned-release workflow after this proof receives human approval.

After the Arc Launcher reference is approved, run the smallest and largest silhouette checks with `plasma-pistol-effects.pilot.json` and `ion-cannon-effects.pilot.json`. Each proof has its own experiment directory, effect keys, timing profile, manifest, and weapon-prefixed preview filenames, so the runs cannot overwrite one another.

The first boundary run completed on 2026-10-15. The Plasma Pistol resolved its muzzle to `{x:111,y:12}` and generated in 192,923 ms with manifest `5cc7719454c239e0c1b631de56951fc4959fd9f5fbd216da219c04923097ef72`. The Ion Cannon resolved to `{x:128,y:15}` and generated in 192,197 ms with manifest `6216e3d89e336e2e12070ae5071a67c84c1a4f05525e248be72d0b378bcecf5e`. Each run used three local model calls, derived six frames deterministically, incurred zero API cost, and remained isolated from the canonical release and marketplace listing.

Generate the five remaining weapon proofs sequentially from the compact, reproducible batch plan:

```bash
npm run digital-assets:effects-batch -- \
  --execute \
  --batch services/digital-asset-engine/fixtures/remaining-weapon-effects.batch.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The batch stops on the first failed proof, preserves every previously completed experiment, and prints a per-weapon manifest, muzzle anchor, attack-cycle path, generation-call count, and duration. It does not mutate the canonical release, Discord package decision, or marketplace listing.

## Interactive item animation recipes

Generate the current interactive expansion proof without changing the approved product or live package:

```bash
npm run digital-assets:interactive-items -- \
  --execute \
  --item-animation-plan services/digital-asset-engine/fixtures/neon-plasma-armory-interactive-expansion-v2.batch.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

An interactive-item recipe treats approved base artwork as immutable. ORION detects the recipe's configured emissive colors dynamically from each sprite, records their connected components and centroid, and rejects a pulse frame if any visible pixel outside that region changes. Explosions, collection bursts, and isolated magical effects align their detected bright core to the corresponding base-sprite anchor before deterministic phases are derived. The base sprite never moves and is never regenerated.

Each item may emit named transparent state PNGs, a state contact sheet, transparent overlay frames, ready-to-use composite frames, non-overlapping sprite sheets, `animation.json` with zero root motion, validation evidence, and review-only GIFs. The current recipes cover explosive devices, shield emitters, power cells, energy pickups, supply crates, powered workbenches, potions, crystals, rune stones, tomes, alchemy flasks, ritual candles, and wands; chairs remain static. A failed state or animation holds the complete item candidate. This is the first asset-type recipe toward production jobs that generate the complete contract for a researched product in one run: required base images, angles, states, animations, metadata, validation, and review previews. Requirements remain type-specific; ORION must not invent unnecessary angles or animations for every asset.

The current Arcane animation proof uses the same command with `services/digital-asset-engine/fixtures/arcane-relics-potions-animation-v7.batch.json`. The fixture is a reproducible product plan, while the recipes and executor remain reusable. Potion and flask liquids, rune activation, a wick-anchored dancing candle flame, upward-oriented smoke, readable faceted crystal turns, tome aura energy, and other mutable regions are detected or derived from the reviewed sprite. Flame deformation uses inverse pixel sampling so stretched frames remain contiguous rather than introducing transparent stripe rows. Identity-sensitive states remain deterministic. When a base sprite itself is unsuitable, a plan may request one explicit local-model replacement; that new base is marked `base_regenerated`, reviewed as `replace_existing`, and cannot silently overwrite the published asset. Ollama remains reserved for isolated effects such as smoke and standalone spells, plus explicitly reviewed replacement bases. Wand charge and spell VFX are delivered separately so buyers can combine them freely. Every animation remains fixed-root; GIFs are review previews, while buyers receive transparent states, frame sequences, sheets, and JSON metadata after the proof is approved and promoted through a versioned release.

Supply-crate open states are explicitly marked for human identity review because the installed local image endpoint is text-to-image only and cannot condition on the approved closed-crate pixels. They may be reviewed as an isolated experiment, but should not be promoted if proportions, perspective, or design identity drift. Other state recipes modify only detected energy regions or compose isolated VFX over an immutable base.

An expansion-plan asset may reference an approved `interactive_proof` by `batch_id` and `asset_key`; legacy `animation_proof` references remain accepted. Preparing the expansion review then verifies the proof's immutable item manifest, confirms its base PNG is byte-identical to the proposed static asset, excludes model source files, and binds state PNGs, runtime frames, overlays, sheets, metadata, validation evidence, contact sheets, and review GIFs into the same expansion manifest. Discord updates the existing expansion overview and asset messages in place. The existing Supabase expansion decision stores the aggregate interactive-bundle hash, so adding new recipes does not require a database migration.

After Discord approves the exact expansion manifest, promote it into a complete versioned buyer candidate:

```bash
npm run digital-assets:prepare-expansion-release -- \
  --internal-preview \
  --expansion-plan services/digital-asset-engine/fixtures/neon-plasma-armory-static-expansion.review.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

This command fails closed if the expansion approval is absent or stale. It verifies the immutable `0.2.0` base and approved expansion files, copies only buyer-useful states, frames, overlays, sheets, and metadata into a content-addressed `0.3.0` candidate, and rebuilds the complete listing media. Review GIFs, validation reports, model sources, and duplicated base images stay outside the paid download. The storefront preserves the established weapon inventory, effects breakdown, and firing-cycle preview, then appends a separate expansion inventory and interactive montage. Its protected slow animated cover shows weapon and expansion scenes sequentially rather than mixing their asset families. Each grid entry is scaled from its visible alpha bounds instead of its source canvas, so transparent padding cannot make a valid sprite unreadably small. The weapon sequence holds and labels the base, independent muzzle-flash, projectile, and impact/decay phases before moving to the expansion assets. Assets that declare an `integrity-decay` lifecycle are previewed as one monotonic decay followed only by the terminal scatter and empty break frames; unrelated animation samples cannot make the preview appear to restore integrity.

If review finds a problem in only selected effect kinds, create new immutable proof revisions while inheriting the accepted artifacts. The current targeted revision regenerates only the Ion Pistol and Energy Shotgun impact/decay keyframes, then derives their decay frames deterministically:

```bash
npm run digital-assets:revise-effects -- \
  --execute \
  --revision-plan services/digital-asset-engine/fixtures/weapon-impact-decays.revision.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The original `-v1` experiments remain unchanged. The `-v2` experiments inherit the approved projectile and muzzle artifacts byte-for-byte, record their source pilot and revision reason, and make one local model call per replacement impact. A target pilot ID is immutable: a changed specification must use a new revision ID.

After all eight experiments exist, post or reconcile the read-only effects presentation in the existing pack channel:

```bash
npm run digital-assets:effects-review -- \
  --post-to-discord \
  --review-plan services/digital-asset-engine/fixtures/all-weapon-effects-v2.review.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

This creates one effects overview and an `effects-review-v1` thread. Each numbered weapon message attaches its complete firing cycle plus the separate muzzle-flash, projectile-travel, and impact/decay GIFs. The exact experiment manifests are combined into one hashed review receipt. This presentation intentionally has no approval buttons yet; it does not reuse the package-release decision for an unversioned extension.

Prepare an immutable `0.2.0` package-extension candidate after the base package and effects presentation have been verified:

```bash
npm run digital-assets:prepare-extension -- \
  --internal-preview \
  --extension-plan services/digital-asset-engine/fixtures/neon-plasma-armory-effects.extension.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The command verifies the exact approved base manifest, its persisted package approval, the effects review bundle, every canonical weapon hash, and every copied effect frame/sheet/metadata hash. It writes a content-addressed candidate below `releases/0.2.0/candidates/` and never changes `product.json`, the current itch.io export, or the Discord package decision. Rerunning the same inputs verifies and reuses the same immutable candidate; changed proof inputs create a new candidate directory.

Buyer files contain the original weapon package plus independent transparent muzzle-flash, stationary-projectile, and impact/decay frames, sprite sheets, animation JSON, `weapon-anchors.json`, buyer-facing documentation, and the exact customer license under review. Animation paths are rewritten and verified against the packaged layout. Model source images, validation internals, and review-only GIFs are excluded. The license identity and content hash are part of the immutable candidate manifest, so approving the exact package also covers the exact license text. Open quality holds prevent a candidate from being staged for package review.

A quality-cleared candidate also builds its marketplace presentation deterministically from the verified package contents: one high-contrast 630x500 grid cover, one weapon inventory image, one independent-effects breakdown, and one protected animated firing-cycle montage. These files remain outside `download/`; clean transparent runtime files remain buyer-only.

Stage and verify the latest immutable `0.2.0` candidate against the existing itch.io project while keeping it in draft:

```bash
npm run digital-assets:itch-draft -- \
  --stage-itch-draft \
  --release-version 0.2.0 \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --itch-url "https://vbjservices.itch.io/asset-pack-test?secret=..." \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

After Playwright reads every saved field and uploaded media item back successfully, reconcile the existing Discord package gate with the same candidate hashes:

```bash
npm run digital-assets:discord-review -- \
  --post-to-discord \
  --release-version 0.2.0 \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --itch-url "https://vbjservices.itch.io/asset-pack-test?secret=..." \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

The effects thread is a proof gallery, not an independent release gate. The existing package overview remains the single authoritative approval surface for the exact candidate, listing, download, and customer-license hashes.
