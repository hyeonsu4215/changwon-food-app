# B4 local review

- Base: origin/main 7dc0db93c91d36cca7057eae17891293b764a8d8.
- Branch: feature/uiux-b4-kakao-test. No commit, push, merge or deployment authorized.
- Integration source: existing uncommitted UI/UX Phase 1 worktree, including its OAuth cache and accessibility fixes. Source worktrees are not modified.
- B mockup attachment was not available in the request. Implementation follows the written four-tab requirements, existing mascot assets and blue/white/yellow palette; visual sign-off remains required.
- Recommendation results, scoring and condition functions remain unchanged from the source integration worktree.
- Navigation: recommendation, community, benefits, MY. Worldcup and search are home tools; favorites stay in the header and MY.
- Community schema and RLS remain unchanged. No category field or reporting feature exists in the current MVP. Only working All/My story filters are presented. My stories uses the existing author_id with a server-side filter before the existing 50-row limit; older stories need future pagination.
- Benefits are explicitly unavailable, with no coupon, stamp, issuing or redemption API.
- Preview client and config endpoint accept only ocqffcambljzhymlfwmh with a public publishable key. Missing, wrong-project or secret-key config fails closed. Production config and weather behavior are inherited unchanged.
- Preview settings must include MUKJJI_TEST_SUPABASE_URL and MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY for the new branch, without changing Production. Existing Kakao deployment is Ready; its protected config endpoint could not be verified read-only (302). No access links or settings were changed.
- OAuth redirect remains the current app origin/path plus communityAuth=1. The eventual B4 Preview origin must be approved in test Supabase before real OAuth validation.
- SW cache advances from integrated v68 to v69. Existing network-first, callback bypass, precache and app-cache cleanup remain; local user data is not deleted.
- Browser verification mocks all network calls and does not establish live OAuth or RLS success. No DB requests or schema operations are run.
- Existing full-suite failures on Windows: analytics-acquisition-source canonical SQL hash, analytics-foundation-migration SQL hash, weekly-hours-preview checked-in CRLF comparison. Do not modify unrelated canonical files to make these pass.

## Second local UX pass

- Community and benefits have explicit recommendation-home buttons. Community list/compose/detail and MY category routes are stored as small History API snapshots, without tokens, draft text or record data. Repeated identical routes are not pushed. Modal-back handling no longer pushes replacement entries during popstate.
- MY shows only the profile and category links. Existing dataDashboard IDs and edit/delete handlers live in myRecordTab and show only the selected category. Favorites retain wishlistTab; record-back buttons return to MY. Secondary review/report/preference/service entries remain available under settings.
- The existing community form is a separate compose state. Back/forward restores unsent drafts within this session; account changes still clear drafts. Deletion returns to the list without a duplicate detail entry.
- Kakao login color and unchanged symbol geometry follow https://developers.kakao.com/docs/ko/kakaologin/design-guide and its official login-complete-ko.svg resource. The label is real text. No third-party logo approximation or new image download is used.
- Authenticated profiles use actual display metadata and an optional HTTPS Kakao/Daum CDN image, with a mascot fallback. These metadata are display-only, never authorization input. No profile-edit API or account-data synchronization is added.
- Account switching remains the existing prompt=login OAuth flow, now also reachable while signed in after confirmation. It does not guarantee that every Kakao in-app browser displays an account picker. Real A/B switching requires an approved test Preview.
- Same uncommitted B4 change set: SW remains v69. No deploy, Auth setting, schema, RLS or DB mutation is performed.

## Third local pass: home cleanup and map preflight

- Removed only the yellow home benefits banner and its unused styles. Recommendation CTA, worldcup/search shortcuts, inline conditions and the four bottom tabs remain. The benefits tab still honestly says it is not yet available.
- Local static catalog: 29 restaurants, 29 valid nonzero latitude/longitude pairs, 29 unique restaurant IDs, 100/100 menus linked to a restaurant. This validates presence and numeric ranges, not real-world positioning accuracy. Live test/Production restaurant rows were not queried.
- app.js dbRestaurantToApp preserves lat/lng from database rows. Existing search joins restaurants and menus by restaurantId and matches store/menu/category/tag text. It currently caps the displayed store list at 20. A later map should share the same matching predicate before presentation/pagination, rather than silently limiting all markers to the first 20 stores.
- Existing mapActionHtml handles external map links. There is no separate restaurant-detail page: the search store card exposes menu-detail buttons with store information. A map selection should reuse these existing actions rather than inventing a nonfunctional store-detail destination.
- No Kakao Maps Web SDK loader, JavaScript-key configuration or local env file exists. The current process has no map-key variable. Read-only Vercel variable metadata inspection (decrypt=false) found only the existing two Preview Supabase settings among relevant variables, with no Kakao/map key. No secret value was printed or used.
- Therefore the map implementation gate is NOT satisfied. No list/map toggle, empty map, fictional pins, SDK fetch, API activation or billing change has been added. Existing list search and external map links remain available.
- Required setup before implementation: an authorized JavaScript platform key for the chosen Kakao test app; confirmation that Kakao Maps usage is enabled; exact JavaScript SDK domain allowlisting for the approved Preview origin and local origin http://127.0.0.1:8098. OAuth redirect allowlisting is separate and is not evidence of Maps domain registration. Do not reuse a REST key, Client Secret, Supabase key or service-role key as the map key.
- The B4 branch has not been pushed or deployed. Its eventual Preview origin and Maps loading cannot yet be verified. No registered-domain or Kakao application-setting access was assumed.
- Proposed future config name (NOT implemented or registered): MUKJJI_TEST_KAKAO_MAP_JS_KEY, scoped to the test branch/Preview. Static browser JS would need an explicit public-config delivery path; it cannot directly read server environment variables. Keep Production unchanged and fail closed without valid test settings. JavaScript map keys are browser-visible and must be restricted by registered origins.
- Official setup references: https://apis.map.kakao.com/web/guide/ and https://developers.kakao.com/docs/ko/kakaomap/common . The latter requires Maps activation and designated platform-key setup; OAuth success alone does not imply Maps readiness.
- At review, official https://developers.kakao.com/docs/ko/getting-started/quota lists Web SDK free daily quota of 300,000 and additional-use pricing of KRW 0.1 per request. Free Maps quota applies only to the developer account's first Maps-enabled app. A second test app may need paid API configuration; confirm the chosen app's free-quota badge, quota consumption and billing settings before enabling anything. No unlimited-free assumption is made.
- Future implementation should lazy-load one SDK promise on explicit map entry (autoload=false), use only validated catalog coordinates and WGS84 lat/lng, reuse the campus gate center, preserve search state, relayout after hidden-tab restoration/resizes, provide keyboard-accessible pin selection and retain list fallback on timeout/error. Existing registered data means no Kakao places/geocoding REST calls are needed merely to produce pins.
