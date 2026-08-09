-- VERSIONED MIGRATION. NOT EXECUTED AS PART OF THIS CHANGE.
-- Approval A adds schema only: no catalog data, RLS, or application behavior changes.

begin;

do $approval_a$
declare
  v_menu_count bigint;
  v_existing_type text;
  v_existing_nullable text;
  v_existing_default text;
  v_existing_constraint text;
begin
  if to_regclass('public.menus') is null then
    raise exception 'Approval A baseline failed: public.menus does not exist';
  end if;

  select count(*) into v_menu_count from public.menus;
  if v_menu_count <> 0 then
    raise exception 'Approval A baseline failed: menus has % rows, expected 0', v_menu_count;
  end if;

  select data_type, is_nullable, column_default
    into v_existing_type, v_existing_nullable, v_existing_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menus'
    and column_name = 'food_character';

  if found then
    raise exception
      'Approval A collision: food_character already exists (type=%, nullable=%, default=%)',
      v_existing_type,
      v_existing_nullable,
      coalesce(v_existing_default, 'none');
  end if;

  select pg_get_constraintdef(oid)
    into v_existing_constraint
  from pg_constraint
  where conrelid = 'public.menus'::regclass
    and conname = 'menus_food_character_allowed';

  if found then
    raise exception
      'Approval A collision: menus_food_character_allowed already exists (%)',
      v_existing_constraint;
  end if;

  alter table public.menus
    add column food_character text null;

  alter table public.menus
    add constraint menus_food_character_allowed
    check (
      food_character is null
      or food_character in (
        'rice-meal',
        'noodle-special',
        'hot-soup',
        'quick-snack',
        'main-dish'
      )
    );
end
$approval_a$;

commit;
