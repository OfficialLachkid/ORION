import process from 'node:process';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { processDiscordEvent } from './intake.mjs';
import {
  buildAcknowledgementDiscordPayload,
  buildNoticeDiscordPayload,
  buildOutboundEventDiscordPayload,
  upgradeLegacyDiscordPayload,
} from './message-formatting.mjs';
import { normalizeTaskMessage } from '../../task-router/src/router.mjs';
import { buildExecutionPlan, buildExecutionStartedEvents, executeTask } from '../../task-router/src/executor.mjs';
import { processTranscriptionRequest } from '../../transcription-worker/src/worker.mjs';
import { recordOpsMetric } from '../../lib/metrics-store.mjs';
import {
  buildApprovalOutcomeWriteBackCandidates,
  buildExecutionWriteBackCandidates,
} from '../../lib/memory-writeback-candidates.mjs';
import {
  buildApprovalRejectModal,
  buildApprovalButtons,
  buildResolvedApprovalButtons,
  buildResolvedApprovalContent,
  buildResolvedApprovalEmbeds,
  normalizeInteractionAsApprovalMessage,
  shouldOpenRejectApprovalModal,
} from './approval-buttons.mjs';
import { buildMemoryWriteBackCandidateEvent } from './memory-writeback-events.mjs';
import { normalizeSupportedSlashCommandInteraction } from './slash-commands.mjs';
import {
  buildGatewayConnectionUrl,
  createEmptySessionState,
  getReconnectPlan,
  hasResumableSession,
} from './gateway-state.mjs';
import { parseGitHubCiObservation } from './github-ci-observer.mjs';
import {
  buildDeveloperMergeApprovalEvents,
  buildDeveloperMergeApprovalTask,
} from '../../developer-agent/src/pr-merge-approval.mjs';
import {
  findPersistedPendingTask,
  loadPersistedPendingTasks,
  removePersistedPendingTask,
  upsertPersistedPendingTask,
} from './pending-task-store.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/';
const GATEWAY_INTENTS =
  (1 << 0) | // GUILDS
  (1 << 9) | // GUILD_MESSAGES
  (1 << 15); // MESSAGE_CONTENT

const DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE = 4;
const DISCORD_INTERACTION_CALLBACK_DEFERRED_UPDATE_MESSAGE = 6;
const DISCORD_INTERACTION_CALLBACK_UPDATE_MESSAGE = 7;
const DISCORD_INTERACTION_CALLBACK_MODAL = 9;
const DISCORD_MESSAGE_FLAG_EPHEMERAL = 1 << 6;
const IMAGE_CONTEXT_WINDOW_MS = 10 * 60 * 1000;
const DISCORD_BOT_LAUNCH_AGENT = 'io.ruv.ruflo.discord-bot';

