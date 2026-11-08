#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { findSentGmailMessages } from '../services/gmail/src/read.mjs';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import {
  markGmailSendReceiptSent,
  prepareGmailSendReceipt,
} from '../services/task-router/src/outbound-receipt-journal.mjs';

function argValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function normalizeEmail(value) {
  const lowered = String(value || '').trim().toLowerCase();
  const angleMatch = /<([^>]+)>/u.exec(lowered);
  return (angleMatch ? angleMatch[1] : lowered).trim();
}

function extractRun(lines, expectedSent) {
  let summaryIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].includes('[morning-shift:outreach] summary:')) continue;
    const match = /"sent":(\d+)/u.exec(lines[index]);
    if (match && Number(match[1]) === expectedSent) {
      summaryIndex = index;
      break;
    }
  }
  if (summaryIndex === -1) throw new Error(`No outreach run with sent=${expectedSent} was found.`);
  let startIndex = summaryIndex;
  while (startIndex > 0) {
    startIndex -= 1;
    if (lines[startIndex].includes('[morning-shift:outreach] cap=')) break;
    if (lines[startIndex].includes('[morning-shift:outreach] summary:')) {
      startIndex += 1;
      break;
    }
  }
  const sentPattern = /\[morning-shift:outreach\] sent \[\d+\/\d+\] (TASK-[A-Z0-9-]+) → ([^ ]+)/u;
  return lines.slice(startIndex, summaryIndex + 1).flatMap((line) => {
    const match = sentPattern.exec(line);
    return match ? [{ taskId: match[1], recipient: normalizeEmail(match[2]) }] : [];
  });
}

function loadLeadMappings(metricsText) {
  const mappings = new Map();
  for (const line of metricsText.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const taskId = String(event?.payload?.approvalTaskId || '').trim();
      const leadId = String(event?.payload?.leadId || '').trim();
      if (event?.type === 'lead_qualification' && taskId && leadId) {
        mappings.set(taskId, {
          leadId,
          domain: String(event?.payload?.domain || '').trim().toLowerCase(),
        });
      }
    } catch {
      // Ignore unrelated/truncated log lines; unresolved tasks are reported.
    }
  }
  return mappings;
}

function dateWindow(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateText)) {
    throw new Error('--date must use YYYY-MM-DD.');
  }
  const start = new Date(`${dateText}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    afterEpoch: Math.floor(start.getTime() / 1000),
    beforeEpoch: Math.floor(end.getTime() / 1000),
  };
}

async function main() {
  const config = loadRuntimeConfig();
  const expectedSent = Number(argValue('--expected-sent', '41'));
  const date = argValue('--date');
  if (!date) throw new Error('--date YYYY-MM-DD is required to avoid matching the wrong Gmail messages.');
  const stdoutPath = resolve(argValue(
    '--stdout-log',
    resolve(config.runtimePaths.logDir, 'morning-shift.stdout.log'),
  ));
  const metricsPath = resolve(argValue('--metrics-log', config.runtimePaths.metricsEventsFile));
  const [stdoutText, metricsText] = await Promise.all([
    readFile(stdoutPath, 'utf8'),
    readFile(metricsPath, 'utf8'),
  ]);
  const sentTasks = extractRun(stdoutText.split(/\r?\n/u), expectedSent);
  if (sentTasks.length !== expectedSent) {
    throw new Error(`Expected ${expectedSent} sent tasks but parsed ${sentTasks.length}; refusing partial recovery.`);
  }
  const mappings = loadLeadMappings(metricsText);
  const { afterEpoch, beforeEpoch } = dateWindow(date);
  const apply = process.argv.includes('--apply');
  const resolved = [];
  const unresolved = [];

  for (const sentTask of sentTasks) {
    const mapping = mappings.get(sentTask.taskId);
    if (!mapping) {
      unresolved.push({ ...sentTask, reason: 'lead_mapping_missing' });
      continue;
    }
    const query = `to:${sentTask.recipient} after:${afterEpoch} before:${beforeEpoch}`;
    const matches = await findSentGmailMessages(config.env, query, { maxResults: 10 });
    const exactMatches = matches.filter((message) => normalizeEmail(message.to) === sentTask.recipient);
    if (exactMatches.length !== 1) {
      unresolved.push({ ...sentTask, leadId: mapping.leadId, reason: `gmail_matches_${exactMatches.length}` });
      continue;
    }
    const message = exactMatches[0];
    const sentAt = message.internalDate > 0
      ? new Date(message.internalDate).toISOString()
      : new Date(afterEpoch * 1000).toISOString();
    const task = {
      task_id: sentTask.taskId,
      lead_id: mapping.leadId,
      lead_domain: mapping.domain,
      email_request: { to: sentTask.recipient, subject: message.subject },
    };
    if (apply) {
      await prepareGmailSendReceipt(task, config, { now: sentAt });
      await markGmailSendReceiptSent(task, config, {
        messageId: message.messageId,
        threadId: message.threadId,
      }, { now: sentAt });
    }
    resolved.push({
      taskId: sentTask.taskId,
      leadId: mapping.leadId,
      recipient: sentTask.recipient,
      gmailMessageId: message.messageId,
      gmailThreadId: message.threadId,
      sentAt,
    });
  }

  const report = { apply, expectedSent, resolved: resolved.length, unresolved };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (unresolved.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`Gmail outage receipt bootstrap failed: ${error.message}\n`);
  process.exitCode = 1;
});
