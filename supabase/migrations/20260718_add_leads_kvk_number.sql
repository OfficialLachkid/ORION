-- Dutch chamber-of-commerce registration number, when the page shows one —
-- a real business signal (directories/marketplaces don't present a KvK
-- number as belonging to the businesses they list).
alter table public.leads add column if not exists kvk_number text;

create index if not exists leads_kvk_number_idx on public.leads (kvk_number)
where kvk_number is not null;
