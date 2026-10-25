const assert = require("node:assert/strict");
const test = require("node:test");
const { createService, completeOAuthReturn, canDelete } = require("../community-mvp");

const tables = ["menu_reviews", "menu_taste_votes", "info_reports"];
const kakao = { id: "existing-kakao-owner", is_anonymous: false, identities: [{ provider: "kakao" }] };

function missingTable(table, code = "PGRST205") {
  return {
    status: 404, count: null, data: null,
    error: {
      code,
      message: code === "PGRST205"
        ? `Could not find the table 'public.${table}' in the schema cache`
        : `relation "public.${table}" does not exist`,
    },
  };
}

function fixture(lookup = (table) => missingTable(table), linkingError = null) {
  let anonymousId = 1;
  let user = { id: `anonymous-${anonymousId}`, is_anonymous: true };
  let oauthUser = kakao;
  const posts = [];
  const calls = [];
  const client = {
    auth: {
      async getUser() { return { data: { user } }; },
      async signInWithOAuth(input) {
        calls.push({ method: "signInWithOAuth", input });
        return { data: { url: "https://oauth.invalid/authorize" } };
      },
      async linkIdentity(input) {
        calls.push({ method: "linkIdentity", input });
        return linkingError ? { error: linkingError } : { data: { url: "https://oauth.invalid/link" } };
      },
      async exchangeCodeForSession(code) {
        assert.equal(code, "mock-kakao-code");
        user = oauthUser;
        return { data: { session: { user } } };
      },
      async signOut() { calls.push({ method: "signOut" }); user = null; return {}; },
      async signInAnonymously() {
        user = { id: `anonymous-${++anonymousId}`, is_anonymous: true };
        calls.push({ method: "signInAnonymously" });
        return { data: { user } };
      },
    },
    from(table) {
      const filters = {};
      let values;
      let selectOptions;
      return {
        select(fields, options) { selectOptions = options; return this; },
        eq(key, value) { filters[key] = value; return this; },
        order() { return this; },
        insert(input) { values = input; return this; },
        async limit(size) {
          if (table === "community_posts") return { data: posts.slice(0, size) };
          calls.push({ method: "lookup", table, filters, size, selectOptions });
          return lookup(table, filters.user_id);
        },
        async single() {
          if (values) {
            const post = {
              id: "00000000-0000-4000-8000-000000000001", author_id: user.id,
              ...values, created_at: "2026-10-25T00:00:00Z",
            };
            posts.push(post);
            calls.push({ method: "insert", table });
            return { data: post };
          }
          return { data: posts.find((post) => post.id === filters.id) };
        },
      };
    },
  };
  const service = createService(client);
  return {
    service, client, calls, posts,
    async finishOAuth(nextUser = kakao) {
      oauthUser = nextUser;
      const result = await completeOAuthReturn(client.auth,
        "https://preview.invalid/?communityAuth=1&code=mock-kakao-code", () => {});
      assert.equal(result.error, "");
    },
  };
}

test("explicit reauthentication switches A to B while preserving A's posts and ownership", async () => {
  const h = fixture();
  await h.service.startLogin("https://preview.invalid/?communityAuth=1");
  assert.equal(h.calls.find((call) => call.method === "signInWithOAuth").input.options.queryParams, undefined);
  await h.finishOAuth();
  const original = await h.service.create("A's post", "Preserve this post");
  const snapshot = { ...original };
  await h.service.logout();
  await h.service.startLogin("https://preview.invalid/?communityAuth=1", { reauthenticate: true });
  const request = h.calls.filter((call) => call.method === "signInWithOAuth").at(-1);
  assert.deepEqual(request.input.options, {
    redirectTo: "https://preview.invalid/?communityAuth=1", queryParams: { prompt: "login" },
  });
  const accountB = { ...kakao, id: "different-kakao-owner" };
  await h.finishOAuth(accountB);
  assert.equal((await h.service.currentUser()).id, accountB.id);
  assert.deepEqual(await h.service.detail(original.id), snapshot);
  assert.equal(canDelete(accountB, original), false);
  await assert.rejects(h.service.remove(original), /본인이/);
  assert.equal(h.calls.some((call) => call.method === "linkIdentity"), false);
});

