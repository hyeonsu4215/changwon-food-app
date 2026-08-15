-- VERSIONED MIGRATION. NOT EXECUTED AS PART OF MAP SEARCH KEYWORD V1.
-- Schema only: no restaurant values, RLS policies, or other tables are changed.

begin;

do $map_search_schema$
declare
  v_restaurant_count bigint;
  v_menu_count bigint;
begin
  if to_regclass('public.restaurants') is null then
    raise exception 'Map search baseline failed: public.restaurants does not exist';
  end if;

  if to_regclass('public.menus') is null then
    raise exception 'Map search baseline failed: public.menus does not exist';
  end if;

  select count(*) into v_restaurant_count from public.restaurants;
  select count(*) into v_menu_count from public.menus;

  if v_restaurant_count <> 29 or v_menu_count <> 100 then
    raise exception
      'Map search baseline failed: restaurants=%, menus=% (expected 29/100)',
      v_restaurant_count,
      v_menu_count;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurants'
      and column_name in ('map_search_keyword', 'map_search_disabled')
  ) then
    raise exception 'Map search schema collision: one or more target columns already exist';
  end if;

  alter table public.restaurants
    add column map_search_keyword text null,
    add column map_search_disabled boolean not null default false;
end
$map_search_schema$;

commit;
