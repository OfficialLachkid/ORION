-- Qualification output for the qualify-and-draft phase. status transitions:
-- 'new' -> 'qualified' (fit found, draft created, awaiting approval)
--        | 'rejected_fit' (real business, wrong fit for current offers)
--        | 'qualified_no_email' (fit found but no public email to draft to)
-- The full Claude qualification result (reasoning, offer angle, draft copy,
-- linked approval task id) lives in the qualification jsonb — that history
-- doubles as the training/eval dataset for a future local model.
alter table public.leads add column if not exists qualification jsonb;
alter table public.leads add column if not exists qualified_at timestamptz;

create index if not exists leads_status_qualified_idx
  on public.leads (status)
  where status in ('qualified', 'qualified_no_email');
