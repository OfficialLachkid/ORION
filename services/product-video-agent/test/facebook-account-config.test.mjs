import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../src/publication-channels.mjs';
import {
  FACEBOOK_REEL_PLATFORM,
  listConfiguredPlatformPublicationTargets,
} from '../src/social-publication-targets.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
const ACCESS_TOKEN_ENV = 'FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN';

test('Poke Quizz maps to the verified Facebook Page without enabling live delivery', async () => {
  const profiles = await loadPublicationChannelProfiles(CHANNELS_PATH, {
    projectRoot: PROJECT_ROOT,
  });
  const profile = findPublicationChannelProfile(profiles, 'poke-quizz-youtube');
  const targets = listConfiguredPlatformPublicationTargets(profile)
    .filter((target) => target.platform === FACEBOOK_REEL_PLATFORM);

  assert.equal(targets.length, 1);
  const [target] = targets;
  assert.equal(target.accountKey, 'poke-quizz-facebook');
  assert.equal(target.sourceAccountKey, 'poke-quizz-youtube');
  assert.equal(target.enabled, true);
  assert.equal(target.scheduleMode, 'orion');
  assert.equal(target.deliveryProvider, 'facebook_graph');
  assert.equal(target.visibility, 'public');
  assert.equal(target.facebook.page_id, '1352400344631205');
  assert.equal(target.facebook.expected_page_name, 'Poke Quizz');
  assert.equal(target.facebook.access_token_env, ACCESS_TOKEN_ENV);

  const envExample = await readFile(
    resolve(PROJECT_ROOT, 'config/product-video/.env.example'),
    'utf8',
  );
  assert.match(envExample, /^FACEBOOK_DELIVERY_ENABLED=false$/mu);
  assert.match(envExample, new RegExp(`^${ACCESS_TOKEN_ENV}=$`, 'mu'));
});
