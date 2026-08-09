const fs = require("node:fs");
const path = require("node:path");

const foodCharacter = require("../food-character-admin.js");

const REVIEW_DECISIONS = Object.freeze({
  M001: ["quick-snack", "부리또는 손에 들고 빠르게 먹는 간편식 형태입니다."],
  M002: ["quick-snack", "부리또는 손에 들고 빠르게 먹는 간편식 형태입니다."],
  M003: ["quick-snack", "부리또는 손에 들고 빠르게 먹는 간편식 형태입니다."],
  M004: ["quick-snack", "부리또는 손에 들고 빠르게 먹는 간편식 형태입니다."],
  M005: ["quick-snack", "부리또는 손에 들고 빠르게 먹는 간편식 형태입니다."],
  M006: ["main-dish", "찜닭 자체가 식사의 중심이 되는 메인 요리입니다."],
  M007: ["main-dish", "치즈 찜닭 자체가 식사의 중심이 되는 메인 요리입니다."],
  M008: ["main-dish", "두루치기는 고기 메인 요리가 중심인 식사입니다."],
  M009: ["hot-soup", "된장찌개는 면이 아닌 찌개 국물이 중심인 식사입니다."],
  M010: ["hot-soup", "김치찌개는 면이 아닌 찌개 국물이 중심인 식사입니다."],
  M011: ["hot-soup", "순두부찌개는 면이 아닌 찌개 국물이 중심인 식사입니다."],
  M012: ["main-dish", "뚝배기 조리 방식보다 불고기 메인 요리 정체성을 우선했습니다."],
  M013: ["rice-meal", "돌솥비빔밥은 밥을 중심으로 구성된 한 끼입니다."],
  M014: ["hot-soup", "육개장은 면이 아닌 뜨거운 국물 자체가 중심인 식사입니다."],
  M015: ["rice-meal", "치킨마요는 밥 위 토핑으로 구성되는 도시락형 한 끼입니다."],
  M016: ["rice-meal", "메뉴명에 명시된 덮밥이 식사의 중심입니다."],
  M017: ["rice-meal", "돈까스 단품보다 밥과 반찬을 함께 먹는 한솥 도시락 구성이 중심입니다."],
  M018: ["rice-meal", "돈까스가 포함되어도 메뉴가 덮밥으로 구성되어 밥 중심입니다."],
  M019: ["rice-meal", "컵밥 도시락은 밥과 토핑이 중심인 한 끼입니다."],
  M020: ["rice-meal", "오리훈제 토핑을 얹은 컵밥 도시락 형태입니다."],
  M021: ["rice-meal", "제육 토핑을 얹은 컵밥 도시락 형태입니다."],
  M022: ["rice-meal", "치즈 토핑을 얹은 컵밥 도시락 형태입니다."],
  M023: ["noodle-special", "소유라멘은 국물이 있어도 면 음식 정체성이 우선입니다."],
  M024: ["noodle-special", "미소라멘은 국물이 있어도 면 음식 정체성이 우선입니다."],
  M025: ["noodle-special", "돈코츠라멘은 국물이 있어도 면 음식 정체성이 우선입니다."],
  M026: ["noodle-special", "탄탄멘은 국물이 있어도 면 음식 정체성이 우선입니다."],
  M027: ["quick-snack", "밥버거는 밥이 들어가지만 빠르고 간편한 식사 형태입니다."],
  M028: ["quick-snack", "봉구스밥버거의 밥버거 메뉴로 빠르고 간편한 식사 형태입니다."],
  M029: ["quick-snack", "봉구스밥버거의 밥버거 메뉴로 빠르고 간편한 식사 형태입니다."],
  M030: ["quick-snack", "봉구스밥버거의 밥버거 메뉴로 빠르고 간편한 식사 형태입니다."],
  M031: ["noodle-special", "쌀국수는 국물이 있어도 면이 중심인 음식입니다."],
  M032: ["noodle-special", "쌀국수는 국물이 있어도 면이 중심인 음식입니다."],
  M033: ["rice-meal", "볶음밥은 밥 조리물이 중심인 한 끼입니다."],
  M034: ["quick-snack", "버거 세트는 패스트푸드형 간편 식사입니다."],
  M035: ["quick-snack", "버거 세트는 패스트푸드형 간편 식사입니다."],
  M036: ["quick-snack", "버거 세트는 패스트푸드형 간편 식사입니다."],
  M037: ["hot-soup", "김치찌개는 면이 아닌 찌개 국물이 중심인 식사입니다."],
  M038: ["noodle-special", "잔치국수는 국물이 있어도 면이 중심인 음식입니다."],
  M039: ["noodle-special", "비빔국수는 국물 없이 양념한 면 음식입니다."],
  M040: ["noodle-special", "열무국수는 국수 면이 중심인 음식입니다."],
  M041: ["quick-snack", "김밥은 빠르고 간편하게 먹는 분식형 한 끼입니다."],
  M042: ["hot-soup", "순두부찌개는 면이 아닌 찌개 국물이 중심인 식사입니다."],
  M043: ["main-dish", "돈까스 자체가 식사의 중심이 되는 메인 요리입니다."],
  M044: ["rice-meal", "백반도시락은 밥과 반찬으로 구성된 한 끼입니다."],
  M045: ["rice-meal", "백반도시락은 밥과 반찬으로 구성된 한 끼입니다."],
  M046: ["rice-meal", "비빔밥은 밥을 중심으로 구성된 한 끼입니다."],
  M047: ["rice-meal", "알밥은 밥을 중심으로 구성된 한 끼입니다."],
  M048: ["rice-meal", "알밥은 밥을 중심으로 구성된 한 끼입니다."],
  M049: ["rice-meal", "알밥은 밥을 중심으로 구성된 한 끼입니다."],
  M050: ["quick-snack", "버거 세트는 패스트푸드형 간편 식사입니다."],
  M051: ["quick-snack", "불고기 재료보다 버거라는 간편 식사 형태를 우선했습니다."],
  M052: ["quick-snack", "버거 세트는 패스트푸드형 간편 식사입니다."],
  M053: ["quick-snack", "토스트는 빠르게 먹는 간편 식사입니다."],
  M054: ["quick-snack", "토스트는 빠르게 먹는 간편 식사입니다."],
  M055: ["main-dish", "피자는 독립적인 메인 요리 형태로 판단했습니다."],
  M056: ["hot-soup", "뼈해장국은 면이 아닌 국물 중심 식사입니다."],
  M057: ["hot-soup", "콩나물해장국은 면이 아닌 국물 중심 식사입니다."],
  M058: ["noodle-special", "촌국수는 국수 면이 중심인 음식입니다."],
  M059: ["noodle-special", "비빔국수는 국물 없이 양념한 면 음식입니다."],
  M060: ["rice-meal", "양푼비빔밥은 밥이 중심인 한 끼입니다."],
  M061: ["main-dish", "해물전은 전 자체를 먹는 메인 요리 형태입니다."],
  M062: ["noodle-special", "수제비는 반죽 면 조각이 중심인 면 음식 계열입니다."],
  M063: ["noodle-special", "들깨칼국수는 국물이 있어도 면이 중심인 음식입니다."],
  M064: ["quick-snack", "김밥은 빠르고 간편하게 먹는 분식형 한 끼입니다."],
  M065: ["rice-meal", "콩나물비빔밥은 밥이 중심인 한 끼입니다."],
  M066: ["noodle-special", "라면은 면이 중심인 음식입니다."],
  M067: ["quick-snack", "떡볶이는 빠르고 간편한 분식 형태입니다."],
  M068: ["hot-soup", "마라탕은 면보다 탕 국물과 재료 구성이 중심입니다."],
  M069: ["hot-soup", "순두부가 앞에 명시된 세트로 찌개 중심 식사 정체성을 우선했습니다."],
  M070: ["hot-soup", "된장찌개가 앞에 명시된 세트로 찌개 중심 식사 정체성을 우선했습니다."],
  M071: ["main-dish", "등심 돈가스 자체가 중심인 메인 요리입니다."],
  M072: ["noodle-special", "크림 파스타는 소스와 함께 먹는 면 음식입니다."],
  M073: ["noodle-special", "로제 파스타는 소스와 함께 먹는 면 음식입니다."],
  M074: ["rice-meal", "리조또는 쌀을 조리한 밥 중심 음식입니다."],
  M075: ["main-dish", "피자는 독립적인 메인 요리 형태로 판단했습니다."],
  M076: ["noodle-special", "물밀면은 육수가 있어도 밀면이 중심인 음식입니다."],
  M077: ["noodle-special", "비빔면은 국물 없이 양념한 면 음식입니다."],
  M078: ["quick-snack", "손만두는 빠르고 간편하게 먹는 메뉴 형태입니다."],
  M079: ["noodle-special", "물밀면은 육수가 있어도 밀면이 중심인 음식입니다."],
  M080: ["noodle-special", "비빔밀면은 국물 없이 양념한 면 음식입니다."],
  M081: ["main-dish", "돈까스 자체가 식사의 중심이 되는 메인 요리입니다."],
  M082: ["main-dish", "닭갈비 자체가 식사의 중심이 되는 메인 요리입니다."],
  M083: ["main-dish", "콘치즈 닭갈비 자체가 중심인 메인 요리입니다."],
  M084: ["rice-meal", "닭갈비가 들어가도 완성 메뉴가 철판볶음밥이므로 밥 중심입니다."],
  M085: ["rice-meal", "완성 메뉴가 철판볶음밥이므로 밥 중심입니다."],
  M086: ["main-dish", "미소허니 닭갈비 자체가 중심인 메인 요리입니다."],
  M087: ["rice-meal", "완성 메뉴가 철판볶음밥이므로 밥 중심입니다."],
  M088: ["hot-soup", "짜글이는 자작한 찌개 국물이 중심인 식사입니다."],
  M089: ["hot-soup", "돼지국밥은 이름에 밥이 있어도 국물이 식사 정체성의 중심입니다."],
  M090: ["hot-soup", "순대국밥은 이름에 밥이 있어도 국물이 식사 정체성의 중심입니다."],
  M091: ["hot-soup", "내장국밥은 이름에 밥이 있어도 국물이 식사 정체성의 중심입니다."],
  M092: ["hot-soup", "섞어국밥은 이름에 밥이 있어도 국물이 식사 정체성의 중심입니다."],
  M093: ["noodle-special", "짜장면은 소스와 함께 먹는 면 음식입니다."],
  M094: ["noodle-special", "짬뽕은 국물이 있어도 면이 중심인 음식입니다."],
  M095: ["rice-meal", "볶음밥은 밥 조리물이 중심인 한 끼입니다."],
  M096: ["noodle-special", "간짜장은 소스와 함께 먹는 면 음식입니다."],
  M097: ["noodle-special", "볶음짬뽕은 국물 양과 관계없이 면이 중심인 음식입니다."],
  M098: ["main-dish", "탕수육의 '탕'은 국물 의미가 아니며 독립적인 메인 요리입니다."],
  M099: ["noodle-special", "쟁반짜장은 소스와 함께 먹는 면 음식입니다."],
  M100: ["rice-meal", "돌솥밥 정식은 밥과 반찬이 중심인 한 끼입니다."],
});

