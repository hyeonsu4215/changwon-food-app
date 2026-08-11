-- POST-COMMIT ROLLBACK PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- STATUS: NOT EXECUTED.
-- Deletes only migration-owned IDs. C001 is asserted and remains untouched.

begin;
set transaction isolation level serializable;
set local timezone = 'UTC';

lock table public.restaurants in share row exclusive mode;
lock table public.menus in share row exclusive mode;

do $catalog_rollback$
declare
  v_written integer;
  v_c001 jsonb;
  v_expected_c001 constant jsonb := $c001_expected${
  "id": "C001",
  "name": "리코리코",
  "area": "정문",
  "address": "경상남도 창원시 의창구 퇴촌로25번길 6-32",
  "lat": 35.2425,
  "lng": 128.6898,
  "phone": "055-267-4300",
  "open_time": "10:00:00",
  "close_time": "20:40:00",
  "break_time": "",
  "closed_days": "일요일",
  "takeout": true,
  "delivery": true,
  "alone": true,
  "group_available": true,
  "seats": 54,
  "review_count": 173,
  "source": "네이버지도",
  "last_checked": "2026-06-15T00:00:00+00:00",
  "memo": "",
  "active": true
}$c001_expected$::jsonb;
begin
  if (select count(*) from public.restaurants) <> 29
     or (select count(*) from public.menus) <> 100 then
    raise exception 'Rollback baseline differs from the expected 29/100 committed state';
  end if;
  if (
    select count(*) from public.restaurants
    where id = any (array(select 'C' || to_char(value, 'FM000') from generate_series(2, 29) as series(value)))
  ) <> 28 or (
    select count(*) from public.menus
    where id = any (array(select 'M' || to_char(value, 'FM000') from generate_series(1, 100) as series(value)))
  ) <> 100 then
    raise exception 'Rollback ownership assertion failed';
  end if;

  select to_jsonb(snapshot) into v_c001
  from (
    select "id", "name", "area", "address", "lat", "lng", "phone", "open_time", "close_time", "break_time", "closed_days", "takeout", "delivery", "alone", "group_available", "seats", "review_count", "source", "last_checked", "memo", "active"
    from public.restaurants
    where id = 'C001'
  ) as snapshot;
  if v_c001 is null or v_c001 is distinct from v_expected_c001 then
    raise exception 'Rollback assertion failed: C001 differs from the approved baseline';
  end if;

  delete from public.menus
  where id = any (array(select 'M' || to_char(value, 'FM000') from generate_series(1, 100) as series(value)));
  get diagnostics v_written = row_count;
  if v_written <> 100 then
    raise exception 'Rollback failed: deleted % menus, expected 100', v_written;
  end if;

  delete from public.restaurants
  where id = any (array(select 'C' || to_char(value, 'FM000') from generate_series(2, 29) as series(value)));
  get diagnostics v_written = row_count;
  if v_written <> 28 then
    raise exception 'Rollback failed: deleted % restaurants, expected 28', v_written;
  end if;

  if (select count(*) from public.restaurants) <> 1
     or (select count(*) from public.menus) <> 0 then
    raise exception 'Rollback validation failed: expected baseline 1/0';
  end if;
  if not exists (select 1 from public.restaurants where id = 'C001') then
    raise exception 'Rollback validation failed: C001 is missing';
  end if;
end
$catalog_rollback$;

commit;
