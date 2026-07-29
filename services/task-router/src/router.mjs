import { createHash, randomBytes } from 'node:crypto';
import { buildTaskWriteBackCandidates } from '../../lib/memory-writeback-candidates.mjs';
import {
  parseDeveloperTaskCommand,
  summarizeDeveloperTaskRequest,
} from '../../developer-agent/src/command-parser.mjs';
import { parseDraftEmailCommand, summarizeDraftEmailRequest } from './email-command-parser.mjs';
import { parseLeadgenCommand, summarizeLeadgenRequest } from './leadgen-command-parser.mjs';

const DOMAIN_KEYWORDS = {
  infra: ['deploy', 'production', 'server', 'host', 'tailscale', 'docker', 'colima', 'restart', 'service', 'mac mini'],
  developer: ['repo', 'code', 'bug', 'fix', 'pr', 'pull request', 'branch', 'refactor', 'test', 'build'],
  sales: ['lead', 'outreach', 'prospect', 'meeting', 'campaign', 'customer', 'client'],
  research: ['research', 'analyze', 'investigate', 'compare', 'evaluate'],
  social: ['post', 'social', 'linkedin', 'twitter', 'x.com', 'instagram'],
};

const TARGET_AGENT_BY_DOMAIN = {
  infra: 'developer-agent',
  developer: 'developer-agent',
  sales: 'sales-agent',
  research: 'research-agent',
  social: 'social-agent',
  general: 'orchestrator',
};

const APPROVAL_KEYWORDS = {
  external_outreach: ['outreach', 'send email', 'email lead', 'contact customer', 'dm', 'message client', 'reach out'],
  production_change: [
    'deploy',
    'production',
    'live site',
    'restart service',
    'change host',
    'infra change',
    'sync the mac',
    'sync mac repo',
    'sync mac runtime',
    'pull latest changes on the mac',
    'pull the latest changes on the mac',
    'update mac runtime',
    'fast-forward pull',
    'apply repo sync',
  ],
  destructive_operation: ['delete', 'remove', 'wipe', 'reset', 'drop database', 'destroy'],
  spending_action: ['buy', 'purchase', 'billing', 'pay', 'subscribe', 'upgrade plan'],
  security_sensitive: ['secret', 'token', 'password', 'ssh key', 'credential', 'permission', 'grant access'],
  code_merge: ['merge pr', 'merge pull request', 'merge into main', 'merge branch', 'ship branch'],
};

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function sanitizeCommandLine(value) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/^[-*•]\s+/u, '')
      .replace(/^\d+[.)]\s+/u, '')
  );
}

