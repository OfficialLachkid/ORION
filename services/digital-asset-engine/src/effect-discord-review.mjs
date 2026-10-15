import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest, sendMessageWithFiles } from './discord-review.mjs';

const REVIEW_COLOR = 0x35d9ff;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadOptionalJson(path) {
  try { return await readJson(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validatePlan(plan) {
  if (plan?.schema_version !== '1.0' || !plan.review_id || !plan.product_slug) {
    throw new Error('Effects Discord review plan is invalid.');
  }
  if (!Array.isArray(plan.experiments) || plan.experiments.length < 1 || plan.experiments.length > 25) {
    throw new Error('Effects Discord review requires between one and twenty-five experiments.');
  }
  const keys = new Set();
  for (const experiment of plan.experiments) {
    if (!experiment.source_asset_key || !experiment.name || !experiment.pilot_id) {
      throw new Error('Every effects review experiment requires a source key, name, and pilot ID.');
    }
    if (keys.has(experiment.source_asset_key)) {
      throw new Error(`Duplicate effects review weapon: ${experiment.source_asset_key}`);
    }
    keys.add(experiment.source_asset_key);
  }
  return plan;
}

function previewPaths(experiment, pilot) {
  const key = experiment.source_asset_key;
  const muzzle = pilot.effects.find((effect) => effect.kind === 'muzzle_flash');
  const impact = pilot.effects.find((effect) => effect.kind === 'impact_decay');
  if (!muzzle || !impact) throw new Error(`${key} pilot is missing its muzzle or impact effect.`);
  return {
    attack: `previews/${key}-attack-cycle.gif`,
    muzzle: `previews/${muzzle.effect_key}.gif`,
    projectile: `previews/${key}-projectile-travel.gif`,
    impact: `previews/${impact.effect_key}.gif`,
  };
}

export function buildEffectsOverviewEmbed({ plan, bundle, revision }) {
  return {
    title: `${plan.title} · Review · Revision ${revision}`,
    description: 'Review-only effects extension. The approved package, itch.io draft, and public release remain unchanged.',
    color: REVIEW_COLOR,
    fields: [
      { name: 'State', value: '`awaiting_effects_review`', inline: true },
      { name: 'Weapons', value: String(bundle.experiments.length), inline: true },
      { name: 'Local generation cost', value: '€0 API cost', inline: true },
      {
        name: 'Included previews',
        value: bundle.experiments.map((item, index) => (
          `**${String(index + 1).padStart(2, '0')}** — ${item.name}`
        )).join('\n'),
        inline: false,
      },
      { name: 'Review bundle', value: `\`${bundle.bundle_hash}\``, inline: false },
      {
        name: 'Scope',
        value: 'Each thread message contains the full firing cycle plus separate muzzle, projectile, and impact animations. Approval actions are intentionally not wired in this presentation slice.',
        inline: false,
      },
    ],
    image: { url: 'attachment://effects-overview.gif' },
    footer: { text: 'ORION Digital Asset Engine · review evidence only' },
  };
}

export function buildWeaponEffectsEmbed({ experiment, manifest, index, total }) {
  return {
    title: `${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')} · ${experiment.name}`,
    description: 'The embedded GIF is the complete firing cycle. Three additional attachments contain the muzzle flash, projectile travel, and impact/decay separately.',
    color: REVIEW_COLOR,
    fields: [
      {
        name: 'Detected muzzle',
        value: `x=${manifest.source_weapon_muzzle_anchor.x}, y=${manifest.source_weapon_muzzle_anchor.y}`,
        inline: true,
      },
      { name: 'Runtime root motion', value: '`x=0, y=0`', inline: true },
      { name: 'Manifest', value: `\`${manifest.manifest_hash}\``, inline: false },
    ],
    image: { url: `attachment://${experiment.source_asset_key}-attack-cycle.gif` },
  };
}

async function loadBundle(productRoot, plan) {
  const experiments = [];
  for (const experiment of plan.experiments) {
    const root = resolve(productRoot, 'experiments', experiment.pilot_id);
    const [manifest, pilot] = await Promise.all([
      readJson(resolve(root, 'manifest.json')),
      readJson(resolve(root, 'pilot.json')),
    ]);
    if (
      manifest.source_asset_key !== experiment.source_asset_key
      || manifest.status !== 'awaiting_effects_review'
      || manifest.canonical_release_mutated !== false
      || manifest.marketplace_listing_mutated !== false
      || manifest.attack_cycle_role !== 'preview_only'
    ) throw new Error(`${experiment.source_asset_key} is not a valid isolated effects proof.`);
    experiments.push({
      ...experiment,
      experiment_root: root,
      manifest_hash: manifest.manifest_hash,
      muzzle_anchor: manifest.source_weapon_muzzle_anchor,
      preview_paths: previewPaths(experiment, pilot),
      manifest,
    });
  }
  const payload = {
    schema_version: '1.0',
    review_id: plan.review_id,
    product_slug: plan.product_slug,
    status: 'awaiting_effects_review',
    canonical_release_mutated: false,
    marketplace_listing_mutated: false,
    approval_actions_wired: false,
    experiments: experiments.map((item) => ({
      source_asset_key: item.source_asset_key,
      name: item.name,
      pilot_id: item.pilot_id,
      experiment_path: `experiments/${item.pilot_id}`,
      manifest_hash: item.manifest_hash,
      muzzle_anchor: item.muzzle_anchor,
      preview_paths: item.preview_paths,
    })),
  };
  return {
    bundle: { ...payload, bundle_hash: sha256(JSON.stringify(payload)) },
    runtimeExperiments: experiments,
  };
}

export async function postEffectsDiscordReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Effects review posting requires Discord bot credentials.');
  const plan = validatePlan(options.plan);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(plan.product_slug);
  const productRoot = store.productRoot(product);
  const packageState = await readJson(resolve(productRoot, 'review', 'discord.json'));
  if (!packageState.channel_id) throw new Error('The existing package Discord channel is unavailable.');

  const { bundle, runtimeExperiments } = await loadBundle(productRoot, plan);
  const bundlePath = resolve(productRoot, 'review', 'effects-review-manifest.json');
  const statePath = resolve(productRoot, 'review', 'effects-discord.json');
  const existing = await loadOptionalJson(statePath);
  if (existing?.bundle_hash === bundle.bundle_hash && existing?.completed_at) {
    return { ...existing, reused: true, statePath, bundlePath };
  }
  await writeJson(bundlePath, bundle);
  const revisionChanged = Boolean(existing?.bundle_hash && existing.bundle_hash !== bundle.bundle_hash);
  const state = existing || {
    schema_version: '1.0',
    review_id: plan.review_id,
    channel_id: packageState.channel_id,
    overview_message_id: null,
    thread_id: null,
    weapon_messages: {},
    review_revision: 1,
    created_at: options.now || new Date().toISOString(),
  };
  state.bundle_hash = bundle.bundle_hash;
  state.review_revision = Math.max(1, Number(state.review_revision) || 1) + (revisionChanged ? 1 : 0);
  state.completed_at = null;
  await writeJson(statePath, state);

  const overviewExperiment = runtimeExperiments[0];
  const overviewPayload = {
    embeds: [buildEffectsOverviewEmbed({ plan, bundle, revision: state.review_revision })],
    components: [],
  };
  const overviewFiles = [
    {
      filename: 'effects-overview.gif',
      contentType: 'image/gif',
      description: `${overviewExperiment.name} complete firing-cycle example`,
      buffer: await readFile(resolve(
        overviewExperiment.experiment_root,
        overviewExperiment.preview_paths.attack,
      )),
    },
    {
      filename: 'effects-review-manifest.json',
      contentType: 'application/json',
      description: `Exact effects review bundle ${bundle.bundle_hash}`,
      buffer: await readFile(bundlePath),
    },
  ];
  if (state.overview_message_id) {
    await sendMessageWithFiles(token, state.channel_id, overviewPayload, overviewFiles, {
      messageId: state.overview_message_id,
      fetchImpl: options.fetchImpl,
    });
  } else {
    const message = await sendMessageWithFiles(
      token,
      state.channel_id,
      overviewPayload,
      overviewFiles,
      { fetchImpl: options.fetchImpl },
    );
    state.overview_message_id = message.id;
    await writeJson(statePath, state);
  }
  if (!state.thread_id) {
    const thread = await discordRequest(
      token,
      `/channels/${state.channel_id}/messages/${state.overview_message_id}/threads`,
      {
        method: 'POST',
        body: { name: 'effects-review-v1', auto_archive_duration: 1440 },
        fetchImpl: options.fetchImpl,
      },
    );
    state.thread_id = thread.id;
    await writeJson(statePath, state);
  }

  for (let index = 0; index < runtimeExperiments.length; index += 1) {
    const experiment = runtimeExperiments[index];
    const files = [
      ['attack', `${experiment.source_asset_key}-attack-cycle.gif`, 'Complete firing cycle'],
      ['muzzle', `${experiment.source_asset_key}-muzzle-flash.gif`, 'Separate muzzle flash'],
      ['projectile', `${experiment.source_asset_key}-projectile-travel.gif`, 'Separate projectile travel'],
      ['impact', `${experiment.source_asset_key}-impact-decay.gif`, 'Separate impact and decay'],
    ];
    const attachments = await Promise.all(files.map(async ([kind, filename, description]) => ({
      filename,
      contentType: 'image/gif',
      description: `${experiment.name}: ${description}`,
      buffer: await readFile(resolve(experiment.experiment_root, experiment.preview_paths[kind])),
    })));
    const payload = {
      embeds: [buildWeaponEffectsEmbed({
        experiment,
        manifest: experiment.manifest,
        index,
        total: runtimeExperiments.length,
      })],
      components: [],
    };
    const existingMessageId = state.weapon_messages[experiment.source_asset_key];
    const message = await sendMessageWithFiles(token, state.thread_id, payload, attachments, {
      messageId: existingMessageId,
      fetchImpl: options.fetchImpl,
    });
    if (!existingMessageId) {
      state.weapon_messages[experiment.source_asset_key] = message.id;
      await writeJson(statePath, state);
    }
  }

  state.completed_at = options.now || new Date().toISOString();
  await writeJson(statePath, state);
  return { ...state, reused: false, statePath, bundlePath, guildId };
}
