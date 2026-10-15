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

The proof writes to `neon-plasma-armory/experiments/arc-launcher-effects-proof-v2`. The local model generates the projectile plus one peak keyframe for each animation; ORION derives the remaining phases deterministically around the fixed origin to prevent identity drift. It produces four fixed-origin muzzle-flash frames, four fixed-center impact/decay frames, transparent PNG sprite sheets, `animation.json` metadata, isolated GIF previews, a weapon-composited muzzle GIF, and a wider looping weapon-and-projectile travel GIF for review. By default, ORION detects the barrel exit from the rightmost opaque terminal band and stores the resolved weapon-local anchor plus its detection evidence in the manifest; a manual anchor remains available for unusual silhouettes. Compositing uses that resolved anchor without baking movement into either asset. GIF files and projectile travel are previews only; buyer/runtime formats are the stationary transparent PNG frames, PNG sprite sheets, and animation metadata. All animation metadata declares zero root motion. The approved pack is extended only through a later versioned-release workflow after this proof receives human approval.

After the Arc Launcher reference is approved, run the smallest and largest silhouette checks with `plasma-pistol-effects.pilot.json` and `ion-cannon-effects.pilot.json`. Each proof has its own experiment directory, effect keys, timing profile, manifest, and weapon-prefixed preview filenames, so the runs cannot overwrite one another.
