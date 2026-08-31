const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const WEEKLY = require("../weekly-hours-admin");

const root = path.resolve(__dirname, "..");
const preview = JSON.parse(fs.readFileSync(path.join(root, "docs", "weekly-hours", "initial-migration-preview.json"), "utf8"));
const adminCss = fs.readFileSync(path.join(root, "admin.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const swJs = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const weeklyJs = fs.readFileSync(path.join(root, "weekly-hours-admin.js"), "utf8");

function rowsFor(id) {
  return preview.rows.filter((row) => row.restaurant_id === id);
}

function openDay(id = "C010", isoWeekday = 1) {
  return WEEKLY.normalizeWeeklyRows(rowsFor(id), id).find((row) => row.iso_weekday === isoWeekday);
}

test("weekly load normalization deep-clones, sorts, and formats HH:MM", () => {
  const source = rowsFor("C010").toReversed();
  const normalized = WEEKLY.normalizeWeeklyRows(source, "C010");
  assert.deepEqual(normalized.map((row) => row.iso_weekday), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(normalized[0].open_time, "10:30");
  normalized[0].open_time = "11:00";
  assert.equal(source.find((row) => row.iso_weekday === 1).open_time, "10:30:00");
});

test("seven complete rows receive a non-partial status", () => {
  const summary = WEEKLY.summarizeWeeklyStatus(rowsFor("C010"));
  assert.equal(summary.rowCount, 7);
  assert.equal(summary.kind, "unverified");
  assert.equal(summary.label, "이전 데이터 이관 · 확인 필요");
});

test("zero rows remain a Legacy state", () => {
  assert.deepEqual(WEEKLY.summarizeWeeklyStatus([]), {
    kind: "legacy",
    rowCount: 0,
    unknownDays: 0,
    unverifiedDays: 0,
    label: "기존 영업정보 사용 중 · 새 시간표 미등록",
  });
});

test("day status labels keep unknown distinct from closed", () => {
  assert.equal(WEEKLY.dayStatusLabel("open"), "영업");
  assert.equal(WEEKLY.dayStatusLabel("closed"), "정기휴무");
  assert.equal(WEEKLY.dayStatusLabel("unknown"), "정보 미확인");
  assert.notEqual(WEEKLY.dayStatusLabel("unknown"), WEEKLY.dayStatusLabel("closed"));
});

test("partial and duplicate row sets fail closed", () => {
  const six = rowsFor("C010").slice(0, 6);
  assert.equal(WEEKLY.summarizeWeeklyStatus(six).kind, "incomplete");
  assert.equal(WEEKLY.validateWeeklyDraft(six).valid, false);
  const duplicate = [...six, { ...six[0] }];
  assert.equal(WEEKLY.summarizeWeeklyStatus(duplicate).kind, "incomplete");
  const outOfRange = rowsFor("C010").map((row) => ({ ...row }));
  outOfRange[6].iso_weekday = 8;
  assert.equal(WEEKLY.summarizeWeeklyStatus(outOfRange).kind, "incomplete");
  assert.equal(WEEKLY.validateWeeklyDraft(outOfRange).valid, false);
});

test("C010 rendering model preserves weekday hours, breaks, and weekend closures", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  rows.slice(0, 5).forEach((row) => {
    assert.equal(WEEKLY.formatWeeklySummary(row), "10:30 ~ 20:00 · 브레이크 14:30 ~ 17:00");
  });
  assert.deepEqual(rows.slice(5).map(WEEKLY.formatWeeklySummary), ["정기휴무", "정기휴무"]);
});

test("C027 rendering model preserves six scheduled-break days and Sunday closure", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C027"), "C027");
  rows.slice(0, 6).forEach((row) => {
    assert.equal(WEEKLY.formatWeeklySummary(row), "10:30 ~ 21:00 · 브레이크 15:00 ~ 16:00");
  });
  assert.equal(WEEKLY.formatWeeklySummary(rows[6]), "정기휴무");
});

test("C003 remains seven explicit unknown days", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C003"), "C003");
  assert.equal(WEEKLY.summarizeWeeklyStatus(rows).unknownDays, 7);
  assert.ok(rows.every((row) => WEEKLY.formatWeeklySummary(row) === "정보 미확인"));
});

