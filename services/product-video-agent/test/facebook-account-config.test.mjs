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
const FACEBOOK_ACCOUNTS = [
  {
    sourceAccountKey: 'poke-quizz-youtube',
    accountKey: 'poke-quizz-facebook',
    pageId: '1352400344631205',
    pageName: 'Poke Quizz',
    accessTokenEnv: 'FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN',
  },
  {
    sourceAccountKey: 'trivamon-youtube',
    accountKey: 'trivamon-facebook',
    pageId: '1507742829080633',
    pageName: 'TrivaMon',
    accessTokenEnv: 'FACEBOOK_TRIVAMON_PAGE_ACCESS_TOKEN',
  },
  {
    sourceAccountKey: 'poke-guess-youtube',
    accountKey: 'poke-guess-facebook',
    pageId: '1487751191082577',
    pageName: 'Poke Guess',
    accessTokenEnv: 'FACEBOOK_POKE_GUESS_PAGE_ACCESS_TOKEN',
  },
];

test('configured Facebook Pages map through the shared target registry', async () => {
  const profiles = await loadPublicationChannelProfiles(CHANNELS_PATH, {
    projectRoot: PROJECT_ROOT,
  });
  const envExample = await readFile(
    resolve(PROJECT_ROOT, 'config/product-video/.env.example'),
    'utf8',
  );

  assert.match(envExample, /^FACEBOOK_DELIVERY_ENABLED=false$/mu);

  for (const expected of FACEBOOK_ACCOUNTS) {
    const profile = findPublicationChannelProfile(profiles, expected.sourceAccountKey);
    const targets = listConfiguredPlatformPublicationTargets(profile)
      .filter((target) => target.platform === FACEBOOK_REEL_PLATFORM);

    assert.equal(targets.length, 1);
    const [target] = targets;
    assert.equal(target.accountKey, expected.accountKey);
    assert.equal(target.sourceAccountKey, expected.sourceAccountKey);
    assert.equal(target.enabled, true);
    assert.equal(target.scheduleMode, 'orion');
    assert.equal(target.deliveryProvider, 'facebook_graph');
    assert.equal(target.visibility, 'public');
    assert.equal(target.facebook.page_id, expected.pageId);
    assert.equal(target.facebook.expected_page_name, expected.pageName);
    assert.equal(target.facebook.access_token_env, expected.accessTokenEnv);
    assert.match(envExample, new RegExp(`^${expected.accessTokenEnv}=$`, 'mu'));
  }
});
