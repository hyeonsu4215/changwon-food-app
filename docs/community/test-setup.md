# Isolated Kakao community test setup

This MVP has not been connected to or tested against a live Supabase project. Do not use the Production project `poxvxxwtrblkjfrqqnrw` for testing.

1. Create a separate test Supabase project. Enable anonymous sign-in and the Kakao provider in that project only. Configure the Kakao REST API key and client secret in the Supabase Auth dashboard, never in browser code.
2. In Kakao Developers, register the test project's Supabase callback URL `https://<test-ref>.supabase.co/auth/v1/callback`. Add the exact Vercel Preview URL (and local development URL if needed) to the test project's Auth redirect allowlist. Enable manual identity linking in the test project to preserve existing anonymous review/taste ownership during Kakao sign-in.
3. After separate approval, apply `community-posts-test-only.sql` to the test project only. Confirm RLS is enabled. Do not run it on Production.
4. In the Preview Vercel environment only, set `MUKJJI_TEST_SUPABASE_URL` and `MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY`. The latter is a public `sb_publishable_` key, not a service-role or secret key. Do not set these in Production. The browser obtains them from `/api/community-test-config`; a missing or unsafe config disables all Preview Supabase access.
5. Verify real OAuth redirect and return, linked anonymous identity retention, public reads, Kakao-only writes, owner-only deletes, and cross-account deletion denial in the isolated project. Mock tests alone do not establish these outcomes.

Community posts are not synced with the existing device-only wishlist, eaten history, taste overrides, or recommendation settings. This MVP intentionally has no account data migration or merge.
