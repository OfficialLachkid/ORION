import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { loadEngineConfig } from '../src/config.mjs';
import {
  buildEffectsOverviewEmbed,
  buildWeaponEffectsEmbed,
  postEffectsDiscordReview,
} from '../src/effect-discord-review.mjs';
import { planDigitalAssetProduct } from '../src/pipeline.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test('effects review embeds distinguish complete and separated animations', () => {
  const experiment = { source_asset_key: 'arc-launcher', name: 'Arc Launcher' };
  const manifest = {
    manifest_hash: 'a'.repeat(64),
    source_weapon_muzzle_anchor: { x: 128, y: 21 },
  };
  const bundle = { bundle_hash: 'b'.repeat(64), experiments: [experiment] };
  const overview = buildEffectsOverviewEmbed({
    plan: { title: 'Effects' },
    bundle,
    revision: 1,
  });
  const weapon = buildWeaponEffectsEmbed({ experiment, manifest, index: 0, total: 1 });
  assert.match(overview.fields.find((field) => field.name === 'Scope').value, /not wired/u);
  assert.match(weapon.description, /complete firing cycle/u);
  assert.match(weapon.description, /muzzle.*projectile.*impact/u);
  assert.equal(weapon.image.url, 'attachment://arc-launcher-attack-cycle.gif');
});

test('effects review posts one overview and updates weapon previews in a dedicated thread', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-effects-discord-'));
  const config = await loadEngineConfig(
    'services/digital-asset-engine/config.example.json',
    projectRoot,
    { output_root: outputRoot },
  );
  const opportunity = JSON.parse(await readFile(resolve(
    projectRoot,
    'services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json',
  ), 'utf8'));
  const planned = await planDigitalAssetProduct({
    config,
    opportunity,
    outputRoot,
    projectRoot,
    now: '2026-10-15T10:00:00.000Z',
  });
  const productRoot = planned.persistence.root;
  const plan = {
    schema_version: '1.0',
    review_id: 'effects-review-test',
    product_slug: planned.product.slug,
    title: 'Effects Review Test',
    experiments: [{
      source_asset_key: 'arc-launcher',
      name: 'Arc Launcher',
      pilot_id: 'arc-launcher-effects-proof-v2',
    }],
  };
  const experimentRoot = resolve(productRoot, 'experiments', plan.experiments[0].pilot_id);
  const previewPaths = [
    'previews/arc-launcher-attack-cycle.gif',
    'previews/arc-muzzle-flash.gif',
    'previews/arc-launcher-projectile-travel.gif',
    'previews/arc-impact-decay.gif',
  ];
  const gif = await sharp({
    create: { width: 8, height: 8, channels: 4, background: '#35d9ff' },
  }).gif().toBuffer();
  await mkdir(resolve(productRoot, 'review'), { recursive: true });
  await Promise.all([
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({ channel_id: 'channel-1' })),
    ...previewPaths.map(async (path) => {
      const absolute = resolve(experimentRoot, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, gif);
    }),
  ]);
  await writeFile(resolve(experimentRoot, 'manifest.json'), JSON.stringify({
    source_asset_key: 'arc-launcher',
    status: 'awaiting_effects_review',
    canonical_release_mutated: false,
    marketplace_listing_mutated: false,
    attack_cycle_role: 'preview_only',
    manifest_hash: 'a'.repeat(64),
    source_weapon_muzzle_anchor: { x: 128, y: 21 },
  }));
  await writeFile(resolve(experimentRoot, 'pilot.json'), JSON.stringify({
    effects: [
      { effect_key: 'arc-projectile', kind: 'projectile' },
      { effect_key: 'arc-muzzle-flash', kind: 'muzzle_flash' },
      { effect_key: 'arc-impact-decay', kind: 'impact_decay' },
    ],
  }));

  const calls = [];
  let messageCount = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === 'POST' && String(url).endsWith('/messages/overview-1/threads')) {
      return jsonResponse({ id: 'thread-1' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages')) {
      messageCount += 1;
      return jsonResponse({ id: messageCount === 1 ? 'overview-1' : 'weapon-1' });
    }
    return jsonResponse({ message: 'unexpected request' }, 500);
  };
  const posted = await postEffectsDiscordReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' }, guildId: 'guild-1' },
    outputRoot,
    plan,
    fetchImpl,
    now: '2026-10-15T10:05:00.000Z',
  });
  assert.equal(posted.overview_message_id, 'overview-1');
  assert.equal(posted.thread_id, 'thread-1');
  assert.equal(posted.weapon_messages['arc-launcher'], 'weapon-1');
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 3);
  const weaponCall = calls.find((call) => String(call.url).includes('/channels/thread-1/messages'));
  const payload = JSON.parse(weaponCall.options.body.get('payload_json'));
  assert.equal(payload.attachments.length, 4);
  assert.deepEqual(payload.components, []);

  const resumed = await postEffectsDiscordReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' }, guildId: 'guild-1' },
    outputRoot,
    plan,
    fetchImpl,
  });
  assert.equal(resumed.reused, true);
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 3);
});
