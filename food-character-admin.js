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

  return Object.freeze({
    definitions,
    definitionsByValue,
    allowedValues,
    isAllowedFoodCharacter,
    suggestFoodCharacterDraft,
  });
});
