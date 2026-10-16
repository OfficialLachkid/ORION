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

The overview message owns the single package gate: `Approve Pack`, `Request Changes`, `Reject Pack`, `Open itch.io Draft`, and `Open Manifest`. Individual thread messages are numbered visual previews without decision buttons. `Request Changes` opens one form with a selectable/deselectable numbered asset list and one shared feedback field. Unselected assets are accepted for that revision; selected assets receive `request_changes`.

Before a decision is stored, the live bot verifies the operator allowlist, overview message, populated itch.io listing hash, package manifest hash, and every exported asset hash against the canonical T7 files. It appends one atomic decision to `digital_asset_release_reviews`, including each asset's resulting outcome. This creative decision does not approve marketplace distribution.

When a corrected package is staged, ORION increments the review revision and edits the existing itch.io draft, Discord overview message, and numbered asset messages. It does not create another channel, thread, or message set.

Apply `supabase/migrations/20261014_create_digital_asset_release_reviews.sql` before enabling the package gate. The earlier `digital_asset_review_decisions` table remains as immutable audit history for the first asset-level pilot. The Discord runtime requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DIGITAL_ASSET_ARCHIVE_ROOT`. Do not use the publishable key for these service-role-only tables.

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
