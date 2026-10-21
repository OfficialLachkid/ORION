// Morning-shift drain: auto-send follow-up drafts that the previous night
// shift queued into the pending-approval store. This replaces the manual
// "click approve on every follow-up card in #outreach-followups" step —
// drafts drafted the night before go out at 07:00 without a human click.
//
// Scope on purpose: ONLY `lead_follow_up` + `gmail_send_draft` tasks. Fresh
// outreach drafts (`lead_qualification`) still require human approval so a
// bad batch can't blast overnight. Extending to outreach is a one-line
// change in `pickApprovedFollowUpSends`, intentionally gated for now.
//
// All I/O is injected (executeTask, discordApi, pending-store accessors,
// sleep). The entry point `run-morning-shift.mjs` wires in the real deps;
// tests wire in fakes.

const DEFAULT_DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_SLEEP_MS = 800;

export function pickApprovedFollowUpSends(tasks) {
  return tasks
    .filter((t) => t?.source_type === 'lead_follow_up' && t?.runtime_action === 'gmail_send_draft')
    .sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)));
}

function buildDiscordApi(token, fetchImpl, sleep, apiBase = DEFAULT_DISCORD_API) {
  return async function discordApi(path, method = 'GET') {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}` },
    });
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      await sleep(Math.max(1000, Math.ceil(((body.retry_after || 1) * 1000) + 150)));
      return discordApi(path, method);
    }
    if (!response.ok) {
      throw new Error(`Discord ${method} ${path} → ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };
}

// Pulls the three channels the approval cards could live in. Follow-up cards
// live in `outreachFollowups` but outreach-agent + waiting-approval are kept
// as fallbacks because historical cards sometimes landed there before the
// routing settled in #166.
function approvalThreadIds(config) {
  return [
    config?.channelIds?.outreachFollowups,
    config?.channelIds?.outreachWaitingApproval,
    config?.channelIds?.outreachAgent,
  ].filter(Boolean);
}

export async function deleteApprovalCard({ config, taskId, discordApi, searchApprovalMessageInThreads }) {
  const threadIds = approvalThreadIds(config);
  if (threadIds.length === 0) return { deleted: false, reason: 'no_channels_configured' };
  const target = await searchApprovalMessageInThreads({
    taskId,
    threadIds,
    fetchChannelMessages: (threadId, limit, { beforeId } = {}) => discordApi(
      `/channels/${threadId}/messages?limit=${limit}${beforeId ? `&before=${beforeId}` : ''}`,
    ),
    maxDepth: 1000,
  });
  if (!target?.messageId) return { deleted: false, reason: 'card_not_found' };
  try {
    await discordApi(`/channels/${target.channelId}/messages/${target.messageId}`, 'DELETE');
    return { deleted: true };
  } catch (error) {
    return { deleted: false, reason: 'delete_failed', error: error.message || String(error) };
  }
}

// Sends one follow-up: execute the gmail_send_draft task, remove it from the
// pending-approval store on success, then best-effort delete the Discord
// card. A send failure leaves the task in the store so it's retried the next
// morning. A card-delete failure is intentionally non-fatal — the email is
// already out and the stale card can be cleaned up by hand.
export async function sendOneFollowUp(task, deps) {
  const result = await deps.executeTask(task, deps.config);
  if (result?.outcome !== 'completed') {
    const message = result?.error?.message || 'executeTask did not complete';
    return { ok: false, taskId: task.task_id, to: task.email_request?.to, error: message };
  }
  deps.removePersistedPendingTask(deps.config, task.task_id);
  const cardResult = await deps.deleteApprovalCard({
    config: deps.config,
    taskId: task.task_id,
    discordApi: deps.discordApi,
    searchApprovalMessageInThreads: deps.searchApprovalMessageInThreads,
  }).catch((error) => ({ deleted: false, reason: 'delete_failed', error: error.message || String(error) }));
  return {
    ok: true,
    taskId: task.task_id,
    to: task.email_request?.to,
    cardDeleted: Boolean(cardResult?.deleted),
    cardReason: cardResult?.deleted ? null : (cardResult?.reason || null),
  };
}

export async function sendApprovedFollowUps(options) {
  const {
    config,
    executeTask,
    loadPersistedPendingTasks,
    removePersistedPendingTask,
    searchApprovalMessageInThreads,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    sleepMs = DEFAULT_SLEEP_MS,
    discordApi: discordApiOverride = null,
    deleteApprovalCard: deleteApprovalCardOverride = null,
    stdout = process.stdout,
  } = options;

  if (typeof executeTask !== 'function') throw new Error('executeTask dependency is required');
  if (typeof loadPersistedPendingTasks !== 'function') throw new Error('loadPersistedPendingTasks dependency is required');
  if (typeof removePersistedPendingTask !== 'function') throw new Error('removePersistedPendingTask dependency is required');
  if (typeof searchApprovalMessageInThreads !== 'function') throw new Error('searchApprovalMessageInThreads dependency is required');

  const token = config?.env?.DISCORD_BOT_TOKEN || '';
  const discordApi = discordApiOverride || buildDiscordApi(token, fetchImpl, sleep);
  const doDeleteCard = deleteApprovalCardOverride || deleteApprovalCard;

  const pending = loadPersistedPendingTasks(config);
  const picks = pickApprovedFollowUpSends(pending);
  stdout.write(`[morning-shift] approved follow-ups to send: ${picks.length}\n`);
  if (picks.length === 0) {
    return { picked: 0, sent: 0, failed: 0, cardsDeleted: 0, failures: [], outcomes: [] };
  }

  let sent = 0;
  let failed = 0;
  let cardsDeleted = 0;
  const failures = [];
  const outcomes = [];

  for (const [i, task] of picks.entries()) {
    const marker = `[${i + 1}/${picks.length}] ${task.task_id} → ${task.email_request?.to || '(no-to)'}`;
    try {
      const outcome = await sendOneFollowUp(task, {
        config,
        executeTask,
        removePersistedPendingTask,
        deleteApprovalCard: doDeleteCard,
        discordApi,
        searchApprovalMessageInThreads,
      });
      outcomes.push(outcome);
      if (outcome.ok) {
        sent += 1;
        if (outcome.cardDeleted) cardsDeleted += 1;
        stdout.write(`[morning-shift] sent ${marker}${outcome.cardDeleted ? ' (card deleted)' : ''}\n`);
      } else {
        failed += 1;
        failures.push({ taskId: task.task_id, to: task.email_request?.to, error: outcome.error });
        stdout.write(`[morning-shift] FAILED ${marker}: ${outcome.error}\n`);
      }
    } catch (error) {
      failed += 1;
      failures.push({ taskId: task.task_id, to: task.email_request?.to, error: error.message || String(error) });
      outcomes.push({ ok: false, taskId: task.task_id, to: task.email_request?.to, error: error.message || String(error) });
      stdout.write(`[morning-shift] THREW ${marker}: ${error.message || error}\n`);
    }
    if (i < picks.length - 1) await sleep(sleepMs);
  }

  const summary = { picked: picks.length, sent, failed, cardsDeleted, failures, outcomes };
  stdout.write(`[morning-shift] summary: ${JSON.stringify({ picked: picks.length, sent, failed, cardsDeleted })}\n`);
  return summary;
}