test("C005 and C024 have no migrated rows and C024 is not auto-converted", () => {
  assert.equal(rowsFor("C005").length, 0);
  assert.equal(rowsFor("C024").length, 0);
  const localDraft = WEEKLY.createUnknownDraft("C024");
  assert.equal(localDraft.length, 7);
  assert.ok(localDraft.every((row) => row.day_status === "unknown"));
  assert.equal(localDraft.filter((row) => row.day_status === "closed").length, 0);
});

test("day status normalization clears incompatible fields", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  const closed = WEEKLY.updateDayField(rows, 1, "day_status", "closed")[0];
  assert.deepEqual(
    [closed.open_time, closed.close_time, closed.closes_next_day, closed.break_status, closed.break_start, closed.break_end],
    [null, null, false, "none", null, null],
  );
  const unknown = WEEKLY.updateDayField(rows, 1, "day_status", "unknown")[0];
  assert.equal(unknown.break_status, "unknown");
});

test("break normalization clears times for none and unknown", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  const none = WEEKLY.updateDayField(rows, 1, "break_status", "none")[0];
  assert.deepEqual([none.break_status, none.break_start, none.break_end], ["none", null, null]);
  const unknown = WEEKLY.updateDayField(rows, 1, "break_status", "unknown")[0];
  assert.deepEqual([unknown.break_status, unknown.break_start, unknown.break_end], ["unknown", null, null]);
});

test("weekday bulk apply copies editable Monday fields only", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  const changed = WEEKLY.updateDayField(rows, 1, "open_time", "11:00");
  const applied = WEEKLY.applyDayToTargets(changed, 1, [2, 3, 4, 5]);
  assert.ok(applied.slice(0, 5).every((row) => row.open_time === "11:00"));
  assert.equal(applied[5].day_status, "closed");
  assert.equal(applied[1].last_verified_at, rows[1].last_verified_at);
});

test("selected-day bulk apply leaves untargeted days unchanged", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  const applied = WEEKLY.applyDayToTargets(rows, 6, [2, 7]);
  assert.equal(applied[1].day_status, "closed");
  assert.equal(applied[6].day_status, "closed");
  assert.equal(applied[2].day_status, "open");
});

test("one-level undo snapshot restores the pre-bulk draft", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  const undo = WEEKLY.cloneRows(rows);
  const applied = WEEKLY.applyDayToTargets(rows, 6, [1, 2, 3]);
  assert.notDeepEqual(applied, undo);
  assert.deepEqual(WEEKLY.cloneRows(undo), rows);
});

test("diff reports changed weekdays and reset returns to original", () => {
  const original = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  const draft = WEEKLY.updateDayField(original, 2, "open_time", "11:00");
  const diff = WEEKLY.diffWeeklyHours(original, draft);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].isoWeekday, 2);
  assert.equal(diff[0].changes[0].field, "open_time");
  assert.equal(WEEKLY.diffWeeklyHours(original, WEEKLY.cloneRows(original)).length, 0);
});

test("source or restaurant generation drift rejects stale responses", () => {
  const request = { generation: 4, source: "supabase", restaurantId: "C001" };
  assert.equal(WEEKLY.isRequestCurrent({ ...request }, request), true);
  assert.equal(WEEKLY.isRequestCurrent({ ...request, generation: 5 }, request), false);
  assert.equal(WEEKLY.isRequestCurrent({ ...request, source: "static" }, request), false);
  assert.equal(WEEKLY.isRequestCurrent({ ...request, restaurantId: "C010" }, request), false);
});

test("validation accepts imported C010 and rejects missing scheduled breaks", () => {
  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  assert.equal(WEEKLY.validateWeeklyDraft(rows).valid, true);
  const missingBreak = WEEKLY.updateDayField(rows, 1, "break_start", "");
  assert.equal(WEEKLY.validateWeeklyDraft(missingBreak).valid, false);
});