const REVIEWED_COLUMNS = Object.freeze([
  "menu_id",
  "restaurant_id",
  "restaurant_name",
  "menu_name",
  "category",
  "suggested_food_character",
  "reviewed_food_character",
  "review_status",
  "warning",
  "review_note",
]);

function validatePreview(preview) {
  if (!preview || !Array.isArray(preview.items) || preview.items.length !== 100) {
    throw new Error("검토 대상 preview는 정확히 100개여야 합니다.");
  }
  const previewIds = preview.items.map((item) => item.menu_id);
  if (new Set(previewIds).size !== previewIds.length) throw new Error("preview에 중복 menu_id가 있습니다.");
  const decisionIds = Object.keys(REVIEW_DECISIONS);
  const missing = previewIds.filter((id) => !REVIEW_DECISIONS[id]);
  const extra = decisionIds.filter((id) => !previewIds.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`검토 결정 ID 불일치: missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
  preview.items.forEach((item) => {
    if (!foodCharacter.isAllowedFoodCharacter(item.suggested_food_character)) {
      throw new Error(`${item.menu_id}의 자동 초안 값이 허용 범위를 벗어났습니다.`);
    }
    if (item.review_status !== "needs-review") {
      throw new Error(`${item.menu_id}의 preview 상태가 needs-review가 아닙니다.`);
    }
  });
}

function buildReviewedData(preview, reviewedAt = new Date().toISOString()) {
  validatePreview(preview);
  const items = preview.items.map((item) => {
    const [reviewedFoodCharacter, reviewNote] = REVIEW_DECISIONS[item.menu_id];
    if (!foodCharacter.isAllowedFoodCharacter(reviewedFoodCharacter) || !reviewNote) {
      throw new Error(`${item.menu_id}의 검토 결정이 올바르지 않습니다.`);
    }
    return {
      menu_id: item.menu_id,
      restaurant_id: item.store_id,
      restaurant_name: item.store_name,
      menu_name: item.menu_name,
      category: item.category,
      suggested_food_character: item.suggested_food_character,
      reviewed_food_character: reviewedFoodCharacter,
      review_status: "reviewed",
      warning: item.warning,
      review_note: reviewNote,
    };
  });
  const distribution = Object.fromEntries(foodCharacter.allowedValues.map((value) => [value, 0]));
  items.forEach((item) => { distribution[item.reviewed_food_character] += 1; });
  const changedItems = items.filter((item) => item.suggested_food_character !== item.reviewed_food_character);
  return {
    metadata: {
      purpose: "Human-reviewed FC-2 input candidate; not applied to Supabase",
      reviewed_at: reviewedAt,
      source_preview: "food-character-preview.json",
      db_applied: false,
      tags_used_for_review: false,
    },
    stats: {
      total_menus: items.length,
      reviewed_count: items.filter((item) => item.review_status === "reviewed").length,
      needs_human_confirmation_count: items.filter((item) => item.review_status === "needs-human-confirmation").length,
      same_as_suggestion_count: items.length - changedItems.length,
      changed_count: changedItems.length,
      warning_count: items.filter((item) => item.warning).length,
      distribution,
    },
    items,
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reviewedToCsv(reviewed) {
  const rows = reviewed.items.map((item) => REVIEWED_COLUMNS.map((column) => csvEscape(item[column])).join(","));
  return `${REVIEWED_COLUMNS.join(",")}\n${rows.join("\n")}\n`;
}

function markdownEscape(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function buildReviewDiff(reviewed) {
  const changedItems = reviewed.items.filter((item) => item.suggested_food_character !== item.reviewed_food_character);
  const warningItems = reviewed.items.filter((item) => item.warning);
  const distributionLines = foodCharacter.allowedValues
    .map((value) => `- ${value}: ${reviewed.stats.distribution[value]}`)
    .join("\n");
  const changedRows = changedItems.length
    ? changedItems.map((item) => `| ${item.menu_id} | ${markdownEscape(item.menu_name)} | ${item.suggested_food_character} | ${item.reviewed_food_character} | ${markdownEscape(item.review_note)} |`).join("\n")
    : "| - | 변경 없음 | - | - | - |";
  const warningRows = warningItems
    .map((item) => `| ${item.menu_id} | ${markdownEscape(item.restaurant_name)} | ${markdownEscape(item.menu_name)} | ${markdownEscape(item.category)} | ${item.suggested_food_character} | ${markdownEscape(item.warning)} | ${item.reviewed_food_character} | ${markdownEscape(item.review_note)} |`)
    .join("\n");
  return `# Food Character Review Diff

- 총 메뉴: ${reviewed.stats.total_menus}
- 자동 초안과 동일: ${reviewed.stats.same_as_suggestion_count}
- 사람 검토로 변경: ${reviewed.stats.changed_count}
- 추가 확인 필요: ${reviewed.stats.needs_human_confirmation_count}

## Primary 분포

${distributionLines}

## 변경된 메뉴

| ID | 메뉴 | 자동 초안 | 검토 결과 | 변경 이유 |
| --- | --- | --- | --- | --- |
${changedRows}

## 경고 ${warningItems.length}개 검토

| ID | 가게 | 메뉴 | category | 자동 초안 | warning | 최종값 | 판단 이유 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${warningRows}
`;
}

function buildApprovedCandidate(reviewed) {
  return reviewed.items
    .filter((item) => item.review_status === "reviewed")
    .map((item) => ({ id: item.menu_id, food_character: item.reviewed_food_character }));
}

function writeReviewedFiles({
  previewFile = path.resolve(__dirname, "..", "docs", "food-character", "food-character-preview.json"),
  outputDirectory = path.dirname(previewFile),
  reviewedAt = new Date().toISOString(),
} = {}) {
  const preview = JSON.parse(fs.readFileSync(previewFile, "utf8"));
  const reviewed = buildReviewedData(preview, reviewedAt);
  const files = {
    json: path.join(outputDirectory, "food-character-reviewed.json"),
    csv: path.join(outputDirectory, "food-character-reviewed.csv"),
    diff: path.join(outputDirectory, "food-character-review-diff.md"),
    candidate: path.join(outputDirectory, "food-character-approved-candidate.json"),
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(files.json, `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");
  fs.writeFileSync(files.csv, reviewedToCsv(reviewed), "utf8");
  fs.writeFileSync(files.diff, buildReviewDiff(reviewed), "utf8");
  fs.writeFileSync(files.candidate, `${JSON.stringify(buildApprovedCandidate(reviewed), null, 2)}\n`, "utf8");
  return { reviewed, files };
}

if (require.main === module) {
  const result = writeReviewedFiles();
  console.log(JSON.stringify({
    files: Object.fromEntries(Object.entries(result.files).map(([key, value]) => [key, path.relative(process.cwd(), value)])),
    stats: result.reviewed.stats,
  }, null, 2));
}

module.exports = Object.freeze({
  REVIEW_DECISIONS,
  REVIEWED_COLUMNS,
  buildApprovedCandidate,
  buildReviewDiff,
  buildReviewedData,
  reviewedToCsv,
  validatePreview,
  writeReviewedFiles,
});