for (const code of ["PGRST205", "42P01"]) {
  test(`${code}: first login, logout, same-account relogin preserves existing posts`, async () => {
    const h = fixture((table) => missingTable(table, code));
    await h.service.startLogin("https://preview.invalid/?communityAuth=1");
    await h.finishOAuth();
    const original = await h.service.create("A meal together", "Original post body");
    await h.service.logout();
    const anonymous = await h.service.currentUser();
    assert.equal(anonymous.is_anonymous, true);
    assert.equal(anonymous.id, "anonymous-2");
    assert.deepEqual(await h.service.list(), [original]);
    await assert.rejects(h.service.create("Not logged in", "Blocked"), /카카오 로그인/);
    await h.service.startLogin("https://preview.invalid/?communityAuth=1");
    await h.finishOAuth();
    assert.equal((await h.service.currentUser()).id, original.author_id);
    assert.deepEqual(await h.service.detail(original.id), original);
    assert.equal(h.calls.filter((call) => call.method === "signInWithOAuth").length, 2);
    assert.equal(h.calls.filter((call) => call.method === "linkIdentity").length, 0);
    const lookups = h.calls.filter((call) => call.method === "lookup");
    assert.equal(lookups.length, 6);
    assert.ok(lookups.every((call) => call.size === 1 && call.selectOptions.head !== true));
    assert.deepEqual(lookups.map((call) => call.filters.user_id), [
      "anonymous-1", "anonymous-1", "anonymous-1", "anonymous-2", "anonymous-2", "anonymous-2",
    ]);
    assert.equal(h.posts.length, 1);
  });
}

test("missing and existing empty tables together allow ordinary Kakao login", async () => {
  const h = fixture((table) => table === "menu_reviews" ? missingTable(table) : { count: 0 });
  await h.service.startLogin("https://preview.invalid/");
  assert.equal(h.calls.at(-1).method, "signInWithOAuth");
  assert.equal(h.calls.filter((call) => call.method === "lookup").length, 3);
});

for (const ownedTable of tables) {
  test(`missing other tables cannot bypass ${ownedTable} anonymous record protection`, async () => {
    const h = fixture((table) => table === ownedTable ? { count: 1 } : missingTable(table));
    await h.service.startLogin("https://preview.invalid/");
    assert.equal(h.calls.at(-1).method, "linkIdentity");
    assert.equal(h.calls.some((call) => call.method === "signInWithOAuth"), false);
    assert.equal(h.posts.length, 0);
  });
}

const unsafeResults = [
  ["permission denied", { status: 403, error: { code: "42501", message: "permission denied for table info_reports" } }],
  ["unauthorized", { status: 401, error: { code: "PGRST301", message: "invalid JWT" } }],
  ["network failure", { status: 0, error: { code: "", message: "TypeError: Failed to fetch" } }],
  ["generic 404", { status: 404, error: { code: "", message: "Not Found" } }],
  ["missing column", { status: 400, error: { code: "42703", message: "column user_id does not exist" } }],
  ["wrong missing relation", missingTable("some_other_table", "42P01")],
  ["wrong missing table", missingTable("some_other_table")],
  ["missing-table text without trusted code", { status: 404, error: { code: "", message: missingTable("info_reports").error.message } }],
  ["missing-table code with wrong status", { ...missingTable("info_reports"), status: 403 }],
  ["missing-table code without message", { status: 404, error: { code: "PGRST205" } }],
  ["unknown count", { count: null }],
];

for (const [name, result] of unsafeResults) {
  test(`${name} remains protected even if earlier tables are missing`, async () => {
    const h = fixture((table) => table === "info_reports" ? result : missingTable(table));
    await h.service.startLogin("https://preview.invalid/");
    assert.equal(h.calls.at(-1).method, "linkIdentity");
    assert.equal(h.calls.some((call) => call.method === "signInWithOAuth"), false);
  });
}

test("thrown network errors preserve the anonymous identity", async () => {
  const h = fixture(() => { throw new Error("network disconnected"); });
  await h.service.startLogin("https://preview.invalid/");
  assert.equal(h.calls.at(-1).method, "linkIdentity");
});

test("existing Kakao identity conflict never falls back, merges, or deletes records", async () => {
  const contributions = { menu_reviews: 1, menu_taste_votes: 1, info_reports: 1 };
  const before = { ...contributions };
  const h = fixture((table) => ({ count: contributions[table] }), {
    code: "identity_already_exists", message: "already linked to a different account",
  });
  const existingPost = { id: "existing-post", author_id: kakao.id, title: "Existing", body: "Keep me" };
  h.posts.push(existingPost);
  await assert.rejects(h.service.startLogin("https://preview.invalid/"), /기존 기록을 보호/);
  assert.equal((await h.service.currentUser()).id, "anonymous-1");
  assert.deepEqual(contributions, before);
  assert.deepEqual(h.posts, [existingPost]);
  assert.equal(h.calls.filter((call) => call.method === "linkIdentity").length, 1);
  assert.equal(h.calls.some((call) => ["signInWithOAuth", "signOut", "insert", "delete"].includes(call.method)), false);
});