function assertLiveRuntimeConfig(config) {
  const missing = [];

  if (!config.env.DISCORD_BOT_TOKEN) {
    missing.push('DISCORD_BOT_TOKEN');
  }

  if (!config.guildId) {
    missing.push('DISCORD_GUILD_ID');
  }

  for (const [key, channelId] of Object.entries({
    commands: config.channelIds.commands,
    parsedTasks: config.channelIds.parsedTasks,
    taskQueue: config.channelIds.taskQueue,
    approvals: config.channelIds.approvals,
    pullRequests: config.channelIds.pullRequests,
    alerts: config.channelIds.alerts,
    dailySummary: config.channelIds.dailySummary,
    systemLogs: config.channelIds.systemLogs,
  })) {
    if (!channelId) {
      missing.push(`channelIds.${key}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Live Discord runtime is missing required config: ${missing.join(', ')}`);
  }
}

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sendDiscordApiRequest(token, path, body, method = 'POST') {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method,
    headers: buildAuthHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function sendDiscordInteractionCallback(interactionId, interactionToken, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord interaction callback failed (${response.status}): ${errorText}`);
  }
}

function scheduleDiscordBotSelfRestart() {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function') {
    return false;
  }

  try {
    const uid = process.getuid();
    const child = spawn(
      '/bin/sh',
      ['-lc', `sleep 1; launchctl kickstart -k gui/${uid}/${DISCORD_BOT_LAUNCH_AGENT}`],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    child.unref();
    return true;
  } catch (error) {
    process.stderr.write(`Could not schedule Discord bot restart: ${error.message}\n`);
    return false;
  }
}

export function shouldScheduleDeferredDiscordBotRestart(execution) {
  return execution?.outcome === 'completed'
    && execution?.executionPlan?.action === 'mac_runtime_safe_sync'
    && execution?.executionResult?.report?.restartDiscordBotDeferred === true;
}

function truncateMessage(content) {
  const text = String(content || '').trim();
  if (text.length <= 2000) {
    return text;
  }

  return `${text.slice(0, 1997)}...`;
}

function isCommandChannelMessage(message, config) {
  return Boolean(config?.channelIds?.commands && message?.channelId === config.channelIds.commands);
}

function hasMessageTextContent(message) {
  return Boolean(String(message?.content || '').trim());
}

function isImageAttachment(attachment) {
  return Boolean(attachment?.contentType && String(attachment.contentType).toLowerCase().startsWith('image/'));
}

function extractImageAttachments(message) {
  return Array.isArray(message?.attachments) ? message.attachments.filter((attachment) => isImageAttachment(attachment)) : [];
}

export function buildImageContextKey(message) {
  return `${message?.author?.id || ''}:${message?.channelId || ''}`;
}

export function mergeImageAttachments(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();

  for (const attachment of [...primary, ...secondary]) {
    const key = attachment?.id || attachment?.url || attachment?.filename || JSON.stringify(attachment || {});
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(attachment);
  }

  return merged;
}

export function attachImageContextToTasks(tasks = [], imageAttachments = []) {
  const mergedImages = mergeImageAttachments([], imageAttachments);
  if (mergedImages.length === 0) {
    return tasks;
  }

  for (const task of tasks) {
    const existingImages = Array.isArray(task?.image_attachments) ? task.image_attachments : [];
    const combined = mergeImageAttachments(existingImages, mergedImages);
    task.image_attachments = combined;
    task.image_attachment_count = combined.length;
    task.image_attachment_filenames = combined
      .map((attachment) => attachment?.filename || '')
      .filter(Boolean);
  }

  return tasks;
}

function buildImageContextUpdateEvents(tasks, imageAttachments) {
  return tasks.map((task) => ({
    channelKey: 'parsedTasks',
    type: 'task_context_update',
    body: `Linked ${imageAttachments.length} image attachment(s) to ${task.task_id}.`,
    metadata: {
      taskId: task.task_id,
      summary: task.summary,
      imageAttachmentCount: task.image_attachment_count || imageAttachments.length,
      imageAttachmentFilenames: task.image_attachment_filenames || imageAttachments.map((attachment) => attachment.filename || '').filter(Boolean),
    },
  }));
}

function hydrateApprovalOutcomeEvents(outboundEvents = [], pendingTask) {
  if (!pendingTask?.task_id) {
    return outboundEvents;
  }

  return outboundEvents.map((outboundEvent) => {
    if (outboundEvent?.type !== 'approval_outcome') {
      return outboundEvent;
    }

    const metadata = outboundEvent.metadata || {};
    return {
      ...outboundEvent,
      metadata: {
        ...metadata,
        status: metadata.status || (metadata.decision === 'approve' ? 'approved' : metadata.decision === 'reject' ? 'rejected' : ''),
        summary: metadata.summary || pendingTask.summary || '',
        targetAgent: metadata.targetAgent || pendingTask.target_agent || '',
        domain: metadata.domain || pendingTask.domain || '',
        priority: metadata.priority || pendingTask.priority || '',
        imageAttachmentCount: metadata.imageAttachmentCount || pendingTask.image_attachment_count || 0,
        imageAttachmentFilenames: metadata.imageAttachmentFilenames || pendingTask.image_attachment_filenames || [],
      },
    };
  });
}

function buildVoiceTranscriptEvent(message, transcriptionResult) {
  return {
    channelKey: 'parsedTasks',
    type: 'voice_transcript',
    body: `Transcript from ${message.author.displayName || message.author.username || message.author.id}: ${transcriptionResult.transcript}`,
    metadata: {
      sourceMessageId: message.messageId || '',
      confidence: transcriptionResult.confidence,
      language: transcriptionResult.language || '',
      segmentCount: transcriptionResult.segmentCount || 0,
    },
  };
}

function resolveTrackedTaskId(outboundEvent) {
  return outboundEvent?.metadata?.taskId || outboundEvent?.metadata?.task?.task_id || '';
}

function buildTrackedOutboundEventKey(channelId, outboundEvent) {
  const taskId = resolveTrackedTaskId(outboundEvent);
  if (!channelId || !taskId) {
    return '';
  }

  let stream = '';
  switch (outboundEvent.type) {
    case 'parsed_task_preview':
    case 'task_context_update':
      stream = 'parsed';
      break;
    case 'approval_request':
      stream = 'approval';
      break;
    case 'task_queue_update':
      stream = 'queue';
      break;
    case 'task_execution_result':
      stream = 'result';
      break;
    default:
      return '';
  }

  return `${channelId}:${stream}:${taskId}`;
}

function buildTaskDispatchBlockedEvents(task) {
  const reason = 'No executor is mapped for this request yet.';

  return [
    {
      channelKey: 'taskQueue',
      type: 'task_queue_update',
      body: `${task.task_id} is blocked because no executor is mapped for this request yet.`,
      metadata: {
        taskId: task.task_id,
        status: 'blocked',
        summary: task.summary,
        priority: task.priority,
        targetAgent: task.target_agent,
        domain: task.domain,
        reason,
      },
    },
    {
      channelKey: 'alerts',
      type: 'task_dispatch_blocked',
      body: `Dispatch blocked for ${task.task_id}: no executor is mapped for this request yet.`,
      metadata: {
        taskId: task.task_id,
        targetAgent: task.target_agent,
        domain: task.domain,
        reason,
      },
    },
  ];
}

function isBlockedExecution(execution) {
  const report = execution?.executionResult?.report || {};
  const state = String(report.state || '').trim().toLowerCase();
  const severity = String(report.severity || '').trim().toLowerCase();
  if (report.paused === true || state === 'paused') {
    return false;
  }

  return report.blocked === true || severity === 'blocked' || state.startsWith('blocked');
}

function isPausedExecution(execution) {
  const report = execution?.executionResult?.report || {};
  const state = String(report.state || '').trim().toLowerCase();
  return report.paused === true || state === 'paused';
}

function isAwaitingApprovalExecution(execution) {
  const report = execution?.executionResult?.report || {};
  const state = String(report.state || '').trim().toLowerCase();
  return report.awaitingApproval === true || state === 'awaiting_approval';
}

function buildTranscribedTaskEvents(normalizedTask) {
  const task = normalizedTask.task;
  const outboundEvents = [
    {
      channelKey: 'systemLogs',
      type: 'accepted_transcribed_command',
      body: `Accepted transcribed ${task.task_id} from ${task.submitted_by}.`,
      metadata: { taskId: task.task_id },
    },
    {
      channelKey: 'parsedTasks',
      type: 'parsed_task_preview',
      body: `Parsed ${task.task_id} for ${task.target_agent}: ${task.summary}`,
      metadata: { task },
    },
    {
      channelKey: 'taskQueue',
      type: 'task_queue_update',
      body: `${task.task_id} is ${task.status} with priority ${task.priority}.`,
      metadata: {
        taskId: task.task_id,
        status: task.status,
        priority: task.priority,
        summary: task.summary,
        targetAgent: task.target_agent,
        domain: task.domain,
      },
    },
  ];

  const memoryWriteBackEvent = buildMemoryWriteBackCandidateEvent(task, normalizedTask.writeBackCandidates);
  if (memoryWriteBackEvent) {
    outboundEvents.push(memoryWriteBackEvent);
  }

  if (task.approval_required) {
    outboundEvents.push({
      channelKey: 'approvals',
      type: 'approval_request',
      body: `Approval needed for ${task.task_id}: ${task.summary}`,
      metadata: {
        taskId: task.task_id,
        approvalReason: task.approval_reason,
        responsePattern: ['approve TASK-123', 'reject TASK-123 because <reason>'],
      },
    });
  }

  return outboundEvents;
}

function channelMention(channelId, fallbackLabel) {
  return channelId ? `<#${channelId}>` : fallbackLabel;
}

function buildSourceAcknowledgement(result, config) {
  if (!result?.accepted) {
    return '';
  }

  if (result.route === 'command') {
    const tasks = Array.isArray(result.normalizedTasks) && result.normalizedTasks.length > 0
      ? result.normalizedTasks
      : result.normalizedTask?.task_id
        ? [result.normalizedTask]
        : [];
    const parsedTasksChannel = channelMention(config?.channelIds?.parsedTasks, '#parsed-tasks');
    const approvalsChannel = channelMention(config?.channelIds?.approvals, '#approvals');
    const runtimeSummary = result.commandRuntimeSummary || {};

    if (tasks.length > 1) {
      if (runtimeSummary.awaitingApprovalCount > 0) {
        return `Accepted ${tasks.length} tasks. Parsed tasks posted to ${parsedTasksChannel}. Approval requests posted to ${approvalsChannel}.`;
      }

      return `Accepted ${tasks.length} tasks. Parsed tasks posted to ${parsedTasksChannel}.`;
    }

    if (tasks[0]?.task_id) {
      if (tasks[0].approval_required) {
        return `Accepted ${tasks[0].task_id}. Parsed task posted to ${parsedTasksChannel}. Approval request posted to ${approvalsChannel}.`;
      }

      return `Accepted ${tasks[0].task_id}. Parsed task posted to ${parsedTasksChannel}.`;
    }
  }

  if (result.route === 'approval' && result.decision?.taskId) {
    return `Registered ${result.decision.decision} for ${result.decision.taskId}.`;
  }

  if (result.route === 'help' && result.helpTopic === 'commands') {
    return 'Showing the current operator command guide.';
  }

  if (result.route === 'voice') {
    return 'Voice note accepted. Transcription handoff prepared.';
  }

  return '';
}

function normalizeDiscordMessage(message) {
  return {
    guildId: message.guild_id || '',
    channelId: message.channel_id || '',
    messageId: message.id || '',
    content: message.content || '',
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => ({
          id: attachment.id || '',
          url: attachment.url || '',
          proxyUrl: attachment.proxy_url || '',
          filename: attachment.filename || '',
          contentType: attachment.content_type || '',
          size: attachment.size || 0,
        }))
      : [],
    author: {
      id: message.author?.id || '',
      username: message.author?.username || '',
      displayName: message.member?.nick || message.author?.global_name || message.author?.username || '',
      roleIds: Array.isArray(message.member?.roles) ? message.member.roles : [],
      isOperator: false,
    },
  };
}

async function postChannelMessage(token, channelId, payloadOrContent) {
  if (!channelId || !payloadOrContent) {
    return null;
  }

  const body = upgradeLegacyDiscordPayload(
    typeof payloadOrContent === 'string'
      ? { content: payloadOrContent }
      : payloadOrContent
  );

  return sendDiscordApiRequest(token, `/channels/${channelId}/messages`, body);
}

async function fanOutOutboundEvents(token, config, outboundEvents = [], trackedMessages = new Map()) {
  for (const outboundEvent of outboundEvents) {
    const targetChannelId = config.channelIds[outboundEvent.channelKey];
    if (!targetChannelId) {
      process.stderr.write(`No Discord channel mapped for outbound key '${outboundEvent.channelKey}'.\n`);
      continue;
    }

    if (outboundEvent.type === 'approval_request') {
      outboundEvent.metadata = {
        ...outboundEvent.metadata,
        approverMentions: buildApprovalMentions(config),
        approverUserIds: config.operatorUserIds || [],
        approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
      };
    }

    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(outboundEvent));

    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId, {
        approveDisabled: outboundEvent.metadata.approvalBlocked === true
          || outboundEvent.metadata.approvalResolved === true,
        rejectDisabled: outboundEvent.metadata.approvalResolved === true,
        isEmailAction: Boolean(outboundEvent.metadata?.emailTo),
      });
    }

    const trackedKey = buildTrackedOutboundEventKey(targetChannelId, outboundEvent);
    const existingMessage = trackedKey ? trackedMessages.get(trackedKey) : null;

    if (existingMessage?.messageId) {
      try {
        const updated = await sendDiscordApiRequest(
          token,
          `/channels/${targetChannelId}/messages/${existingMessage.messageId}`,
          body,
          'PATCH'
        );

        if (updated?.id) {
          trackedMessages.set(trackedKey, {
            channelId: targetChannelId,
            messageId: updated.id,
          });
        }
        continue;
      } catch (error) {
        process.stderr.write(
          `Could not update tracked Discord message ${existingMessage.messageId} for ${trackedKey}: ${error.message}\n`
        );
      }
    }

    const created = await sendDiscordApiRequest(token, `/channels/${targetChannelId}/messages`, body);
    if (trackedKey && created?.id) {
      trackedMessages.set(trackedKey, {
        channelId: targetChannelId,
        messageId: created.id,
      });
    }
  }
}

