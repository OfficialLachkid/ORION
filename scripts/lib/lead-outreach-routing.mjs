// Route lead-outreach outbound events to the right Discord destination.
//
// Pending outreach drafts (approval_request events) go to the
// #waiting-approval thread inside #outreach-agent when it's configured, so
// the parent channel stays clean and the operator can eyeball what's
// waiting at a glance (2026-08-25 addition). Falls back to #outreach-agent
// when the thread isn't set — existing installs without the new env var
// keep working unchanged.
//
// agentResults events get dropped entirely: they carry duplicate copies of
// data that already lives on the draft card + Gmail, and used to just add
// noise to the outreach channel.
export function routeLeadOutreachEvents(channelIds = {}, outboundEvents = []) {
  const waitingApprovalThread = String(channelIds.outreachWaitingApproval || '').trim();
  const outreachChannel = String(channelIds.outreachAgent || '').trim();
  const approvalChannelKey = waitingApprovalThread
    ? 'outreachWaitingApproval'
    : (outreachChannel ? 'outreachAgent' : '');
  return outboundEvents
    .filter((outboundEvent) => outboundEvent.channelKey !== 'agentResults')
    .map((outboundEvent) => (
      outboundEvent.type === 'approval_request' && approvalChannelKey
        ? { ...outboundEvent, channelKey: approvalChannelKey }
        : outboundEvent
    ));
}
