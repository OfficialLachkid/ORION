import { spawn } from 'node:child_process';

import { projectRoot } from '../../services/lib/runtime-config.mjs';
import { sendDiscordChannelMessage } from './discord-post.mjs';
import {
  isClaudeAuthenticationError,
  isClaudeUsageLimitError,
} from './night-shift/qualification.mjs';

function commandFor(config) {
  return config?.env?.CLAUDE_COMMAND || 'claude';
}

export function runClaudeAnalysis(prompt, config, spawnImpl = spawn) {
  return new Promise((resolvePromise, rejectPromise) => {
    const command = commandFor(config);
    const model = config?.env?.CLAUDE_MODEL || 'sonnet';
    const child = spawnImpl(command, ['-p', prompt, '--model', model], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`claude -p exited ${code}. stderr: ${stderr.trim().slice(0, 500) || '(empty)'}`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

export function buildWeeklyAnalyticsClaudeAlert(config, error) {
  const message = String(error?.message || error || 'Unknown Claude failure');
  const command = commandFor(config);
  const model = config?.env?.CLAUDE_MODEL || 'sonnet';
  if (isClaudeAuthenticationError(message)) {
    return {
      title: 'Weekly analytics: Claude authentication required',
      description: 'The data pack was built, but Claude could not authenticate, so no weekly analysis was posted.',
      color: 0xa11c1c,
      fields: [
        { name: 'Reauthenticate', value: `\`${command} auth login --claudeai\`` },
        { name: 'Verify the real CLI session', value: `\`${command} -p "Reply with exactly AUTH_READY" --model ${model}\`` },
        { name: 'Important', value: '`claude auth status` can be stale; use the real prompt canary above.' },
      ],
    };
  }
  if (isClaudeUsageLimitError(message)) {
    return {
      title: 'Weekly analytics: Claude usage limit reached',
      description: 'The data pack is intact. The report can run again after the Claude usage window refreshes.',
      color: 0xd4a017,
      fields: [{ name: 'Failure', value: message.slice(0, 900) }],
    };
  }
  return {
    title: 'Weekly analytics: Claude analysis failed',
    description: 'The data collection stage completed, but the analyst step failed.',
    color: 0xa11c1c,
    fields: [{ name: 'Failure', value: message.slice(0, 900) }],
  };
}

export async function notifyWeeklyAnalyticsClaudeFailure(
  config,
  error,
  send = sendDiscordChannelMessage,
) {
  const channelId = String(config?.channelIds?.alerts || '').trim();
  if (!channelId) return { posted: false, reason: 'alerts_channel_missing' };
  return send(config, channelId, { embeds: [buildWeeklyAnalyticsClaudeAlert(config, error)] });
}
