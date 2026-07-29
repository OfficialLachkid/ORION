-- Outreach lifecycle timestamps. The status column stays the single
-- lifecycle field (new -> qualified -> sent -> responded / rejected_fit /
-- draft_rejected / ...); these timestamps record WHEN the two
-- outward-facing transitions happened. Draft-creation time is already
-- covered by qualified_at + the approval task id in qualification jsonb —
-- deliberately no extra column noise for intermediate states.
alter table public.leads add column if not exists sent_at timestamptz;
alter table public.leads add column if not exists responded_at timestamptz;
