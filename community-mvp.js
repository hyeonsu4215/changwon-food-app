(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MukjjiCommunity = api;
})(typeof window === "undefined" ? null : window, function () {
  const MAX_TITLE = 80;
  const MAX_BODY = 3000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  class CommunityInputError extends Error {}

  function authFailureMessage(code) {
    return code === "identity_already_exists"
      ? "이미 다른 계정에 연결된 카카오 계정이에요. 기존 기록을 보호하기 위해 연결을 멈췄어요."
      : "카카오 인증을 완료하지 못했어요. 다시 시도해주세요.";
  }

  function isKakaoUser(user) {
    if (!user || user.is_anonymous !== false) return false;
    return user.identities?.some((identity) => identity.provider === "kakao") ||
      user.app_metadata?.providers?.includes("kakao") || user.app_metadata?.provider === "kakao" || false;
  }

  function validatePost(title, body) {
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    const cleanBody = typeof body === "string" ? body.trim() : "";
    if (!cleanTitle || cleanTitle.length > MAX_TITLE) return { error: `제목은 1~${MAX_TITLE}자로 입력해주세요.` };
    if (!cleanBody || cleanBody.length > MAX_BODY) return { error: `본문은 1~${MAX_BODY}자로 입력해주세요.` };
    return { title: cleanTitle, body: cleanBody };
  }

  function canDelete(user, post) {
    return Boolean(isKakaoUser(user) && post?.author_id === user.id);
  }

  function isMissingContributionTable(result, table) {
    if (result.status !== 404) return false;
    const error = result.error;
    if (error?.code === "PGRST205") {
      return error.message === `Could not find the table 'public.${table}' in the schema cache`;
    }
    return error?.code === "42P01" &&
      [table, `public.${table}`].some((name) => error.message === `relation "${name}" does not exist`);
  }

  async function completeOAuthReturn(auth, href, replaceUrl) {
    const url = new URL(href);
    if (!url.searchParams.has("communityAuth")) return { handled: false, error: "" };
    const fragment = new URLSearchParams(url.hash.slice(1));
    let errorCode = url.searchParams.get("error_code") || fragment.get("error_code");
    let error = url.searchParams.get("error_description") || url.searchParams.get("error") ||
      fragment.get("error_description") || fragment.get("error") || "";
    const code = url.searchParams.get("code");
    if (!code && !error) error = "카카오 인증이 완료되지 않았어요.";
    if (code && !error) {
      try {
        const result = await auth.exchangeCodeForSession(code);
        error = result.error?.message || "";
        errorCode = result.error?.code || errorCode;
      } catch (cause) {
        error = cause.message || "카카오 인증을 완료하지 못했어요.";
        errorCode = cause.code || errorCode;
      }
    }
    for (const key of ["communityAuth", "code", "error", "error_description", "error_code"]) url.searchParams.delete(key);
    if (["error", "error_description", "error_code"].some((key) => fragment.has(key))) {
      for (const key of ["error", "error_description", "error_code"]) fragment.delete(key);
      url.hash = fragment.toString();
    }
    replaceUrl(url.href);
    return { handled: true, error, ...(error ? { message: authFailureMessage(errorCode) } : {}) };
  }

  function createService(client) {
    async function currentUser() {
      const result = await client.auth.getUser();
      if (result.error?.name === "AuthSessionMissingError") return null;
      if (result.error) throw result.error;
      return result.data?.user || null;
    }

    async function anonymousHasRemoteContributions(userId) {
      for (const table of ["menu_reviews", "menu_taste_votes", "info_reports"]) {
        try {
          // HEAD hides error bodies; a bounded GET distinguishes missing tables from denied access.
          const result = await client.from(table).select("user_id", { count: "exact" }).eq("user_id", userId).limit(1);
          if (isMissingContributionTable(result, table)) continue;
          if (result.error || !Number.isInteger(result.count) || result.count !== 0) return true;
        } catch {
          return true;
        }
      }
      return false;
    }

    return {
      currentUser,
      async startLogin(redirectTo, { reauthenticate = false } = {}) {
        const user = await currentUser();
        const options = { redirectTo };
        if (reauthenticate === true) options.queryParams = { prompt: "login" };
        const preserveAnonymous = user?.is_anonymous && await anonymousHasRemoteContributions(user.id);
        const result = preserveAnonymous
          ? await client.auth.linkIdentity({ provider: "kakao", options })
          : await client.auth.signInWithOAuth({ provider: "kakao", options });
        if (result.error?.code === "identity_already_exists") throw new CommunityInputError(authFailureMessage(result.error.code));
        if (result.error) throw result.error;
        if (!result.data?.url) throw new CommunityInputError("카카오 인증 주소를 받지 못했어요.");
        return result.data.url;
      },
      async logout() {
        const user = await currentUser();
        if (!isKakaoUser(user)) return;
        const result = await client.auth.signOut();
        if (result.error) throw result.error;
        if (client.auth.signInAnonymously) {
          const anonymous = await client.auth.signInAnonymously();
          if (anonymous.error) throw anonymous.error;
        }
      },
      async list() {
        const result = await client.from("community_posts")
          .select("id,author_id,title,body,created_at,updated_at")
          .order("created_at", { ascending: false }).limit(50);
        if (result.error) throw result.error;
        return result.data || [];
      },
      async detail(id) {
        if (!UUID.test(id)) throw new CommunityInputError("잘못된 게시글 주소예요.");
        const result = await client.from("community_posts")
          .select("id,author_id,title,body,created_at,updated_at").eq("id", id).single();
        if (result.error) throw result.error;
        return result.data;
      },
      async create(title, body) {
        const user = await currentUser();
        if (!isKakaoUser(user)) throw new CommunityInputError("게시글은 카카오 로그인 후 작성할 수 있어요.");
        const post = validatePost(title, body);
        if (post.error) throw new CommunityInputError(post.error);
        const result = await client.from("community_posts")
          .insert(post).select("id,author_id,title,body,created_at,updated_at").single();
        if (result.error) throw result.error;
        return result.data;
      },
      async remove(post) {
        const user = await currentUser();
        if (!canDelete(user, post)) throw new CommunityInputError("본인이 작성한 게시글만 삭제할 수 있어요.");
        const result = await client.from("community_posts")
          .delete().eq("id", post.id).eq("author_id", user.id).select("id").single();
        if (result.error) throw result.error;
        if (result.data?.id !== post.id) throw new CommunityInputError("게시글 삭제를 확인하지 못했어요. 목록을 다시 확인해주세요.");
        return result.data;
      },
    };
  }

  function createController(client, elements, onBack, onAuthChanged) {
    const service = createService(client);
    let user = null;
    let posts = [];
    let selected = null;
    let busy = false;
    let mounted = false;
    let loginPending = false;
    let authRevision = 0;
    let authLookupId = 0;
    let pendingDeletePost = null;
    const deletingIds = new Set();
    const removedIds = new Set();

    function setMessage(message) {
      elements.message.textContent = message || "";
    }

    function makePostButton(post) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "community-post-row";
      const title = document.createElement("strong");
      title.textContent = post.title;
      const date = document.createElement("span");
      date.textContent = new Date(post.created_at).toLocaleDateString("ko-KR");
      button.append(title, date);
      button.addEventListener("click", () => showDetail(post.id));
      return button;
    }

    function render() {
      const kakao = isKakaoUser(user);
      elements.authStatus.textContent = kakao ? "카카오 로그인 중" : "로그인 없이 게시글을 읽을 수 있어요.";
      elements.login.hidden = kakao;
      elements.login.disabled = loginPending;
      elements.loginOther.hidden = kakao;
      elements.loginOther.disabled = loginPending;
      elements.logout.hidden = !kakao;
      elements.form.hidden = !kakao;
      elements.list.replaceChildren(...posts.map(makePostButton));
      elements.empty.hidden = posts.length > 0;
      elements.detail.hidden = !selected;
      elements.listSection.hidden = Boolean(selected);
      elements.deleteButton.hidden = !canDelete(user, selected);
      elements.deleteButton.disabled = deletingIds.has(selected?.id);
      elements.confirmDelete.disabled = deletingIds.has(pendingDeletePost?.id);
      if (selected) {
        elements.detailTitle.textContent = selected.title;
        elements.detailBody.textContent = selected.body;
        elements.detailDate.textContent = new Date(selected.created_at).toLocaleString("ko-KR");
      }
    }

    function applyUser(nextUser) {
      if (user?.id !== nextUser?.id) {
        elements.form.reset();
        pendingDeletePost = null;
        if (elements.deleteDialog.open) elements.deleteDialog.close();
        setMessage("");
      }
      user = nextUser || null;
      onAuthChanged?.(user);
      render();
    }

    async function refreshAuth() {
      const revision = authRevision;
      const lookupId = ++authLookupId;
      let nextUser = null;
      try {
        nextUser = await service.currentUser();
      } catch {
        nextUser = null;
      }
      if (revision !== authRevision || lookupId !== authLookupId) return;
      applyUser(nextUser);
    }

    async function run(action, failureMessage = "요청을 완료하지 못했어요. 잠시 후 다시 시도해주세요.") {
      if (busy) return;
      busy = true;
      try {
        setMessage("");
        await action();
      } catch (error) {
        setMessage(error instanceof CommunityInputError ? error.message : failureMessage);
      } finally {
        busy = false;
      }
    }

    async function showDetail(id) {
      await run(async () => {
        const post = await service.detail(id);
        if (removedIds.has(id)) return;
        selected = post;
        render();
        elements.detailTitle.focus?.({ preventScroll: true });
      }, "게시글을 불러오지 못했어요.");
    }

    async function deleteSelectedPost() {
      const target = pendingDeletePost;
      if (!target || deletingIds.has(target.id)) return;
      deletingIds.add(target.id);
      setMessage("");
      render();
      try {
        await service.remove(target);
        removedIds.add(target.id);
        posts = posts.filter((post) => post.id !== target.id);
        if (selected?.id === target.id) selected = null;
        if (pendingDeletePost?.id === target.id) {
          pendingDeletePost = null;
          elements.deleteDialog.close();
        }
      } catch (error) {
        setMessage(error instanceof CommunityInputError ? error.message : "게시글을 삭제하지 못했어요.");
      } finally {
        deletingIds.delete(target.id);
        render();
      }
    }

    function startLogin(reauthenticate = false) {
      if (loginPending) return;
      return run(async () => {
        loginPending = true;
        render();
        try {
          const redirectTo = new URL(window.location.pathname, window.location.origin);
          redirectTo.searchParams.set("communityAuth", "1");
          await service.startLogin(redirectTo.href, { reauthenticate });
        } catch (error) {
          loginPending = false;
          render();
          throw error;
        }
      }, "카카오 인증을 시작하지 못했어요. 기존 기록은 그대로 유지됩니다.");
    }

    function mount() {
      if (mounted) return;
      mounted = true;
      elements.back.addEventListener("click", () => {
        if (selected) {
          selected = null;
          render();
        } else {
          onBack();
        }
      });
      elements.login.addEventListener("click", () => startLogin());
      elements.loginOther.addEventListener("click", () => startLogin(true));
      if (typeof window !== "undefined") window.addEventListener?.("pageshow", () => {
        loginPending = false;
        render();
      });
      elements.logout.addEventListener("click", () => run(async () => {
        await service.logout();
        await refreshAuth();
      }, "로그아웃을 완료하지 못했어요."));
      elements.form.addEventListener("submit", (event) => {
        event.preventDefault();
        run(async () => {
          const post = await service.create(elements.titleInput.value, elements.bodyInput.value);
          elements.form.reset();
          posts.unshift(post);
          selected = post;
          render();
        }, "게시글을 올리지 못했어요.");
      });
      elements.deleteButton.addEventListener("click", () => {
        if (!canDelete(user, selected)) return;
        pendingDeletePost = Object.freeze({ id: selected.id, author_id: selected.author_id });
        render();
        elements.deleteDialog.showModal();
      });
      elements.cancelDelete.addEventListener("click", () => {
        pendingDeletePost = null;
        elements.deleteDialog.close();
      });
      for (const type of ["cancel", "close"]) elements.deleteDialog.addEventListener(type, () => {
        pendingDeletePost = null;
      });
      elements.confirmDelete.addEventListener("click", deleteSelectedPost);
      client.auth.onAuthStateChange((event, session) => {
        authRevision += 1;
        applyUser(session?.user);
      });
      refreshAuth();
    }

    async function open() {
      await run(async () => {
        posts = (await service.list()).filter((post) => !removedIds.has(post.id));
        selected = null;
        await refreshAuth();
      }, "게시글 목록을 불러오지 못했어요.");
    }

    return { mount, open, refreshAuth, setMessage };
  }

  return { isKakaoUser, validatePost, canDelete, completeOAuthReturn, createService, createController };
});
