#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const FEED_COLOR = Object.freeze({
  push: 0x5865F2,
  pull_request_opened: 0x3BA55C,
  pull_request_merged: 0x57F287,
  release: 0xFEE75C,
  workflow_dispatch: 0x99AAB5,
});

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function shortSha(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 7) : '';
}

function truncate(value, limit = 160) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/u)[0].trim();
}

function markdownLink(label, url) {
  return url ? `[${label}](${url})` : label;
}

function getEventPayload() {
  const eventPath = env('GITHUB_EVENT_PATH');
  if (!eventPath || !existsSync(eventPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch {
    return {};
  }
}

function buildCommitUrl(repositoryUrl, sha) {
  return repositoryUrl && sha ? `${repositoryUrl}/commit/${sha}` : '';
}

function buildCompareUrl(payload) {
  const compareUrl = String(payload?.compare || '').trim();
  return compareUrl.startsWith('http') ? compareUrl : '';
}

function buildPushPayload(payload) {
  const repository = payload?.repository;
  const repositoryName = repository?.full_name || env('GITHUB_REPOSITORY', 'unknown');
  const repositoryUrl = repository?.html_url || '';
  const branch = String(payload?.ref || env('GITHUB_REF_NAME', 'unknown')).replace(/^refs\/heads\//u, '');
  const actor = payload?.sender?.login || payload?.pusher?.name || env('GITHUB_ACTOR', 'unknown');
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  const headCommit = payload?.head_commit || commits[commits.length - 1] || null;
  const headSha = headCommit?.id || payload?.after || env('GITHUB_SHA');
  const headCommitUrl = buildCommitUrl(repositoryUrl, headSha);
  const compareUrl = buildCompareUrl(payload);
  const commitSummary = commits
    .slice(0, 3)
    .map((commit) => {
      const sha = shortSha(commit.id);
      const message = truncate(firstLine(commit.message), 90) || 'No commit message';
      return `- ${markdownLink(`\`${sha}\``, buildCommitUrl(repositoryUrl, commit.id))} ${message}`;
    })
    .join('\n');

  const fields = [
    { name: 'Repository', value: `\`${repositoryName}\``, inline: true },
    { name: 'Branch', value: `\`${branch}\``, inline: true },
    { name: 'Actor', value: `\`${actor}\``, inline: true },
    { name: 'Commits', value: `\`${commits.length || 1}\``, inline: true },
    {
      name: 'Head Commit',
      value: headSha
        ? markdownLink(`\`${shortSha(headSha)}\``, headCommitUrl)
        : '`unknown`',
      inline: true,
    },
  ];

  if (compareUrl) {
    fields.push({
      name: 'Compare',
      value: markdownLink('View comparison', compareUrl),
      inline: true,
    });
  }

  if (commitSummary) {
    fields.push({
      name: 'Latest Commits',
      value: commitSummary,
      inline: false,
    });
  }

  return {
    color: FEED_COLOR.push,
    title: `GitHub Push - ${repositoryName}`,
    description: `${commits.length || 1} commit(s) pushed to \`${branch}\`. Latest: ${truncate(firstLine(headCommit?.message), 120) || 'No commit message'}`,
    fields,
  };
}

function buildPullRequestPayload(payload) {
  const pr = payload?.pull_request;
  if (!pr) {
    return null;
  }

  const action = env('GITHUB_EVENT_NAME') === 'pull_request_target'
    ? String(payload?.action || '').trim().toLowerCase()
    : String(payload?.action || '').trim().toLowerCase();
  const isMerged = Boolean(pr.merged);

  if (!['opened', 'reopened', 'closed'].includes(action)) {
    return null;
  }

  if (action === 'closed' && !isMerged) {
    return null;
  }

  const repositoryName = pr.base?.repo?.full_name || env('GITHUB_REPOSITORY', 'unknown');
  const stateKey = isMerged ? 'pull_request_merged' : 'pull_request_opened';
  const stateLabel = isMerged
    ? 'Pull Request Merged'
    : action === 'reopened'
      ? 'Pull Request Reopened'
      : 'Pull Request Opened';

  const fields = [
    {
      name: 'PR',
      value: markdownLink(`#${pr.number} ${truncate(pr.title, 120) || 'Untitled PR'}`, pr.html_url),
      inline: false,
    },
    { name: 'Repository', value: `\`${repositoryName}\``, inline: true },
    { name: 'Base', value: `\`${pr.base?.ref || 'unknown'}\``, inline: true },
    { name: 'Head', value: `\`${pr.head?.ref || 'unknown'}\``, inline: true },
    { name: 'Author', value: `\`${pr.user?.login || 'unknown'}\``, inline: true },
  ];

  if (isMerged && pr.merge_commit_sha) {
    fields.push({
      name: 'Merge Commit',
      value: markdownLink(
        `\`${shortSha(pr.merge_commit_sha)}\``,
        buildCommitUrl(pr.base?.repo?.html_url || '', pr.merge_commit_sha)
      ),
      inline: true,
    });
  }

  return {
    color: FEED_COLOR[stateKey],
    title: `${stateLabel} - ${repositoryName}`,
    description: truncate(pr.body, 220) || `${stateLabel} for \`${pr.base?.ref || 'unknown'}\`.`,
    fields,
  };
}

function buildReleasePayload(payload) {
  const release = payload?.release;
  const repositoryName = payload?.repository?.full_name || env('GITHUB_REPOSITORY', 'unknown');
  if (!release) {
    return null;
  }

  const fields = [
    { name: 'Repository', value: `\`${repositoryName}\``, inline: true },
    { name: 'Tag', value: `\`${release.tag_name || 'unknown'}\``, inline: true },
    { name: 'Author', value: `\`${release.author?.login || env('GITHUB_ACTOR', 'unknown')}\``, inline: true },
    { name: 'Target', value: `\`${release.target_commitish || 'unknown'}\``, inline: true },
  ];

  return {
    color: FEED_COLOR.release,
    title: `Release Published - ${repositoryName}`,
    description: markdownLink(truncate(release.name || release.tag_name || 'Release', 140), release.html_url),
    fields,
  };
}

function buildDispatchPayload() {
  const repositoryName = env('GITHUB_REPOSITORY', 'unknown');
  const actor = env('GITHUB_ACTOR', 'unknown');
  const branch = env('GITHUB_REF_NAME', 'unknown');

  return {
    color: FEED_COLOR.workflow_dispatch,
    title: `GitHub Feed Test - ${repositoryName}`,
    description: `Manual repo-activity feed test triggered by \`${actor}\` on \`${branch}\`.`,
    fields: [
      { name: 'Repository', value: `\`${repositoryName}\``, inline: true },
      { name: 'Branch', value: `\`${branch}\``, inline: true },
      { name: 'Actor', value: `\`${actor}\``, inline: true },
    ],
  };
}

function buildActivityPayload() {
  const eventName = env('GITHUB_EVENT_NAME');
  const payload = getEventPayload();
  const embed = eventName === 'push'
    ? buildPushPayload(payload)
    : eventName === 'pull_request_target' || eventName === 'pull_request'
      ? buildPullRequestPayload(payload)
      : eventName === 'release'
        ? buildReleasePayload(payload)
        : eventName === 'workflow_dispatch'
          ? buildDispatchPayload()
          : null;

  if (!embed) {
    return null;
  }

  return {
    embeds: [
      {
        ...embed,
        footer: {
          text: 'Ruflo GitHub Feed',
        },
      },
    ],
  };
}

async function main() {
  const payload = buildActivityPayload();
  if (!payload) {
    process.stdout.write('Event is not configured for GitHub feed posting. Skipping.\n');
    return;
  }

  const webhookUrl = env('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) {
    process.stdout.write('DISCORD_WEBHOOK_URL is not set. Skipping GitHub feed notification.\n');
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord webhook post failed (${response.status}): ${errorText}`);
  }

  process.stdout.write('Posted GitHub activity to Discord webhook.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