function buildApprovalMentions(config) {
  if (Array.isArray(config.operatorUserIds) && config.operatorUserIds.length > 0) {
    return config.operatorUserIds.map((userId) => `<@${userId}>`).join(' ');
  }

  if (config.operatorRoleId) {
    return `<@&${config.operatorRoleId}>`;
  }

  return '';
}

function createGatewayConnection() {
  return new WebSocket(DISCORD_GATEWAY_URL);
}

function computeElapsedMs(timestamp) {
  if (!timestamp) {
    return 0;
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Date.now() - parsed);
}

function estimateTextTokens(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

export async function runLiveDiscordBot(config) {
  assertLiveRuntimeConfig(config);

  const token = config.env.DISCORD_BOT_TOKEN;
  const resolvedApprovals = new Map();
  const pendingTasks = new Map(
    loadPersistedPendingTasks(config).map((task) => [task.task_id, task])
  );
  const executionQueue = [];
  const pendingImageContexts = new Map();
  const recentCommandTaskContexts = new Map();
  const trackedTaskMessages = new Map();
  let sessionState = createEmptySessionState();
  let sequence = null;
  let heartbeatTimer = null;
  let initialHeartbeatTimer = null;
  let activeSocket = null;
  let shuttingDown = false;
  let reconnectTimer = null;
  let lastHeartbeatAck = true;
  let resumeNextConnection = false;
  let activeExecutionTaskId = '';
  let executionDrainPromise = null;

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (initialHeartbeatTimer) {
      clearTimeout(initialHeartbeatTimer);
      initialHeartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (shuttingDown || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
  };

  const sendGatewayPayload = (payload) => {
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    activeSocket.send(JSON.stringify(payload));
  };

  const sendHeartbeat = () => {
    if (!lastHeartbeatAck) {
      process.stderr.write('Discord heartbeat ACK timeout. Terminating socket and attempting resume.\n');
      resumeNextConnection = hasResumableSession(sessionState, sequence);
      activeSocket?.terminate();
      return;
    }

    lastHeartbeatAck = false;
    sendGatewayPayload({ op: 1, d: sequence });
  };

  const identify = () => {
    process.stdout.write('Discord gateway identify requested.\n');
    sendGatewayPayload({
      op: 2,
      d: {
        token,
        intents: GATEWAY_INTENTS,
        properties: {
          os: process.platform,
          browser: 'ruflo',
          device: 'ruflo',
        },
      },
    });
  };

  const resume = () => {
    process.stdout.write('Discord gateway resume requested.\n');
    sendGatewayPayload({
      op: 6,
      d: {
        token,
        session_id: sessionState.sessionId,
        seq: sequence,
      },
    });
  };

  const connect = () => {
    const gatewayUrl = resumeNextConnection && sessionState.resumeGatewayUrl
      ? buildGatewayConnectionUrl(sessionState.resumeGatewayUrl)
      : buildGatewayConnectionUrl(DISCORD_GATEWAY_URL);

    activeSocket = new WebSocket(gatewayUrl);

    activeSocket.on('open', () => {
      process.stdout.write(`Discord gateway connected (${resumeNextConnection ? 'resume' : 'identify'} mode).\n`);
    });

    activeSocket.on('message', async (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());

        if (payload.s !== null && payload.s !== undefined) {
          sequence = payload.s;
        }

        if (payload.op === 10) {
          clearHeartbeat();
          lastHeartbeatAck = true;
          const heartbeatInterval = payload.d.heartbeat_interval;
          const initialDelay = Math.floor(heartbeatInterval * Math.random());
          heartbeatTimer = setInterval(sendHeartbeat, heartbeatInterval);
          initialHeartbeatTimer = setTimeout(sendHeartbeat, initialDelay);

          if (resumeNextConnection && hasResumableSession(sessionState, sequence)) {
            resume();
          } else {
            resumeNextConnection = false;
            identify();
          }
          return;
        }

        if (payload.op === 11) {
          lastHeartbeatAck = true;
          return;
        }

        if (payload.op === 1) {
          sendHeartbeat();
          return;
        }

        if (payload.op === 7) {
          process.stderr.write('Discord gateway requested reconnect.\n');
          resumeNextConnection = hasResumableSession(sessionState, sequence);
          activeSocket?.close();
          return;
        }

        if (payload.op === 9) {
          const resumable = payload.d === true;
          process.stderr.write(`Discord gateway invalid session (resumable=${resumable}).\n`);
          resumeNextConnection = resumable && hasResumableSession(sessionState, sequence);
          if (!resumable) {
            sessionState = createEmptySessionState();
            sequence = null;
          }
          activeSocket?.close();
          return;
        }

        if (payload.op !== 0) {
          return;
        }

        if (payload.t === 'READY') {
          sessionState = {
            sessionId: payload.d.session_id || '',
            resumeGatewayUrl: payload.d.resume_gateway_url || '',
          };
          resumeNextConnection = false;
          process.stdout.write(`Discord bot ready as ${payload.d.user?.username || 'bot'}.\n`);
          safeRecordMetric('discord_runtime_ready', {
            user: payload.d.user?.username || 'bot',
            sessionId: payload.d.session_id || '',
          });
          if (config.channelIds.systemLogs) {
            await postChannelMessage(token, config.channelIds.systemLogs, buildNoticeDiscordPayload({
              title: 'System Log',
              description: 'Discord bot up and running on Mac Mini.',
            }));
          }
          return;
        }

        if (payload.t === 'RESUMED') {
          resumeNextConnection = false;
          process.stdout.write('Discord gateway resumed previous session.\n');
          return;
        }

        if (payload.t === 'INTERACTION_CREATE') {
          const slashCommandMessage = normalizeSupportedSlashCommandInteraction(payload.d);
          if (slashCommandMessage) {
            const result = processDiscordEvent(slashCommandMessage, config);
            const acknowledgement = result.accepted
              ? buildSourceAcknowledgement(result, config)
              : result.reason || 'Slash command request was rejected.';

            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
              data: result.accepted
                ? {
                    ...buildAcknowledgementDiscordPayload(result, acknowledgement, config),
                    flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
                  }
                : {
                    content: truncateMessage(acknowledgement),
                    flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
                  },
            });

            if (result.outboundEvents?.length) {
              await fanOutOutboundEvents(token, config, result.outboundEvents, trackedTaskMessages);
            }
            return;
          }

          if (shouldOpenRejectApprovalModal(payload.d)) {
            const customId = String(payload.d?.data?.custom_id || '');
            const taskId = customId.split(':').slice(1).join(':').trim();
            const modal = buildApprovalRejectModal(taskId);
            if (!modal) {
              await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
                type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: 'Could not open the reject feedback form for this approval.',
                  flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
                },
              });
              return;
            }

            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_MODAL,
              data: modal,
            });
            return;
          }

          const approvalMessage = normalizeInteractionAsApprovalMessage(payload.d);
          if (!approvalMessage) {
            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: 'This button is not supported by the current bot runtime.',
                flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
              },
            });
            return;
          }

          const result = processDiscordEvent(approvalMessage, config);
          const actorName = approvalMessage.author.displayName || approvalMessage.author.username || approvalMessage.author.id || 'operator';
          let pendingApprovalTask = null;

          if (result.route === 'approval' && result.decision?.taskId) {
            const existingResolution = resolvedApprovals.get(result.decision.taskId);
            if (existingResolution) {
              await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
                type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: truncateMessage(
                    `${result.decision.taskId} was already resolved as ${existingResolution.decision.toUpperCase()} by ${existingResolution.actor}.`
                  ),
                  flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
                },
              });
              return;
            }
          }

          const acknowledgement = result.accepted
            ? buildSourceAcknowledgement(result)
            : result.reason || 'Approval action was rejected.';

          if (result.accepted && result.route === 'approval' && result.decision?.taskId) {
            resolvedApprovals.set(result.decision.taskId, {
              decision: result.decision.decision,
              actor: actorName,
            });
            pendingApprovalTask = pendingTasks.get(result.decision.taskId);
            const approvalWaitMs = computeElapsedMs(pendingApprovalTask?.submitted_at);
            safeRecordMetric('approval_button_resolution', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: approvalMessage.author?.id || '',
              approvalWaitMs,
              sourceType: pendingApprovalTask?.source_type || '',
              automationType: pendingApprovalTask?.automation_type || '',
            });
            safeRecordMetric('approval_decision_received', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: approvalMessage.author?.id || '',
              source: 'button',
              approvalWaitMs,
              sourceType: pendingApprovalTask?.source_type || '',
              automationType: pendingApprovalTask?.automation_type || '',
              countTowardHumanTaskLatency: !pendingApprovalTask?.automation_type,
            });

            // Ack immediately with a bare deferred update (valid for both
            // MESSAGE_COMPONENT and MODAL_SUBMIT), then do the actual edit as
            // a direct REST PATCH fetched fresh from Discord. payload.d.message
            // is reliably present for a direct button click but NOT for a
            // MODAL_SUBMIT interaction (the reject-with-feedback path) — that
            // gap is why content/buttons updated on reject but the embed color
            // stayed yellow: embeds silently evaluated to undefined and got
            // dropped from the interaction-callback body, which Discord then
            // treats as "leave embeds unchanged". Fetching the live message by
            // ID sidesteps payload.d.message entirely, so both paths behave
            // the same way.
            const interactionChannelId = payload.d.channel_id || '';
            const trackedApprovalKey = buildTrackedOutboundEventKey(interactionChannelId, {
              type: 'approval_request',
              metadata: { taskId: result.decision.taskId },
            });
            const trackedApprovalMessage = trackedApprovalKey ? trackedTaskMessages.get(trackedApprovalKey) : null;
            const approvalMessageId = trackedApprovalMessage?.messageId || payload.d.message?.id || '';

            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_DEFERRED_UPDATE_MESSAGE,
            });

            if (interactionChannelId && approvalMessageId) {
              try {
                const currentMessage = await sendDiscordApiRequest(
                  token,
                  `/channels/${interactionChannelId}/messages/${approvalMessageId}`,
                  undefined,
                  'GET'
                );

                await sendDiscordApiRequest(
                  token,
                  `/channels/${interactionChannelId}/messages/${approvalMessageId}`,
                  {
                    content: truncateMessage(
                      buildResolvedApprovalContent(currentMessage?.content, result.decision.decision, actorName)
                    ),
                    components: buildResolvedApprovalButtons(result.decision.taskId, result.decision.decision),
                    embeds: buildResolvedApprovalEmbeds(currentMessage?.embeds, result.decision.decision, result.decision.taskId),
                  },
                  'PATCH'
                );
              } catch (error) {
                process.stderr.write(
                  `Could not update approval message ${approvalMessageId} for ${result.decision.taskId}: ${error.message}\n`
                );
              }
            } else {
              process.stderr.write(
                `Could not resolve approval message reference for ${result.decision.taskId}; visual state not updated.\n`
              );
            }
          } else {
            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: truncateMessage(acknowledgement || 'Registered interaction.'),
                flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
              },
            });
          }

          const outboundEvents = result.route === 'approval'
            ? hydrateApprovalOutcomeEvents(result.outboundEvents, pendingApprovalTask)
            : result.outboundEvents;

          await fanOutOutboundEvents(token, config, outboundEvents, trackedTaskMessages);
          if (result.accepted && result.route === 'approval' && result.decision?.decision) {
            await resolvePendingTask(result.decision);
          }
          return;
        }

        if (payload.t === 'MESSAGE_CREATE' || payload.t === 'MESSAGE_UPDATE') {
          const githubCiObservation = parseGitHubCiObservation(payload.d, config);
          if (githubCiObservation) {
            safeRecordMetric('github_ci_result_observed', githubCiObservation);
            await handleGitHubCiObservation(githubCiObservation);
            return;
          }
        }

        if (payload.t !== 'MESSAGE_CREATE') {
          return;
        }

        if (payload.d.author?.bot) {
          return;
        }

        const message = normalizeDiscordMessage(payload.d);
        const receivedAtMs = Date.now();
        const commandChannelMessage = isCommandChannelMessage(message, config);
        const imageContextKey = buildImageContextKey(message);
        const messageImageAttachments = extractImageAttachments(message);
        const hasOnlyImages = commandChannelMessage && messageImageAttachments.length > 0 && !hasMessageTextContent(message);
        pruneImageContextCaches(receivedAtMs);

        if (hasOnlyImages) {
          const recentTaskContext = recentCommandTaskContexts.get(imageContextKey);

          if (recentTaskContext?.tasks?.length) {
            attachImageContextToTasks(recentTaskContext.tasks, messageImageAttachments);
            safeRecordMetric('image_context_linked', {
              authorId: message.author?.id || '',
              channelId: message.channelId || '',
              imageAttachmentCount: messageImageAttachments.length,
              taskIds: recentTaskContext.tasks.map((task) => task.task_id),
              source: 'follow_up_message',
            });
            await postChannelMessage(token, message.channelId, buildNoticeDiscordPayload({
              title: 'Image Context Linked',
              description: `Linked ${messageImageAttachments.length} image attachment(s) to the latest task context from this channel.`,
              fields: [
                {
                  name: 'Tasks',
                  value: recentTaskContext.tasks.map((task) => `\`${task.task_id}\``).join('\n'),
                  inline: false,
                },
              ],
              footerText: 'Ruflo intake',
            }));
            await fanOutOutboundEvents(
              token,
              config,
              buildImageContextUpdateEvents(recentTaskContext.tasks, messageImageAttachments),
              trackedTaskMessages
            );
          } else {
            const existingPendingContext = pendingImageContexts.get(imageContextKey);
            pendingImageContexts.set(imageContextKey, {
              createdAt: receivedAtMs,
              attachments: mergeImageAttachments(existingPendingContext?.attachments || [], messageImageAttachments),
              sourceMessageId: message.messageId || '',
            });
            safeRecordMetric('image_context_stored', {
              authorId: message.author?.id || '',
              channelId: message.channelId || '',
              imageAttachmentCount: messageImageAttachments.length,
              source: 'pre_command_message',
            });
            await postChannelMessage(token, message.channelId, buildNoticeDiscordPayload({
              title: 'Image Context Stored',
              description: `Stored ${messageImageAttachments.length} image attachment(s) for your next command in this channel for 10 minutes.`,
              footerText: 'Ruflo intake',
            }));
          }

          return;
        }

        const pendingImageContext = commandChannelMessage ? pendingImageContexts.get(imageContextKey) : null;
        if (commandChannelMessage && pendingImageContext?.attachments?.length && hasMessageTextContent(message)) {
          message.attachments = mergeImageAttachments(message.attachments, pendingImageContext.attachments);
          pendingImageContexts.delete(imageContextKey);
        }

        const result = processDiscordEvent(message, config);
        const runtimeOutboundEvents = [];

        if (!result.accepted) {
          safeRecordMetric('discord_event_rejected', {
            route: result.route,
            reason: result.reason || '',
            channelId: message.channelId || '',
            authorId: message.author?.id || '',
            username: message.author?.username || '',
            displayName: message.author?.displayName || '',
            mention: message.author?.id ? `<@${message.author.id}>` : '',
          });
        }

        let pendingApprovalTask = null;
        if (result.route === 'approval' && result.decision?.taskId) {
          const existingResolution = resolvedApprovals.get(result.decision.taskId);
          if (existingResolution) {
            await postChannelMessage(
              token,
              message.channelId,
              truncateMessage(`${result.decision.taskId} was already resolved as ${existingResolution.decision.toUpperCase()} by ${existingResolution.actor}.`)
            );
            return;
          }

          if (result.accepted) {
            const actorName = message.author.displayName || message.author.username || message.author.id || 'operator';
            result.decision.actor = actorName;
            result.decision.actorId = message.author?.id || '';
            resolvedApprovals.set(result.decision.taskId, {
              decision: result.decision.decision,
              actor: actorName,
            });
            pendingApprovalTask = pendingTasks.get(result.decision.taskId);
            const approvalWaitMs = computeElapsedMs(pendingApprovalTask?.submitted_at);
            safeRecordMetric('approval_text_resolution', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: message.author?.id || '',
              approvalWaitMs,
              sourceType: pendingApprovalTask?.source_type || '',
              automationType: pendingApprovalTask?.automation_type || '',
            });
            safeRecordMetric('approval_decision_received', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: message.author?.id || '',
              source: 'text',
              approvalWaitMs,
              sourceType: pendingApprovalTask?.source_type || '',
              automationType: pendingApprovalTask?.automation_type || '',
              countTowardHumanTaskLatency: !pendingApprovalTask?.automation_type,
            });
          }
        }

        if (result.route === 'command') {
          const tasks = Array.isArray(result.normalizedTasks) && result.normalizedTasks.length > 0
            ? result.normalizedTasks
            : result.normalizedTask?.task_id
              ? [result.normalizedTask]
              : [];
          const queueBacklogBefore = (activeExecutionTaskId ? 1 : 0) + executionQueue.length;
          const executionStates = [];

          for (const task of tasks) {
            safeRecordMetric('command_accepted', {
              taskId: task.task_id,
              domain: task.domain,
              priority: task.priority,
              approvalRequired: task.approval_required,
              targetAgent: task.target_agent,
              authorId: message.author?.id || '',
              submittedBy: task.submitted_by,
              sourceType: task.source_type,
              estimatedInputTokens: estimateTextTokens(task.full_text),
              estimatedCostUsd: 0,
            });
            recordTaskStateChange(task, task.status);
            rememberPendingTaskIfNeeded(task);

            if (task.approval_required) {
              executionStates.push({
                taskId: task.task_id,
                state: 'awaiting_approval',
                action: '',
                queuePosition: 0,
                blockedByTaskId: '',
              });
              continue;
            }

            const executionState = queueExecutableTask(task);
            executionStates.push(executionState);
            if (executionState.state === 'no_executor') {
              runtimeOutboundEvents.push(...buildTaskDispatchBlockedEvents(task));
              safeRecordMetric('task_dispatch_blocked', {
                taskId: task.task_id,
                domain: task.domain || '',
                targetAgent: task.target_agent || '',
                reason: 'no_executor',
              });
              recordTaskStateChange(task, 'blocked', {
                reason: 'No executor is mapped for this request yet.',
              });
            }
          }

          result.commandRuntimeSummary = {
            taskCount: tasks.length,
            queueBacklogBefore,
            activeExecutionTaskId,
            executionStates,
            awaitingApprovalCount: executionStates.filter((item) => item.state === 'awaiting_approval').length,
            queuedCount: executionStates.filter((item) => item.state === 'queued').length,
            startingCount: executionStates.filter((item) => item.state === 'starting').length,
            noExecutorCount: executionStates.filter((item) => item.state === 'no_executor').length,
          };
          rememberRecentCommandTasks(message, tasks);
        }

        const acknowledgement = buildSourceAcknowledgement(result, config);

        if (acknowledgement) {
          await postChannelMessage(token, message.channelId, buildAcknowledgementDiscordPayload(result, acknowledgement, config));
          safeRecordMetric('source_acknowledged', {
            route: result.route,
            channelId: message.channelId || '',
            taskId: result.normalizedTask?.task_id || result.decision?.taskId || '',
            latencyMs: Math.max(0, Date.now() - receivedAtMs),
            sourceType: result.normalizedTask?.source_type || '',
          });
        }

        const outboundEvents = result.route === 'approval'
          ? hydrateApprovalOutcomeEvents(result.outboundEvents, pendingApprovalTask)
          : [...result.outboundEvents, ...runtimeOutboundEvents];

        await fanOutOutboundEvents(token, config, outboundEvents, trackedTaskMessages);

        if (result.route === 'command') {
          ensureExecutionDrain();
        }

        if (result.route === 'approval' && result.accepted && result.decision?.decision) {
          await resolvePendingTask(result.decision);
        }

        if (result.route === 'voice' && result.transcriptionRequest) {
          safeRecordMetric('voice_note_received', {
            sourceMessageId: result.transcriptionRequest.sourceMessageId || '',
            submittedBy: result.transcriptionRequest.submittedBy || '',
            attachmentCount: Array.isArray(result.transcriptionRequest.attachments)
              ? result.transcriptionRequest.attachments.length
              : 0,
          });

          const transcriptionStartedAt = Date.now();
          const transcriptionResult = await processTranscriptionRequest(result.transcriptionRequest, config);

          if (transcriptionResult.status !== 'completed') {
            safeRecordMetric('voice_transcription_failed', {
              status: transcriptionResult.status,
              sourceMessageId: message.messageId || '',
              warnings: transcriptionResult.warnings || [],
              latencyMs: Date.now() - transcriptionStartedAt,
            });
            await fanOutOutboundEvents(token, config, [
              {
                channelKey: 'alerts',
                type: 'voice_transcription_failed',
                body: `Voice transcription ${transcriptionResult.status} for ${message.author.displayName || message.author.username || message.author.id}.`,
                metadata: {
                  sourceMessageId: message.messageId || '',
                  warnings: transcriptionResult.warnings || [],
                },
              },
            ], trackedTaskMessages);
            return;
          }

          safeRecordMetric('voice_transcription_completed', {
            sourceMessageId: message.messageId || '',
            confidence: transcriptionResult.confidence,
            language: transcriptionResult.language || '',
            segmentCount: transcriptionResult.segmentCount || 0,
            latencyMs: Date.now() - transcriptionStartedAt,
          });

          await fanOutOutboundEvents(token, config, [
            buildVoiceTranscriptEvent(message, transcriptionResult),
          ], trackedTaskMessages);

          const transcribedCommand = normalizeTaskMessage({
            guildId: message.guildId,
            channelKey: 'commands',
            channelId: config.channelIds.commands,
            content: transcriptionResult.transcript,
            author: message.author,
          }, config);

          await fanOutOutboundEvents(token, config, buildTranscribedTaskEvents(transcribedCommand), trackedTaskMessages);
          safeRecordMetric('transcribed_command_accepted', {
            taskId: transcribedCommand.task.task_id,
            domain: transcribedCommand.task.domain,
            priority: transcribedCommand.task.priority,
            approvalRequired: transcribedCommand.task.approval_required,
            targetAgent: transcribedCommand.task.target_agent,
            authorId: message.author?.id || '',
            submittedBy: transcribedCommand.task.submitted_by,
            sourceType: transcribedCommand.task.source_type,
            estimatedInputTokens: estimateTextTokens(transcribedCommand.task.full_text),
            estimatedCostUsd: 0,
          });
          recordTaskStateChange(transcribedCommand.task, transcribedCommand.task.status);
          rememberPendingTaskIfNeeded(transcribedCommand.task);
          if (!transcribedCommand.task.approval_required) {
            const executionState = queueExecutableTask(transcribedCommand.task);
            if (executionState.state === 'no_executor') {
              safeRecordMetric('task_dispatch_blocked', {
                taskId: transcribedCommand.task.task_id,
                domain: transcribedCommand.task.domain || '',
                targetAgent: transcribedCommand.task.target_agent || '',
                reason: 'no_executor',
                sourceType: transcribedCommand.task.source_type || '',
              });
              recordTaskStateChange(transcribedCommand.task, 'blocked', {
                reason: 'No executor is mapped for this request yet.',
              });
              await fanOutOutboundEvents(
                token,
                config,
                buildTaskDispatchBlockedEvents(transcribedCommand.task),
                trackedTaskMessages
              );
            } else {
              ensureExecutionDrain();
            }
          }
        }
      } catch (error) {
        process.stderr.write(`Discord bot runtime error: ${error.message}\n`);
        try {
          await postChannelMessage(
            token,
            config.channelIds.alerts,
            buildNoticeDiscordPayload({
              title: '⚠️ Runtime Error',
              description: `Discord bot runtime error: ${error.message}`,
              color: 0xED4245,
              footerText: 'Ruflo runtime',
            })
          );
        } catch (postError) {
          process.stderr.write(`Could not post alert: ${postError.message}\n`);
        }
      }
    });

    activeSocket.on('close', (code, reasonBuffer) => {
      clearHeartbeat();
      const reason = reasonBuffer?.toString() || 'no reason';
      process.stderr.write(`Discord gateway closed (${code}): ${reason}\n`);
      const reconnectPlan = getReconnectPlan({
        closeCode: code,
        shuttingDown,
        sessionState,
        sequence,
      });
      resumeNextConnection = reconnectPlan.shouldResume;
      if (reconnectPlan.shouldReconnect) {
        scheduleReconnect();
      } else {
        process.stderr.write('Discord gateway close code is not reconnectable; leaving socket closed.\n');
        if (!shuttingDown) {
          process.stderr.write('Discord runtime exiting so the LaunchAgent KeepAlive policy can relaunch it.\n');
          setTimeout(() => {
            process.exit(1);
          }, 50).unref();
        }
      }
    });

    activeSocket.on('error', (error) => {
      process.stderr.write(`Discord gateway error: ${error.message}\n`);
    });
  };

  const shutdown = () => {
    shuttingDown = true;
    clearHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    activeSocket?.close(1000, 'shutdown');
  };

  const safeRecordMetric = (eventType, payload = {}) => {
    try {
      recordOpsMetric(config, eventType, payload);
    } catch (error) {
      process.stderr.write(`Could not record metrics event '${eventType}': ${error.message}\n`);
    }
  };

  const pruneImageContextCaches = (nowMs = Date.now()) => {
    for (const [key, context] of pendingImageContexts.entries()) {
      if (!context?.createdAt || nowMs - context.createdAt > IMAGE_CONTEXT_WINDOW_MS) {
        pendingImageContexts.delete(key);
      }
    }

    for (const [key, context] of recentCommandTaskContexts.entries()) {
      if (!context?.createdAt || nowMs - context.createdAt > IMAGE_CONTEXT_WINDOW_MS) {
        recentCommandTaskContexts.delete(key);
      }
    }
  };

  const rememberRecentCommandTasks = (message, tasks = []) => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return;
    }

    recentCommandTaskContexts.set(buildImageContextKey(message), {
      createdAt: Date.now(),
      tasks,
    });
  };

  const recordTaskStateChange = (task, status, extra = {}) => {
    if (!task?.task_id) {
      return;
    }

    safeRecordMetric('task_state_changed', {
      taskId: task.task_id,
      status,
      domain: task.domain || '',
      priority: task.priority || '',
      approvalRequired: Boolean(task.approval_required),
      targetAgent: task.target_agent || '',
      sourceType: task.source_type || '',
      submittedBy: task.submitted_by || '',
      ...extra,
    });
  };

  const queueExecutableTask = (task) => {
    const executionPlan = buildExecutionPlan(task);
    if (!executionPlan) {
      return {
        taskId: task.task_id,
        state: 'no_executor',
        action: '',
        queuePosition: 0,
        blockedByTaskId: '',
      };
    }

    // A task already active or already sitting in the queue must not be
    // enqueued a second time — e.g. a gmail_send_draft re-queued this way
    // sends the email twice. resolvedApprovals is supposed to make this
    // unreachable for approval-triggered runs, but this is a second,
    // independent backstop at the point where a duplicate would actually
    // cause a duplicate side effect, regardless of how it got triggered
    // (observed once in production: two near-simultaneous Discord
    // interaction deliveries for one click both reached here).
    if (
      activeExecutionTaskId === task.task_id
      || executionQueue.some((queued) => queued.task.task_id === task.task_id)
    ) {
      return {
        taskId: task.task_id,
        state: 'duplicate_ignored',
        action: executionPlan.action,
        queuePosition: 0,
        blockedByTaskId: activeExecutionTaskId || executionQueue[0]?.task.task_id || '',
      };
    }

    const blockedByTaskId = activeExecutionTaskId || executionQueue[0]?.task.task_id || '';
    const queuePosition = (activeExecutionTaskId ? 1 : 0) + executionQueue.length;
    const state = queuePosition === 0 ? 'starting' : 'queued';

    executionQueue.push({ task, executionPlan });

    return {
      taskId: task.task_id,
      state,
      action: executionPlan.action,
      queuePosition,
      blockedByTaskId,
    };
  };

  const ensureExecutionDrain = () => {
    if (!executionDrainPromise && executionQueue.length > 0) {
      executionDrainPromise = drainExecutionQueue();
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const runExecutableTask = async (task, executionPlan) => {
    activeExecutionTaskId = task.task_id;
    await fanOutOutboundEvents(token, config, buildExecutionStartedEvents(task, executionPlan), trackedTaskMessages);
    recordTaskStateChange(task, 'running', {
      action: executionPlan.action,
      queueDwellMs: computeElapsedMs(task.submitted_at),
    });
    safeRecordMetric('task_execution_started', {
      taskId: task.task_id,
      action: executionPlan.action,
      domain: task.domain || '',
      targetAgent: task.target_agent || '',
      queueDwellMs: computeElapsedMs(task.submitted_at),
    });
    const executionStartedAt = Date.now();
    const execution = await executeTask(task, config);
    const executionDurationMs = Date.now() - executionStartedAt;
    const pendingApprovalTaskFromExecution = execution?.executionResult?.report?.pendingApprovalTask || null;
    if (pendingApprovalTaskFromExecution?.task_id) {
      pendingTasks.set(pendingApprovalTaskFromExecution.task_id, pendingApprovalTaskFromExecution);
      upsertPersistedPendingTask(config, pendingApprovalTaskFromExecution);
    }
    safeRecordMetric('task_execution_finished', {
      taskId: task.task_id,
      action: execution.executionPlan?.action || executionPlan.action,
      outcome: execution.outcome || '',
      state: execution.executionResult?.report?.state || '',
      error: execution.error?.message || '',
      durationMs: executionDurationMs,
      lifecycleMs: computeElapsedMs(task.submitted_at),
    });
    const finalTaskState = isPausedExecution(execution)
      ? 'paused'
      : isAwaitingApprovalExecution(execution)
        ? 'awaiting_approval'
      : isBlockedExecution(execution)
        ? 'blocked'
        : execution.outcome === 'completed'
        ? 'completed'
        : 'failed';
    recordTaskStateChange(pendingApprovalTaskFromExecution || task, finalTaskState, {
      action: execution.executionPlan?.action || executionPlan.action,
      state: execution.executionResult?.report?.state || '',
      durationMs: executionDurationMs,
    });
    await fanOutOutboundEvents(token, config, execution.outboundEvents, trackedTaskMessages);

    if (execution.outcome === 'completed') {
      const writeBackCandidates = buildExecutionWriteBackCandidates(task, execution, config.memoryPromotionRules);
      const writeBackEvent = buildMemoryWriteBackCandidateEvent(task, writeBackCandidates);
      if (writeBackEvent) {
        await fanOutOutboundEvents(token, config, [writeBackEvent], trackedTaskMessages);
      }
    }

    if (shouldScheduleDeferredDiscordBotRestart(execution)) {
      const scheduled = scheduleDiscordBotSelfRestart();
      if (scheduled) {
        safeRecordMetric('discord_bot_restart_scheduled', {
          taskId: task.task_id,
          reason: 'mac_runtime_safe_sync_deferred',
        });
      }
    }
  };

  const drainExecutionQueue = async () => {
    try {
      while (executionQueue.length > 0) {
        const next = executionQueue.shift();
        if (!next) {
          continue;
        }

        await runExecutableTask(next.task, next.executionPlan);
        activeExecutionTaskId = '';
      }
    } finally {
      activeExecutionTaskId = '';
      executionDrainPromise = null;
    }
  };

  const rememberPendingTaskIfNeeded = (task) => {
    if (task?.approval_required && task?.task_id) {
      pendingTasks.set(task.task_id, task);
      upsertPersistedPendingTask(config, task);
    }
  };

  const handleGitHubCiObservation = async (observation) => {
    const task = buildDeveloperMergeApprovalTask(observation, config);
    if (!task) {
      return;
    }

    const isAlreadyTracked = pendingTasks.has(task.task_id)
      || Boolean(findPersistedPendingTask(config, task.task_id))
      || resolvedApprovals.has(task.task_id);
    if (isAlreadyTracked) {
      safeRecordMetric('developer_agent_merge_approval_deduplicated', {
        taskId: task.task_id,
        pullRequestNumber: task.github_merge_request.pullRequestNumber,
        expectedHeadSha: task.github_merge_request.expectedHeadSha,
      });
      return;
    }

    rememberPendingTaskIfNeeded(task);
    recordTaskStateChange(task, 'awaiting_approval', {
      action: task.runtime_action,
    });
    safeRecordMetric('developer_agent_merge_approval_requested', {
      taskId: task.task_id,
      repository: task.github_merge_request.repository,
      pullRequestNumber: task.github_merge_request.pullRequestNumber,
      sourceBranch: task.github_merge_request.sourceBranch,
      targetBranch: task.github_merge_request.targetBranch,
      expectedHeadSha: task.github_merge_request.expectedHeadSha,
      ciRunUrl: task.github_merge_request.ciRunUrl,
    });
    await fanOutOutboundEvents(
      token,
      config,
      buildDeveloperMergeApprovalEvents(task),
      trackedTaskMessages
    );
  };

  const resolvePendingTask = async (decision) => {
    if (!decision?.taskId) {
      return;
    }

    const pendingTask = pendingTasks.get(decision.taskId) || findPersistedPendingTask(config, decision.taskId);
    if (!pendingTask) {
      return;
    }

    pendingTasks.delete(decision.taskId);
    removePersistedPendingTask(config, decision.taskId);
    const approvalWaitMs = computeElapsedMs(pendingTask?.submitted_at);

    if (decision.decision === 'reject') {
      recordTaskStateChange(pendingTask, 'rejected', {
        approvalWaitMs,
      });

      // Persist the operator's rejection feedback onto the lead row so it's
      // durable (not only in the Discord task-queue message) and can auto-feed
      // a future redraft — this is the seed of the outcome/feedback loop.
      // Best-effort: a Supabase blip must never break the reject flow. Merges
      // into the existing qualification jsonb rather than clobbering it.
      if (pendingTask.lead_id && decision.reason) {
        try {
          const { fetchLeadById, updateLead } = await import('../../../scripts/lib/leadgen-supabase.mjs');
          const lead = await fetchLeadById(pendingTask.lead_id);
          const existingQualification = lead?.qualification && typeof lead.qualification === 'object' ? lead.qualification : {};
          await updateLead(pendingTask.lead_id, {
            status: 'draft_rejected',
            qualification: {
              ...existingQualification,
              rejection_feedback: decision.reason,
              rejected_by: decision.actor || '',
              rejected_at: new Date().toISOString(),
            },
          });
        } catch (error) {
          process.stderr.write(`Could not persist rejection feedback for lead ${pendingTask.lead_id}: ${error.message}\n`);
        }
      }

      const approvalCandidates = buildApprovalOutcomeWriteBackCandidates(pendingTask, decision, config.memoryPromotionRules);
      const approvalWriteBackEvent = buildMemoryWriteBackCandidateEvent(pendingTask, approvalCandidates);
      const outboundEvents = [
        {
          channelKey: 'taskQueue',
          type: 'task_queue_update',
          body: `${decision.taskId} was rejected and will not execute.`,
          metadata: {
            taskId: decision.taskId,
            status: 'rejected',
            summary: pendingTask.summary,
            targetAgent: pendingTask.target_agent,
            domain: pendingTask.domain,
            reason: decision.reason || '',
            decision: decision.decision,
          },
        },
      ];
      if (approvalWriteBackEvent) {
        outboundEvents.push(approvalWriteBackEvent);
      }
      await fanOutOutboundEvents(token, config, outboundEvents, trackedTaskMessages);
      return;
    }

    recordTaskStateChange(pendingTask, 'approved', {
      approvalWaitMs,
    });
    pendingTask.approval_state = 'approved';
    pendingTask.approved_by = decision.actor || '';
    pendingTask.approved_by_id = decision.actorId || '';
    const approvalCandidates = buildApprovalOutcomeWriteBackCandidates(pendingTask, decision, config.memoryPromotionRules);
    const approvalWriteBackEvent = buildMemoryWriteBackCandidateEvent(pendingTask, approvalCandidates);
    if (approvalWriteBackEvent) {
      await fanOutOutboundEvents(token, config, [approvalWriteBackEvent], trackedTaskMessages);
    }
    const executionState = queueExecutableTask(pendingTask);
    if (executionState.state === 'duplicate_ignored') {
      // Should be unreachable — resolvedApprovals already blocks a second
      // resolution of the same taskId — but this is the point where a
      // duplicate would actually cause a duplicate send/action, so it's
      // worth a metric if the earlier guard is ever bypassed some other way.
      safeRecordMetric('task_dispatch_duplicate_ignored', {
        taskId: pendingTask.task_id,
        domain: pendingTask.domain || '',
        targetAgent: pendingTask.target_agent || '',
        source: 'approval_resolution',
      });
      return;
    }
    if (executionState.state === 'no_executor') {
      safeRecordMetric('task_dispatch_blocked', {
        taskId: pendingTask.task_id,
        domain: pendingTask.domain || '',
        targetAgent: pendingTask.target_agent || '',
        reason: 'no_executor',
        source: 'approval_resolution',
      });
      recordTaskStateChange(pendingTask, 'blocked', {
        approvalWaitMs,
        reason: 'No executor is mapped for this request yet.',
      });
      await fanOutOutboundEvents(token, config, buildTaskDispatchBlockedEvents(pendingTask), trackedTaskMessages);
      return;
    }

    ensureExecutionDrain();
  };

  connect();

  await new Promise(() => {});
}