test("overnight validation requires next-day intent", () => {
  let rows = WEEKLY.createUnknownDraft("LOCAL");
  rows = WEEKLY.updateDayField(rows, 1, "day_status", "open");
  rows = WEEKLY.updateDayField(rows, 1, "open_time", "18:00");
  rows = WEEKLY.updateDayField(rows, 1, "close_time", "02:00");
  assert.match(WEEKLY.validateWeeklyDraft(rows).errors.map((error) => error.message).join(" "), /자정을 넘어 영업해요/);
  rows = WEEKLY.updateDayField(rows, 1, "closes_next_day", true);
  assert.doesNotMatch(WEEKLY.validateWeeklyDraft(rows).errors.map((error) => error.message).join(" "), /자정을 넘어 영업해요/);
});

test("hybrid time parser preserves keyboard hour entry and quick minute options", () => {
  assert.deepEqual(
    ["00:00", "00:30", "23:30"].map((value) => {
      const [hour, minute] = value.split(":");
      const parsed = WEEKLY.parseAdminTimeInput(hour, minute);
      return [parsed.valid, parsed.value];
    }),
    [[true, "00:00"], [true, "00:30"], [true, "23:30"]],
  );
  assert.equal(WEEKLY.parseAdminTimeInput("0", "0").value, "00:00");
  assert.deepEqual(WEEKLY.adminTimeOptions("minute"), ["00", "30"]);
});

test("hour option lists stay complete regardless of the current value", () => {
  const openHours = WEEKLY.adminTimeOptions("hour");
  const closingHours = WEEKLY.adminTimeOptions("hour", { allow24: true });
  assert.deepEqual(openHours, Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")));
  assert.deepEqual(closingHours, [...openHours, "24"]);
  assert.ok(openHours.includes("10"));
  assert.ok(closingHours.includes("10"));
});

test("keyboard minutes 00 through 59 are valid while 60 is rejected", () => {
  ["10", "20", "40", "59"].forEach((minute) => {
    const parsed = WEEKLY.parseAdminTimeInput("20", minute);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.value, `20:${minute}`);
  });
  assert.equal(WEEKLY.parseAdminTimeInput("20", "60").valid, false);
  assert.match(WEEKLY.parseAdminTimeInput("20", "60").error, /00분부터 59분/);
  assert.equal(WEEKLY.parseAdminTimeInput("24", "30", { allow24: true }).valid, false);
  assert.match(WEEKLY.parseAdminTimeInput("24", "30", { allow24: true }).error, /24:00/);
});

test("24:00 closing time canonicalizes to next-day 00:00", () => {
  let rows = WEEKLY.createUnknownDraft("LOCAL");
  rows = WEEKLY.updateDayField(rows, 1, "day_status", "open");
  rows = WEEKLY.updateAdminTimeField(rows, 1, "open_time", "11", "00");
  rows = WEEKLY.updateAdminTimeField(rows, 1, "close_time", "24", "00");
  assert.equal(rows[0].close_time, "00:00");
  assert.equal(rows[0].closes_next_day, true);
  assert.deepEqual(
    WEEKLY.formatAdminTimeInput(rows[0].close_time, { allow24: true, closesNextDay: rows[0].closes_next_day }),
    { hour: "24", minute: "00", displayValue: "24:00" },
  );
  assert.equal(WEEKLY.validateWeeklyDraft(rows).valid, true);
});

test("selected and rerendered controls retain 11:00 through 19:00", () => {
  let rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  rows = WEEKLY.updateAdminTimeField(rows, 1, "open_time", "11", "00");
  rows = WEEKLY.updateAdminTimeField(rows, 1, "close_time", "19", "00");
  const monday = rows[0];
  assert.deepEqual(WEEKLY.formatAdminTimeInput(monday.open_time), {
    hour: "11",
    minute: "00",
    displayValue: "11:00",
  });
  assert.deepEqual(WEEKLY.formatAdminTimeInput(monday.close_time, {
    allow24: true,
    closesNextDay: monday.closes_next_day,
  }), {
    hour: "19",
    minute: "00",
    displayValue: "19:00",
  });
  assert.match(WEEKLY.formatWeeklySummary(monday), /^11:00 ~ 19:00/);
});

