-- APPROVAL A PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- Adds one nullable column and one CHECK constraint. No default, backfill, RLS, or Secondary Trait.

begin;

do $schema$
declare
  v_data_type text;
  v_is_nullable text;
  v_column_default text;
begin
  if to_regclass('public.menus') is null then
    raise exception 'Baseline assertion failed: public.menus does not exist';
  end if;

  select data_type, is_nullable, column_default
    into v_data_type, v_is_nullable, v_column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menus'
    and column_name = 'food_character';

  if not found then
    alter table public.menus add column food_character text null;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' or v_column_default is not null then
    raise exception 'food_character exists with an unexpected type/nullability/default';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.menus'::regclass
      and conname = 'menus_food_character_allowed'
  ) then
    raise exception 'Constraint already exists; stop for definition review instead of replacing it';
  end if;

  alter table public.menus
    add constraint menus_food_character_allowed
    check (food_character is null or food_character in ('rice-meal', 'noodle-special', 'hot-soup', 'quick-snack', 'main-dish'))
    not valid;

  alter table public.menus validate constraint menus_food_character_allowed;
end
$schema$;

commit;

-- A failed assertion or DDL statement leaves this transaction uncommitted/aborted.
-- Approval B must remain a separate action after this schema change is verified.
