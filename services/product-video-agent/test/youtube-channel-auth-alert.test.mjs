import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_TYPE_BROWSER_SESSION,
  AUTH_TYPE_OAUTH,
  alertYoutubeChannelAuthFailure,
  buildAuthAlertBody,
  buildRecoveryCommand,
  classifyYoutubeAuthError,
  isFatalAuthClassification,
  parseYoutubeOauthErrorMessage,
} from '../src/youtube-channel-auth-alert.mjs';

test('classifyYoutubeAuthError: invalid_grant body is the canonical "token dead" signal', () => {
  assert.equal(classifyYoutubeAuthError({ status: 400, bodyText: '{"error":"invalid_grant"}' }), 'invalid_grant');
  // Google's token endpoint sometimes returns 200 with an error body — body text still wins
  assert.equal(classifyYoutubeAuthError({ status: 200, bodyText: 'error: invalid_grant' }), 'invalid_grant');
});

test('classifyYoutubeAuthError: 401 unauthorized without invalid_grant still fatal', () => {
  assert.equal(classifyYoutubeAuthError({ status: 401, bodyText: '' }), 'unauthorized');
  assert.equal(classifyYoutubeAuthError({ status: 500, bodyText: 'Unauthorized' }), 'unauthorized', 'body text wins over status for unauthorized');
});

test('classifyYoutubeAuthError: 5xx and 429 are transient, never fatal', () => {
  assert.equal(classifyYoutubeAuthError({ status: 500, bodyText: 'internal' }), 'transient');
  assert.equal(classifyYoutubeAuthError({ status: 503, bodyText: '' }), 'transient');
  assert.equal(classifyYoutubeAuthError({ status: 429, bodyText: 'rate limit' }), 'transient');
});

test('classifyYoutubeAuthError: client credentials rejected (invalid_client) is fatal', () => {
  assert.equal(classifyYoutubeAuthError({ status: 401, bodyText: '{"error":"invalid_client"}' }), 'invalid_client');
});

test('classifyYoutubeAuthError: network-level failure classifies as unknown, not fatal', () => {
  assert.equal(classifyYoutubeAuthError({ status: 0, error: new Error('fetch failed') }), 'unknown');
});

test('isFatalAuthClassification covers only the four auth-dead buckets', () => {
  for (const bucket of ['invalid_grant', 'invalid_client', 'unauthorized', 'invalid_scope']) {
    assert.equal(isFatalAuthClassification(bucket), true, `${bucket} must be fatal`);
  }
  for (const bucket of ['transient', 'unknown', 'ok', '']) {
    assert.equal(isFatalAuthClassification(bucket), false, `${bucket} must NOT be fatal`);
  }
});

test('parseYoutubeOauthErrorMessage: extracts status + body from the standard thrown message', () => {
  const parsed = parseYoutubeOauthErrorMessage('YouTube access-token refresh failed (400): {"error":"invalid_grant"}');
  assert.equal(parsed.status, 400);
  assert.equal(parsed.bodyText, '{"error":"invalid_grant"}');
});

test('parseYoutubeOauthErrorMessage: falls through gracefully when the message is non-standard', () => {
  const parsed = parseYoutubeOauthErrorMessage('fetch failed');
  assert.equal(parsed.status, 0);
  assert.equal(parsed.bodyText, 'fetch failed');
});

test('buildRecoveryCommand: OAuth path points at youtube-authorize.mjs with the channel key', () => {
  assert.match(
    buildRecoveryCommand({ channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_OAUTH }),
    /youtube-authorize\.mjs --channel poke-quizz-youtube/u,
  );
});

test('buildRecoveryCommand: browser-session path points at the runbook, no one-shot command', () => {
  const cmd = buildRecoveryCommand({ channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_BROWSER_SESSION });
  assert.match(cmd, /related-video-relogin/u);
  assert.match(cmd, /poke-quizz-youtube/u);
});

test('buildAuthAlertBody: OAuth body mentions the token and uses the OAuth recovery command', () => {
  const body = buildAuthAlertBody({
    channelKey: 'poke-quizz-youtube',
    authType: AUTH_TYPE_OAUTH,
    action: 'video_upload',
    errorDetail: '{"error":"invalid_grant"}',
    recoveryCommand: buildRecoveryCommand({ channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_OAUTH }),
  });
  assert.match(body, /OAuth token invalid/u);
  assert.match(body, /video_upload/u);
  assert.match(body, /youtube-authorize\.mjs/u);
  assert.match(body, /invalid_grant/u);
});

