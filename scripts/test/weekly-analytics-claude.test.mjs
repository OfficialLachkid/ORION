import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeeklyAnalyticsClaudeAlert,
  notifyWeeklyAnalyticsClaudeFailure,
} from '../lib/weekly-analytics-claude.mjs';

test('Claude OAuth failures produce a ready-to-run recovery alert', () => {
  const config = { env: { CLAUDE_COMMAND: '/opt/homebrew/bin/claude', CLAUDE_MODEL: 'sonnet' } };
  const alert = buildWeeklyAnalyticsClaudeAlert(
    config,
    new Error('Failed to authenticate: OAuth session expired and could not be refreshed'),
  );
  assert.match(alert.title, /authentication required/u);
  assert.match(JSON.stringify(alert), /auth login --claudeai/u);
  assert.match(JSON.stringify(alert), /AUTH_READY/u);
  assert.match(JSON.stringify(alert), /auth status.*stale/u);
});

test('weekly Claude alert posts to #alerts and degrades safely without it', async () => {
  const sent = [];
  const send = async (config, channelId, payload) => {
    sent.push({ config, channelId, payload });
    return { posted: true };
  };
  const config = { env: {}, channelIds: { alerts: 'alerts-1' } };
  assert.deepEqual(await notifyWeeklyAnalyticsClaudeFailure(config, new Error('boom'), send), { posted: true });
  assert.equal(sent[0].channelId, 'alerts-1');
  assert.equal(sent[0].payload.embeds.length, 1);
  assert.deepEqual(
    await notifyWeeklyAnalyticsClaudeFailure({ env: {}, channelIds: {} }, new Error('boom'), send),
    { posted: false, reason: 'alerts_channel_missing' },
  );
});
