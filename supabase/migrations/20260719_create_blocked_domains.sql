-- Directory/marketplace/junk domains the leadgen pipeline must skip.
-- Previously a hardcoded set in services/leadgen-scraper/search_leads.py —
-- as a table, new offenders can be added without a code deploy, and the
-- list is shared across devices. The code list remains as a fallback seed
-- if this table is unreachable.
create table if not exists public.blocked_domains (
  domain text primary key,
  reason text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.blocked_domains enable row level security;
revoke all on public.blocked_domains from anon, authenticated;
grant all on public.blocked_domains to postgres, service_role;

insert into public.blocked_domains (domain, reason) values
  ('companydata.com', 'B2B data broker'),
  ('bolddata.nl', 'same company as companydata.com'),
  ('bedrijfsinformatieonline.nl', 'business-info directory'),
  ('yelp.com', 'review platform'),
  ('wikipedia.org', 'encyclopedia'),
  ('tripadvisor.com', 'review platform'),
  ('opencorporates.com', 'company-data directory'),
  ('elektriciensgids.nl', 'electrician directory'),
  ('elektricien.nl', 'directory on bare niche-word domain'),
  ('trustoo.nl', 'review/matching marketplace'),
  ('consumentenbond.nl', 'consumer-advocacy nonprofit'),
  ('spoedklus.nl', 'multi-trade emergency broker'),
  ('startpagina.nl', 'online directory'),
  ('klantervaringen.nl', 'review platform'),
  ('loodgieters-bedrijven.nl', 'lead-referral marketplace'),
  ('yoys.nl', 'B2B marketplace'),
  ('delokaleloodgieter.nl', 'multi-province referral platform'),
  ('moving.nl', 'multi-category comparison marketplace'),
  ('linkedin.com', 'job postings/profiles, not business sites'),
  ('technieknederland.nl', 'trade association'),
  ('klusup.nl', 'gig-work matching platform'),
  ('loodgietershub.nl', 'customer/plumber matching network'),
  ('bouwproducten.nl', 'construction-industry news site'),
  ('facebook.com', 'social platform'),
  ('instagram.com', 'social platform'),
  ('twitter.com', 'social platform'),
  ('x.com', 'social platform'),
  ('tiktok.com', 'social platform'),
  ('bing.com', 'search-ad redirect URLs'),
  ('alexwaterandbouw.eu', 'SEO content site'),
  ('homedeal.nl', 'quote-comparison marketplace'),
  ('werkspot.nl', 'home-services marketplace'),
  ('expatguide.nl', 'expat services directory'),
  ('de10beste.nl', 'top-10 ranking site'),
  ('telefoonboek.nl', 'phone book'),
  ('detelefoongids.nl', 'phone book'),
  ('goudengids.nl', 'yellow pages'),
  ('cylex.nl', 'business directory'),
  ('zoofy.nl', 'handyman booking platform'),
  ('slimster.nl', 'quote-comparison platform'),
  ('amsterdamlokaal.nl', 'city blog/listicle directory'),
  ('amsterdamonline.nl', 'city business directory'),
  ('mva.nl', 'brokers association'),
  ('wieisdebestemakelaar.nl', 'makelaar comparison site'),
  ('ikzoekdebestemakelaar.nl', 'makelaar comparison site'),
  ('makelaaroverzicht.nl', 'makelaar directory'),
  ('elektricienaanhuis.nl', 'Volton multi-trade marketplace'),
  ('elektricienindebuurt.com', 'no-identity SEO shell'),
  ('zorgkaartnederland.nl', 'national healthcare review directory'),
  ('kliniekervaringen.nl', 'clinic review site'),
  ('independer.nl', 'insurance/services comparison'),
  ('clinicbooking.com', 'clinic booking platform'),
  ('injectablesbooking.nl', 'cosmetic-clinic booking platform'),
  ('davidhealth.com', 'health-equipment brand, misattribution source'),
  ('triginta.be', 'real-estate investor, misattribution source'),
  ('4in24.nl', 'B2B recruitment platform'),
  ('ecommercerecruitment.nl', 'recruitment-bureau comparison directory'),
  ('prettigparkeren.nl', 'parking-info site'),
  ('slijterijen.com', 'liquor-store directory'),
  ('slijterij-info.nl', 'liquor-store directory'),
  ('city-map.nl', 'city directory platform (per-city subdomains)'),
  ('turksegids.nl', 'community guide/directory'),
  ('iamsterdam.com', 'official tourism portal')
on conflict (domain) do nothing;
