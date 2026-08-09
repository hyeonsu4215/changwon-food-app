-- PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE SCHEMA APPROVAL.
-- Secondary Trait and food_traits are intentionally out of scope.

begin;

alter table public.menus
  add column food_character text null;

alter table public.menus
  add constraint menus_food_character_allowed
  check (food_character is null or food_character in ('rice-meal', 'noodle-special', 'hot-soup', 'quick-snack', 'main-dish'))
  not valid;

alter table public.menus
  validate constraint menus_food_character_allowed;

commit;

-- Nullable is intentional for rollout compatibility: existing rows and old clients remain valid
-- while catalog migration and application consumption are approved independently.
-- Rollback is a separate approval: drop the constraint first, then drop the column only after
-- confirming that no deployed code reads it.
