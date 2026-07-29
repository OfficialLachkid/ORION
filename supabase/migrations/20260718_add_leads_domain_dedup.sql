-- Same business, different pages/runs, different source_url — dedup by domain
-- instead of exact URL so a business already saved once (from any past run,
-- any niche) doesn't get re-saved as a "new" lead from a different page.
alter table public.leads add column if not exists domain text;

update public.leads
set domain = lower(regexp_replace(regexp_replace(source_url, '^https?://', ''), '/.*$', ''))
where domain is null;

alter table public.leads alter column domain set not null;
alter table public.leads add constraint leads_domain_key unique (domain);

create index if not exists leads_domain_idx on public.leads (domain);
