import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../src/publication-channels.mjs';
import {
  INSTAGRAM_REEL_PLATFORM,
  listConfiguredPlatformPublicationTargets,
} from '../src/social-publication-targets.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';

const EXPECTED_INSTAGRAM_TARGETS = [
  {
    sourceAccountKey: 'proffmon-youtube',
    accountKey: 'proffmon-instagram',
    userId: '17841460825848023',
    username: 'proffmon',
    accessTokenEnv: 'INSTAGRAM_PROFFMON_ACCESS_TOKEN',
  },
  {
    sourceAccountKey: 'dexguess-youtube',
    accountKey: 'dexguess-instagram',
    userId: '17841435584465471',
    username: 'dexguesss',
    accessTokenEnv: 'INSTAGRAM_DEXGUESS_ACCESS_TOKEN',
  },
  {
    sourceAccountKey: 'trivamon-youtube',
    accountKey: 'trivamon-instagram',
    userId: '17841449539714324',
    username: 'trivamon',
    accessTokenEnv: 'INSTAGRAM_TRIVAMON_ACCESS_TOKEN',
  },
  {
    sourceAccountKey: 'poke-guess-youtube',
    accountKey: 'poke-guess-instagram',
    userId: '17841468340101871',
    username: 'pokeguesss',
    accessTokenEnv: 'INSTAGRAM_POKE_GUESS_ACCESS_TOKEN',
  },
];

test('owned Instagram accounts map to their corresponding source publication channels', async () => {
  const profiles = await loadPublicationChannelProfiles(CHANNELS_PATH, { projectRoot: PROJECT_ROOT });

  for (const expected of EXPECTED_INSTAGRAM_TARGETS) {
    const profile = findPublicationChannelProfile(profiles, expected.sourceAccountKey);
    const targets = listConfiguredPlatformPublicationTargets(profile)
      .filter((target) => target.platform === INSTAGRAM_REEL_PLATFORM);

    assert.equal(targets.length, 1, `${expected.sourceAccountKey} must have one Instagram target`);
    const [target] = targets;
    assert.equal(target.accountKey, expected.accountKey);
    assert.equal(target.sourceAccountKey, expected.sourceAccountKey);
    assert.equal(target.enabled, true);
    assert.equal(target.scheduleMode, 'orion');
    assert.equal(target.deliveryProvider, 'instagram_graph');
    assert.equal(target.visibility, 'public');
    assert.equal(target.instagram.user_id, expected.userId);
    assert.equal(target.instagram.expected_username, expected.username);
    assert.equal(target.instagram.access_token_env, expected.accessTokenEnv);
    assert.equal(target.instagram.share_to_feed, true);
  }
});

test('every configured Instagram account token is documented without a secret value', async () => {
  const envExample = await readFile(resolve(PROJECT_ROOT, 'config/product-video/.env.example'), 'utf8');

  for (const { accessTokenEnv } of EXPECTED_INSTAGRAM_TARGETS) {
    assert.match(envExample, new RegExp(`^${accessTokenEnv}=$`, 'mu'));
  }
});
