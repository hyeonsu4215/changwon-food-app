# Weekly Hours Admin Save v1

## Runtime Permission

The production admin URL has no query-string or storage-token unlock. Save eligibility requires the Supabase source, an authenticated administrator, a current restaurant selection and load generation, a complete valid draft, a supported zero-row or seven-row original state, and an actual change. `saveWeeklyHours()` refreshes administrator authorization and re-runs eligibility immediately before creating persistence. Supabase RLS remains the final authorization boundary.

## Save Contract

- Existing complete schedules write only changed weekdays with one `upsert` request.
- Restaurants with zero rows may create one complete seven-row `insert` request.
- Partial schedules, special recurring closures, stale pre-read snapshots, invalid drafts, duplicate submissions, and source or selection drift are blocked.
- A checked verification control applies one timestamp and `admin_manual` to all seven rows.
- An unchecked schedule edit clears `last_verified_at` only for changed schedule rows.
- A note-only edit preserves the existing verification timestamp and records the changed row source as `admin_manual`.
- Legacy fields on `public.restaurants` are never included in the weekly payload.

## Concurrency Limit

Admin v1 uses a fresh pre-read, one insert/upsert request, and an exact read-back. This prevents ordinary stale overwrites but is not a transactional compare-and-swap across multiple concurrent owners. A future multi-owner app should move the precondition and write into a database RPC or another transactional CAS mechanism. That change requires separate schema and deployment approval.
