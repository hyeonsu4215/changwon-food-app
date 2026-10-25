const assert = require("node:assert/strict");
const test = require("node:test");
const { isKakaoUser, validatePost, canDelete, completeOAuthReturn, createService, createController } = require("../community-mvp");

const kakao = { id: "owner", is_anonymous: false, identities: [{ provider: "kakao" }] };
const anonymous = { id: "anon", is_anonymous: true, app_metadata: { providers: ["kakao"] } };

function clientFor(user = kakao) {
  const calls = [];
  const rows = [{ id: "00000000-0000-4000-8000-000000000001", author_id: "owner", title: "제목", body: "본문", created_at: "2026-10-25T00:00:00Z" }];
  const query = {
    select(...args) { calls.push(["select", ...args]); return this; },
    order(...args) { calls.push(["order", ...args]); return this; },
    limit(...args) { calls.push(["limit", ...args]); return Promise.resolve({ data: rows }); },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    single() { calls.push(["single"]); return Promise.resolve({ data: rows[0] }); },
    insert(value) { calls.push(["insert", value]); return this; },
    delete() { calls.push(["delete"]); return this; },
  };
  return {
    calls,
    auth: {
      async getUser() { return { data: { user } }; },
      async linkIdentity(value) { calls.push(["linkIdentity", value]); return { data: { url: "https://test.example/oauth" } }; },
      async signInWithOAuth(value) { calls.push(["signInWithOAuth", value]); return { data: { url: "https://test.example/oauth" } }; },
      async signOut() { calls.push(["signOut"]); return {}; },
      async signInAnonymously() { calls.push(["signInAnonymously"]); return {}; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table) { calls.push(["from", table]); return query; },
  };
}

test("only verified non-anonymous Kakao identity can author", () => {
  assert.equal(isKakaoUser(kakao), true);
  assert.equal(isKakaoUser(anonymous), false);
  assert.equal(isKakaoUser({ id: "other", is_anonymous: false, identities: [{ provider: "google" }] }), false);
  assert.equal(canDelete(kakao, { author_id: "owner" }), true);
  assert.equal(canDelete(kakao, { author_id: "someone-else" }), false);
});

test("OAuth starts by linking an anonymous identity and does not silently merge on failure", async () => {
  const client = clientFor(anonymous);
  client.from = () => ({ select() { return this; }, eq() { return this; }, async limit() { return { count: 1 }; } });
  const url = await createService(client).startLogin("https://preview.example/?communityAuth=1");
  assert.equal(url, "https://test.example/oauth");
  assert.equal(client.calls[0][0], "linkIdentity");
  assert.equal(client.calls[0][1].provider, "kakao");
  assert.equal(client.calls.some(([name]) => name === "signInWithOAuth"), false);
  client.auth.linkIdentity = async () => ({ error: new Error("linking disabled") });
  await assert.rejects(createService(client).startLogin("https://preview.example/"), /linking disabled/);
  assert.equal(client.calls.some(([name]) => name === "signInWithOAuth"), false);
});

test("an anonymous session without remote reviews, taste votes, or reports can sign in to an existing Kakao account", async () => {
  const client = clientFor(anonymous);
  const checked = [];
  client.from = (table) => {
    checked.push(table);
    return { select() { return this; }, eq() { return this; }, async limit() { return { count: 0 }; } };
  };
  await createService(client).startLogin("https://preview.example/");
  assert.deepEqual(checked, ["menu_reviews", "menu_taste_votes", "info_reports"]);
  assert.equal(client.calls.some(([name]) => name === "signInWithOAuth"), true);
  assert.equal(client.calls.some(([name]) => name === "linkIdentity"), false);
});

test("uncertain anonymous contribution lookup preserves the account by requiring identity linking", async () => {
  const client = clientFor(anonymous);
  client.from = () => ({ select() { return this; }, eq() { return this; }, async limit() { return { error: new Error("offline") }; } });
  await createService(client).startLogin("https://preview.example/");
  assert.equal(client.calls.some(([name]) => name === "linkIdentity"), true);
});

test("OAuth starts normally without an anonymous account, then logout restores anonymous auth", async () => {
  const unsigned = clientFor(null);
  unsigned.auth.getUser = async () => ({ error: { name: "AuthSessionMissingError" } });
  await createService(unsigned).startLogin("https://preview.example/");
  assert.equal(unsigned.calls[0][0], "signInWithOAuth");
  const signed = clientFor(kakao);
  await createService(signed).logout();
  assert.deepEqual(signed.calls.map(([name]) => name), ["signOut", "signInAnonymously"]);
});

test("OAuth return exchanges the code before clearing URL and reports cancellation", async () => {
  const events = [];
  const auth = { async exchangeCodeForSession(code) { events.push(["exchange", code]); return { data: { session: { access_token: "test" } } }; } };
  const result = await completeOAuthReturn(auth, "https://preview.example/?communityAuth=1&code=code123", (url) => events.push(["replace", url]));
  assert.deepEqual(result, { handled: true, error: "" });
  assert.equal(events[0][0], "exchange");
  assert.equal(events[1][0], "replace");
  assert.equal(events[1][1].includes("code="), false);
  const cancelled = await completeOAuthReturn(auth, "https://preview.example/?communityAuth=1", () => {});
  assert.match(cancelled.error, /완료되지/);
});

test("OAuth return reports exchange failure without creating a fake login", async () => {
  const auth = { async exchangeCodeForSession() { return { error: new Error("invalid code") }; } };
  const result = await completeOAuthReturn(auth, "https://preview.example/?communityAuth=1&code=bad", () => {});
  assert.equal(result.error, "invalid code");
});

test("community list, detail, input validation, insert and owner-only delete", async () => {
  const client = clientFor(kakao);
  const service = createService(client);
  assert.equal((await service.list()).length, 1);
  assert.equal((await service.detail("00000000-0000-4000-8000-000000000001")).title, "제목");
  await assert.rejects(service.detail("invalid"), /잘못된/);
  assert.equal(validatePost(" ", "body").error.includes("제목"), true);
  assert.equal(validatePost("title", " ").error.includes("본문"), true);
  assert.equal(validatePost("a".repeat(81), "body").error.includes("제목"), true);
  await service.create("  title  ", "  body  ");
  assert.deepEqual(client.calls.find(([name]) => name === "insert")[1], { title: "title", body: "body" });
  await service.remove({ id: "00000000-0000-4000-8000-000000000001", author_id: "owner" });
  assert.equal(client.calls.some(([name, key, value]) => name === "eq" && key === "author_id" && value === "owner"), true);
  await assert.rejects(service.remove({ id: "other", author_id: "other" }), /본인이/);
});

test("anonymous writes and deletes are blocked before network access", async () => {
  const client = clientFor(anonymous);
  const service = createService(client);
  await assert.rejects(service.create("title", "body"), /카카오 로그인/);
  await assert.rejects(service.remove({ id: "x", author_id: "anon" }), /본인이/);
  assert.equal(client.calls.some(([name]) => name === "from"), false);
});

test("post text is assigned as textContent, not HTML", async () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "community-mvp.js"), "utf8");
  for (const fragment of ["title.textContent = post.title", "elements.detailTitle.textContent = selected.title", "elements.detailBody.textContent = selected.body"]) {
    assert.ok(source.includes(fragment));
  }
  assert.equal(source.includes("innerHTML"), false);
});

