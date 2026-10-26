const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { PROJECT, BASE, allowed, marker, parseCode, createRunner, mount } = require("../tools/preview-rls/rls-check");
const { previewConfig } = require("../api/preview-rls-config");

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const A = { id: id(1), token: "mock-a-token", anonymous: false, kakao: true };
const B = { id: id(2), token: "mock-b-token", anonymous: false, kakao: true };
const ANONYMOUS = { id: id(3), token: "mock-anonymous-token", anonymous: true, kakao: false };
const config = { enabled: true, project: PROJECT, url: BASE, publishableKey: "sb_publishable_mock" };
const hostname = "kakao-community-preview.vercel.app";
const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/kakao-community-mvp", MUKJJI_TEST_SUPABASE_URL: BASE, MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY: config.publishableKey };

function harness(options = {}) {
  const existing = [A, B].map((actor, index) => ({
    id: id(10 + index), author_id: actor.id, title: `Existing user post ${index}`,
    body: "Never modify this", created_at: "2026-10-25T00:00:00Z", updated_at: "2026-10-25T00:00:00Z",
  }));
  const original = structuredClone(existing);
  const rows = new Map(existing.map((row) => [row.id, row]));
  const calls = [];
  let sequence = 100, rowSequence = 200, anonymousStarts = 0;
  const response = (status, data, count) => ({ ok: status >= 200 && status < 300, status,
    json: async () => structuredClone(data), headers: { get: (name) => name === "content-range" && count !== undefined ? `0-0/${count}` : null } });
  const deny = () => response(403, { code: "42501", message: "permission denied" });
  const fetchImpl = async (raw, request) => {
    const url = new URL(raw);
    assert.equal(url.origin, BASE);
    assert.equal(url.pathname, "/rest/v1/community_posts");
    assert.equal(request.headers.apikey, config.publishableKey);
    const actor = [A, B, ANONYMOUS].find((value) => request.headers.Authorization === `Bearer ${value.token}`);
    const query = Object.fromEntries(url.searchParams);
    calls.push({ method: request.method, query, actor: actor?.id || null, body: request.body && JSON.parse(request.body) });
    if (options.failRequest?.(request.method)) throw new Error("offline mock");
    const found = [...rows.values()].filter((row) => Object.entries(query).every(([key, value]) => !value.startsWith("eq.") || row[key] === value.slice(3)));
    if (request.method === "GET") {
      const offset = Number(query.offset || 0), limit = Number(query.limit || 1000);
      return response(200, found.sort((a, b) => a.id.localeCompare(b.id)).slice(offset, offset + limit), found.length);
    }
    if (request.method === "POST") {
      if (options.postError) return response(options.postError.status, { code: options.postError.code });
      const payload = JSON.parse(request.body);
      if (!actor || (actor.anonymous && !options.allowAnonymousWrite)) return deny();
      if (payload.author_id && !options.allowSpoofWrite) return deny();
      const row = { id: id(rowSequence++), author_id: payload.author_id || actor.id, ...payload,
        created_at: "2026-10-26T00:00:00Z", updated_at: "2026-10-26T00:00:00Z" };
      rows.set(row.id, row);
      return response(201, [row]);
    }
    assert.equal(request.method, "DELETE");
    assert.deepEqual(Object.keys(query).sort(), ["id", "select"]);
    const deleted = found.filter((row) => actor && (row.author_id === actor.id || options.allowForeignDelete));
    for (const row of deleted) rows.delete(row.id);
    return response(200, deleted.map((row) => ({ id: row.id })));
  };
  function runner(actor = A) {
    return createRunner({ config, hostname, fetchImpl, getActor: async () => actor,
      createAnonymous: async () => { anonymousStarts++; return ANONYMOUS; }, uuid: () => id(sequence++) });
  }
  return { runner, rows, original, calls, anonymousStarts: () => anonymousStarts,
    assertPreserved() { for (const row of original) assert.deepEqual(rows.get(row.id), row); } };
}

