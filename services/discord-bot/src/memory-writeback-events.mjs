export function buildMemoryWriteBackCandidateEvent(task, candidates = []) {
  if (!task?.task_id || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  // Sales/outreach approval + execution outcomes already have a durable,
  // queryable record (the leads table's `qualification` jsonb + `sent_at`,
  // plus the resolved approval message itself in #outreach-agent) — posting
  // a second automatic #memoryUpdates card per email adds no information
  // that isn't already recorded elsewhere, only channel noise at outreach
  // volume (operator request, 2026-07-20). Other domains (infra, security)
  // have no equivalent standalone record, so this stays scoped to sales.
  if (task.domain === 'sales') {
    return null;
  }

  return {
    channelKey: 'memoryUpdates',
    type: 'memory_writeback_candidates',
    body: `Prepared ${candidates.length} memory write-back candidate(s) for ${task.task_id}.`,
    metadata: {
      taskId: task.task_id,
      summary: task.summary,
      targetAgent: task.target_agent,
      domain: task.domain,
      candidateCount: candidates.length,
      candidates,
    },
  };
}
