(function initAdminFoodCharacter(root, factory) {
  const api = factory();
  if (root) root.CHANGWON_ADMIN_FOOD_CHARACTER = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAdminFoodCharacter() {
  const definitions = Object.freeze([
    Object.freeze({
      value: "rice-meal",
      label: "밥 중심 한 끼",
      description: "덮밥, 도시락, 비빔밥, 볶음밥, 알밥, 리조또, 정식처럼 밥이 중심인 식사",
    }),
    Object.freeze({
      value: "noodle-special",
      label: "면 중심 한 끼",
      description: "라멘, 쌀국수, 국수, 칼국수, 수제비, 라면, 짜장면, 짬뽕, 파스타, 밀면처럼 면이 중심인 식사",
    }),
    Object.freeze({
      value: "hot-soup",
      label: "국물·찌개 중심",
      description: "김치찌개, 된장찌개, 순두부찌개, 육개장, 국밥, 해장국, 마라탕처럼 면이 아닌 국물 중심 식사",
    }),
    Object.freeze({
      value: "quick-snack",
      label: "빠르고 간편한 식사",
      description: "햄버거, 부리또, 김밥, 토스트, 떡볶이, 밥버거, 만두처럼 빠르고 간편한 식사",
    }),
    Object.freeze({
      value: "main-dish",
      label: "메인 요리 중심",
      description: "돈까스, 닭갈비, 찜닭, 불고기, 피자, 탕수육, 전류처럼 메인 요리가 중심인 식사",
    }),
  ]);

  const allowedValues = Object.freeze(definitions.map((definition) => definition.value));
  const definitionsByValue = Object.freeze(
    Object.fromEntries(definitions.map((definition) => [definition.value, definition])),
  );

  const keywordRules = Object.freeze([
    Object.freeze({ value: "quick-snack", keywords: Object.freeze(["부리또", "밥버거", "햄버거", "버거", "김밥", "토스트", "떡볶이", "만두"]) }),
    Object.freeze({ value: "noodle-special", keywords: Object.freeze(["라멘", "탄탄멘", "쌀국수", "국수", "칼국수", "수제비", "라면", "짜장", "짬뽕", "파스타", "밀면", "비빔면", "우동", "소바", "모밀"]) }),
    Object.freeze({ value: "hot-soup", keywords: Object.freeze(["김치찌개", "된장찌개", "순두부", "육개장", "국밥", "해장국", "마라탕", "짜글이"]) }),
    Object.freeze({ value: "rice-meal", keywords: Object.freeze(["덮밥", "도시락", "컵밥", "비빔밥", "볶음밥", "알밥", "리조또", "정식", "백반"]) }),
    Object.freeze({ value: "main-dish", keywords: Object.freeze(["돈까스", "돈가스", "닭갈비", "찜닭", "불고기", "피자", "탕수육", "해물전", "두루치기", "제육볶음"]) }),
  ]);

  const categoryFallbacks = Object.freeze({
    도시락: "rice-meal",
    분식: "quick-snack",
    아시안: "noodle-special",
    양식: "main-dish",
    "일식/돈까스": "main-dish",
    중식: "main-dish",
    "찜/탕": "hot-soup",
    한식: "rice-meal",
    햄버거: "quick-snack",
  });

  function normalize(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function specialReviewWarning(name) {
    if (name.includes("부리또")) return "기존 tags 문자열 오분류 방지 확인: 부리또는 quick-snack 후보입니다.";
    if (name.includes("쌀국수")) return "국물 유무와 관계없이 면 음식 확인: 쌀국수는 noodle-special 후보입니다.";
    if (name.includes("미니탕수육")) return "이름의 '탕' 오분류 방지 확인: 미니탕수육은 main-dish 후보입니다.";
    return "";
  }

  function suggestFoodCharacterDraft(menu = {}) {
    const name = normalize(menu.name);
    const category = String(menu.category || "").trim();
    const restaurantName = normalize(menu.restaurantName || menu.storeName);
    const matchedRules = keywordRules.filter((rule) => rule.keywords.some((keyword) => name.includes(normalize(keyword))));
    let suggestedFoodCharacter = matchedRules[0]?.value || null;
    let confidence = suggestedFoodCharacter ? "high" : "low";
    const warnings = [];

    if (!suggestedFoodCharacter && restaurantName.includes("밥버거")) {
      suggestedFoodCharacter = "quick-snack";
      confidence = "medium";
      warnings.push("가게명 문맥으로 밥버거 후보를 제안했습니다.");
    }
    if (!suggestedFoodCharacter && categoryFallbacks[category]) {
      suggestedFoodCharacter = categoryFallbacks[category];
      confidence = "low";
      warnings.push(`메뉴명 규칙이 없어 category '${category}' 기준으로 제안했습니다.`);
    }
    if (!suggestedFoodCharacter) {
      warnings.push("자동 초안을 만들 근거가 부족합니다.");
    }
    if (matchedRules.length > 1) {
      confidence = "medium";
      warnings.push(`복수 식사 형태 후보가 감지되었습니다: ${matchedRules.map((rule) => rule.value).join(", ")}.`);
    }
    const specialWarning = specialReviewWarning(name);
    if (specialWarning) warnings.push(specialWarning);

    return Object.freeze({
      suggestedFoodCharacter,
      confidence,
      warning: warnings.join(" "),
      reviewStatus: "needs-review",
    });
  }

  function isAllowedFoodCharacter(value) {
    return allowedValues.includes(value);
  }

  const saveErrorMessages = Object.freeze({
    "missing-client": "Supabase 연결을 확인할 수 없습니다.",
    "missing-menu": "Food Character를 변경할 메뉴를 먼저 선택해주세요.",
    "static-source": "정적 데이터는 읽기 전용입니다.",
    "invalid-original": "현재 Food Character가 유효하지 않아 저장할 수 없습니다.",
    "invalid-value": "허용되지 않은 Food Character입니다.",
    unchanged: "현재 Food Character와 변경할 값이 같습니다.",
    stale: "다른 곳에서 값이 변경되었을 수 있습니다. 새로고침 후 다시 확인해주세요.",
    authorization: "Food Character를 변경할 권한이 없습니다. 관리자 인증 상태를 확인해주세요.",
    connection: "Supabase 연결 오류로 Food Character를 저장하지 못했습니다.",
    "database-error": "Supabase가 Food Character 저장 요청을 처리하지 못했습니다.",
    "invalid-response": "Supabase 저장 결과를 확인할 수 없습니다.",
    "verification-missing": "저장 후 메뉴를 다시 확인하지 못했습니다.",
    "verification-mismatch": "저장 후 확인한 Food Character가 요청한 값과 다릅니다.",
  });

  class FoodCharacterSaveError extends Error {
    constructor(code, cause) {
      super(saveErrorMessages[code] || "Food Character 저장에 실패했습니다.");
      this.name = "FoodCharacterSaveError";
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  function createEditorState(menu = null) {
    const value = menu?.foodCharacter ?? null;
    return {
      menuId: menu?.id || null,
      menuName: menu?.name || "",
      restaurantName: menu?.restaurantName || "",
      originalValue: value,
      nextValue: value,
      saving: false,
    };
  }

  function updateEditorValue(editor, nextValue) {
    return {
      ...editor,
      nextValue,
    };
  }

  function getEditorStatus(editor, source) {
    const menuSelected = Boolean(editor?.menuId);
    const originalValid = isAllowedFoodCharacter(editor?.originalValue);
    const nextValid = isAllowedFoodCharacter(editor?.nextValue);
    const dirty = originalValid && nextValid && editor.originalValue !== editor.nextValue;
    const supabaseSource = source === "supabase";
    const saving = Boolean(editor?.saving);
    return Object.freeze({
      menuSelected,
      originalValid,
      nextValid,
      dirty,
      selectEnabled: supabaseSource && menuSelected && originalValid && !saving,
      saveEnabled: supabaseSource && menuSelected && dirty && !saving,
    });
  }

  function classifySupabaseError(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    if (
      status === 401 ||
      status === 403 ||
      code === "42501" ||
      /permission|policy|jwt|not authorized|unauthorized|forbidden/.test(message)
    ) {
      return new FoodCharacterSaveError("authorization", error);
    }
    if (/failed to fetch|network|timeout|load failed/.test(message) || (!status && !code)) {
      return new FoodCharacterSaveError("connection", error);
    }
    return new FoodCharacterSaveError("database-error", error);
  }

  async function saveFoodCharacterChange({ supabase, source, menuId, originalValue, nextValue }) {
    if (source !== "supabase") throw new FoodCharacterSaveError("static-source");
    if (!menuId) throw new FoodCharacterSaveError("missing-menu");
    if (!isAllowedFoodCharacter(originalValue)) throw new FoodCharacterSaveError("invalid-original");
    if (!isAllowedFoodCharacter(nextValue)) throw new FoodCharacterSaveError("invalid-value");
    if (originalValue === nextValue) throw new FoodCharacterSaveError("unchanged");
    if (!supabase?.from) throw new FoodCharacterSaveError("missing-client");

    let updateResult;
    try {
      updateResult = await supabase
        .from("menus")
        .update({ food_character: nextValue })
        .eq("id", menuId)
        .eq("food_character", originalValue)
        .select("id,food_character");
    } catch (error) {
      throw classifySupabaseError(error);
    }

    if (updateResult?.error) throw classifySupabaseError(updateResult.error);
    if (!Array.isArray(updateResult?.data)) throw new FoodCharacterSaveError("invalid-response");
    if (updateResult.data.length === 0) throw new FoodCharacterSaveError("stale");
    if (updateResult.data.length !== 1 || updateResult.data[0]?.id !== menuId) {
      throw new FoodCharacterSaveError("invalid-response");
    }

    let verificationResult;
    try {
      verificationResult = await supabase
        .from("menus")
        .select("id,food_character")
        .eq("id", menuId)
        .maybeSingle();
    } catch (error) {
      throw classifySupabaseError(error);
    }

    if (verificationResult?.error) throw classifySupabaseError(verificationResult.error);
    if (!verificationResult?.data || verificationResult.data.id !== menuId) {
      throw new FoodCharacterSaveError("verification-missing");
    }
    if (verificationResult.data.food_character !== nextValue) {
      throw new FoodCharacterSaveError("verification-mismatch");
    }

    return Object.freeze({
      menuId,
      foodCharacter: verificationResult.data.food_character,
    });
  }

  return Object.freeze({
    definitions,
    definitionsByValue,
    allowedValues,
    isAllowedFoodCharacter,
    suggestFoodCharacterDraft,
    FoodCharacterSaveError,
    createEditorState,
    updateEditorValue,
    getEditorStatus,
    saveFoodCharacterChange,
  });
});
