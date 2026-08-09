# User App Source Transition

## Visibility boundary

The catalog migration is one PostgreSQL transaction. Under PostgreSQL MVCC, other sessions do not see its uncommitted inserts. The table locks also prevent concurrent catalog writes during baseline verification and insertion.

- Before COMMIT: PostgREST readers continue to see the existing restaurants 1 / menus 0 state, so the user app keeps static 29/100.
- After a successful COMMIT: all 28 restaurant rows and all 100 menu rows become visible together, producing restaurants 29 / menus 100.
- On any assertion or insert failure: the transaction aborts and none of the catalog inserts commit.

The user app currently switches when it sees at least one active Supabase restaurant and at least one available Supabase menu. Atomic visibility prevents the migration itself from exposing a partial insert state. Operational validation is still a separate gate after COMMIT because application behavior, cache state, and read policy must be checked independently.