export function splitCommandMessage(content) {
  const rawContent = String(content || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .trim();

  if (!rawContent) {
    return [];
  }

  if (
    parseDeveloperTaskCommand(rawContent)
    || parseDraftEmailCommand(rawContent)
    || parseLeadgenCommand(rawContent)
  ) {
    return [rawContent];
  }

  const rawLines = rawContent
    .split(/\r?\n/u)
    .map((line) => sanitizeCommandLine(line))
    .filter(Boolean);

  if (rawLines.length <= 1) {
    const normalized = sanitizeCommandLine(content);
    return normalized ? [normalized] : [];
  }

  return rawLines;
}

function summarizeText(text) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137)}...`;
}

function isImageAttachment(attachment) {
  return Boolean(attachment?.contentType && String(attachment.contentType).toLowerCase().startsWith('image/'));
}

function extractImageContext(message) {
  const imageAttachments = (message.attachments || []).filter((attachment) => isImageAttachment(attachment));
  return {
    image_attachment_count: imageAttachments.length,
    image_attachments: imageAttachments.map((attachment) => ({
      id: attachment.id || '',
      url: attachment.url || '',
      proxyUrl: attachment.proxyUrl || '',
      filename: attachment.filename || '',
      contentType: attachment.contentType || '',
      size: attachment.size || 0,
    })),
    image_attachment_filenames: imageAttachments
      .map((attachment) => attachment.filename || '')
      .filter(Boolean),
  };
}

function inferDomain(text) {
  const lower = text.toLowerCase();

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return domain;
    }
  }

  return 'general';
}

function inferPriority(text) {
  const lower = text.toLowerCase();
  if (/(urgent|asap|immediately|today|critical|blocker)/u.test(lower)) {
    return 'high';
  }
  if (/(whenever|sometime|later|low priority|not urgent)/u.test(lower)) {
    return 'low';
  }

  return 'normal';
}

function buildTaskId(text, submittedAt) {
  const timestamp = new Date(submittedAt || Date.now()).toISOString().replace(/[-:TZ.]/gu, '').slice(0, 12);
  const fingerprint = createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase();
  const entropy = randomBytes(2).toString('hex').toUpperCase();
  return `TASK-${timestamp}-${fingerprint}${entropy}`;
}

function detectApproval(text, approvalRules) {
  const lower = text.toLowerCase();
  const matches = [];

  for (const rule of approvalRules.approvalRequiredFor || []) {
    const keywords = APPROVAL_KEYWORDS[rule.rule] || [];
    if (keywords.some((keyword) => lower.includes(keyword))) {
      matches.push(rule);
    }
  }

  return {
    approvalRequired: matches.length > 0,
    matchedRules: matches,
  };
}

export function normalizeTaskMessage(message, config) {
  const rawContent = String(message.content || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .trim();
  const content = normalizeWhitespace(rawContent);
  if (!content) {
    throw new Error('Cannot normalize an empty command message.');
  }

  const submittedAt = message.submittedAt || new Date().toISOString();
  const developerRequest = parseDeveloperTaskCommand(rawContent);
  const draftEmailRequest = developerRequest ? null : parseDraftEmailCommand(rawContent);
  const leadgenRequest = developerRequest || draftEmailRequest ? null : parseLeadgenCommand(rawContent);
  const hasExplicitRequest = Boolean(developerRequest || draftEmailRequest || leadgenRequest);
  const taskText = hasExplicitRequest ? rawContent : content;
  const taskId = buildTaskId(taskText, submittedAt);
  const domain = developerRequest ? 'developer' : hasExplicitRequest ? 'sales' : inferDomain(content);
  const targetAgent = developerRequest
    ? 'developer-agent'
    : hasExplicitRequest
      ? 'orchestrator'
      : (TARGET_AGENT_BY_DOMAIN[domain] || 'orchestrator');
  const approvalCheck = developerRequest
    ? {
        approvalRequired: true,
        matchedRules: [{
          rule: 'developer_agent_workflow',
          description: 'creates GitHub writes and invokes Claude in an isolated worktree',
        }],
      }
    : hasExplicitRequest
      ? { approvalRequired: false, matchedRules: [] }
      : detectApproval(content, config.approvalRules);
  const matchedRuleDescriptions = approvalCheck.matchedRules.map((rule) => `${rule.rule}: ${rule.description}`);
  const summary = developerRequest
    ? summarizeDeveloperTaskRequest(developerRequest)
    : draftEmailRequest
      ? summarizeDraftEmailRequest(draftEmailRequest)
      : leadgenRequest
        ? summarizeLeadgenRequest(leadgenRequest)
        : summarizeText(content);

  const task = {
    task_id: taskId,
    source_type: message.sourceType || 'discord_text_command',
    source_channel: message.channelKey || message.channelName || 'commands',
    submitted_by: message.author?.displayName || message.author?.username || message.author?.id || 'unknown',
    submitted_at: submittedAt,
    summary,
    full_text: taskText,
    target_agent: targetAgent,
    domain,
    priority: inferPriority(content),
    approval_required: approvalCheck.approvalRequired,
    approval_reason: matchedRuleDescriptions.join(' | '),
    status: approvalCheck.approvalRequired ? 'awaiting_approval' : 'queued',
    message_id: message.messageId || null,
    ...(developerRequest
      ? {
          runtime_action: 'developer_agent_workflow',
          automation_type: 'developer_agent_workflow',
          developer_request: developerRequest,
        }
      : draftEmailRequest
      ? {
          runtime_action: 'gmail_create_draft',
          email_request: draftEmailRequest,
        }
      : leadgenRequest
        ? {
            runtime_action: 'leadgen_search',
            leadgen_request: leadgenRequest,
          }
        : {}),
    ...extractImageContext(message),
  };

  return {
    task,
    writeBackCandidates: buildTaskWriteBackCandidates(task, config.memoryPromotionRules),
  };
}

export function normalizeTaskMessages(message, config) {
  const segments = splitCommandMessage(message.content);
  if (segments.length === 0) {
    throw new Error('Cannot normalize an empty command message.');
  }

  return segments.map((segment, index) => normalizeTaskMessage({
    ...message,
    content: segment,
    submittedAt: message.submittedAt || new Date(Date.now() + index).toISOString(),
  }, config));
}

export function parseApprovalResponse(message) {
  const content = normalizeWhitespace(message.content);
  const approveMatch = /^approve\s+(TASK-[A-Z0-9-]+)$/iu.exec(content);
  if (approveMatch) {
    return {
      valid: true,
      decision: 'approve',
      taskId: approveMatch[1].toUpperCase(),
      reason: '',
    };
  }

  const rejectMatch = /^reject\s+(TASK-[A-Z0-9-]+)(?:\s+because\s+(.+))?$/iu.exec(content);
  if (rejectMatch) {
    const reason = normalizeWhitespace(rejectMatch[2] || '');
    if (!reason) {
      return {
        valid: false,
        decision: 'invalid',
        taskId: rejectMatch[1].toUpperCase(),
        reason: 'Reject decisions must include feedback: `reject TASK-123 because <reason>`.',
      };
    }

    return {
      valid: true,
      decision: 'reject',
      taskId: rejectMatch[1].toUpperCase(),
      reason,
    };
  }

  return {
    valid: false,
    decision: 'invalid',
    taskId: '',
    reason: 'Approval message must match `approve TASK-123` or `reject TASK-123 because <reason>`.',
  };
}
