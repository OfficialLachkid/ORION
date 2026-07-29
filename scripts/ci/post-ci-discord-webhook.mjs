#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { resolveCiRefContext } from './lib/ci-notification-context.mjs';

const STATUS_COLOR = {
  success: 0x57F287,
  failure: 0xED4245,
  cancelled: 0x95A5A6,
  skipped: 0xFEE75C,
  running: 0xFEE75C,
};

// Same at-a-glance-state idea as the leadgen sweep messages (✅❌🔄⏳).
const STATUS_EMOJI = {
  success: '✅',
  failure: '❌',
  cancelled: '⏹️',
  skipped: '⏭️',
  running: '🔄',
};

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function shortSha(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 7) : '';
}

function buildCommitUrl(sha, repository) {
  const normalizedSha = env('CI_SHA', env('GITHUB_SHA', sha));
  const normalizedRepository = repository || env('CI_REPOSITORY', env('GITHUB_REPOSITORY'));
  const serverUrl = env('GITHUB_SERVER_URL');
  return normalizedSha && normalizedRepository && serverUrl
    ? `${serverUrl}/${normalizedRepository}/commit/${normalizedSha}`
    : '';
}

function buildRunUrl() {
  const explicit = env('CI_RUN_URL');
  if (explicit) {
    return explicit;
  }

  const serverUrl = env('GITHUB_SERVER_URL');
  const repository = env('GITHUB_REPOSITORY');
  const runId = env('GITHUB_RUN_ID');
  return serverUrl && repository && runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : '';
}

function buildPayload() {
  const status = env('CI_STATUS', 'unknown').toLowerCase();
  const emoji = STATUS_EMOJI[status] || '';
  const workflowName = env('CI_WORKFLOW_NAME', 'Ruflo CI');
  const jobName = env('CI_JOB_NAME', 'Runtime Validation');
  const repository = env('CI_REPOSITORY', env('GITHUB_REPOSITORY', 'unknown'));
  const refName = env('CI_REF_NAME', env('GITHUB_REF_NAME', 'unknown'));
  const sha = env('CI_SHA', env('GITHUB_SHA'));
  const eventName = env('CI_EVENT_NAME', env('GITHUB_EVENT_NAME', 'unknown'));
  const actor = env('CI_ACTOR', env('GITHUB_ACTOR', 'unknown'));
  const prNumber = env('CI_PR_NUMBER');
  const runUrl = buildRunUrl();
  const runNumber = env('GITHUB_RUN_NUMBER');
  const commitUrl = buildCommitUrl(sha, repository);
  const refContext = resolveCiRefContext({
    eventName,
    refName,
    headRef: env('CI_HEAD_REF', env('GITHUB_HEAD_REF')),
    baseRef: env('CI_BASE_REF', env('GITHUB_BASE_REF')),
  });

  const fields = [
    { name: 'Workflow', value: `\`${workflowName}\``, inline: true },
    { name: 'Job', value: `\`${jobName}\``, inline: true },
    { name: 'Status', value: `${emoji ? `${emoji} ` : ''}\`${status}\``, inline: true },
    { name: 'Repository', value: `\`${repository}\``, inline: true },
    { name: 'Source Branch', value: `\`${refContext.sourceBranch}\``, inline: true },
    {
      name: 'Target Branch',
      value: refContext.targetBranch ? `\`${refContext.targetBranch}\`` : '`not applicable`',
      inline: true,
    },
    { name: 'Event', value: `\`${eventName}\``, inline: true },
    { name: 'Actor', value: `\`${actor}\``, inline: true },
    {
      name: 'Commit',
      value: sha
        ? commitUrl
          ? `[\`${shortSha(sha)}\`](${commitUrl})`
          : `\`${shortSha(sha)}\``
        : '`unknown`',
      inline: true,
    },
  ];

  if (prNumber) {
    fields.push({ name: 'PR', value: `#${prNumber}`, inline: true });
  }

  if (runNumber) {
    fields.push({ name: 'Run', value: `#${runNumber}`, inline: true });
  }

  if (runUrl) {
    fields.push({ name: 'Details', value: runUrl, inline: false });
  }

  const isRunning = status === 'running';
  return {
    embeds: [
      {
        color: STATUS_COLOR[status] || 0x5865F2,
        title: `${emoji ? `${emoji} ` : ''}GitHub CI ${status.toUpperCase()} - ${repository}`,
        description: isRunning
          ? `${workflowName} is running for \`${refContext.displayRef}\`... this message updates when it finishes.`
          : `${workflowName} finished for \`${refContext.displayRef}\`.`,
        fields,
        footer: {
          text: 'Ruflo GitHub CI',
        },
      },
    ],
  };
}

function appendJobOutput(name, value) {
  const outputPath = env('GITHUB_OUTPUT');
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

async function main() {
  const webhookUrl = env('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) {
    process.stdout.write('DISCORD_WEBHOOK_URL is not set. Skipping Discord CI notification.\n');
    return;
  }

  // Start→finish edit-in-place: the "start" mode posts a Running embed with
  // ?wait=true so Discord returns the message ID, which the workflow passes
  // to the finish step; with CI_MESSAGE_ID set, the same message is PATCHed
  // instead of posting a second one.
  const messageId = env('CI_MESSAGE_ID');
  const isStart = env('CI_NOTIFY_MODE') === 'start';

  const targetUrl = messageId
    ? `${webhookUrl.split('?')[0]}/messages/${messageId}`
    : `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}wait=true`;

  const response = await fetch(targetUrl, {
    method: messageId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildPayload()),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord webhook post failed (${response.status}): ${errorText}`);
  }

  if (isStart) {
    const body = await response.json();
    if (body?.id) {
      appendJobOutput('message_id', body.id);
      process.stdout.write(`Posted CI running notice (message ${body.id}).\n`);
      return;
    }
  }

  process.stdout.write(messageId ? 'Updated CI Discord message in place.\n' : 'Posted CI result to Discord webhook.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
