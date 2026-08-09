# Post-migration Validation Plan

> PLAN ONLY. Run only after separately approved schema and catalog migrations.

## Database

- Confirm `restaurants=29` and `menus=100`.
- Confirm duplicate restaurant/menu IDs are 0.
- Confirm orphan menus are 0.
- Confirm sellable menus linked to inactive stores are 0.
- Confirm all 100 menus have one allowed `food_character`; null and invalid values are 0.
- Compare C001 against the approved conflict decision and pre-migration backup.

## Administrator

- Supabase source reports normal, not partial.
- User app expected source reports Supabase and source mismatch warning is cleared.
- Static 29/100 remains available as read-only recovery/reference data.
- Primary Food Character renders only after separately approved UI activation.
- Initial upload remains locked unless a later safety feature explicitly replaces it.

## User app

- Confirm the selected catalog source is Supabase only after all integrity checks pass.
- Verify recommendation returns 3 menus.
- Verify search, favorites, eaten history, sharing, reviews, world cup, roulette, and map links.
- Verify location denial still falls back to the Changwon National University main gate.
- Verify PC and 360/390/430px mobile layouts.

## Service Worker and rollback readiness

- Confirm required catalog assets and cache version respond normally.
- Do not clear user caches as part of validation.
- Keep the baseline backups and migration ID manifest until the observation window closes.
- Treat successful writes and a safe user-source switch as separate sign-offs.
