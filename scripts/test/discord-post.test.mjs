import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToolReportEmbed,
  postToolReport,
  sendDiscordChannelMessage,
  shouldPostToDiscord,
} from '../lib/discord-post.mjs';

function buildConfig(overrides = {}) {
  return {
    env: { DISCORD_BOT_TOKEN: 'test-token', ...overrides.env },
    channelIds: {
      agentResults: '123',
      memoryUpdates: '234',
      systemLogs: '345',
      ...overrides.channelIds,
    },
  };
}

test('shouldPostToDiscord defaults to false and requires explicit opt-in', () => {
  assert.equal(shouldPostToDiscord(buildConfig()), false);
  assert.equal(shouldPostToDiscord(buildConfig(), { explicit: true }), true);
  assert.equal(shouldPostToDiscord(buildConfig({ env: { DISCORD_BOT_TOKEN: '' } }), { explicit: true }), false);
  assert.equal(shouldPostToDiscord(buildConfig(), { explicit: false }), false);
});

test('buildToolReportEmbed maps verdicts to colours and clips fields', () => {
  const embed = buildToolReportEmbed('claude_runner_doctor', 'ready', 'All 10 checks passed.', [
    { name: 'runtime_user', value: 'Agent' },
    { name: 'claude_cli_version', value: '2.1.206' },
    { name: 'empty', value: '' },
  ]);
  assert.equal(embed.title, 'claude_runner_doctor: ready');
  assert.equal(embed.color, 0x1f7a3a);
  assert.equal(embed.fields.length, 2);
  assert.equal(embed.fields[0].name, 'runtime_user');
});

test('sendDiscordChannelMessage skips gracefully without token or channel', async () => {
  const noToken = await sendDiscordChannelMessage({ env: {} }, '123', { content: 'x' });
  assert.equal(noToken.posted, false);
  assert.equal(noToken.reason, 'no_token');

  const noChannel = await sendDiscordChannelMessage({ env: { DISCORD_BOT_TOKEN: 't' } }, '', { content: 'x' });
  assert.equal(noChannel.posted, false);
  assert.equal(noChannel.reason, 'no_channel_id');
});

test('sendDiscordChannelMessage returns messageId on success and error on failure', async () => {
  const stubFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'msg-1' }),
    text: async () => '',
  });
  const success = await sendDiscordChannelMessage(buildConfig(), '123', { content: 'x' }, { fetch: stubFetch });
  assert.equal(success.posted, true);
  assert.equal(success.messageId, 'msg-1');

  const stubFailure = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
    text: async () => 'server oops',
  });
  const failure = await sendDiscordChannelMessage(buildConfig(), '123', { content: 'x' }, { fetch: stubFailure });
  assert.equal(failure.posted, false);
  assert.equal(failure.reason, 'discord_api_500');
});

test('postToolReport skips when opt-in flag is not set', async () => {
  const stubFetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'y' }), text: async () => '' });
  const skipped = await postToolReport(buildConfig(), 'claude_runner_doctor', 'ready', 'ok', [], { fetch: stubFetch });
  assert.equal(skipped.posted, false);
  assert.equal(skipped.reason, 'disabled');
});

test('postToolReport picks channel by tool when explicit is true', async () => {
  let capturedUrl = '';
  const stubFetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, json: async () => ({ id: 'msg' }), text: async () => '' };
  };
  const result = await postToolReport(
    buildConfig(),
    'session_pre_limit_checkpoint',
    'pre_limit',
    'triggered',
    [],
    { explicit: true, fetch: stubFetch }
  );
  assert.equal(result.posted, true);
  assert.equal(result.channelKey, 'memoryUpdates');
  assert.ok(capturedUrl.includes('/channels/234/messages'));
});
