# Weekly Hours Schema Design v1

> Historical design record. The schema and initial 112 rows were applied manually on 2026-08-16; the user app still uses the legacy hours reader.

## Baseline

- Source commit: `c12dadd8614263d867370c63683d80a62f66091b`
- Live catalog: restaurants 29, menus 100
- Static/live legacy-hours differences: 0
- Legacy columns remain the production source of truth during 3B.
- Existing `restaurants_updated_at` trigger and `public.set_updated_at()` are unchanged.

## Recommended Scope

Create only `public.restaurant_weekly_hours` in the first schema approval. Defer recurring closures and date exceptions. This keeps the admin v1 bounded while preserving C024 through the legacy reader.

The design uses text status columns with CHECK constraints instead of PostgreSQL enums. Adding a future status then requires a constraint migration rather than an enum lifecycle migration.

## Columns

| Column | PostgreSQL type | Null | Default | Purpose |
| --- | --- | --- | --- | --- |
| `restaurant_id` | `text` | no | none | Ownership boundary and FK to `public.restaurants(id)` |
| `iso_weekday` | `smallint` | no | none | ISO weekday, Monday 1 through Sunday 7 |
| `day_status` | `text` | no | none | `open`, `closed`, or `unknown` |
| `open_time` | `time without time zone` | yes | none | Opening time when status is open |
| `close_time` | `time without time zone` | yes | none | Closing time when status is open |
| `closes_next_day` | `boolean` | no | `false` | Close time belongs to the following date |
| `break_status` | `text` | no | none | `scheduled`, `none`, or `unknown` |
| `break_start` | `time without time zone` | yes | none | Scheduled break start |
| `break_end` | `time without time zone` | yes | none | Scheduled break end |
| `note` | `text` | yes | none | Human review context that does not drive runtime state |
| `source` | `text` | yes | none | Provenance such as `legacy-hours-v1`, `admin`, or a future owner source |
| `last_verified_at` | `timestamptz` | yes | none | When the schedule itself was verified |
| `updated_at` | `timestamptz` | no | `now()` | Technical modification timestamp |

## Keys And Structural Checks

- Primary key: `(restaurant_id, iso_weekday)`.
- Foreign key: `restaurant_id` references `public.restaurants(id)` with `ON DELETE RESTRICT`.
- `iso_weekday` is restricted to 1 through 7.
- `day_status = 'open'` requires both opening and closing times.
- Closed days require both times to be null, `closes_next_day = false`, and `break_status = 'none'`.
- Unknown days require both times to be null, `closes_next_day = false`, and `break_status = 'unknown'`.
- A scheduled break requires an open day and both break times.
- None or unknown break status requires both break times to be null.
- Time ordering is intentionally left to application validation. This avoids rejecting future overnight schedules or incorrectly encoding business rules in a dense CHECK expression.

`day_status` and `break_status` have no defaults. Every insert must state its meaning explicitly. `closes_next_day` defaults to false because that is a mechanical modifier, not a data-quality state.

## Metadata Decision

### Minimal v1

`note` and `updated_at` only. It is smaller, but cannot distinguish migrated data from administrator or future owner edits and cannot represent verification freshness.

### Data-quality enhanced

Adds `source` and `last_verified_at`. The two nullable fields do not control runtime behavior, but they preserve provenance and make 25 unverified break schedules operationally manageable.

**Recommendation:** data-quality enhanced. The current dataset contains substantial unknown information, so provenance and verification time are useful product data rather than speculative metadata.

## C024 Recurring Closure Decision

### Option A: weekly v1 only

- Do not create weekly rows for C024 yet.
- Keep C024 on the legacy reader.
- No recurring-closure UI, policy, or runtime evaluator is added in admin v1.
- Lowest implementation and rollback risk, while preserving the existing `2,4번째 일요일` text exactly.

### Option B: recurring closure table now

Add `restaurant_recurring_closures` with two C024 rows: ISO weekday 7 and weeks 2 and 4. This preserves machine-readable meaning, but also requires another table, policies, trigger, admin editor, runtime precedence, migration assertions, and rollback surface.

**Recommendation:** Option A. One restaurant does not justify expanding the first weekly-hours release across schema, UI, and runtime. Option B remains the required direction before C024 can leave legacy fallback.

## Closed-day Uncertainty Decision

Twelve restaurants have usable opening and closing times but no verified closed-day rule.

### Method A: create no weekly rows

- Keep the known legacy times visible as reference data.
- Leave the restaurant on the legacy reader until all seven weekdays are reviewed.
- Avoids turning an unknown closure into seven apparently confirmed open days.

### Method B: create seven unknown rows

- Preserves uncertainty in the weekly table, but discards the useful known opening and closing times from the structured rows.
- Can make a partially known schedule look like a completed migration even though an administrator must still reconstruct every day.

**Recommendation:** Method A. Create zero weekly rows for these 12 restaurants and keep the legacy values unchanged. The migration preview therefore omits 84 rows until manual review.

## Future Date Exceptions

A future `restaurant_hours_exceptions` table can key rows by `(restaurant_id, service_date)` and override status and times. It does not conflict with the weekly primary key.

Planned evaluation order:

1. Specific date exception.
2. Recurring closure, if that feature is later adopted.
3. Weekly hours.
4. Legacy fallback when the weekly schedule is not complete and verified.

## RLS And Privileges Preview

- Enable RLS on the new table.
- Allow anon and authenticated SELECT only when the parent restaurant is active.
- Allow authenticated DML only through the existing `public.is_admin()` predicate.
- Do not grant anon INSERT, UPDATE, or DELETE.
- Revoke broad defaults before applying explicit least-privilege grants.
- Future owner policies can join `restaurant_owner_memberships` by `restaurant_id`; no admin-only ownership column is embedded in this table.

The current browser-side `admin_users` check remains only a UI gate. RLS is the database enforcement boundary.

## Trigger And Index Decision

- Reuse `public.set_updated_at()` through a new `restaurant_weekly_hours_updated_at` BEFORE UPDATE trigger.
- Do not modify `restaurants_updated_at`.
- The composite primary key already indexes restaurant lookups and weekday uniqueness.
- Add no secondary index in v1. Reconsider `(iso_weekday, day_status)` only if runtime queries fetch schedules across many restaurants by weekday instead of loading by restaurant.

## Source Of Truth Gate

Legacy columns are not deleted or modified. A restaurant becomes eligible for a future weekly reader only when it has exactly seven unique rows, no unknown day status, structurally valid times, and all seven rows have a non-null `last_verified_at`. C024 remains ineligible until recurring closure support exists.
