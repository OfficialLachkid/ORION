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

The preview export contains only distributable candidates, a sprite sheet, an actual-asset cover, listing metadata, hashes, and explicit draft-license warnings. It never includes the full-resolution model source images.

Post the packaged pilot into a pack channel under the existing `DIGITAL ASSETS` Discord category, create its asset-review thread, and attach every individual sprite:

```bash
npm run digital-assets:discord-review -- \
  --post-to-discord \
  --itch-url "https://vbjservices.itch.io/asset-pack-test" \
  --runtime-env "/Users/Agent/Workspace/ORION/config/discord/.env" \
  --opportunity services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json \
  --output-root "/Volumes/T7/O.R.I.O.N. Digital Assets"
```

Each individual asset message has `Approve`, `Request Changes`, `Reject`, and `Open Manifest` actions. Change requests and rejections require a reason. Before a decision is stored, the live bot verifies the operator allowlist, guild, thread, Discord message, product, full manifest hash, and exported asset hash against the canonical T7 files. It then appends the decision to Supabase and resolves the buttons for that exact review message. This does not approve marketplace distribution.

Apply `supabase/migrations/20261014_create_digital_asset_review_decisions.sql` before enabling the buttons. The Discord runtime requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DIGITAL_ASSET_ARCHIVE_ROOT`. Do not use the publishable key for this service-role-only table.

The ORION bot needs `View Channel`, `Send Messages`, `Embed Links`, `Attach Files`, `Create Public Threads`, and `Send Messages in Threads` in the `DIGITAL ASSETS` category. It also needs `Manage Channels` when ORION is expected to create the per-pack channel itself. Grant these as category permissions so each new pack channel inherits them.

Set `DIGITAL_ASSET_ARCHIVE_ROOT` for both generation and the live Discord bot, for example `/Volumes/T7/O.R.I.O.N. Digital Assets`.

Canonical approved assets, release manifests, covers, sprite sheets, and marketplace exports remain on the T7 while a product is supported. Mac working copies can be removed after their T7 hashes are verified. Model source images and rejected candidates are retention-managed separately; marketplace uploads are delivery copies, not backups.
