#!/usr/bin/env node
// Morning shift (07:00). Drains the pending-approval store in two
// passes:
//
//   1. Follow-ups  — auto-sends every `lead_follow_up` draft. No
//                    pre-send checks, no cap. The drafter has already
//                    validated the recipient on the first touch, and
//                    the follow-up SLA is tight.
//   2. Fresh outreach — auto-sends up to N `lead_qualification`
//                    drafts per morning (default N=5), each after
//                    running deterministic pre-send checks
//                    (suppression / drafter-leakage / per-domain
//                    cap). Rejections stay in the store for manual
//                    click-approval.

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { executeTask } from '../services/task-router/src/executor.mjs';
import {
  loadPersistedPendingTasks,
  removePersistedPendingTask,
} from '../services/discord-bot/src/pending-task-store.mjs';
import { searchApprovalMessageInThreads } from '../services/discord-bot/src/live-runtime.mjs';
import { sendApprovedFollowUps } from './lib/morning-shift/send-approved-followups.mjs';
import { sendApprovedOutreach } from './lib/morning-shift/send-approved-outreach.mjs';

async function main() {
  const config = loadRuntimeConfig();

  const followUps = await sendApprovedFollowUps({
    config,
    executeTask,
    loadPersistedPendingTasks,
    removePersistedPendingTask,
    searchApprovalMessageInThreads,
  });

  const outreach = await sendApprovedOutreach({
    config,
    executeTask,
    loadPersistedPendingTasks,
    removePersistedPendingTask,
    searchApprovalMessageInThreads,
  });

  process.stdout.write(`${JSON.stringify({ followUps, outreach }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Morning shift failed: ${error.message}\n`);
  process.exitCode = 1;
});