test('buildAuthAlertBody: browser-session body mentions Playwright profile + runbook recovery', () => {
  const body = buildAuthAlertBody({
    channelKey: 'poke-quizz-youtube',
    authType: AUTH_TYPE_BROWSER_SESSION,
    action: 'related_video_sweep',
    errorDetail: 'login_required',
    recoveryCommand: buildRecoveryCommand({ channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_BROWSER_SESSION }),
  });
  assert.match(body, /Studio session expired/u);
  assert.match(body, /Playwright profile/u);
  assert.match(body, /related_video_sweep/u);
  assert.match(body, /related-video-relogin/u);
});

function makeInMemoryStore(initial = {}, nowRef = { value: new Date('2026-10-14T10:00:00Z') }) {
  const state = { ...initial };
  const windowMs = 24 * 60 * 60 * 1000;
  return {
    state,
    nowRef,
    async shouldSuppress(key) {
      const lastIso = state[key];
      if (!lastIso) return false;
      return (nowRef.value.valueOf() - new Date(lastIso).valueOf()) < windowMs;
    },
    async record(key) {
      state[key] = nowRef.value.toISOString();
    },
  };
}

test('alertYoutubeChannelAuthFailure: first fire posts, second within 24h dedupes', async () => {
  const posts = [];
  const nowRef = { value: new Date('2026-10-14T10:00:00Z') };
  const store = makeInMemoryStore({}, nowRef);
  const discordPostImpl = async (params) => { posts.push(params); };

  const first = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube',
    authType: AUTH_TYPE_OAUTH,
    action: 'video_upload',
    errorDetail: 'invalid_grant',
    discordPostImpl, stateStore: store, now: () => nowRef.value,
  });
  assert.equal(first.posted, true);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /OAuth token invalid/u);

  nowRef.value = new Date('2026-10-14T22:00:00Z'); // 12h later
  const second = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube',
    authType: AUTH_TYPE_OAUTH,
    action: 'video_delete',
    discordPostImpl, stateStore: store, now: () => nowRef.value,
  });
  assert.equal(second.posted, false);
  assert.equal(second.deduped, true);
  assert.equal(posts.length, 1, 'second call within window must NOT post');
});

test('alertYoutubeChannelAuthFailure: after 24h window elapses, re-fires', async () => {
  const posts = [];
  const nowRef = { value: new Date('2026-10-14T10:00:00Z') };
  const store = makeInMemoryStore({ 'poke-quizz-youtube|oauth': '2026-10-13T09:00:00Z' }, nowRef);
  const first = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube',
    authType: AUTH_TYPE_OAUTH,
    discordPostImpl: async (p) => { posts.push(p); },
    stateStore: store, now: () => nowRef.value,
  });
  assert.equal(first.posted, true, '25h since last alert → must re-post');
  assert.equal(posts.length, 1);
});

test('alertYoutubeChannelAuthFailure: OAuth and browser-session dedup independently per channel', async () => {
  const posts = [];
  const store = makeInMemoryStore();
  const impl = async (p) => { posts.push(p); };
  const oauth = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_OAUTH,
    discordPostImpl: impl, stateStore: store,
  });
  const browser = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_BROWSER_SESSION,
    discordPostImpl: impl, stateStore: store,
  });
  assert.equal(oauth.posted, true);
  assert.equal(browser.posted, true, 'different authType for the same channel must NOT dedupe');
  assert.equal(posts.length, 2);
});

test('alertYoutubeChannelAuthFailure: Discord post failure returns gracefully, does not throw, does not record', async () => {
  const store = makeInMemoryStore();
  const discordPostImpl = async () => { throw new Error('discord 500'); };
  const result = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_OAUTH,
    discordPostImpl, stateStore: store,
  });
  assert.equal(result.posted, false);
  assert.equal(result.reason, 'discord_post_failed');
  assert.deepEqual(store.state, {}, 'failed post must not record a dedup entry');
});

test('alertYoutubeChannelAuthFailure: refuses on missing input, no post', async () => {
  const posts = [];
  const impl = async (p) => { posts.push(p); };
  assert.equal((await alertYoutubeChannelAuthFailure({ channelKey: '', authType: AUTH_TYPE_OAUTH, discordPostImpl: impl })).posted, false);
  assert.equal((await alertYoutubeChannelAuthFailure({ channelKey: 'x', authType: '', discordPostImpl: impl })).posted, false);
  assert.equal(posts.length, 0);
});

test('alertYoutubeChannelAuthFailure: no discord impl → skipped (not an error)', async () => {
  const result = await alertYoutubeChannelAuthFailure({
    channelKey: 'poke-quizz-youtube', authType: AUTH_TYPE_OAUTH,
  });
  assert.equal(result.posted, false);
  assert.equal(result.reason, 'no_discord_impl');
});
