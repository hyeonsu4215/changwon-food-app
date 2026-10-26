# Temporary Preview-only community RLS checks

This tool is separate from the user application. It is not linked from the app,
does not register a Service Worker, and must NOT be included in an operational
main pull request. Before preparing an MVP-to-main PR, exclude/remove all of:

- `tools/preview-rls/`
- `api/preview-rls-config.js`
- `tests/preview-rls.test.js`

Do not merge the feature branch wholesale while these temporary files are present.
No Git operations or deployment are authorized by this document.

## Environment gate

Open `/tools/preview-rls/` on the SAME Preview origin used for Kakao login.
No secrets or tokens are entered or copied. The configuration function allows
only `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=feature/kakao-community-mvp`,
and `MUKJJI_TEST_SUPABASE_URL=https://ocqffcambljzhymlfwmh.supabase.co`
(an optional trailing slash is accepted), with a public
`MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY` starting with `sb_publishable_`.
Missing configuration, a different project/branch, localhost, and Production
fail closed BEFORE loading the SDK or requesting an Auth session.

The server only publishes public test configuration; it never calls Supabase.
The browser pins every data request to the test project's community_posts table.
The shared SDK uses the app's existing same-origin session without signing out.
The anonymous check uses an isolated nonpersistent client and explicitly creates
an anonymous Auth user after confirmation. That Auth user is not deleted by this
tool; no service-role key or Auth administration is used.

## User sequence

1. A (regular Chrome): sign in through the app, open this page, check the account,
   then press `A: 임시 글 만들기`. Note the baseline count. Copy the test code.
2. B (incognito, same Preview origin): sign in as a different Kakao account, open
   this page, paste/import the code. Press the B deletion check and confirm only
   that disposable test post. PASS requires the post still exists after the request.
3. B copies its updated code back to A. A imports it. This transfers B's Auth UID,
   not a token and not a trusted PASS receipt. Verify B's result on B's own screen.
4. A performs author-spoofing, unauthenticated, and isolated-anonymous checks.
   Each generates a new unique marker. Only an explicit permission denial plus
   absence on read-back is PASS. Other API errors are inconclusive, not PASS.
5. A performs the owner-delete check, confirms, and then verifies preservation.
   Only the exact generated post ID is in the DELETE filter; its full test marker,
   content, and author are verified before deletion. No PATCH or broad DELETE exists.
6. A/B keep the results from their own screens. This tool does not claim an overall
   security PASS based on data copied from another browser.

On a security failure, stop further checks. Unexpectedly created test rows are
listed for explicit owner-confirmed cleanup. If ownership was spoofed, B may need
the updated code to remove the B-owned test row. Unknown write outcomes are tracked
in memory and can be resolved with the verification button. Do not reload/close
the page before recording results and checking for outstanding temporary rows.
No existing app localStorage, reviews, favorites, history, or settings are cleared.
An unexpectedly created anonymous-owned post may not be deletable under the
Kakao-only DELETE policy. In that case stop and request separately approved test
administration cleanup; the tool must not elevate privileges or change policies.

Only local mocked tests have run during implementation. Real test API writes and
deletes require the user's later Preview execution; no SQL is executed by the tool.