test("Preview config allows only the exact test project and feature branch", () => {
  assert.equal(previewConfig(env).url, BASE);
  for (const override of [
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: undefined },
    { VERCEL_GIT_COMMIT_REF: "main" }, { VERCEL_GIT_COMMIT_REF: undefined },
    { MUKJJI_TEST_SUPABASE_URL: "https://poxvxxwtrblkjfrqqnrw.supabase.co" },
    { MUKJJI_TEST_SUPABASE_URL: "https://other.supabase.co" },
    { MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY: "sb_secret_mock" },
    { MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY: undefined },
  ]) assert.equal(previewConfig({ ...env, ...override }), null);
  assert.deepEqual(Object.keys(previewConfig(env)).sort(), ["enabled", "project", "publishableKey", "url"]);
});

test("browser guard rejects Production, localhost, unsafe keys, and mismatched projects", () => {
  assert.equal(allowed(config, hostname), true);
  for (const host of ["changwon-food-app.vercel.app", "localhost", "127.0.0.1", "evil.example"]) {
    assert.equal(allowed(config, host), false);
    assert.throws(() => createRunner({ config, hostname: host }), /Preview/);
  }
  for (const override of [{ url: "https://poxvxxwtrblkjfrqqnrw.supabase.co" }, { project: "other" }, { publishableKey: "sb_secret_mock" }, { enabled: false }]) {
    assert.equal(allowed({ ...config, ...override }, hostname), false);
  }
});

test("failed environment gate never loads SDK, reads sessions, or calls Supabase", async () => {
  for (const host of ["changwon-food-app.vercel.app", "localhost", hostname]) {
    const elements = new Map(); let fetches = 0;
    const win = { location: { hostname: host }, document: { getElementById(key) {
      if (!elements.has(key)) elements.set(key, { hidden: true, textContent: "" }); return elements.get(key);
    } }, fetch: async () => { fetches++; return { ok: false }; },
      supabase: { createClient() { throw new Error("Must not initialize"); } } };
    await mount(win);
    assert.equal(elements.get("tool").hidden, true);
    assert.equal(fetches, host === hostname ? 1 : 0);
  }
});

test("all six checks use normal user rights, preserve existing rows, and clean the main test post", async () => {
  const h = harness(), a = h.runner(A), b = h.runner(B);
  assert.equal(h.calls.length, 0);
  assert.equal((await a.create()).status, "PASS");
  assert.equal(a.state().baselineCount, 2);
  assert.equal(h.rows.size, 3);
  const code = a.exportCode();
  assert.doesNotMatch(code, /token|publishable|apikey|Authorization|mock-a/);
  b.importCode(code);
  assert.equal((await b.other(true)).status, "PASS");
  assert.equal(h.rows.size, 3);
  a.importCode(b.exportCode());
  assert.equal((await a.forge()).status, "PASS");
  assert.equal((await a.public()).status, "PASS");
  assert.equal((await a.anonymous(true)).status, "PASS");
  assert.equal(h.anonymousStarts(), 1);
  assert.equal((await a.own(true)).status, "PASS");
  assert.equal(a.state().artifacts.length, 0);
  assert.equal(h.rows.size, 2);
  assert.equal((await a.verify()).status, "PASS");
  h.assertPreserved();
  const posts = h.calls.filter((call) => call.method === "POST");
  assert.equal(posts[0].actor, A.id);
  assert.equal(posts[1].body.author_id, B.id);
  assert.equal(posts[2].actor, null);
  assert.equal(posts[3].actor, ANONYMOUS.id);
});

