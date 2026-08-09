# Execution Tool Recommendation

> ANALYSIS ONLY. No command or SQL in this package has been executed against Supabase.

## Recommended path

This worktree currently has no `supabase/migrations` directory, and neither `supabase` nor `psql` is installed or available on PATH. In the current environment, the Supabase Dashboard SQL Editor is therefore the directly available execution path. It can submit each reviewed file as one PostgreSQL batch and supports the assertions and table locks in this package.

Supabase's official migration guide warns that direct remote changes in SQL Editor bypass migration history. If this project adopts a tracked migration workflow before execution, prefer two reviewed migration files and Supabase CLI: add/push only Approval A, stop and verify, then add/push Approval B after its separate approval. Use `supabase db push --dry-run` before either push.

1. Approval A: run only `01-add-food-character.sql`, verify the nullable column and CHECK, then stop.
2. Obtain separate Approval B.
3. Immediately recheck the exact 1/0 baseline and backup fingerprint.
4. Run only `02-migrate-catalog.sql` as one batch.
5. Perform the post-migration checks before closing the migration window.

## Not recommended

- Browser anon client or `seedCatalogFromStatic()`: the existing two-request flow cannot make restaurant and menu writes atomic.
- REST upsert: the 1/0 baseline gives no reason to permit overwrite, and upsert weakens collision detection.
- A persistent RPC/function solely for this one-time migration: it adds an extra database object and permission surface. If an RPC is later required operationally, define, review, execute, and remove it under separate approvals.

## Credential handling

No service credential belongs in source files, generated SQL, shell history, logs, or reports. The SQL Editor uses the authenticated Supabase dashboard session. A direct client must receive credentials through an operator-controlled secret channel; this package neither requests nor stores them.

Official references:

- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/local-development/cli-workflows
- https://www.postgresql.org/docs/current/transaction-iso.html
