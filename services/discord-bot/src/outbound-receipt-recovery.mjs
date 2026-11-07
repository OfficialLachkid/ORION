import { reconcilePendingGmailSendReceipts } from '../../task-router/src/gmail-send-receipts.mjs';
import { readOutboundReceipt } from '../../task-router/src/outbound-receipt-journal.mjs';
import {
  loadPersistedPendingTasks,
  removePersistedPendingTask,
} from './pending-task-store.mjs';
import {
  searchApprovalMessageInThreads,
  sendDiscordApiRequest,
} from './live-runtime.mjs';

function approvalThreadIds(config) {
  return [
    config?.channelIds?.outreachFollowups,
    config?.channelIds?.outreachWaitingApproval,
    config?.channelIds?.outreachAgent,
  ].filter(Boolean);
}

async function findApprovalCard(config, task, options = {}) {
  const originChannelId = String(task?.approval_origin?.channelId || '').trim();
  const originMessageId = String(task?.approval_origin?.messageId || '').trim();
  if (originChannelId && originMessageId) {
    return { channelId: originChannelId, messageId: originMessageId };
  }
  const token = config?.env?.DISCORD_BOT_TOKEN || '';
  const sendRequest = options.sendDiscordApiRequest || sendDiscordApiRequest;
  return searchApprovalMessageInThreads({
    taskId: task.task_id,
    threadIds: approvalThreadIds(config),
    fetchChannelMessages: (threadId, limit, { beforeId } = {}) => sendRequest(
      token,
      `/channels/${threadId}/messages?limit=${limit}${beforeId ? `&before=${beforeId}` : ''}`,
      undefined,
      'GET',
      options,
    ),
    maxDepth: 1000,
  });
}

async function removeReconciledApprovalCard(config, task, options = {}) {
  const token = config?.env?.DISCORD_BOT_TOKEN || '';
  if (!token) return { cleaned: false, reason: 'discord_token_missing' };
  const target = await findApprovalCard(config, task, options);
  if (!target?.messageId) return { cleaned: true, reason: 'card_not_found' };
  const sendRequest = options.sendDiscordApiRequest || sendDiscordApiRequest;
  try {
    await sendRequest(
      token,
      `/channels/${target.channelId}/messages/${target.messageId}`,
      undefined,
      'DELETE',
      options,
    );
    return { cleaned: true, reason: 'card_deleted' };
  } catch (error) {
    if (/\(404\)/u.test(error?.message || '')) {
      return { cleaned: true, reason: 'card_already_gone' };
    }
    return { cleaned: false, reason: 'discord_delete_failed', error: error?.message || String(error) };
  }
}

export async function recoverOutboundReceipts(config, options = {}) {
  const reconciliation = await reconcilePendingGmailSendReceipts(config, options);
  const reconciledTaskIds = new Set(
    reconciliation.results
      .filter((result) => result.status === 'reconciled')
      .map((result) => result.receipt?.task_id)
      .filter(Boolean),
  );
  const receiptPendingTasks = loadPersistedPendingTasks(config)
    .filter((task) => task?.database_receipt_pending === true);
  const cleanup = [];
  for (const task of receiptPendingTasks) {
    if (!reconciledTaskIds.has(task.task_id)) {
      const receipt = await readOutboundReceipt(config, task.task_id);
      if (receipt?.state !== 'reconciled') continue;
    }
    const result = await removeReconciledApprovalCard(config, task, options);
    cleanup.push({ taskId: task.task_id, ...result });
    if (result.cleaned) removePersistedPendingTask(config, task.task_id);
  }
  return {
    ...reconciliation,
    tasksCleaned: cleanup.filter((item) => item.cleaned).length,
    cleanup,
  };
}