test("ordinary posts and altered markers can never become deletion targets", async () => {
  const h = harness(), a = h.runner(); await a.create();
  const code = JSON.parse(a.exportCode());
  code.main.id = h.original[0].id;
  const b = h.runner(B); b.importCode(JSON.stringify(code));
  const before = h.calls.filter((call) => call.method === "DELETE").length;
  assert.equal((await b.other(true)).status, "BLOCKED");
  assert.equal(h.calls.filter((call) => call.method === "DELETE").length, before);
  code.main.title = h.original[0].title;
  assert.throws(() => parseCode(JSON.stringify(code)), /검증용/);
  h.assertPreserved();
});

test("both deletion checks require explicit confirmation before any DELETE", async () => {
  const h = harness(), a = h.runner(); await a.create();
  const b = h.runner(B); b.importCode(a.exportCode());
  assert.equal((await b.other(false)).status, "BLOCKED");
  assert.equal((await a.own(false)).status, "BLOCKED");
  assert.equal(h.calls.some((call) => call.method === "DELETE"), false);
  assert.equal(h.rows.size, 3);
});

test("B cannot run the owner cleanup and A cannot pretend to be B", async () => {
  const h = harness(), a = h.runner(); await a.create();
  const b = h.runner(B); b.importCode(a.exportCode());
  assert.equal((await b.own(true)).status, "BLOCKED");
  assert.equal((await a.other(true)).status, "BLOCKED");
  assert.equal(h.calls.some((call) => call.method === "DELETE"), false);
});

test("bad DELETE RLS is FAIL based on actual read-back, never a false PASS", async () => {
  const h = harness({ allowForeignDelete: true }), a = h.runner(); await a.create();
  const b = h.runner(B); b.importCode(a.exportCode());
  assert.equal((await b.other(true)).status, "FAIL");
  assert.equal(h.rows.size, 2);
  h.assertPreserved();
});

for (const error of [{ status: 404, code: "PGRST205" }, { status: 401, code: "PGRST301" }, { status: 500, code: "XX000" }]) {
  test(`unexpected API error ${error.code} is inconclusive, not a permission PASS`, async () => {
    const h = harness(), a = h.runner(); await a.create();
    // Switch only the POST response after the authorized setup row exists.
    const run = createRunner({ config, hostname,
      fetchImpl: async (url, request) => request.method === "POST"
        ? { ok: false, status: error.status, json: async () => ({ code: error.code }), headers: { get: () => null } }
        : { ok: true, status: 200, json: async () => url.includes("title=") ? [] : [...h.rows.values()].filter((row) => row.id === a.state().main.id), headers: { get: () => "0-0/1" } },
      getActor: async () => A, uuid: () => id(999), createAnonymous: async () => ANONYMOUS });
    run.importCode(a.exportCode());
    assert.equal((await run.public()).status, "BLOCKED");
  });
}

test("network failures are inconclusive and never permit another write automatically", async () => {
  const h = harness({ failRequest: (method) => method === "POST" }), a = h.runner();
  assert.equal((await a.create()).status, "BLOCKED");
  assert.equal(a.state().pendingCount, 1);
  assert.equal((await a.create()).status, "BLOCKED");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal((await a.verify()).status, "BLOCKED");
  assert.equal(a.state().pendingCount, 1);
  h.assertPreserved();
});

test("no authenticated Kakao actor means no post lookup or write", async () => {
  for (const actor of [null, ANONYMOUS, { ...A, kakao: false }, { ...A, token: null }]) {
    let requests = 0;
    const runner = createRunner({ config, hostname, fetchImpl: async () => { requests++; throw new Error("Must not request"); },
      getActor: async () => actor, createAnonymous: async () => ANONYMOUS, uuid: () => id(999) });
    assert.equal((await runner.create()).status, "BLOCKED");
    assert.equal(requests, 0);
  }
});

