#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import { loadEngineConfig, resolveOutputRoot } from './src/config.mjs';
import { postDigitalAssetReview } from './src/discord-review.mjs';
import { postDigitalAssetDistributionReview } from './src/distribution-review.mjs';
import { postMarketplaceSetupReview } from './src/marketplace-setup.mjs';
import { updatePublishedItchDescription } from './src/itch-description-maintainer.mjs';
import { generateEffectBatch } from './src/effect-batch.mjs';
import { postEffectsDiscordReview } from './src/effect-discord-review.mjs';
import { generateEffectPilot } from './src/effect-pilot.mjs';
import { reviseEffectBatch } from './src/effect-revision.mjs';
import { prepareVersionedPackageExtension } from './src/release-extension.mjs';
import { stageItchDraft } from './src/itch-draft-stager.mjs';
import { publishApprovedItchRelease } from './src/itch-publisher.mjs';
import { inspectItchSellerReadiness } from './src/itch-seller-preflight.mjs';
import { migrateItchProjectSlug } from './src/itch-slug-migrator.mjs';
import { applyApprovedItchTheme, prepareItchThemeCandidate } from './src/itch-theme.mjs';
import { packageDigitalAssetPreview } from './src/packager.mjs';
import { generateDigitalAssetProduct, planDigitalAssetProduct } from './src/pipeline.mjs';
import { slugify } from './src/product-planner.mjs';
import { markItchThemeApplied, postItchThemeReview } from './src/theme-review.mjs';
import { prepareAssetExpansionReview } from './src/asset-expansion.mjs';
import { prepareApprovedAssetExpansionRelease } from './src/asset-expansion-release.mjs';
import { postAssetExpansionReview } from './src/asset-expansion-review.mjs';
import { generateInteractiveItemAnimationBatch } from './src/interactive-item-animation.mjs';
import { prepareStorefrontRevision } from './src/storefront-revision.mjs';

const DEFAULT_CONFIG = 'services/digital-asset-engine/config.example.json';
const DEFAULT_OPPORTUNITY = 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json';
const DEFAULT_EFFECT_PILOT = 'services/digital-asset-engine/fixtures/arc-launcher-effects-v2.pilot.json';
const DEFAULT_EFFECT_BATCH = 'services/digital-asset-engine/fixtures/remaining-weapon-effects.batch.json';
const DEFAULT_EFFECT_REVISION = 'services/digital-asset-engine/fixtures/weapon-impact-decays.revision.json';
const DEFAULT_EFFECT_REVIEW = 'services/digital-asset-engine/fixtures/all-weapon-effects-v2.review.json';
const DEFAULT_EXTENSION_PLAN = 'services/digital-asset-engine/fixtures/neon-plasma-armory-effects.extension.json';
const DEFAULT_EXPANSION_REVIEW = 'services/digital-asset-engine/fixtures/neon-plasma-armory-static-expansion.review.json';
const DEFAULT_ITEM_ANIMATION_BATCH = 'services/digital-asset-engine/fixtures/neon-plasma-armory-interactive-expansion-v2.batch.json';

