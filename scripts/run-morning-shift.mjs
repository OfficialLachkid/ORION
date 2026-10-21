#!/usr/bin/env node
// Morning shift (07:00). Auto-sends follow-up drafts that the previous
// night-shift queued into the pending-approval store, so the operator
// doesn't have to click approve on each one by hand. Fresh outreach drafts
// (lead_qualification) still require a human click — this shift is
// intentionally scoped to follow-ups only.

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { executeTask } from '../services/task-router/src/executor.mjs';
import {
  loadPersistedPendingTasks,
  removePersistedPendingTask,
} from '../services/discord-bot/src/pending-task-store.mjs';
import { searchApprovalMessageInThreads } from '../services/discord-bot/src/live-runtime.mjs';
import { sendApprovedFollowUps } from './lib/morning-shift/send-approved-followups.mjs';

async function main() {
  const config = loadRuntimeConfig();
  const summary = await sendApprovedFollowUps({
    config,
    executeTask,
    loadPersistedPendingTasks,
    removePersistedPendingTask,
    searchApprovalMessageInThreads,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Morning shift failed: ${error.message}\n`);
  process.exitCode = 1;
});