test("failed baseline read or missing total count prevents setup writes", async () => {
  for (const mode of ["denied", "unknown-count"]) {
    const methods = [];
    const runner = createRunner({ config, hostname, getActor: async () => A, createAnonymous: async () => ANONYMOUS, uuid: () => id(999),
      fetchImpl: async (url, request) => { methods.push(request.method); return {
        ok: mode !== "denied", status: mode === "denied" ? 403 : 200,
        json: async () => [], headers: { get: () => null },
      }; } });
    assert.equal((await runner.create()).status, "BLOCKED");
    assert.deepEqual(methods, ["GET"]);
  }
});

test("an acknowledged insert hidden from public read-back stays unresolved, never clean", async () => {
  let writes = 0;
  const runner = createRunner({ config, hostname, getActor: async () => A, uuid: () => id(999), createAnonymous: async () => ANONYMOUS,
    fetchImpl: async (url, request) => ({
      ok: true, status: request.method === "POST" ? 201 : 200,
      json: async () => {
        if (request.method !== "POST") return [];
        writes++;
        return [{ ...JSON.parse(request.body), id: id(500), author_id: A.id }];
      }, headers: { get: () => "*/0" },
    }) });
  assert.equal((await runner.create()).status, "FAIL");
  assert.equal(writes, 1);
  assert.equal(runner.state().pendingCount, 1);
  assert.equal((await runner.verify()).status, "BLOCKED");
});

test("anonymous RLS failure is tracked and only the matching owner may confirm cleanup", async () => {
  const h = harness({ allowAnonymousWrite: true }), a = h.runner(); await a.create();
  assert.equal((await a.anonymous(true)).status, "FAIL");
  assert.equal(a.state().artifacts.length, 2);
  assert.equal((await a.public()).status, "BLOCKED");
  const extra = a.state().artifacts.find((row) => row.authorId === ANONYMOUS.id);
  assert.equal((await a.cleanup(extra.id, true)).status, "BLOCKED");
  h.assertPreserved();
});

test("spoofed-author failure can be exported for B's explicit owner cleanup", async () => {
  const h = harness({ allowSpoofWrite: true }), a = h.runner(), b = h.runner(B);
  await a.create(); b.importCode(a.exportCode()); await b.other(true); a.importCode(b.exportCode());
  assert.equal((await a.forge()).status, "FAIL");
  const extra = a.state().artifacts.find((row) => row.authorId === B.id);
  b.importCode(a.exportCode());
  assert.equal((await b.cleanup(extra.id, false)).status, "BLOCKED");
  assert.equal((await b.cleanup(extra.id, true)).status, "PASS");
  h.assertPreserved();
});

test("duplicate clicks cannot create duplicate temporary rows", async () => {
  const h = harness(), a = h.runner();
  const first = a.create();
  assert.equal((await a.create()).status, "BLOCKED");
  assert.equal((await first).status, "PASS");
  assert.equal((await a.create()).status, "BLOCKED");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("import cannot change the target project, add credentials, or replace an active run", async () => {
  const h = harness(), a = h.runner(); await a.create();
  const value = JSON.parse(a.exportCode());
  assert.throws(() => parseCode(JSON.stringify({ ...value, project: "poxvxxwtrblkjfrqqnrw" })), /프로젝트/);
  assert.equal(parseCode(JSON.stringify({ ...value, token: "never-export-me" })).token, undefined);
  const replacement = { ...value.main, runId: id(999), ...marker(id(999)) };
  assert.throws(() => a.importCode(JSON.stringify({ ...value, main: replacement })), /다른 코드/);
});

test("temporary tool has no app entry, Service Worker cache, password, token input, or unsafe HTML rendering", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "tools/preview-rls/index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "tools/preview-rls/rls-check.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.doesNotMatch(app, /preview-rls/);
  assert.doesNotMatch(sw, /preview-rls/);
  assert.doesNotMatch(js, /innerHTML|console\.|localStorage\.(?:clear|removeItem|setItem)|\.rpc\(|PATCH/);
  assert.doesNotMatch(html, /type="password"|name="token"/);
  assert.match(html, /<dialog/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});
