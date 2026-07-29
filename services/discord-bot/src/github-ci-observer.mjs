function normalize(value) {
  return String(value || '').trim();
}

function findField(embed, name) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  return fields.find((field) => normalize(field?.name).toLowerCase() === normalize(name).toLowerCase()) || null;
}

function extractFieldValue(embed, name) {
  const field = findField(embed, name);
  return normalize(field?.value).replace(/^`|`$/gu, '');
}

function extractNumber(value) {
  const match = /#?(\d+)/u.exec(normalize(value));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function extractCommit(value) {
  const matches = [...normalize(value).matchAll(/\b([0-9a-f]{7,40})\b/giu)]
    .map((match) => match[1].toLowerCase())
    .sort((left, right) => right.length - left.length);
  return matches[0] || '';
}

function extractStatus(value) {
  const match = /\b(running|success|failure|cancelled|skipped|timed_out|action_required|neutral)\b/iu.exec(normalize(value));
  return match ? match[1].toLowerCase() : '';
}

function inferStatusFromTitle(title) {
  const match = /^GitHub CI\s+([A-Z_]+)\s+/u.exec(normalize(title));
  return match ? match[1].toLowerCase() : '';
}

export function parseGitHubCiObservation(message, config) {
  const ciChannelId = config?.channelIds?.ci || config?.channelIds?.github;
  if (!ciChannelId || message?.channel_id !== ciChannelId) {
    return null;
  }

  if (!message?.webhook_id && !message?.author?.bot) {
    return null;
  }

  const embed = Array.isArray(message?.embeds) ? message.embeds[0] : null;
  if (!embed) {
    return null;
  }

  const workflowName = extractFieldValue(embed, 'Workflow');
  const jobName = extractFieldValue(embed, 'Job');
  const status = extractStatus(extractFieldValue(embed, 'Status')) || inferStatusFromTitle(embed?.title);
  const repository = extractFieldValue(embed, 'Repository');
  const sourceBranch = extractFieldValue(embed, 'Source Branch');
  const targetBranch = extractFieldValue(embed, 'Target Branch');
  const refName = sourceBranch || extractFieldValue(embed, 'Ref');
  const eventName = extractFieldValue(embed, 'Event');
  const actor = extractFieldValue(embed, 'Actor');
  const commit = extractCommit(extractFieldValue(embed, 'Commit'));
  const detailsUrl = extractFieldValue(embed, 'Details');
  const prNumber = extractNumber(extractFieldValue(embed, 'PR'));
  const runNumber = extractNumber(extractFieldValue(embed, 'Run'));

  if (!workflowName && !jobName && !status) {
    return null;
  }

  return {
    workflowName,
    jobName,
    status,
    repository,
    refName,
    sourceBranch,
    targetBranch: targetBranch === 'not applicable' ? '' : targetBranch,
    eventName,
    actor,
    commit,
    detailsUrl,
    prNumber,
    runNumber,
    isRuntimeValidation:
      workflowName === 'Ruflo Runtime Validation'
      || jobName === 'Runtime Validation',
    source: message.webhook_id ? 'github_webhook' : 'bot_message',
  };
}
