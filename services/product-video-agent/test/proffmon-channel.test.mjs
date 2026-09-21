import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationChannelUrl,
  resolvePublicationReviewThreadId,
} from '../src/publication-channels.mjs';
import {
  PRODUCT_VIDEO_CHANNEL_DEFINITIONS,
  resolveBaseProductVideoChannelConfigPath,
} from '../src/product-video-template-routing.mjs';
import { resolveVideoTemplateRuntime } from '../src/video-template-context.mjs';
import {
  PRODUCT_VIDEO_CHANNEL_OPTIONS,
  parseProductVideoCommand,
} from '../../task-router/src/product-video-command-parser.mjs';
import { discoverNightShiftChannelRuntimes } from '../../../scripts/lib/night-shift/pokemon-maintenance-runtime.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
const PROFFMON_CONFIG_PATH = 'services/product-video-agent/config/channels/proffmon-youtube.json';
const POKE_QUIZZ_CONFIG_PATH = 'services/product-video-agent/config/channels/poke-quizz-youtube.json';
const PROFFMON_WEIGHT_THREE_TEMPLATE_IDS = new Set([
  'pokemon.progressive-reveal.v1',
  'pokemon.pixelated-reveal.v1',
  'pokemon.stat-clash.v1',
  'pokemon.build-your-team.v1',
  'pokemon.cry-match.v1',
]);
async function loadJson(projectRelativePath) {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, projectRelativePath), 'utf8'));
}

test('ProffMon publication profile uses its own YouTube identity, OAuth token, and review thread', async () => {
  const profiles = await loadPublicationChannelProfiles(CHANNELS_PATH, { projectRoot: PROJECT_ROOT });
  const profile = findPublicationChannelProfile(profiles, 'proffmon-youtube');

  assert.equal(profile.id, 'video-channel-proffmon-youtube');
  assert.equal(profile.name, 'ProffMon');
  assert.equal(profile.status, 'active');
  assert.equal(profile.youtube.channel_id, 'UCoBQkiRDRgyrOCjiu5TDSMg');
  assert.equal(profile.youtube.oauth_refresh_token_env, 'YOUTUBE_PROFFMON_REFRESH_TOKEN');
  assert.equal(resolvePublicationChannelUrl(profile), 'https://www.youtube.com/channel/UCoBQkiRDRgyrOCjiu5TDSMg');
  assert.equal(resolvePublicationReviewThreadId({}, profile), '1549355550553280542');
});

test('ProffMon uses every Poke Quizz template with its selected weight overrides', async () => {
  const [proffmonConfig, pokeQuizzConfig, runtimes] = await Promise.all([
    loadJson(PROFFMON_CONFIG_PATH),
    loadJson(POKE_QUIZZ_CONFIG_PATH),
    discoverNightShiftChannelRuntimes(),
  ]);
  assert.deepEqual(
    Object.keys(proffmonConfig.templates),
    Object.keys(pokeQuizzConfig.templates),
  );
  for (const [templateId, proffmonTemplate] of Object.entries(proffmonConfig.templates)) {
    const expectedWeight = PROFFMON_WEIGHT_THREE_TEMPLATE_IDS.has(templateId)
      ? 3
      : pokeQuizzConfig.templates[templateId].weight;
    assert.equal(proffmonTemplate.enabled, true, `${templateId} must be enabled`);
    assert.equal(proffmonTemplate.manual_generate, true, `${templateId} must support manual generation`);
    assert.equal(proffmonTemplate.night_shift, true, `${templateId} must participate in night shift`);
    assert.equal(
      proffmonTemplate.weight,
      expectedWeight,
      `${templateId} must use its configured ProffMon weight`,
    );
  }
  assert.equal(proffmonConfig.night_shift.review_backlog.enabled, true);
  assert.equal(proffmonConfig.night_shift.review_backlog.target_review_ready_count, 10);
  assert.equal(proffmonConfig.night_shift.review_refresh.enabled, true);
  assert.deepEqual(proffmonConfig.night_shift.publication_automation, {
    enabled: true,
    mode: 'auto',
    max_scheduled_days: 3,
  });

  const runtimeByChannel = new Map(runtimes.map((runtime) => [runtime.channelSelector, runtime]));
  const proffmonRuntime = runtimeByChannel.get('proffmon-youtube');
  assert.ok(proffmonRuntime);
  assert.deepEqual(
    proffmonRuntime.nightShift.reviewBacklogTemplateWeights,
    Object.fromEntries(Object.entries(proffmonConfig.templates).map(([templateId, template]) => (
      [templateId, template.weight]
    ))),
  );
  assert.equal(proffmonRuntime.nightShift.publicationAutomationEnabled, true);
  assert.equal(proffmonRuntime.nightShift.publicationAutomationMode, 'auto');
});

test('ProffMon is available to runtime routing and Discord video generation commands', async () => {
  assert.ok(PRODUCT_VIDEO_CHANNEL_DEFINITIONS.some((channel) => (
    channel.channelSelector === 'proffmon-youtube'
  )));
  assert.ok(PRODUCT_VIDEO_CHANNEL_OPTIONS.some((channel) => (
    channel.value === 'proffmon-youtube' && channel.name === 'ProffMon'
  )));
  assert.equal(resolveBaseProductVideoChannelConfigPath('proffmon-youtube'), PROFFMON_CONFIG_PATH);

  const parsed = parseProductVideoCommand(
    'generate video template: build-your-team channel: proffmon-youtube',
  );
  assert.equal(parsed?.channelLabel, 'ProffMon');
  assert.equal(parsed?.channelConfigPath, PROFFMON_CONFIG_PATH);

  const runtime = await resolveVideoTemplateRuntime({
    projectRoot: PROJECT_ROOT,
    channelConfigPath: PROFFMON_CONFIG_PATH,
    templateId: 'pokemon.build-your-team.v1',
  });
  assert.equal(runtime.channelSelector, 'proffmon-youtube');
  assert.equal(runtime.genreLabel, 'Build Your Team');
});

test('ProffMon OAuth refresh token is documented in the product-video environment example', async () => {
  const envExample = await readFile(resolve(PROJECT_ROOT, 'config/product-video/.env.example'), 'utf8');
  assert.match(envExample, /^YOUTUBE_PROFFMON_REFRESH_TOKEN=$/mu);
});