test("24:00 is rejected for opening and break fields", () => {
  assert.equal(WEEKLY.parseAdminTimeInput("24", "00").valid, false);
  assert.match(WEEKLY.parseAdminTimeInput("24", "00").error, /마감 시간에만/);
  let rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  rows = WEEKLY.updateAdminTimeField(rows, 1, "break_start", "24", "00");
  assert.equal(WEEKLY.validateWeeklyDraft(rows).valid, false);
});

test("DB HH:MM:SS values render as HH:MM without changing the source", () => {
  const source = [{ ...rowsFor("C010")[0] }];
  const normalized = WEEKLY.normalizeWeeklyRows(source, "C010");
  assert.equal(WEEKLY.formatAdminTimeInput(normalized[0].open_time).displayValue, "10:30");
  assert.equal(source[0].open_time, "10:30:00");
});

test("existing 20:40 and 21:10 values round-trip without normalization", () => {
  ["20:40:00", "21:10:00"].forEach((sourceValue) => {
    const rows = WEEKLY.normalizeWeeklyRows([{
      restaurant_id: "LEGACY",
      iso_weekday: 1,
      day_status: "open",
      open_time: "10:00:00",
      close_time: sourceValue,
      closes_next_day: false,
      break_status: "none",
    }], "LEGACY");
    const expected = sourceValue.slice(0, 5);
    assert.equal(rows[0].close_time, expected);
    assert.equal(WEEKLY.formatAdminTimeInput(rows[0].close_time).displayValue, expected);
    assert.equal(WEEKLY.validateAdminTime(rows[0].close_time).valid, true);
  });
});

test("all 112 migrated rows remain valid without minute rounding", () => {
  const restaurantIds = [...new Set(preview.rows.map((row) => row.restaurant_id))];
  restaurantIds.forEach((restaurantId) => {
    const validation = WEEKLY.validateWeeklyDraft(rowsFor(restaurantId));
    assert.equal(validation.valid, true, `${restaurantId}: ${validation.errors.map((error) => error.message).join(" ")}`);
  });
});

test("scheduled breaks accept exact non-half-hour legacy minutes", () => {
  let rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  rows = WEEKLY.updateAdminTimeField(rows, 1, "break_start", "14", "10");
  const validation = WEEKLY.validateWeeklyDraft(rows);
  assert.equal(validation.valid, true);
  assert.equal(rows[0].break_start, "14:10");
});

test("special closure rules are warned about but never interpreted", () => {
  assert.equal(WEEKLY.hasSpecialClosureRule("2,4번째 일요일"), true);
  assert.equal(WEEKLY.hasSpecialClosureRule("일요일"), false);
  const draft = WEEKLY.createUnknownDraft("C024");
  assert.ok(draft.every((row) => row.day_status === "unknown"));
  assert.match(adminJs, /특수 휴무 규칙 확인 필요/);
  assert.match(adminJs, /요일별 정기휴무로 자동 변환하지 않습니다/);
});

