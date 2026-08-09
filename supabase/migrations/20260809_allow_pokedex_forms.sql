do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'pokedex'
      and constraint_name = 'pokemon_species_national_dex_number_key'
  ) then
    alter table public.pokedex
      drop constraint pokemon_species_national_dex_number_key;
  end if;

  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'pokedex'
      and constraint_name = 'pokedex_national_dex_number_key'
  ) then
    alter table public.pokedex
      drop constraint pokedex_national_dex_number_key;
  end if;
end;
$$;

alter table public.pokedex
  add column if not exists is_default_form boolean not null default true;

create index if not exists pokedex_national_dex_number_form_idx
  on public.pokedex (national_dex_number, is_default_form desc, slug);
