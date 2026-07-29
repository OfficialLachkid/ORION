import { existsSync, readFileSync } from 'node:fs';
import { resolveMetricsEventsPath } from '../../lib/metrics-store.mjs';
import { recordOpsMetric } from '../../lib/metrics-store.mjs';
import { buildNoticeDiscordPayload } from './message-formatting.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sendDiscordApiRequest(token, path, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function parseJsonLines(content) {
  return String(content || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function loadOpsEvents(config) {
  const filePath = resolveMetricsEventsPath(config);
  if (!existsSync(filePath)) {
    return [];
  }

  return parseJsonLines(readFileSync(filePath, 'utf8'));
}

function selectWindow(events, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const windowHours = Number(options.windowHours || 24);
  const windowStart = new Date(now.getTime() - (windowHours * 60 * 60 * 1000));

  return {
    now,
    windowStart,
    events: events.filter((event) => {
      const timestamp = new Date(event.timestamp);
      return Number.isFinite(timestamp.getTime()) && timestamp >= windowStart && timestamp <= now;
    }),
  };
}

function average(numbers) {
  if (!numbers.length) {
    return 0;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function p95(numbers) {
  if (!numbers.length) {
    return 0;
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function countByType(events) {
  const counts = new Map();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) || 0) + 1);
  }
  return counts;
}

function countByValue(events, selector) {
  const counts = new Map();
  for (const event of events) {
    const value = selector(event);
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function averageByValue(events, selector, valueSelector) {
  const aggregates = new Map();

  for (const event of events) {
    const key = selector(event);
    const value = Number(valueSelector(event));
    if (!key || !Number.isFinite(value) || value <= 0) {
      continue;
    }

    const current = aggregates.get(key) || { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    aggregates.set(key, current);
  }

  return new Map(
    [...aggregates.entries()].map(([key, value]) => [key, value.sum / value.count])
  );
}

function isAutomationApprovalEvent(event) {
  return Boolean(event?.payload?.automationType);
}

function topEntries(map, limit = 3) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function sumByPayloadField(events, fieldName) {
  return events.reduce((sum, event) => {
    const value = Number(event.payload?.[fieldName] || 0);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function latestTaskStates(events) {
  const latestByTaskId = new Map();

  for (const event of events) {
    if (event.type !== 'task_state_changed' || !event.payload?.taskId) {
      continue;
    }

    const timestamp = new Date(event.timestamp).getTime();
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const existing = latestByTaskId.get(event.payload.taskId);
    if (!existing || timestamp >= existing.timestampMs) {
      latestByTaskId.set(event.payload.taskId, {
        timestampMs: timestamp,
        event,
      });
    }
  }

  return [...latestByTaskId.values()].map((entry) => entry.event);
}

function formatDurationMs(value) {
  if (!value) {
    return 'n/a';
  }

  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function countValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getEventTimestampMs(event) {
  const timestamp = new Date(event?.timestamp).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function summarizeOpsEvents(events, options = {}) {
  const { now, windowStart, events: windowEvents } = selectWindow(events, options);
  const counts = countByType(windowEvents);

  const transcriptionCompletions = windowEvents.filter((event) => event.type === 'voice_transcription_completed');
  const transcriptionFailures = windowEvents.filter((event) => event.type === 'voice_transcription_failed');
  const transcriptionLatencies = transcriptionCompletions.map((event) => Number(event.payload?.latencyMs || 0)).filter((value) => value > 0);
  const transcriptionConfidences = transcriptionCompletions.map((event) => Number(event.payload?.confidence || 0)).filter((value) => value >= 0);

  const executionFinishes = windowEvents.filter((event) => event.type === 'task_execution_finished');
  const approvalResolutions = windowEvents.filter((event) => event.type === 'approval_button_resolution' || event.type === 'approval_text_resolution');
  const approvalDecisionEvents = windowEvents.filter((event) => event.type === 'approval_decision_received');
  const humanTaskApprovalDecisions = approvalDecisionEvents.filter((event) => event.payload?.countTowardHumanTaskLatency !== false);
  const automationApprovalDecisions = approvalDecisionEvents.filter((event) => isAutomationApprovalEvent(event));
  const rejectedEvents = windowEvents.filter((event) => event.type === 'discord_event_rejected');
  const acceptedCommandEvents = windowEvents.filter((event) => event.type === 'command_accepted' || event.type === 'transcribed_command_accepted');
  const acknowledgementEvents = windowEvents.filter((event) => event.type === 'source_acknowledged');
  const taskStateLatest = latestTaskStates(windowEvents);
  const taskStateChanges = windowEvents.filter((event) => event.type === 'task_state_changed');
  const runtimeReadyEvents = windowEvents.filter((event) => event.type === 'discord_runtime_ready');
  const healthAlertEvents = windowEvents.filter((event) => event.type === 'health_monitor_alert_emitted');
  const healthRecoveryEvents = windowEvents.filter((event) => event.type === 'health_monitor_recovered');
  const githubCiObserved = windowEvents.filter((event) => event.type === 'github_ci_result_observed');
  const runtimeValidationCiObserved = githubCiObserved.filter((event) => event.payload?.isRuntimeValidation === true);
  const macSyncWatchRequestsCreated = windowEvents.filter((event) => event.type === 'mac_sync_watch_request_created');
  const macSyncWatchRequestsRefreshed = windowEvents.filter((event) => event.type === 'mac_sync_watch_request_refreshed');
  const macSyncWorkerCompleted = windowEvents.filter((event) => event.type === 'mac_sync_worker_completed');

  const healthMonitorCheckEvents = windowEvents.filter((event) => event.type === 'health_monitor_check');
  const healthMonitorRunEvents = windowEvents.filter((event) => event.type === 'health_monitor_run_completed');
  const opsToolEvents = windowEvents.filter((event) => [
    'claude_runner_canary_run',
    'claude_runner_resumed',
    'claude_runner_resume_failed',
    'claude_runner_stalled_marked_blocked',
    'session_pre_limit_checkpoint_written',
    'mac_reboot_recovery_check',
  ].includes(event.type));
  const opsToolCounts = countByType(opsToolEvents);

  const executionByOutcome = countByValue(executionFinishes, (event) => event.payload?.outcome || '');
  const commandByDomain = countByValue(acceptedCommandEvents, (event) => event.payload?.domain || '');
  const githubCiByStatus = countByValue(githubCiObserved, (event) => event.payload?.status || '');
  const runtimeValidationCiByStatus = countByValue(runtimeValidationCiObserved, (event) => event.payload?.status || '');

  const approvalByDecision = countByValue(approvalResolutions, (event) => event.payload?.decision || '');
  const rejectionReasons = countByValue(rejectedEvents, (event) => event.payload?.reason || '');
  const approvalByOperator = countByValue(approvalDecisionEvents, (event) => event.payload?.actor || event.payload?.actorId || '');
  const commandAckLatencies = acknowledgementEvents
    .filter((event) => event.payload?.route === 'command')
    .map((event) => Number(event.payload?.latencyMs || 0))
    .filter((value) => value > 0);
  const approvalWaits = humanTaskApprovalDecisions
    .map((event) => Number(event.payload?.approvalWaitMs || 0))
    .filter((value) => value > 0);
  const queueDwellEvents = taskStateChanges
    .filter((event) => event.payload?.status === 'running')
    .filter((event) => Number(event.payload?.queueDwellMs || 0) > 0);
  const latestRuntimeReadyMs = runtimeReadyEvents.reduce((latest, event) => Math.max(latest, getEventTimestampMs(event)), 0);
  const queuedStates = taskStateLatest.filter((event) => event.payload?.status === 'queued');
  const awaitingApprovalStates = taskStateLatest.filter((event) => event.payload?.status === 'awaiting_approval');
  const runningStates = taskStateLatest.filter((event) => event.payload?.status === 'running');
  const currentExecutableStates = taskStateLatest.filter((event) => {
    const status = event.payload?.status;
    if (status !== 'queued' && status !== 'running') {
      return false;
    }

    if (!latestRuntimeReadyMs) {
      return true;
    }

    return getEventTimestampMs(event) >= latestRuntimeReadyMs;
  });
  const currentQueuedStates = currentExecutableStates.filter((event) => event.payload?.status === 'queued');
  const currentRunningStates = currentExecutableStates.filter((event) => event.payload?.status === 'running');
  const staleInterruptedTaskStates = taskStateLatest.filter((event) => {
    const status = event.payload?.status;
    if (!latestRuntimeReadyMs || (status !== 'queued' && status !== 'running')) {
      return false;
    }

    return getEventTimestampMs(event) < latestRuntimeReadyMs;
  });
  const estimatedInputTokens = sumByPayloadField(acceptedCommandEvents, 'estimatedInputTokens');
  const estimatedCostUsd = sumByPayloadField(acceptedCommandEvents, 'estimatedCostUsd');
  const avgExecutionDurationByAction = averageByValue(executionFinishes, (event) => event.payload?.action || '', (event) => event.payload?.durationMs);
  const avgLifecycleByAction = averageByValue(executionFinishes, (event) => event.payload?.action || '', (event) => event.payload?.lifecycleMs);
  const avgQueueDwellByDomain = averageByValue(queueDwellEvents, (event) => event.payload?.domain || '', (event) => event.payload?.queueDwellMs);
  const avgQueueDwellByAction = averageByValue(queueDwellEvents, (event) => event.payload?.action || '', (event) => event.payload?.queueDwellMs);
  const alertCountByComponent = countByValue(healthAlertEvents, (event) => event.payload?.action || '');
  const recoveryCountByComponent = countByValue(healthRecoveryEvents, (event) => event.payload?.action || '');

  const oldestAgeMs = (taskEvents) => {
    if (!taskEvents.length) {
      return 0;
    }

    return Math.max(
      ...taskEvents.map((event) => {
        const timestamp = new Date(event.timestamp).getTime();
        return Number.isFinite(timestamp) ? now.getTime() - timestamp : 0;
      })
    );
  };

  const workflowEventCount = windowEvents.filter((event) => event.type !== 'health_monitor_check').length;

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowHours: Number(options.windowHours || 24),
    totalEvents: windowEvents.length,
    workflowEvents: workflowEventCount,
    healthMonitorCheckEvents: healthMonitorCheckEvents.length,
    healthMonitorRuns: healthMonitorRunEvents.length,
    opsToolEvents: opsToolEvents.length,
    opsToolCounts: [...opsToolCounts.entries()].sort((left, right) => right[1] - left[1]),
    runtimeReadyCount: counts.get('discord_runtime_ready') || 0,
    commandsAccepted: counts.get('command_accepted') || 0,
    transcribedCommandsAccepted: counts.get('transcribed_command_accepted') || 0,
    avgCommandAckLatencyMs: average(commandAckLatencies),
    p95CommandAckLatencyMs: p95(commandAckLatencies),
    voiceNotesReceived: counts.get('voice_note_received') || 0,
    transcriptionCompleted: transcriptionCompletions.length,
    transcriptionFailed: transcriptionFailures.length,
    avgTranscriptionLatencyMs: average(transcriptionLatencies),
    p95TranscriptionLatencyMs: p95(transcriptionLatencies),
    avgTranscriptionConfidence: average(transcriptionConfidences),
    approvalsResolved: approvalResolutions.length,
    approvalsApproved: approvalByDecision.get('approve') || 0,
    approvalsRejected: approvalByDecision.get('reject') || 0,
    automationApprovalsResolved: automationApprovalDecisions.length,
    avgApprovalWaitMs: average(approvalWaits),
    p95ApprovalWaitMs: p95(approvalWaits),
    rejectedEvents: rejectedEvents.length,
    executionsCompleted: executionByOutcome.get('completed') || 0,
    executionsFailed: executionByOutcome.get('failed') || 0,
    githubCiObserved: githubCiObserved.length,
    githubCiSuccess: githubCiByStatus.get('success') || 0,
    githubCiFailure: githubCiByStatus.get('failure') || 0,
    githubCiOther: githubCiObserved.length - ((githubCiByStatus.get('success') || 0) + (githubCiByStatus.get('failure') || 0)),
    runtimeValidationCiObserved: runtimeValidationCiObserved.length,
    runtimeValidationCiSuccess: runtimeValidationCiByStatus.get('success') || 0,
    runtimeValidationCiFailure: runtimeValidationCiByStatus.get('failure') || 0,
    macSyncRequestsCreated: macSyncWatchRequestsCreated.length,
    macSyncRequestsRefreshed: macSyncWatchRequestsRefreshed.length,
    macSyncRuns: macSyncWorkerCompleted.length,
    macSyncPullsApplied: macSyncWorkerCompleted.filter((event) => event.payload?.didPull === true).length,
    macSyncRunsBlocked: macSyncWorkerCompleted.filter((event) => event.payload?.blocked === true).length,
    tasksAwaitingApproval: awaitingApprovalStates.length,
    tasksQueued: currentQueuedStates.length,
    tasksRunning: currentRunningStates.length,
    staleInterruptedTasks: staleInterruptedTaskStates.length,
    oldestAwaitingApprovalMs: oldestAgeMs(awaitingApprovalStates),
    oldestQueuedMs: oldestAgeMs(currentQueuedStates),
    oldestRunningMs: oldestAgeMs(currentRunningStates),
    avgQueueDwellMs: average(queueDwellEvents.map((event) => Number(event.payload?.queueDwellMs || 0)).filter((value) => value > 0)),
    estimatedInputTokens,
    avgEstimatedTokensPerAcceptedCommand: acceptedCommandEvents.length ? estimatedInputTokens / acceptedCommandEvents.length : 0,
    estimatedPaidCostUsd: estimatedCostUsd,
    avgMacSyncExecutionDurationMs: avgExecutionDurationByAction.get('mac_runtime_safe_sync') || 0,
    avgMacSyncLifecycleMs: avgLifecycleByAction.get('mac_runtime_safe_sync') || 0,
    topDomains: topEntries(commandByDomain),
    topRejectionReasons: topEntries(rejectionReasons),
    topApprovalOperators: topEntries(approvalByOperator),
    avgExecutionDurationByAction: topEntries(avgExecutionDurationByAction, 5),
    avgLifecycleByAction: topEntries(avgLifecycleByAction, 5),
    avgQueueDwellByDomain: topEntries(avgQueueDwellByDomain, 5),
    avgQueueDwellByAction: topEntries(avgQueueDwellByAction, 5),
    alertCountByComponent: topEntries(alertCountByComponent, 5),
    recoveryCountByComponent: topEntries(recoveryCountByComponent, 5),
  };
}

export function formatDailySummary(summary) {
  const lines = [
    `**Daily Summary**`,
    `Window: last ${summary.windowHours}h`,
    '',
    `**Workflow**`,
    `- Workflow events: ${summary.workflowEvents ?? summary.totalEvents} (excludes health monitor per-check telemetry)`,
    `- Total tracked events: ${summary.totalEvents}`,
    `- Runtime reconnects: ${summary.runtimeReadyCount}`,
    `- Commands accepted: ${summary.commandsAccepted}`,
    `- Transcribed commands accepted: ${summary.transcribedCommandsAccepted}`,
    `- Avg command ack: ${formatDurationMs(summary.avgCommandAckLatencyMs)}`,
    `- P95 command ack: ${formatDurationMs(summary.p95CommandAckLatencyMs)}`,
    `- Voice notes received: ${summary.voiceNotesReceived}`,
    `- Approvals resolved: ${summary.approvalsResolved} (${summary.approvalsApproved} approved, ${summary.approvalsRejected} rejected)`,
    `- Automation approvals resolved: ${summary.automationApprovalsResolved || 0}`,
    `- Awaiting approval now: ${summary.tasksAwaitingApproval}`,
    `- Queued now: ${summary.tasksQueued}`,
    `- Running now: ${summary.tasksRunning}`,
    '',
    `**Transcription**`,
    `- Completed: ${summary.transcriptionCompleted}`,
    `- Failed: ${summary.transcriptionFailed}`,
    `- Avg latency: ${summary.avgTranscriptionLatencyMs ? `${Math.round(summary.avgTranscriptionLatencyMs)} ms` : 'n/a'}`,
    `- P95 latency: ${summary.p95TranscriptionLatencyMs ? `${Math.round(summary.p95TranscriptionLatencyMs)} ms` : 'n/a'}`,
    `- Avg confidence: ${summary.avgTranscriptionConfidence ? `${Math.round(summary.avgTranscriptionConfidence * 100)}%` : 'n/a'}`,
    '',
    `**Execution**`,
    `- Completed actions: ${summary.executionsCompleted}`,
    `- Failed actions: ${summary.executionsFailed}`,
    `- Rejected/blocked events: ${summary.rejectedEvents}`,
    `- Avg Mac sync execution: ${formatDurationMs(summary.avgMacSyncExecutionDurationMs)}`,
    `- Avg approval-to-sync completion: ${formatDurationMs(summary.avgMacSyncLifecycleMs)}`,
    '',
    `**Queue + Approval Age**`,
    `- Avg approval wait: ${formatDurationMs(summary.avgApprovalWaitMs)}`,
    `- P95 approval wait: ${formatDurationMs(summary.p95ApprovalWaitMs)}`,
    `- Oldest awaiting approval: ${formatDurationMs(summary.oldestAwaitingApprovalMs)}`,
    `- Stale interrupted executable tasks: ${countValue(summary.staleInterruptedTasks)}`,
    `- Oldest queued task: ${formatDurationMs(summary.oldestQueuedMs)}`,
    `- Oldest running task: ${formatDurationMs(summary.oldestRunningMs)}`,
    `- Avg queue dwell: ${formatDurationMs(summary.avgQueueDwellMs)}`,
    '',
    `**Token + Cost**`,
    `- Estimated intake tokens: ${Math.round(summary.estimatedInputTokens || 0)}`,
    `- Avg estimated tokens per accepted command: ${summary.avgEstimatedTokensPerAcceptedCommand ? Math.round(summary.avgEstimatedTokensPerAcceptedCommand) : 0}`,
    `- Estimated paid model cost captured: $${Number(summary.estimatedPaidCostUsd || 0).toFixed(2)}`,
    '',
    `**CI + Sync**`,
    `- GitHub CI results observed: ${countValue(summary.githubCiObserved)}`,
    `- GitHub CI success/failure: ${countValue(summary.githubCiSuccess)}/${countValue(summary.githubCiFailure)}`,
    `- Runtime validation success/failure: ${countValue(summary.runtimeValidationCiSuccess)}/${countValue(summary.runtimeValidationCiFailure)}`,
    `- Mac sync requests created: ${countValue(summary.macSyncRequestsCreated)}`,
    `- Mac sync requests refreshed: ${countValue(summary.macSyncRequestsRefreshed)}`,
    `- Mac sync runs: ${countValue(summary.macSyncRuns)}`,
    `- Mac sync pulls applied: ${countValue(summary.macSyncPullsApplied)}`,
    `- Mac sync blocked runs: ${countValue(summary.macSyncRunsBlocked)}`,
    '',
    `**Health Monitor**`,
    `- Runs completed: ${countValue(summary.healthMonitorRuns)}`,
    `- Individual checks recorded: ${countValue(summary.healthMonitorCheckEvents)}`,
    `- Alerts fired: ${countValue((summary.alertCountByComponent || []).reduce((sum, entry) => sum + (entry[1] || 0), 0))}`,
    `- Recoveries: ${countValue((summary.recoveryCountByComponent || []).reduce((sum, entry) => sum + (entry[1] || 0), 0))}`,
    '',
    `**Operator Tools**`,
    `- Total operator-tool events: ${countValue(summary.opsToolEvents)}`,
  ];

  if ((summary.opsToolCounts || []).length > 0) {
    for (const [type, count] of summary.opsToolCounts) {
      lines.push(`- ${type}: ${count}`);
    }
  } else {
    lines.push('- (no operator-tool runs recorded in this window)');
  }

  if ((summary.topDomains || []).length > 0) {
    lines.push('', '**Top domains**');
    for (const [domain, count] of summary.topDomains || []) {
      lines.push(`- ${domain}: ${count}`);
    }
  }

  if ((summary.topRejectionReasons || []).length > 0) {
    lines.push('', '**Top rejection reasons**');
    for (const [reason, count] of summary.topRejectionReasons || []) {
      lines.push(`- ${reason}: ${count}`);
    }
  }

  if ((summary.topApprovalOperators || []).length > 0) {
    lines.push('', '**Approvals by operator**');
    for (const [operator, count] of summary.topApprovalOperators || []) {
      lines.push(`- ${operator}: ${count}`);
    }
  }

  if ((summary.avgQueueDwellByDomain || []).length > 0) {
    lines.push('', '**Avg queue dwell by domain**');
    for (const [domain, durationMs] of summary.avgQueueDwellByDomain || []) {
      lines.push(`- ${domain}: ${formatDurationMs(durationMs)}`);
    }
  }

  if ((summary.avgQueueDwellByAction || []).length > 0) {
    lines.push('', '**Avg queue dwell by action**');
    for (const [action, durationMs] of summary.avgQueueDwellByAction || []) {
      lines.push(`- ${action}: ${formatDurationMs(durationMs)}`);
    }
  }

  if ((summary.avgExecutionDurationByAction || []).length > 0) {
    lines.push('', '**Avg execution duration by action**');
    for (const [action, durationMs] of summary.avgExecutionDurationByAction || []) {
      lines.push(`- ${action}: ${formatDurationMs(durationMs)}`);
    }
  }

  if ((summary.avgLifecycleByAction || []).length > 0) {
    lines.push('', '**Avg lifecycle duration by action**');
    for (const [action, durationMs] of summary.avgLifecycleByAction || []) {
      lines.push(`- ${action}: ${formatDurationMs(durationMs)}`);
    }
  }

  if ((summary.alertCountByComponent || []).length > 0) {
    lines.push('', '**Alert count by component**');
    for (const [action, count] of summary.alertCountByComponent || []) {
      lines.push(`- ${action}: ${count}`);
    }
  }

  if ((summary.recoveryCountByComponent || []).length > 0) {
    lines.push('', '**Recovery count by component**');
    for (const [action, count] of summary.recoveryCountByComponent || []) {
      lines.push(`- ${action}: ${count}`);
    }
  }

  return lines.join('\n');
}

export function generateDailySummary(config, options = {}) {
  const events = loadOpsEvents(config);
  const summary = summarizeOpsEvents(events, options);
  const content = formatDailySummary(summary);

  return {
    events,
    summary,
    content,
  };
}

export async function postDailySummary(config, options = {}) {
  const { summary, content } = generateDailySummary(config, options);

  if (!config.channelIds.dailySummary) {
    throw new Error('No Discord dailySummary channel is configured.');
  }

  await sendDiscordApiRequest(
    config.env.DISCORD_BOT_TOKEN,
    `/channels/${config.channelIds.dailySummary}/messages`,
    buildNoticeDiscordPayload({
      title: `Daily Summary - ${summary.windowHours}h`,
      description: content,
      color: 0x5865F2,
      footerText: 'Ruflo daily summary',
    })
  );

  recordOpsMetric(config, 'daily_summary_posted', {
    windowHours: summary.windowHours,
    totalEvents: summary.totalEvents,
    commandsAccepted: summary.commandsAccepted,
    transcribedCommandsAccepted: summary.transcribedCommandsAccepted,
    executionsCompleted: summary.executionsCompleted,
    executionsFailed: summary.executionsFailed,
  });

  return {
    summary,
    content,
  };
}