test("verification checkbox updates local state without direct network calls", () => {
  const start = adminJs.indexOf("function updateWeeklyVerificationDraft");
  const end = adminJs.indexOf("function weeklySaveFailureMessage");
  const verification = adminJs.slice(start, end);
  assert.match(verification, /verificationConfirmed/);
  assert.doesNotMatch(verification, /\.from\(|last_verified_at|\.update\(|\.upsert\(/);
});

test("weekly DML requires fresh runtime permission assessment", () => {
  const saveStart = adminJs.indexOf("async function saveWeeklyHours");
  const saveEnd = adminJs.indexOf("function handleFoodCharacterChange");
  const saveFunction = adminJs.slice(saveStart, saveEnd);
  assert.doesNotMatch(adminJs, /WEEKLY_HOURS_WRITE_ENABLED/);
  assert.match(saveFunction, /if \(!assessment\.canSave\)/);
  assert.ok(saveFunction.indexOf("if (!assessment.canSave)") < saveFunction.indexOf("createWeeklyHoursPersistence"));
  assert.match(saveFunction, /const finalAssessment = weeklySaveAssessment/);
  assert.match(saveFunction, /permissionGranted: finalAssessment\.canSave/);
  assert.match(weeklyJs, /if \(permissionGranted !== true\) throw createSaveError\("unauthorized"/);
  assert.doesNotMatch(weeklyJs, /\.update\(|\.delete\(/);
});

test("static source and save controls remain functionally locked", () => {
  assert.match(adminJs, /state\.catalogSource !== "supabase"/);
  assert.match(adminJs, /canEditSupabaseCatalog\(\)/);
  assert.match(adminJs, /data-weekly-save\$\{assessment\.canSave \? "" : " disabled"\}/);
  assert.match(weeklyJs, /영업시간을 수정할 관리자 권한이 없습니다/);
  assert.doesNotMatch(adminJs, /실제 저장 테스트 승인 전입니다|실제 DB 저장은 아직 비활성화/);
});

test("legacy form payload is independent from weekly draft fields", () => {
  const start = adminJs.indexOf("function appRestaurantToDb");
  const end = adminJs.indexOf("function appMenuToDb");
  const payload = adminJs.slice(start, end);
  assert.match(payload, /open_time: restaurant\.openTime/);
  assert.doesNotMatch(payload, /restaurant_weekly_hours|iso_weekday|day_status|break_status|closes_next_day/);
});

test("HTML and service worker load the helper before admin.js using cache v59", () => {
  assert.ok(adminHtml.indexOf('src="./weekly-hours-admin.js"') < adminHtml.indexOf('src="./admin.js"'));
  assert.match(adminHtml, /id="weeklyHoursEditor"/);
  assert.match(adminHtml, /SUPABASE 조회 · 임시 편집/);
  assert.match(adminJs, /data-weekly-time-part="hour"/);
  assert.match(adminJs, /role="combobox"/);
  assert.match(adminJs, /role="listbox"/);
  assert.match(adminJs, /data-weekly-time-toggle/);
  assert.match(adminJs, /addEventListener\("focusin"/);
  assert.match(adminJs, /handleWeeklyTimeComboboxKeydown/);
  assert.match(adminJs, /aria-expanded="false"/);
  assert.match(adminJs, /자정을 넘어 영업해요/);
  assert.match(swJs, /changwon-food-app-/);
  assert.match(swJs, /`\$\{CACHE_PREFIX\}v59`/);
  assert.match(swJs, /"\.\/weekly-hours-admin\.js"/);
});

test("time dropdown uses a readable single-column popover without clipping", () => {
  const renderTimePart = adminJs.slice(
    adminJs.indexOf("function renderWeeklyTimePart"),
    adminJs.indexOf("function renderWeeklyTimeControl"),
  );
  const openCombobox = adminJs.slice(
    adminJs.indexOf("function openWeeklyTimeCombobox"),
    adminJs.indexOf("function selectWeeklyTimeOption"),
  );
  assert.match(adminCss, /\.weekly-day-card\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(adminCss, /\.weekly-time-options\s*\{[^}]*position:\s*absolute;/s);
  assert.match(adminCss, /\.weekly-time-options\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(adminCss, /\.weekly-time-options\s*\{[^}]*min-width:\s*84px;/s);
  assert.match(adminCss, /\.weekly-time-options\s*\{[^}]*max-height:\s*288px;/s);
  assert.match(adminCss, /\.weekly-time-options\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(adminCss, /\.weekly-time-options\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(adminCss, /\.weekly-time-options button\s*\{[^}]*min-height:\s*38px;/s);
  assert.match(adminCss, /\.weekly-time-options button\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(adminCss, /\.weekly-time-row\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(adminCss, /\.weekly-time-parts\s*\{[^}]*grid-template-columns:\s*minmax\(70px,\s*1fr\)\s+auto\s+minmax\(70px,\s*1fr\);/s);
  assert.match(adminCss, /\.weekly-time-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(36px,\s*1fr\)\s+30px;/s);
  assert.match(adminCss, /\.weekly-time-parts input\s*\{[^}]*min-width:\s*36px;/s);
  assert.match(renderTimePart, /options\.map\(\(option\) => `<button[^`]*>\$\{option\}<\/button>`\)/);
  assert.match(renderTimePart, /aria-selected="\$\{option === value\}"/);
  assert.doesNotMatch(openCombobox, /\.filter\(/);
  assert.match(adminJs, /classList\.add\("has-open-time-list"\)/);
  assert.match(adminJs, /selectedOption\.offsetTop/);
});

test("3D-2 save preview names the restaurant and refreshes permission before DML", () => {
  const saveStart = adminJs.indexOf("async function saveWeeklyHours()");
  const savingLock = adminJs.indexOf("saving: true", saveStart);
  const authRefresh = adminJs.indexOf("await isAdminUser()", saveStart);
  assert.match(adminHtml, /Supabase 관리자 전용/);
  assert.ok(saveStart >= 0 && savingLock > saveStart && authRefresh > savingLock, "saving lock must precede async auth refresh");
  assert.ok(adminJs.indexOf("confirm(", saveStart) < adminJs.indexOf("createWeeklyHoursPersistence", saveStart));
  assert.match(adminJs, /저장 대상/);
  assert.match(adminJs, /\$\{escapeHtml\(restaurant\?\.name \|\| editor\.restaurantName\)\} \(\$\{escapeHtml\(editor\.restaurantId\)\}\)/);
  assert.match(adminJs, /data-weekly-save/);
  assert.match(weeklyJs, /영업시간을 수정할 관리자 권한이 없습니다/);
  assert.match(weeklyJs, /특수 휴무 기능 구현 후 처리해주세요/);
  assert.match(adminCss, /\.weekly-save-preview-head\s*\{[^}]*grid-template-columns:/s);
  assert.match(adminCss, /\.weekly-save-preview-actions\s*\{[^}]*display:\s*flex;/s);
});

test("URL and storage tokens cannot unlock weekly writes or hide the editor", () => {
  const renderStart = adminJs.indexOf("function renderWeeklyHoursEditor");
  const renderEnd = adminJs.indexOf("async function loadWeeklyHoursForRestaurant");
  const renderEditor = adminJs.slice(renderStart, renderEnd);
  const loadStart = renderEnd;
  const loadEnd = adminJs.indexOf("function foodCharacterMeta");
  const loadEditor = adminJs.slice(loadStart, loadEnd);
  const draftStart = adminJs.indexOf("function renderWeeklyDraft");
  const draftEnd = renderStart;
  const renderDraft = adminJs.slice(draftStart, draftEnd);

  assert.doesNotMatch(renderEditor, /controlled-write|location\.search|localStorage|sessionStorage/);
  assert.doesNotMatch(adminJs, /controlled-write|location\.search|localStorage|sessionStorage|WEEKLY_HOURS_WRITE_ENABLED/);
  assert.doesNotMatch(weeklyJs, /controlled-write|localStorage|sessionStorage|writeEnabled/);
  assert.match(adminJs, /generation: editor\.generation/);
  assert.match(adminJs, /currentGeneration: state\.weeklyHoursGeneration/);
  assert.match(renderEditor, /요일별 영업시간 편집 모듈을 불러오지 못했습니다/);
  assert.match(renderEditor, /els\.weeklyHoursContent\.innerHTML = renderWeeklyDraft/);
  assert.match(renderDraft, /rows\.map\(\(row\) => renderWeeklyDayCard\(row, openDays\)\)/);
  assert.match(loadEditor, /from\("restaurant_weekly_hours"\)/);
  assert.match(loadEditor, /renderWeeklyHoursEditor\(\)/);

  const rows = WEEKLY.normalizeWeeklyRows(rowsFor("C010"), "C010");
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.iso_weekday), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(WEEKLY.formatWeeklySummary(rows[0]), "10:30 ~ 20:00 · 브레이크 14:30 ~ 17:00");
  assert.deepEqual(rows.slice(5).map(WEEKLY.formatWeeklySummary), ["정기휴무", "정기휴무"]);
});

console.log("weekly hours admin 3D-1: read-only load, local draft, validation, bulk, diff, and race guards passed");
