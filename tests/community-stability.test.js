const assert = require("node:assert/strict");
const test = require("node:test");
const { createController, createService, completeOAuthReturn } = require("../community-mvp");

const kakao = { id: "owner", is_anonymous: false, identities: [{ provider: "kakao" }] };
const anonymous = { id: "anon", is_anonymous: true };
const tables = ["menu_reviews", "menu_taste_votes", "info_reports"];
const posts = [1, 2].map((index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  author_id: "owner", title: `post ${index}`, body: `body ${index}`, created_at: "2026-10-25T00:00:00Z",
}));
const settle = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(t, options = {}) {
  const previous = { document: global.document, window: global.window };
  t.after(() => { global.document = previous.document; global.window = previous.window; });
  function element() {
    return {
      textContent: "", hidden: false, disabled: false, open: false, children: [], handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      reset() {}, focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close?.(); },
    };
  }
  const names = ["back", "authStatus", "login", "logout", "message", "form", "titleInput", "bodyInput", "list", "empty", "listSection", "detail", "detailTitle", "detailBody", "detailDate", "deleteButton", "deleteDialog", "cancelDelete", "confirmDelete"];
  const elements = Object.fromEntries(names.map((name) => [name, element()]));
  const events = { navigations: [], starts: [], ownership: [], deletes: [], users: [], window: {} };
  let user = options.user === undefined ? kakao : options.user;
  let authListener;
  global.document = { createElement: element };
  global.window = {
    location: { pathname: "/", origin: "https://preview.invalid", assign(url) { events.navigations.push(url); } },
    addEventListener(type, listener) { events.window[type] = listener; },
  };
  async function oauth(method, input) {
    events.starts.push({ method, input });
    if (options.oauthGate) await options.oauthGate.promise;
    if (options.oauthError) return { error: options.oauthError };
    window.location.assign("https://provider.invalid/authorize");
    return { data: { url: "https://provider.invalid/authorize" } };
  }
  const client = {
    auth: {
      getUser: options.getUser || (async () => ({ data: { user } })),
      onAuthStateChange(listener) { authListener = listener; },
      signInWithOAuth(input) { return oauth("signInWithOAuth", input); },
      linkIdentity(input) { return oauth("linkIdentity", input); },
      async signOut() { user = null; authListener("SIGNED_OUT", null); return {}; },
      async signInAnonymously() { user = anonymous; authListener("SIGNED_IN", { user }); return {}; },
    },
    from(table) {
      let id;
      let head = false;
      let deleting = false;
      return {
        select(fields, options) { head = Boolean(options?.head); return this; },
        order() { return this; },
        eq(key, value) { if (key === "id") id = value; if (head) events.ownership.push({ table, key, value }); return this; },
        async limit() { return { data: posts }; },
        delete() { deleting = true; return this; },
        async single() {
          if (deleting) {
            events.deletes.push(id);
            return options.onDelete ? options.onDelete(id) : { data: { id } };
          }
          return { data: posts.find((post) => post.id === id) };
        },
        then(resolve, reject) {
          const result = options.countResult?.(table) || { count: 0 };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
    },
  };
  const controller = createController(client, elements, () => {}, (nextUser) => events.users.push(nextUser?.id || null));
  controller.mount();
  return {
    client, controller, elements, events,
    emit(event, nextUser) { user = nextUser; authListener(event, nextUser ? { user: nextUser } : null); },
    async show(index = 0) {
      if (!elements.list.children.length) await controller.open();
      const row = elements.list.children.find((node) => node.children[0].textContent === posts[index].title);
      await row.handlers.click();
    },
    async beginDelete(index = 0) {
      await this.show(index);
      elements.deleteButton.handlers.click();
      const request = elements.confirmDelete.handlers.click();
      await settle();
      return { request };
    },
  };
}

for (const link of [false, true]) {
  test(`${link ? "identity linking" : "OAuth login"} navigates once and remains locked until browser return`, async (t) => {
    const h = harness(t, { user: link ? anonymous : null, countResult: () => ({ count: link ? 1 : 0 }) });
    await settle();
    await h.elements.login.handlers.click();
    await h.elements.login.handlers.click();
    assert.equal(h.events.navigations.length, 1);
    assert.equal(h.events.starts.length, 1);
    assert.equal(h.events.starts[0].method, link ? "linkIdentity" : "signInWithOAuth");
    assert.equal(h.events.starts[0].input.provider, "kakao");
    assert.equal(h.events.starts[0].input.options.redirectTo, "https://preview.invalid/?communityAuth=1");
    assert.equal(h.elements.login.disabled, true);
    h.events.window.pageshow();
    assert.equal(h.elements.login.disabled, false);
  });
}

test("rapid login clicks start only one OAuth request", async (t) => {
  const gate = deferred();
  const h = harness(t, { user: null, oauthGate: gate });
  await settle();
  const first = h.elements.login.handlers.click();
  const second = h.elements.login.handlers.click();
  await settle();
  assert.equal(h.events.starts.length, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(h.events.navigations.length, 1);
});

test("OAuth failure does not navigate and releases the login lock", async (t) => {
  const h = harness(t, { user: null, oauthError: new Error("provider unavailable") });
  await settle();
  await h.elements.login.handlers.click();
  assert.equal(h.events.navigations.length, 0);
  assert.equal(h.elements.login.disabled, false);
  assert.match(h.elements.message.textContent, /기존 기록/);
  await h.elements.login.handlers.click();
  assert.equal(h.events.starts.length, 2);
});

for (const owned of tables) {
  test(`anonymous ${owned}-only ownership uses identity linking`, async (t) => {
    const h = harness(t, { user: anonymous, countResult: (table) => ({ count: table === owned ? 1 : 0 }) });
    await createService(h.client).startLogin("https://preview.invalid/");
    assert.equal(h.events.starts[0].method, "linkIdentity");
    assert.ok(h.events.ownership.every(({ key, value }) => key === "user_id" && value === anonymous.id));
    assert.equal(h.events.deletes.length, 0);
  });
}

test("all three tables must confirm zero owned rows before ordinary OAuth", async (t) => {
  const h = harness(t, { user: anonymous });
  await createService(h.client).startLogin("https://preview.invalid/");
  assert.deepEqual(h.events.ownership.map(({ table }) => table), tables);
  assert.equal(h.events.starts[0].method, "signInWithOAuth");
  assert.ok(h.events.ownership.every(({ value }) => value !== null && value !== "other-user"));
});

test("reports without a UID or owned by another user do not count as this anonymous user's data", async (t) => {
  const h = harness(t, { user: anonymous });
  const filters = [];
  h.client.from = (table) => ({
    select() { return this; },
    async eq(key, value) {
      filters.push({ table, key, value });
      const rows = table === "info_reports" ? [{ user_id: null }, { user_id: "other-user" }] : [];
      return { count: rows.filter((row) => row[key] === value).length };
    },
  });
  await createService(h.client).startLogin("https://preview.invalid/");
  assert.equal(h.events.starts[0].method, "signInWithOAuth");
  assert.deepEqual(filters.map(({ value }) => value), [anonymous.id, anonymous.id, anonymous.id]);
});

for (const failed of tables) {
  test(`failed ownership lookup in ${failed} cannot fall back to ordinary OAuth`, async (t) => {
    const h = harness(t, { user: anonymous, countResult: (table) => table === failed ? { error: new Error("denied") } : { count: 0 }, oauthError: new Error("link failed") });
    await assert.rejects(createService(h.client).startLogin("https://preview.invalid/"), /link failed/);
    assert.equal(h.events.starts.length, 1);
    assert.equal(h.events.starts[0].method, "linkIdentity");
    assert.equal(h.events.navigations.length, 0);
  });
}

test("unknown ownership count preserves the anonymous account", async (t) => {
  const h = harness(t, { user: anonymous, countResult: () => ({ count: null }) });
  await createService(h.client).startLogin("https://preview.invalid/");
  assert.equal(h.events.starts[0].method, "linkIdentity");
});

test("identity conflict is explained without a fallback login or data writes", async (t) => {
  const h = harness(t, { user: anonymous, countResult: () => ({ count: 1 }), oauthError: { code: "identity_already_exists", message: "internal detail" } });
  await settle();
  await h.elements.login.handlers.click();
  assert.match(h.elements.message.textContent, /다른 계정에 연결/);
  assert.equal(h.events.starts[0].method, "linkIdentity");
  assert.equal(h.events.starts.length, 1);
  assert.equal(h.events.navigations.length, 0);
  assert.equal(h.events.deletes.length, 0);
});

for (const location of ["?communityAuth=1&error=access_denied&error_code=identity_already_exists", "?communityAuth=1#error=access_denied&error_code=identity_already_exists"]) {
  test(`OAuth identity conflict on return is safe in ${location.includes("#") ? "fragment" : "query"}`, async () => {
    let exchanged = 0;
    let cleaned;
    const result = await completeOAuthReturn({ exchangeCodeForSession() { exchanged += 1; } }, `https://preview.invalid/${location}`, (url) => { cleaned = url; });
    assert.equal(exchanged, 0);
    assert.match(result.message, /다른 계정에 연결/);
    assert.doesNotMatch(cleaned, /error|communityAuth/);
  });
}

test("late getUser lookup cannot undo a newer sign-out or sign-in event", async (t) => {
  const gate = deferred();
  const h = harness(t, { getUser: () => gate.promise });
  h.emit("SIGNED_OUT", null);
  assert.equal(h.events.users.at(-1), null);
  h.emit("SIGNED_IN", { ...kakao, id: "new-owner" });
  gate.resolve({ data: { user: kakao } });
  await settle();
  assert.equal(h.events.users.at(-1), "new-owner");
});

test("normal deletion removes the acknowledged post", async (t) => {
  const h = harness(t);
  const { request } = await h.beginDelete();
  await request;
  assert.deepEqual(h.events.deletes, [posts[0].id]);
  assert.equal(h.elements.list.children.length, 1);
  assert.equal(h.elements.detail.hidden, true);
  assert.equal(h.elements.deleteDialog.open, false);
  assert.equal(h.elements.message.textContent, "");
});

for (const navigation of ["cancel", "escape", "back", "other-post"]) {
  test(`deletion succeeds after ${navigation} without depending on selected`, async (t) => {
    const gate = deferred();
    const h = harness(t, { onDelete: () => gate.promise });
    const { request } = await h.beginDelete();
    if (navigation === "escape") {
      h.elements.deleteDialog.handlers.cancel();
      h.elements.deleteDialog.close();
    } else {
      h.elements.cancelDelete.handlers.click();
    }
    if (navigation === "back" || navigation === "other-post") h.elements.back.handlers.click();
    if (navigation === "other-post") {
      await h.show(1);
      h.elements.deleteButton.handlers.click();
    }
    gate.resolve({ data: { id: posts[0].id } });
    await request;
    assert.equal(h.elements.message.textContent, "");
    assert.equal(h.elements.list.children.length, 1);
    if (navigation === "other-post") {
      assert.equal(h.elements.detailTitle.textContent, posts[1].title);
      assert.equal(h.elements.detail.hidden, false);
      assert.equal(h.elements.deleteDialog.open, true);
    }
  });
}

test("repeated delete confirmation sends one request", async (t) => {
  const gate = deferred();
  const h = harness(t, { onDelete: () => gate.promise });
  const { request } = await h.beginDelete();
  await h.elements.confirmDelete.handlers.click();
  assert.equal(h.events.deletes.length, 1);
  gate.resolve({ data: { id: posts[0].id } });
  await request;
});

for (const result of [{ error: { message: "RLS internals" } }, { data: null }]) {
  test(`unconfirmed deletion keeps the post and permits retry (${result.error ? "server error" : "no row"})`, async (t) => {
    const h = harness(t, { onDelete: async () => result });
    const { request } = await h.beginDelete();
    await request;
    assert.equal(h.elements.list.children.length, 2);
    assert.equal(h.elements.detail.hidden, false);
    assert.equal(h.elements.confirmDelete.disabled, false);
    assert.match(h.elements.message.textContent, /삭제/);
    assert.doesNotMatch(h.elements.message.textContent, /RLS internals/);
  });
}

test("another author cannot start a delete from UI or service", async (t) => {
  const h = harness(t, { user: { ...kakao, id: "other-owner" } });
  await h.show();
  assert.equal(h.elements.deleteButton.hidden, true);
  h.elements.deleteButton.handlers.click();
  await h.elements.confirmDelete.handlers.click();
  await assert.rejects(createService(h.client).remove(posts[0]), /본인이/);
  assert.equal(h.events.deletes.length, 0);
});