test("list and detail render untrusted titles and body as text nodes", async () => {
  const originalDocument = global.document;
  function element() {
    return {
      textContent: "", hidden: false, children: [], handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      reset() {}, showModal() {}, close() {},
    };
  }
  const ids = ["back", "authStatus", "login", "logout", "message", "form", "titleInput", "bodyInput", "list", "empty", "listSection", "detail", "detailTitle", "detailBody", "detailDate", "deleteButton", "deleteDialog", "cancelDelete", "confirmDelete"];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  const client = clientFor(kakao);
  client.from = () => ({
    select() { return this; }, order() { return this; },
    limit: async () => ({ data: [{ id: "00000000-0000-4000-8000-000000000001", author_id: "owner", title: "<img src=x>", body: "<script>alert(1)</script>", created_at: "2026-10-25T00:00:00Z" }] }),
    eq() { return this; },
    single: async () => ({ data: { id: "00000000-0000-4000-8000-000000000001", author_id: "owner", title: "<img src=x>", body: "<script>alert(1)</script>", created_at: "2026-10-25T00:00:00Z" } }),
  });
  try {
    global.document = { createElement: element };
    const controller = createController(client, elements, () => {});
    controller.mount();
    await controller.open();
    assert.equal(elements.list.children[0].children[0].textContent, "<img src=x>");
    await elements.list.children[0].handlers.click();
    assert.equal(elements.detailTitle.textContent, "<img src=x>");
    assert.equal(elements.detailBody.textContent, "<script>alert(1)</script>");
  } finally {
    global.document = originalDocument;
  }
});