function parseArguments(argv) {
  const args = {
    command: argv[2] || 'help',
    execute: false,
    internalPreview: false,
    postToDiscord: false,
    stageItchDraft: false,
    categoryName: 'DIGITAL ASSETS',
  };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--execute') args.execute = true;
    else if (token === '--internal-preview') args.internalPreview = true;
    else if (token === '--post-to-discord') args.postToDiscord = true;
    else if (token === '--stage-itch-draft') args.stageItchDraft = true;
    else if (token === '--publish-itch') args.publishItch = true;
    else if (token === '--migrate-itch-slug') args.migrateItchSlug = true;
    else if (token === '--apply-itch-theme') args.applyItchTheme = true;
    else if (token === '--update-itch-description') args.updateItchDescription = true;
    else if (token === '--headless') args.headed = false;
    else if (token === '--config') args.config = argv[++index];
    else if (token === '--opportunity') args.opportunity = argv[++index];
    else if (token === '--pilot') args.pilot = argv[++index];
    else if (token === '--batch') args.batch = argv[++index];
    else if (token === '--revision-plan') args.revisionPlan = argv[++index];
    else if (token === '--review-plan') args.reviewPlan = argv[++index];
    else if (token === '--extension-plan') args.extensionPlan = argv[++index];
    else if (token === '--expansion-plan') args.expansionPlan = argv[++index];
    else if (token === '--item-animation-plan') args.itemAnimationPlan = argv[++index];
    else if (token === '--release-version') args.releaseVersion = argv[++index];
    else if (token === '--base-version') args.baseVersion = argv[++index];
    else if (token === '--target-version') args.targetVersion = argv[++index];
    else if (token === '--base-manifest-hash') args.baseManifestHash = argv[++index];
    else if (token === '--suggested-price') args.suggestedPrice = argv[++index];
    else if (token === '--currency') args.currency = argv[++index];
    else if (token === '--slug') args.slug = argv[++index];
    else if (token === '--output-root') args.outputRoot = argv[++index];
    else if (token === '--now') args.now = argv[++index];
    else if (token === '--category-name') args.categoryName = argv[++index];
    else if (token === '--itch-url') args.itchUrl = argv[++index];
    else if (token === '--itch-edit-url') args.itchEditUrl = argv[++index];
    else if (token === '--playwright-profile') args.playwrightProfile = argv[++index];
    else if (token === '--target-itch-slug') args.targetItchSlug = argv[++index];
    else if (token === '--theme-model') args.themeModel = argv[++index];
    else if (token === '--runtime-env') args.runtimeEnv = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printHelp() {
  process.stdout.write([
    'ORION Digital Asset Engine',
    '',
    'Commands:',
    '  plan      Validate an opportunity and create a canonical product plan.',
    '  generate  Generate and post-process assets locally; requires --execute.',
    '  package   Assemble a deterministic internal itch preview export.',
    '  itch-draft  Upload the package and populate/verify the existing itch.io draft.',
    '  discord-review  Create the pack review channel/thread and post previews.',
    '  seller-preflight  Verify itch.io payout mode and tax-interview readiness.',
    '  distribution-review  Reconcile the separate marketplace approval gate in Discord.',
    '  marketplace-setup-review  Post or reconcile the separate itch.io draft-creation gate.',
    '  itch-publish  Publish and verify the separately approved itch.io release.',
    '  itch-slug  Migrate the verified public project URL and reconcile every stored target.',
    '  itch-theme-review  Generate a local theme candidate and post desktop/mobile previews.',
    '  itch-theme-apply  Apply and verify the exact Discord-approved built-in itch.io theme.',
    '  itch-description  Apply structured headings/lists to the exact verified public listing.',
    '  effects-pilot  Generate isolated fixed-anchor effects without changing the approved pack.',
    '  effects-batch  Generate sequential isolated weapon-effect proofs from a compact batch plan.',
    '  revise-effects  Regenerate selected effects into new immutable proof revisions.',
    '  effects-review  Post or update the isolated effects presentation in the existing pack channel.',
    '  prepare-extension  Assemble an immutable, versioned package-extension candidate.',
    '  prepare-expansion-review  Assemble an immutable static-asset expansion review bundle.',
    '  prepare-expansion-release  Build a full immutable release from an approved expansion review.',
    '  prepare-storefront-revision  Build an immutable price/media-only revision from a verified release or draft.',
    '  expansion-review  Post or update the expansion proposal in the existing product channel.',
    '  interactive-items  Generate fixed-anchor item states, overlays, sheets, metadata, and review GIFs.',
    '',
    'Options:',
    `  --config <path>       Default: ${DEFAULT_CONFIG}`,
    `  --opportunity <path>  Default: ${DEFAULT_OPPORTUNITY}`,
    `  --pilot <path>       Default: ${DEFAULT_EFFECT_PILOT}`,
    `  --batch <path>       Default: ${DEFAULT_EFFECT_BATCH}`,
    `  --revision-plan <path> Default: ${DEFAULT_EFFECT_REVISION}`,
    `  --review-plan <path> Default: ${DEFAULT_EFFECT_REVIEW}`,
    `  --extension-plan <path> Default: ${DEFAULT_EXTENSION_PLAN}`,
    `  --expansion-plan <path> Default: ${DEFAULT_EXPANSION_REVIEW}`,
    `  --item-animation-plan <path> Default: ${DEFAULT_ITEM_ANIMATION_BATCH}`,
    '  --release-version <semver>  Stage/review the latest immutable candidate for this version.',
    '  --base-version <semver>  Verified version inherited by a storefront revision.',
    '  --target-version <semver>  New immutable storefront revision version.',
    '  --base-manifest-hash <sha256>  Exact verified storefront base manifest.',
    '  --suggested-price <amount>  Proposed marketplace price for storefront review.',
    '  --currency <code>  Price currency. Default: USD.',
    '  --slug <product-slug>  Canonical product slug for marketplace setup reconciliation.',
    '  --output-root <path>  Override canonical product storage.',
    '  --now <ISO datetime>  Deterministic validation/testing time.',
    '  --execute             Required for image generation.',
    '  --internal-preview    Required for packaging unapproved candidates.',
    '  --post-to-discord     Required for live Discord posting.',
    '  --stage-itch-draft    Required for live itch.io draft changes.',
    '  --publish-itch        Required for the approved live itch.io visibility change.',
    '  --migrate-itch-slug   Required for the live project URL migration.',
    '  --apply-itch-theme    Required for the approved live Theme editor save.',
    '  --update-itch-description  Required for the verified public description presentation update.',
    '  --category-name <name>  Discord category. Default: DIGITAL ASSETS.',
    '  --itch-url <url>      Existing itch.io draft URL shown to reviewers.',
    '  --itch-edit-url <url> Authenticated itch.io editor URL; dashboard discovery is the default.',
    '  --playwright-profile <path>  Dedicated authenticated itch.io browser profile.',
    '  --target-itch-slug <slug>  New itch.io project URL slug.',
    '  --theme-model <model> Local Ollama text model. Default: llama3.1:8b.',
    '  --headless            Run itch.io browser automation without a visible window.',
    '  --runtime-env <path>  Existing ORION Discord .env; useful from an isolated worktree.',
    '',
  ].join('\n'));
}

async function main() {
  const args = parseArguments(process.argv);
  if (args.command === 'help' || args.command === '--help') {
    printHelp();
    return;
  }
  if (!['plan', 'generate', 'package', 'itch-draft', 'discord-review', 'seller-preflight', 'distribution-review', 'marketplace-setup-review', 'itch-publish', 'itch-slug', 'itch-theme-review', 'itch-theme-apply', 'itch-description', 'effects-pilot', 'effects-batch', 'revise-effects', 'effects-review', 'prepare-extension', 'prepare-expansion-review', 'prepare-expansion-release', 'prepare-storefront-revision', 'expansion-review', 'interactive-items'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (['generate', 'effects-pilot', 'effects-batch', 'revise-effects', 'interactive-items'].includes(args.command) && !args.execute) {
    throw new Error('Image generation requires --execute. Planning remains the safe default.');
  }
  if (['package', 'prepare-extension', 'prepare-expansion-review', 'prepare-expansion-release', 'prepare-storefront-revision'].includes(args.command) && !args.internalPreview) {
    throw new Error('Packaging unapproved candidates requires --internal-preview.');
  }
  if (['discord-review', 'distribution-review', 'marketplace-setup-review', 'effects-review', 'itch-theme-review', 'expansion-review'].includes(args.command) && !args.postToDiscord) {
    throw new Error('Live Discord review posting requires --post-to-discord.');
  }
  if (args.command === 'itch-draft' && !args.stageItchDraft) {
    throw new Error('Live itch.io draft staging requires --stage-itch-draft.');
  }
  if (args.command === 'itch-publish' && !args.publishItch) {
    throw new Error('Live itch.io publication requires --publish-itch and an exact distribution approval.');
  }
  if (args.command === 'itch-slug' && (!args.migrateItchSlug || !args.targetItchSlug)) {
    throw new Error('Live itch.io URL migration requires --migrate-itch-slug and --target-itch-slug.');
  }
  if (args.command === 'itch-theme-apply' && !args.applyItchTheme) {
    throw new Error('Live itch.io theme application requires --apply-itch-theme and an exact theme approval.');
  }
  if (args.command === 'itch-description' && !args.updateItchDescription) {
    throw new Error('Live itch.io description maintenance requires --update-itch-description.');
  }
  if (args.command === 'discord-review' && !args.itchUrl) {
    throw new Error(`${args.command} requires --itch-url for the existing itch.io draft.`);
  }
  if (args.command === 'marketplace-setup-review' && !args.slug) {
    throw new Error('marketplace-setup-review requires --slug.');
  }

  let config = await loadEngineConfig(args.config || DEFAULT_CONFIG);
  if (args.outputRoot) config = { ...config, output_root: args.outputRoot };
  if (args.command === 'prepare-storefront-revision') {
    const result = await prepareStorefrontRevision({
      outputRoot: resolveOutputRoot(config),
      slug: args.slug,
      baseVersion: args.baseVersion,
      targetVersion: args.targetVersion,
      baseManifestHash: args.baseManifestHash,
      suggestedPrice: args.suggestedPrice,
      currency: args.currency,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      product_id: result.product.product_id,
      product_slug: result.product.slug,
      base_version: result.plan.base_version,
      target_version: result.plan.target_version,
      candidate_root: result.candidateRoot,
      manifest_hash: result.manifest.manifest_hash,
      listing_hash: result.manifest.listing_hash,
      suggested_price: result.manifest.storefront_revision.suggested_price,
      media: result.manifest.storefront_revision.media,
      buyer_payload_changed: result.manifest.storefront_revision.buyer_payload_changed,
      reused: result.reused,
      gates: result.gates,
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'itch-slug') {
    const opportunity = JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'));
    const result = await migrateItchProjectSlug({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot: resolveOutputRoot(config),
      slug: slugify(opportunity.title),
      releaseVersion: args.releaseVersion,
      targetSlug: args.targetItchSlug,
      profileDir: args.playwrightProfile,
      headed: args.headed,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'itch-theme-review') {
    const opportunity = JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'));
    const outputRoot = resolveOutputRoot(config);
    const slug = slugify(opportunity.title);
    const candidate = await prepareItchThemeCandidate({
      outputRoot,
      slug,
      releaseVersion: args.releaseVersion,
      profileDir: args.playwrightProfile,
      headed: args.headed,
      themeModel: args.themeModel,
      ollamaEndpoint: config.generation.endpoint,
      now: args.now,
    });
    const result = await postItchThemeReview({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot,
      slug,
      candidate,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'itch-theme-apply') {
    const opportunity = JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'));
    const result = await applyApprovedItchTheme({
      outputRoot: resolveOutputRoot(config),
      slug: slugify(opportunity.title),
      releaseVersion: args.releaseVersion,
      profileDir: args.playwrightProfile,
      headed: args.headed,
      now: args.now,
    });
    await markItchThemeApplied({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      statePath: result.themeStatePath,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'itch-description') {
    const opportunity = JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'));
    const result = await updatePublishedItchDescription({
      outputRoot: resolveOutputRoot(config),
      slug: slugify(opportunity.title),
      releaseVersion: args.releaseVersion,
      profileDir: args.playwrightProfile,
      headed: args.headed,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'itch-publish') {
    const opportunity = JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'));
    const result = await publishApprovedItchRelease({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot: resolveOutputRoot(config),
      slug: slugify(opportunity.title),
      releaseVersion: args.releaseVersion,
      profileDir: args.playwrightProfile,
      headed: args.headed,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'seller-preflight') {
    const result = await inspectItchSellerReadiness({
      outputRoot: resolveOutputRoot(config),
      slug: slugify((JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'))).title),
      releaseVersion: args.releaseVersion,
      profileDir: args.playwrightProfile,
      headed: args.headed,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'distribution-review') {
    const opportunity = JSON.parse(await readFile(args.opportunity || DEFAULT_OPPORTUNITY, 'utf8'));
    const result = await postDigitalAssetDistributionReview({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot: resolveOutputRoot(config),
      slug: slugify(opportunity.title),
      releaseVersion: args.releaseVersion,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'marketplace-setup-review') {
    const result = await postMarketplaceSetupReview({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot: resolveOutputRoot(config),
      slug: args.slug,
      releaseVersion: args.releaseVersion,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'prepare-expansion-review') {
    const plan = JSON.parse(await readFile(args.expansionPlan || DEFAULT_EXPANSION_REVIEW, 'utf8'));
    const result = await prepareAssetExpansionReview({
      outputRoot: resolveOutputRoot(config),
      plan,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      expansion_id: result.plan.expansion_id,
      base_version: result.plan.base_version,
      target_version: result.plan.target_version,
      candidate_root: result.candidateRoot,
      manifest_hash: result.manifest.manifest_hash,
      asset_count: result.manifest.asset_count,
      gates: result.manifest.gates,
      reused: result.reused,
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'prepare-expansion-release') {
    const plan = JSON.parse(await readFile(args.expansionPlan || DEFAULT_EXPANSION_REVIEW, 'utf8'));
    const result = await prepareApprovedAssetExpansionRelease({
      outputRoot: resolveOutputRoot(config),
      plan,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      expansion_id: result.plan.expansion_id,
      base_version: result.plan.base_version,
      target_version: result.plan.target_version,
      candidate_root: result.candidateRoot,
      manifest_hash: result.manifest.manifest_hash,
      release_state: result.manifest.release_state,
      asset_count: result.manifest.asset_count,
      expansion_animation_count: result.manifest.expansion_animation_count,
      gates: result.gates,
      reused: result.reused,
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'expansion-review') {
    const plan = JSON.parse(await readFile(args.expansionPlan || DEFAULT_EXPANSION_REVIEW, 'utf8'));
    const result = await postAssetExpansionReview({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot: resolveOutputRoot(config),
      productSlug: plan.product_slug,
      expansionId: plan.expansion_id,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({ command: args.command, ...result }, null, 2)}\n`);
    return;
  }
  if (args.command === 'prepare-extension') {
    const plan = JSON.parse(await readFile(args.extensionPlan || DEFAULT_EXTENSION_PLAN, 'utf8'));
    const result = await prepareVersionedPackageExtension({
      outputRoot: resolveOutputRoot(config),
      plan,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      extension_id: result.plan.extension_id,
      base_version: result.plan.base_version,
      target_version: result.plan.target_version,
      candidate_root: result.candidateRoot,
      manifest_hash: result.manifest.manifest_hash,
      release_state: result.manifest.release_state,
      effect_animation_count: result.manifest.effect_animation_count,
      quality_holds: result.manifest.quality_holds,
      gates: result.gates,
      reused: result.reused,
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'effects-review') {
    const plan = JSON.parse(await readFile(args.reviewPlan || DEFAULT_EFFECT_REVIEW, 'utf8'));
    const review = await postEffectsDiscordReview({
      runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
      outputRoot: resolveOutputRoot(config),
      plan,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      review_id: review.review_id,
      bundle_hash: review.bundle_hash,
      channel_id: review.channel_id,
      thread_id: review.thread_id,
      overview_message_id: review.overview_message_id,
      weapon_messages: review.weapon_messages,
      reused: review.reused,
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'revise-effects') {
    const plan = JSON.parse(await readFile(args.revisionPlan || DEFAULT_EFFECT_REVISION, 'utf8'));
    const batch = await reviseEffectBatch({
      config,
      plan,
      outputRoot: resolveOutputRoot(config),
      projectRoot: process.cwd(),
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      batch_id: batch.batch_id,
      product_slug: batch.product_slug,
      total_generation_calls: batch.total_generation_calls,
      total_duration_ms: batch.total_duration_ms,
      incurred_cost: batch.incurred_cost,
      results: batch.results.map((result) => ({
        source_pilot_id: result.source_pilot_id,
        target_pilot_id: result.target_pilot_id,
        experiment_root: result.experimentRoot,
        manifest_hash: result.manifest.manifest_hash,
        inherited_effects: result.inherited_effects,
        regenerated_kinds: result.regenerated_kinds,
        attack_cycle_preview_path: result.attack_cycle_preview_path,
        timing: {
          total_duration_ms: result.timing.total_duration_ms,
          generation_calls: result.timing.generation_calls,
          derived_frames: result.timing.derived_frames,
        },
      })),
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'effects-batch') {
    const plan = JSON.parse(await readFile(args.batch || DEFAULT_EFFECT_BATCH, 'utf8'));
    const outputRoot = resolveOutputRoot(config);
    const batch = await generateEffectBatch({
      config,
      plan,
      outputRoot,
      projectRoot: process.cwd(),
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      batch_id: batch.batch_id,
      product_slug: batch.product_slug,
      total_generation_calls: batch.total_generation_calls,
      total_duration_ms: batch.total_duration_ms,
      incurred_cost: batch.incurred_cost,
      results: batch.results.map((result) => ({
        pilot_id: result.pilot.pilot_id,
        source_asset_key: result.pilot.source_asset_key,
        experiment_root: result.experimentRoot,
        manifest_hash: result.manifest.manifest_hash,
        muzzle_anchor: result.manifest.source_weapon_muzzle_anchor,
        attack_cycle_preview_path: result.attack_cycle_preview_path,
        timing: {
          total_duration_ms: result.timing.total_duration_ms,
          generation_calls: result.timing.generation_calls,
          derived_frames: result.timing.derived_frames,
        },
      })),
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'interactive-items') {
    const plan = JSON.parse(await readFile(args.itemAnimationPlan || DEFAULT_ITEM_ANIMATION_BATCH, 'utf8'));
    const batch = await generateInteractiveItemAnimationBatch({
      config,
      plan,
      outputRoot: resolveOutputRoot(config),
      projectRoot: process.cwd(),
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      batch_id: batch.plan.batch_id,
      product_slug: batch.plan.product_slug,
      experiment_root: batch.batchRoot,
      manifest_hash: batch.manifest.manifest_hash,
      generation_calls: batch.manifest.generation_calls,
      total_duration_ms: batch.timing.total_duration_ms,
      incurred_cost: batch.cost.incurred,
      items: batch.results.map((result) => ({
        asset_key: result.item.target_asset_key,
        recipe: result.item.recipe,
        manifest_hash: result.manifest.manifest_hash,
        status: result.validation.status,
        dynamic_energy_region: result.validation.energy_region,
        states: result.states?.states?.map((state) => ({
          state_key: state.key,
          path: state.path,
        })) || [],
        animations: result.animations.map((animation) => ({
          animation_key: animation.key,
          sprite_sheet_path: animation.sheetPath,
          preview_gif_path: animation.gifPath,
          metadata_path: animation.metadataPath,
        })),
      })),
      gates: batch.manifest.gates,
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'effects-pilot') {
    const pilot = JSON.parse(await readFile(args.pilot || DEFAULT_EFFECT_PILOT, 'utf8'));
    const outputRoot = resolveOutputRoot(config);
    const result = await generateEffectPilot({
      config,
      pilot,
      outputRoot,
      projectRoot: process.cwd(),
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify({
      command: args.command,
      pilot_id: result.pilot.pilot_id,
      product_id: result.product.product_id,
      product_version: result.product.version,
      status: result.manifest.status,
      output_root: outputRoot,
      experiment_root: result.experimentRoot,
      effects: result.effects.map((effect) => ({
        effect_key: effect.effect_key,
        frame_count: effect.frame_count,
        sheet_path: effect.sheet_path,
        animation_path: effect.animation_path,
        preview_gif_path: effect.preview_gif_path,
      })),
      composite_preview_path: result.composite_preview_path,
      projectile_travel_preview_path: result.projectile_travel_preview_path,
      attack_cycle_preview_path: result.attack_cycle_preview_path,
      timing: result.timing,
      manifest_hash: result.manifest.manifest_hash,
      gates: result.gates,
      cost: result.cost,
    }, null, 2)}\n`);
    return;
  }
  const opportunityPath = args.opportunity || DEFAULT_OPPORTUNITY;
  const opportunity = JSON.parse(await readFile(opportunityPath, 'utf8'));
  const common = {
    config,
    opportunity,
    outputRoot: resolveOutputRoot(config),
    projectRoot: process.cwd(),
    now: args.now,
  };

  const result = args.command === 'generate'
    ? await generateDigitalAssetProduct(common)
    : args.command === 'package'
      ? await packageDigitalAssetPreview({
        outputRoot: common.outputRoot,
        slug: slugify(opportunity.title),
      })
      : args.command === 'itch-draft'
        ? {
          product: await (async () => {
            const staging = await stageItchDraft({
              outputRoot: common.outputRoot,
              slug: slugify(opportunity.title),
              itchUrl: args.itchUrl,
              itchEditUrl: args.itchEditUrl,
              profileDir: args.playwrightProfile,
              headed: args.headed,
              releaseVersion: args.releaseVersion,
              now: args.now,
            });
            return {
              product_id: staging.product_id,
              title: opportunity.title,
              status: 'itch_draft_verified',
              itch_staging: staging,
            };
          })(),
        }
        : args.command === 'discord-review'
        ? {
          product: await (async () => {
            const review = await postDigitalAssetReview({
              runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
              outputRoot: common.outputRoot,
              slug: slugify(opportunity.title),
              categoryName: args.categoryName,
              itchUrl: args.itchUrl,
              releaseVersion: args.releaseVersion,
              now: args.now,
            });
            return {
              product_id: review.product_id,
              title: opportunity.title,
              status: 'awaiting_asset_review',
              discord_review: review,
            };
          })(),
        }
      : await planDigitalAssetProduct(common);
  process.stdout.write(`${JSON.stringify({
    command: args.command,
    product_id: result.product.product_id,
    title: result.product.title,
    status: result.product.status,
    output_root: common.outputRoot,
    generation: result.generation || [],
    export_root: result.exportRoot,
    manifest_hash: result.manifest?.manifest_hash,
    discord_review: result.product.discord_review,
    itch_staging: result.product.itch_staging,
    gates: result.gates || { human_review_required: true, distribution_ready: false },
    cost: result.cost || { currency: 'EUR', incurred: 0, estimated: 0 },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Digital Asset Engine failed: ${error.message}\n`);
  process.exitCode = 1;
});
