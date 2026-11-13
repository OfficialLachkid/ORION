// Per-domain dedup for the lead-qualification batch (added 2026-11-13).
//
// The scraper routinely finds multiple contact emails on one site
// (info@, sales@, contact@) and each lands as its own `status='new'`
// lead. Before this helper, every one of them was Claude-drafted and
// queued for approval — ballooning the morning-shift pending-approval
// store and leaning on the send-side in-batch dedup to collapse them
// to one send. This helper partitions a freshly-fetched batch so only
// the OLDEST lead per domain goes to the drafter; siblings are tagged
// with `status='deferred_same_domain'` and come back out of the active
// rotation until an operator revives them.
//
// Pure — no I/O. The caller handles the Supabase status update and the
// outcomes bookkeeping.

export function domainOfLead(lead) {
  return String(lead?.domain || '').trim().toLowerCase();
}

// Partitions a batch of lead rows by per-domain uniqueness. The batch
// is expected to be ordered oldest-first by the caller (that is the
// default of fetchLeadBatch); this helper is stable with respect to
// the input order so "oldest wins" naturally.
//
// Returns:
//   primaries: Lead[]              — one per domain, in input order
//   deferredSiblings: Lead[]       — later-arriving leads at a domain
//                                     already represented in primaries
//
// Leads with no resolvable domain are always treated as primaries —
// we never collapse rows we cannot group reliably.
export function partitionBatchByDomain(batch) {
  const primaries = [];
  const deferredSiblings = [];
  const claimed = new Set();
  for (const lead of Array.isArray(batch) ? batch : []) {
    const domain = domainOfLead(lead);
    if (!domain) {
      primaries.push(lead);
      continue;
    }
    if (claimed.has(domain)) {
      deferredSiblings.push(lead);
      continue;
    }
    claimed.add(domain);
    primaries.push(lead);
  }
  return { primaries, deferredSiblings };
}
