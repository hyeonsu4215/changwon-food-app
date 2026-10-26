(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.MukjjiRlsCheck = api;
    root.document.addEventListener("DOMContentLoaded", () => api.mount(root));
  }
})(typeof window === "undefined" ? null : window, function () {
  const PROJECT = "ocqffcambljzhymlfwmh";
  const BASE = `https://${PROJECT}.supabase.co`;
  const TABLE = `${BASE}/rest/v1/community_posts`;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FIELDS = "id,author_id,title,body,created_at,updated_at";
  const result = (status, message) => ({ status, message });
  class CheckError extends Error {}

  function allowed(config, hostname) {
    return Boolean(config?.enabled === true && config.project === PROJECT && config.url === BASE &&
      typeof config.publishableKey === "string" && config.publishableKey.startsWith("sb_publishable_") &&
      /^[a-z0-9-]+\.vercel\.app$/.test(hostname) && hostname !== "changwon-food-app.vercel.app");
  }

  function marker(runId) {
    return { title: `[MUKJJI RLS TEST] ${runId}`, body: `Temporary security verification only. Run: ${runId}. No personal data.` };
  }

  function validArtifact(value) {
    if (!value || !UUID.test(value.runId) || !UUID.test(value.id) || !UUID.test(value.authorId)) return false;
    const expected = marker(value.runId);
    return value.title === expected.title && value.body === expected.body;
  }

  function parseCode(text) {
    if (typeof text !== "string" || text.length > 2500) throw new CheckError("검사 코드가 올바르지 않아요.");
    let value;
    try { value = JSON.parse(text); } catch { throw new CheckError("검사 코드가 올바르지 않아요."); }
    if (value?.version !== 1 || value.project !== PROJECT || !validArtifact(value.main) ||
      !Array.isArray(value.artifacts) || value.artifacts.length > 8 || value.artifacts.some((row) => !validArtifact(row)) ||
      (value.otherAuthorId !== null && (!UUID.test(value.otherAuthorId) || value.otherAuthorId === value.main.authorId))) {
      throw new CheckError("이 테스트 프로젝트의 검증용 코드만 사용할 수 있어요.");
    }
    // Rebuild a strict allowlist; imported JSON can never supply URLs, credentials, or request options.
    const copy = (row) => ({ runId: row.runId, id: row.id, authorId: row.authorId, title: row.title, body: row.body });
    return { version: 1, project: PROJECT, main: copy(value.main), artifacts: value.artifacts.map(copy), otherAuthorId: value.otherAuthorId };
  }

  function createRunner({ config, hostname, fetchImpl, getActor, createAnonymous, uuid }) {
    if (!allowed(config, hostname)) throw new CheckError("허용된 테스트 Preview에서만 사용할 수 있어요.");
    const publicKey = config.publishableKey;
    let main = null, otherAuthorId = null, baseline = null, busy = false, halted = false, operationWrote = false;
    const artifacts = new Map();
    const pending = new Map();

    async function request(method, actor, query = {}, payload) {
      if (!["GET", "POST", "DELETE"].includes(method)) throw new CheckError("허용하지 않은 요청입니다.");
      const url = new URL(TABLE);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const headers = { apikey: publicKey, "Content-Type": "application/json", Prefer: method === "GET" ? "count=exact" : "return=representation" };
      if (actor?.token) headers.Authorization = `Bearer ${actor.token}`;
      if (method !== "GET") operationWrote = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetchImpl(url.href, { method, headers, body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal, cache: "no-store" });
        let data;
        try { data = await response.json(); } catch { throw new CheckError("응답을 확인하지 못했어요. 다시 쓰기 전에 임시 글을 확인하세요."); }
        return { ok: response.ok, status: response.status, data, count: response.headers.get("content-range")?.split("/")[1] };
      } catch (error) {
        if (error instanceof CheckError) throw error;
        throw new CheckError("통신 결과를 확인할 수 없어 검사를 멈췄어요. 임시 글 확인이 필요해요.");
      } finally { clearTimeout(timer); }
    }

    function denied(response) {
      return !response.ok && [401, 403].includes(response.status) && response.data?.code === "42501";
    }

    async function kakaoActor(ownerOnly = false) {
      const actor = await getActor();
      if (!actor || !UUID.test(actor.id) || !actor.token || actor.anonymous !== false || actor.kakao !== true) {
        throw new CheckError("같은 Preview 주소의 묵찌 이야기에서 카카오 로그인 후 다시 확인하세요.");
      }
      if (ownerOnly && (!main || actor.id !== main.authorId)) throw new CheckError("임시 글을 만든 A 계정에서 실행하세요.");
      return actor;
    }

    function matches(row, artifact) {
      return row?.id === artifact.id && row.author_id === artifact.authorId && row.title === artifact.title && row.body === artifact.body;
    }

    async function rowsBy(query) {
      const response = await request("GET", null, { select: FIELDS, ...query });
      if (!response.ok || !Array.isArray(response.data)) throw new CheckError("게시글을 조회하지 못해 판정할 수 없어요.");
      return response.data;
    }

    async function checkedPost(artifact) {
      if (!validArtifact(artifact)) throw new CheckError("검증용 게시글 식별정보가 올바르지 않아요.");
      const rows = await rowsBy({ id: `eq.${artifact.id}` });
      if (rows.length !== 1 || !matches(rows[0], artifact)) throw new CheckError("지정된 검증용 글이 없거나 내용이 달라요. 삭제하지 않았어요.");
      return rows[0];
    }

    async function snapshot() {
      const collected = [];
      let total = null;
      for (let offset = 0; offset <= 10000; offset += 1000) {
        const response = await request("GET", null, { select: FIELDS, order: "id", limit: "1000", offset: String(offset) });
        const count = Number(response.count);
        if (!response.ok || !Array.isArray(response.data) || response.count == null || !Number.isInteger(count) || count < 0 ||
          (total !== null && count !== total)) throw new CheckError("검사 전 게시글 수를 정확히 확인하지 못했어요.");
        total = count;
        collected.push(...response.data);
        if (collected.length === total) return new Map(collected.map((row) => [row.id, JSON.stringify(row)]));
        if (!response.data.length) break;
      }
      throw new CheckError("전체 게시글을 안전하게 비교할 수 없어 중단했어요.");
    }

    async function rememberAttempt(attempt, completed = false, acknowledged = []) {
      for (const row of acknowledged) {
        if (UUID.test(row?.id) && UUID.test(row.author_id) && row.title === attempt.title && row.body === attempt.body) {
          artifacts.set(row.id, { ...attempt, id: row.id, authorId: row.author_id });
        }
      }
      const rows = await rowsBy({ title: `eq.${attempt.title}` });
      for (const row of rows) {
        if (!UUID.test(row.id) || !UUID.test(row.author_id) || row.title !== attempt.title || row.body !== attempt.body) {
          throw new CheckError("검증용 글 확인에 실패했어요.");
        }
        artifacts.set(row.id, { ...attempt, id: row.id, authorId: row.author_id });
      }
      if (rows.length || completed) pending.delete(attempt.runId);
      return rows;
    }

    async function perform(action, canRunWhenHalted = false) {
      if (busy) return result("BLOCKED", "다른 검사가 진행 중이에요.");
      if (halted && !canRunWhenHalted) return result("BLOCKED", "이전 검사 결과를 확인한 뒤 임시 글만 정리하세요.");
      busy = true;
      operationWrote = false;
      try {
        const outcome = await action();
        if (outcome.status !== "PASS") halted = true;
        return outcome;
      } catch (error) {
        if (operationWrote || !(error instanceof CheckError)) halted = true;
        return result("BLOCKED", error instanceof CheckError ? error.message : "확인할 수 없는 오류로 검사를 멈췄어요.");
      } finally { busy = false; }
    }

    function requireRun() {
      if (!main) throw new CheckError("A에서 임시 글을 만들거나 검사 코드를 먼저 불러오세요.");
    }

    async function insertProbe(actor, authorId) {
      const attempt = { runId: uuid() };
      Object.assign(attempt, marker(attempt.runId));
      pending.set(attempt.runId, attempt);
      const payload = { title: attempt.title, body: attempt.body };
      if (authorId) payload.author_id = authorId;
      const response = await request("POST", actor, { select: FIELDS }, payload);
      const rows = await rememberAttempt(attempt, denied(response), Array.isArray(response.data) ? response.data : []);
      if (rows.length || response.ok) return result("FAIL", "차단되어야 할 작성이 허용됐어요. 검사를 멈추고 표시된 임시 글만 정리하세요.");
      if (!denied(response)) return result("BLOCKED", "권한 거부가 아닌 오류여서 차단 성공으로 판정하지 않았어요.");
      return result("PASS", authorId ? "작성자 위조가 거부됐고 새 글도 없습니다. 컬럼 권한 또는 RLS에 의한 차단입니다." : "일반 사용자 API에서 작성이 거부됐고 새 글도 없습니다.");
    }

    async function deleteArtifact(artifact, actor) {
      await checkedPost(artifact);
      // Deliberately filter only by post ID: an author filter would mask an RLS failure.
      const response = await request("DELETE", actor, { id: `eq.${artifact.id}`, select: "id" });
      const remaining = await rowsBy({ id: `eq.${artifact.id}` });
      if (!remaining.length && response.ok && Array.isArray(response.data) &&
        response.data.length === 1 && response.data[0].id === artifact.id) artifacts.delete(artifact.id);
      return { response, remaining };
    }

    return {
      async actor() { return kakaoActor(); },
      state() { return { main, otherAuthorId, artifacts: [...artifacts.values()], pendingCount: pending.size, baselineCount: baseline?.size ?? null, halted }; },
      exportCode() {
        requireRun();
        return JSON.stringify({ version: 1, project: PROJECT, main, artifacts: [...artifacts.values()], otherAuthorId });
      },
      importCode(text) {
        if (busy) throw new CheckError("검사가 끝난 뒤 불러오세요.");
        const value = parseCode(text);
        if (main && ["runId", "id", "authorId", "title", "body"].some((key) => main[key] !== value.main[key])) throw new CheckError("진행 중인 검사와 다른 코드예요. 현재 임시 글부터 확인하세요.");
        main = value.main;
        otherAuthorId = value.otherAuthorId;
        for (const artifact of value.artifacts) artifacts.set(artifact.id, artifact);
      },
      create() { return perform(async () => {
        if (main || pending.size) throw new CheckError("이미 시작한 검사가 있어요. 임시 글을 중복 생성하지 않았어요.");
        const actor = await kakaoActor();
        baseline = await snapshot();
        const attempt = { runId: uuid() };
        Object.assign(attempt, marker(attempt.runId));
        pending.set(attempt.runId, attempt);
        const response = await request("POST", actor, { select: FIELDS }, { title: attempt.title, body: attempt.body });
        const rows = await rememberAttempt(attempt, denied(response), Array.isArray(response.data) ? response.data : []);
        if (rows.length === 1) main = artifacts.get(rows[0].id);
        if (!response.ok || response.status !== 201 || !Array.isArray(response.data) || response.data.length !== 1 ||
          !main || main.authorId !== actor.id || !matches(response.data[0], main)) return result("FAIL", "본인 글 작성 결과를 확인하지 못했어요. 임시 글 목록을 확인하세요.");
        return result("PASS", `A의 임시 글을 작성하고 실제 조회로 확인했어요. 검사 전 기존 글: ${baseline.size}개`);
      }); },
      other(confirmed) { return perform(async () => {
        requireRun();
        const actor = await kakaoActor();
        if (actor.id === main.authorId) throw new CheckError("다른 브라우저의 B 계정에서 실행하세요.");
        if (!confirmed) return result("BLOCKED", "삭제 시도를 취소했어요. 요청은 보내지 않았습니다.");
        otherAuthorId = actor.id;
        const { response, remaining } = await deleteArtifact(main, actor);
        if (!remaining.length) return result("FAIL", "B가 A의 임시 글을 실제 삭제했습니다. RLS 확인이 필요해요.");
        if (remaining.length !== 1 || !matches(remaining[0], main) ||
          !(denied(response) || (response.ok && Array.isArray(response.data) && response.data.length === 0))) {
          return result("BLOCKED", "삭제 차단 여부를 정확히 확인하지 못했어요.");
        }
        return result("PASS", "B의 삭제는 0건이며 A의 임시 글이 그대로 남아 있습니다. 이 결과는 B 화면에서 확인하세요.");
      }); },
      forge() { return perform(async () => {
        requireRun();
        const actor = await kakaoActor(true);
        await checkedPost(main);
        if (!otherAuthorId || otherAuthorId === actor.id) throw new CheckError("B의 검사가 끝난 뒤 B가 돌려준 검사 코드를 불러오세요.");
        return insertProbe(actor, otherAuthorId);
      }); },
      public() { return perform(async () => {
        requireRun(); await kakaoActor(true); await checkedPost(main);
        return insertProbe(null);
      }); },
      anonymous(confirmed) { return perform(async () => {
        requireRun(); await kakaoActor(true); await checkedPost(main);
        if (!confirmed) return result("BLOCKED", "익명 사용자 생성을 취소했어요.");
        const actor = await createAnonymous();
        if (!actor?.token || !UUID.test(actor.id) || actor.anonymous !== true || actor.kakao !== false || actor.id === main.authorId) {
          throw new CheckError("독립된 익명 사용자임을 확인하지 못했어요.");
        }
        return insertProbe(actor);
      }); },
      own(confirmed) { return perform(async () => {
        requireRun();
        const actor = await kakaoActor(true);
        if (!confirmed) return result("BLOCKED", "삭제를 취소했어요. 요청은 보내지 않았습니다.");
        const { response, remaining } = await deleteArtifact(main, actor);
        if (response.ok && Array.isArray(response.data) && response.data.length === 1 && response.data[0].id === main.id && !remaining.length) {
          return result("PASS", "A의 임시 글 1개만 삭제했고 실제 조회에서도 사라졌습니다.");
        }
        return result("FAIL", "본인 삭제 결과가 기대와 다릅니다. 추가 변경은 하지 않았어요.");
      }, true); },
      cleanup(id, confirmed) { return perform(async () => {
        const artifact = artifacts.get(id);
        if (!artifact || !confirmed) throw new CheckError("확인된 검증용 글만 정리할 수 있어요.");
        const actor = await kakaoActor();
        if (actor.id !== artifact.authorId) throw new CheckError("이 임시 글의 작성자 계정에서 정리하세요.");
        const { response, remaining } = await deleteArtifact(artifact, actor);
        if (!response.ok || remaining.length || !Array.isArray(response.data) || response.data.length !== 1 || response.data[0].id !== artifact.id) return result("FAIL", "임시 글 삭제를 확인하지 못했어요.");
        return result("PASS", "확인한 임시 글만 정리했습니다.");
      }, true); },
      verify() { return perform(async () => {
        for (const attempt of pending.values()) await rememberAttempt(attempt);
        const current = await snapshot();
        let preserved = null;
        if (baseline) preserved = [...baseline].every(([id, fingerprint]) => current.get(id) === fingerprint);
        if (pending.size) return result("BLOCKED", "결과가 불확실한 작성 요청이 남아 있어요. 임시 글 정리가 끝났다고 판정하지 않았습니다.");
        const unobserved = [...artifacts.keys()].some((id) => !current.has(id));
        if (unobserved) return result("BLOCKED", "추적 중인 임시 글 일부가 조회되지 않아요. 삭제 완료로 단정하지 않았습니다.");
        return result(preserved === false ? "FAIL" : "PASS",
          `현재 게시글 ${current.size}개, 이 화면에서 확인한 임시 글 ${artifacts.size}개. ` +
          (preserved === null ? "기존 글 비교는 처음 시작한 A 화면에서 확인하세요." : preserved ? "검사 전 기존 글의 내용이 모두 유지됐습니다." : "기존 글 변경이 관찰됐습니다. 추가 검사를 중단하세요."));
      }, true); },
    };
  }

  async function mount(win) {
    const doc = win.document, byId = (id) => doc.getElementById(id);
    let runner = null, uiBusy = false, viewerId = null;
    const gate = byId("gate"), message = byId("message");

    async function sessionActor(client) {
      const session = await client.auth.getSession();
      const token = session.data?.session?.access_token;
      if (session.error || !token) return null;
      const result = await client.auth.getUser(token);
      if (result.error || !result.data?.user) return null;
      const user = result.data.user;
      return { id: user.id, token, anonymous: user.is_anonymous,
        kakao: Boolean(user.identities?.some((identity) => identity.provider === "kakao") || user.app_metadata?.providers?.includes("kakao")) };
    }

    function confirm(text) {
      return new Promise((resolve) => {
        const dialog = byId("confirm");
        byId("confirm-text").textContent = text;
        dialog.returnValue = "cancel";
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "approved"), { once: true });
        byId("cancel").onclick = () => dialog.close("cancel");
        byId("approve").onclick = () => dialog.close("approved");
        dialog.showModal();
      });
    }

    function renderState() {
      const state = runner.state();
      byId("target").textContent = state.main ? `검사 ID: ${state.main.runId}` : "아직 임시 글이 없습니다.";
      const list = byId("artifacts");
      list.replaceChildren();
      for (const row of state.artifacts) {
        const li = doc.createElement("li");
        li.textContent = row.title;
        const button = doc.createElement("button");
        button.type = "button"; button.textContent = "이 임시 글만 정리";
        button.disabled = uiBusy || viewerId !== row.authorId;
        button.addEventListener("click", () => runUi(async () => {
          if (!await confirm(`검증용 글 ${row.runId}만 삭제할까요? 기존 글은 삭제하지 않습니다.`)) return;
          const outcome = await runner.cleanup(row.id, true);
          message.textContent = `${outcome.status}: ${outcome.message}`;
        }));
        li.append(button); list.append(li);
      }
      if (state.pendingCount) message.textContent = "결과가 불확실한 작성 요청이 있어요. 현재 글 확인 버튼으로 먼저 확인하세요.";
      const owner = state.main && viewerId === state.main.authorId;
      for (const button of doc.querySelectorAll("[data-check]")) {
        const name = button.dataset.check;
        button.disabled = uiBusy || !viewerId || (name === "create" ? Boolean(state.main || state.pendingCount)
          : name === "other" ? !state.main || owner
          : !owner || (name === "forge" && !state.otherAuthorId) || (name === "own" && !state.artifacts.some((row) => row.id === state.main.id)));
      }
    }

    async function runUi(action) {
      if (uiBusy) return;
      const focusTarget = doc.activeElement;
      uiBusy = true;
      for (const button of doc.querySelectorAll("#tool button")) button.disabled = true;
      try { await action(); } catch { message.textContent = "검사를 진행하지 못했어요. 로그인과 검사 코드를 확인하세요."; }
      finally {
        for (const button of doc.querySelectorAll("#tool button")) button.disabled = false;
        uiBusy = false;
        renderState();
        if (focusTarget?.isConnected && !focusTarget.disabled) focusTarget.focus();
      }
    }

    try {
      if (win.location.hostname === "changwon-food-app.vercel.app" || !/^[a-z0-9-]+\.vercel\.app$/.test(win.location.hostname)) {
        throw new CheckError("허용된 Vercel 테스트 Preview에서만 열 수 있어요.");
      }
      const response = await win.fetch("/api/preview-rls-config", { cache: "no-store" });
      const config = response.ok ? await response.json() : null;
      if (!allowed(config, win.location.hostname)) throw new CheckError("테스트 Preview 설정이 일치하지 않아 연결을 차단했어요.");
      if (!win.supabase?.createClient) {
        await new Promise((resolve, reject) => {
          const script = doc.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
          script.onload = resolve; script.onerror = reject; doc.head.append(script);
        });
      }
      const client = win.supabase.createClient(BASE, config.publishableKey, { auth: { flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false } });
      runner = createRunner({ config, hostname: win.location.hostname, fetchImpl: win.fetch.bind(win),
        uuid: () => win.crypto.randomUUID(), getActor: () => sessionActor(client),
        createAnonymous: async () => {
          const isolated = win.supabase.createClient(BASE, config.publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "mukjji-rls-isolated-anonymous" },
          });
          const result = await isolated.auth.signInAnonymously();
          if (result.error) throw new CheckError("임시 익명 사용자를 만들지 못했어요.");
          return sessionActor(isolated);
        },
      });
      byId("tool").hidden = false;
      gate.textContent = `테스트 프로젝트 확인 완료: ${PROJECT}`;
      async function refresh() {
        try { const actor = await runner.actor(); viewerId = actor.id; byId("account").textContent = `카카오 로그인 확인 완료 · 사용자 식별값 ${actor.id}`; }
        catch { viewerId = null; byId("account").textContent = "이 Preview 주소에서 카카오 로그인이 필요해요."; }
      }
      await refresh();
      renderState();
      byId("refresh").addEventListener("click", () => runUi(refresh));
      byId("import").addEventListener("click", () => runUi(async () => {
        runner.importCode(byId("code").value.trim()); message.textContent = "검사 코드를 불러왔어요. 결과 자체는 각 브라우저에서 직접 확인하세요.";
      }));
      byId("copy").addEventListener("click", () => runUi(async () => {
        byId("code").value = runner.exportCode();
        try { await win.navigator.clipboard.writeText(byId("code").value); message.textContent = "토큰이 없는 검사 코드를 복사했어요."; }
        catch { byId("code").focus(); byId("code").select(); message.textContent = "선택된 검사 코드만 복사하세요. 인증 토큰은 들어 있지 않아요."; }
      }));
      for (const button of doc.querySelectorAll("[data-check]")) button.addEventListener("click", () => runUi(async () => {
        const name = button.dataset.check;
        if (["other", "own"].includes(name) && !await confirm(name === "other"
          ? "B의 권한으로 지정된 A의 검증용 임시 글만 삭제 시도합니다. RLS가 잘못됐다면 실제 삭제될 수 있어요. 진행할까요?"
          : "A가 만든 지정된 검증용 임시 글만 삭제할까요?")) return;
        if (name === "anonymous" && !await confirm("A의 로그인과 분리된 임시 익명 인증 사용자를 생성할까요? 생성된 인증 사용자 자체는 이 도구로 삭제하지 않습니다.")) return;
        const outcome = await runner[name](true);
        const output = byId(`result-${name}`);
        output.dataset.status = outcome.status;
        output.textContent = `${outcome.status === "BLOCKED" ? "확인 불가" : outcome.status}: ${outcome.message}`;
        if (runner.state().main) byId("code").value = runner.exportCode();
      }));
      byId("verify").addEventListener("click", () => runUi(async () => {
        const outcome = await runner.verify(); byId("preservation").textContent = `${outcome.status}: ${outcome.message}`;
      }));
    } catch {
      byId("tool").hidden = true;
      gate.textContent = "연결 차단: 허용된 테스트 Preview 설정을 확인할 수 없어요. DB 요청은 시작하지 않았습니다.";
    }
  }

  return { PROJECT, BASE, allowed, marker, validArtifact, parseCode, createRunner, mount };
});
