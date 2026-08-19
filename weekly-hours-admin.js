(function initWeeklyHoursAdmin(root, factory) {
  const api = factory();
  if (root) root.CHANGWON_ADMIN_WEEKLY_HOURS = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createWeeklyHoursAdmin() {
  const WEEKDAYS = Object.freeze([
    { isoWeekday: 1, label: "월요일", shortLabel: "월" },
    { isoWeekday: 2, label: "화요일", shortLabel: "화" },
    { isoWeekday: 3, label: "수요일", shortLabel: "수" },
    { isoWeekday: 4, label: "목요일", shortLabel: "목" },
    { isoWeekday: 5, label: "금요일", shortLabel: "금" },
    { isoWeekday: 6, label: "토요일", shortLabel: "토" },
    { isoWeekday: 7, label: "일요일", shortLabel: "일" },
  ]);
  const DAY_STATUSES = Object.freeze(["open", "closed", "unknown"]);
  const BREAK_STATUSES = Object.freeze(["scheduled", "none", "unknown"]);
  const DAY_STATUS_LABELS = Object.freeze({
    open: "영업",
    closed: "정기휴무",
    unknown: "정보 미확인",
  });
  const HOUR_OPTIONS = Object.freeze(Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")));
  const CLOSING_HOUR_OPTIONS = Object.freeze([...HOUR_OPTIONS, "24"]);
  const MINUTE_QUICK_OPTIONS = Object.freeze(["00", "30"]);
  const TIME_FIELDS = Object.freeze(["open_time", "close_time", "break_start", "break_end"]);
  const EDITABLE_FIELDS = Object.freeze([
    "day_status",
    "open_time",
    "close_time",
    "closes_next_day",
    "break_status",
    "break_start",
    "break_end",
    "note",
  ]);
  const COMPARED_FIELDS = Object.freeze([
    ...EDITABLE_FIELDS,
    "source",
    "last_verified_at",
  ]);
  const SCHEDULE_FIELDS = Object.freeze([
    "day_status",
    "open_time",
    "close_time",
    "closes_next_day",
    "break_status",
    "break_start",
    "break_end",
  ]);
  const DB_WRITE_FIELDS = Object.freeze([
    "restaurant_id",
    "iso_weekday",
    "day_status",
    "open_time",
    "close_time",
    "closes_next_day",
    "break_status",
    "break_start",
    "break_end",
    "note",
    "source",
    "last_verified_at",
  ]);
  const STALE_FIELDS = Object.freeze([...DB_WRITE_FIELDS, "updated_at"]);
  const WEEKLY_SELECT_COLUMNS = STALE_FIELDS.join(",");

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
    }
    return value;
  }

  function cloneRows(rows) {
    return Array.isArray(rows) ? rows.map((row) => cloneValue(row)) : [];
  }

  function normalizeTime(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
    return match ? `${match[1]}:${match[2]}` : trimmed || null;
  }

  function normalizeText(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  function normalizeTimePart(value) {
    if (value == null) return "";
    const trimmed = String(value).trim();
    return /^\d$/.test(trimmed) ? `0${trimmed}` : trimmed;
  }

  function parseAdminTimeInput(hourInput, minuteInput, { allow24 = false } = {}) {
    const hour = normalizeTimePart(hourInput);
    const minute = normalizeTimePart(minuteInput);
    const displayValue = hour || minute ? `${hour}:${minute}` : null;
    if (!hour && !minute) {
      return { valid: false, empty: true, hour, minute, displayValue, value: null, canonicalized24: false, error: null };
    }
    if (!/^\d{2}$/.test(hour) || Number(hour) < 0 || Number(hour) > 24) {
      return { valid: false, empty: false, hour, minute, displayValue, value: displayValue, canonicalized24: false, error: "시간은 00시부터 24시까지 입력해주세요." };
    }
    if (!/^\d{2}$/.test(minute) || Number(minute) < 0 || Number(minute) > 59) {
      return { valid: false, empty: false, hour, minute, displayValue, value: displayValue, canonicalized24: false, error: "분은 00분부터 59분까지 입력해주세요." };
    }
    if (hour === "24") {
      if (minute !== "00") {
        return { valid: false, empty: false, hour, minute, displayValue, value: displayValue, canonicalized24: false, error: "24시는 24:00으로만 사용할 수 있어요." };
      }
      if (!allow24) {
        return { valid: false, empty: false, hour, minute, displayValue, value: displayValue, canonicalized24: false, error: "24:00은 영업 마감 시간에만 사용할 수 있어요." };
      }
      return { valid: true, empty: false, hour, minute, displayValue, value: "00:00", canonicalized24: true, error: null };
    }
    return { valid: true, empty: false, hour, minute, displayValue, value: `${hour}:${minute}`, canonicalized24: false, error: null };
  }

  function formatAdminTimeInput(value, { allow24 = false, closesNextDay = false } = {}) {
    const normalized = normalizeTime(value);
    if (!normalized) return { hour: "", minute: "", displayValue: "" };
    if (allow24 && closesNextDay && normalized === "00:00") {
      return { hour: "24", minute: "00", displayValue: "24:00" };
    }
    const separator = normalized.indexOf(":");
    if (separator < 0) return { hour: normalized, minute: "", displayValue: normalized };
    return {
      hour: normalized.slice(0, separator),
      minute: normalized.slice(separator + 1),
      displayValue: normalized,
    };
  }

  function validateAdminTime(value, { allow24 = false } = {}) {
    const formatted = formatAdminTimeInput(value);
    return parseAdminTimeInput(formatted.hour, formatted.minute, { allow24 });
  }

  function adminTimeOptions(part, { allow24 = false } = {}) {
    if (part === "hour") return [...(allow24 ? CLOSING_HOUR_OPTIONS : HOUR_OPTIONS)];
    if (part === "minute") return [...MINUTE_QUICK_OPTIONS];
    return [];
  }

  function dayStatusLabel(value) {
    return DAY_STATUS_LABELS[value] || "상태 확인 필요";
  }

  function hasSpecialClosureRule(value) {
    const text = normalizeText(value);
    return Boolean(text && /(?:번째|주차|매월|격주|홀수|짝수|\d+\s*주)/.test(text));
  }

  function normalizeWeeklyRow(row, restaurantId) {
    return {
      restaurant_id: row?.restaurant_id || restaurantId || "",
      iso_weekday: Number(row?.iso_weekday),
      day_status: row?.day_status || "unknown",
      open_time: normalizeTime(row?.open_time),
      close_time: normalizeTime(row?.close_time),
      closes_next_day: row?.closes_next_day === true,
      break_status: row?.break_status || "unknown",
      break_start: normalizeTime(row?.break_start),
      break_end: normalizeTime(row?.break_end),
      note: normalizeText(row?.note),
      source: normalizeText(row?.source),
      last_verified_at: row?.last_verified_at || null,
      updated_at: row?.updated_at || null,
    };
  }

  function normalizeWeeklyRows(rows, restaurantId) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => normalizeWeeklyRow(row, restaurantId))
      .sort((left, right) => left.iso_weekday - right.iso_weekday);
  }

  function createUnknownDraft(restaurantId) {
    return WEEKDAYS.map(({ isoWeekday }) => ({
      restaurant_id: restaurantId,
      iso_weekday: isoWeekday,
      day_status: "unknown",
      open_time: null,
      close_time: null,
      closes_next_day: false,
      break_status: "unknown",
      break_start: null,
      break_end: null,
      note: null,
      source: null,
      last_verified_at: null,
      updated_at: null,
    }));
  }

  function normalizeDayShape(row) {
    const next = cloneValue(row);
    if (next.day_status === "closed") {
      next.open_time = null;
      next.close_time = null;
      next.closes_next_day = false;
      next.break_status = "none";
      next.break_start = null;
      next.break_end = null;
    } else if (next.day_status === "unknown") {
      next.open_time = null;
      next.close_time = null;
      next.closes_next_day = false;
      next.break_status = "unknown";
      next.break_start = null;
      next.break_end = null;
    } else if (next.break_status !== "scheduled") {
      next.break_start = null;
      next.break_end = null;
    }
    return next;
  }

  function updateDayField(rows, isoWeekday, field, value) {
    if (!EDITABLE_FIELDS.includes(field)) return cloneRows(rows);
    return cloneRows(rows).map((row) => {
      if (row.iso_weekday !== Number(isoWeekday)) return row;
      const next = { ...row };
      if (field === "day_status") {
        if (!DAY_STATUSES.includes(value)) return row;
        next.day_status = value;
      } else if (field === "break_status") {
        if (!BREAK_STATUSES.includes(value) || next.day_status !== "open") return row;
        next.break_status = value;
      } else if (["open_time", "close_time", "break_start", "break_end"].includes(field)) {
        next[field] = normalizeTime(value);
      } else if (field === "closes_next_day") {
        next.closes_next_day = value === true;
      } else if (field === "note") {
        next.note = normalizeText(value);
      }
      return normalizeDayShape(next);
    });
  }

  function updateAdminTimeField(rows, isoWeekday, field, hourInput, minuteInput) {
    if (!TIME_FIELDS.includes(field)) return cloneRows(rows);
    const parsed = parseAdminTimeInput(hourInput, minuteInput, { allow24: field === "close_time" });
    let next = updateDayField(rows, isoWeekday, field, parsed.value);
    if (field === "close_time" && parsed.canonicalized24) {
      next = updateDayField(next, isoWeekday, "closes_next_day", true);
    }
    return next;
  }

  function applyDayToTargets(rows, sourceIsoWeekday, targetIsoWeekdays) {
    const draft = cloneRows(rows);
    const source = draft.find((row) => row.iso_weekday === Number(sourceIsoWeekday));
    const targets = new Set((targetIsoWeekdays || []).map(Number).filter((day) => day >= 1 && day <= 7));
    if (!source || targets.size === 0) return draft;
    return draft.map((row) => {
      if (!targets.has(row.iso_weekday) || row.iso_weekday === source.iso_weekday) return row;
      const next = { ...row };
      EDITABLE_FIELDS.forEach((field) => {
        next[field] = cloneValue(source[field]);
      });
      return normalizeDayShape(next);
    });
  }

  function rowMap(rows) {
    return new Map((rows || []).map((row) => [Number(row.iso_weekday), row]));
  }

  function hasCompleteWeek(rows) {
    const days = new Set(rows.map((row) => row.iso_weekday));
    return rows.length === 7 && WEEKDAYS.every(({ isoWeekday }) => days.has(isoWeekday));
  }

  function sameValue(left, right) {
    return (left ?? null) === (right ?? null);
  }

  function diffWeeklyHours(originalRows, draftRows) {
    const original = rowMap(normalizeWeeklyRows(originalRows));
    const draft = rowMap(normalizeWeeklyRows(draftRows));
    return WEEKDAYS.flatMap(({ isoWeekday, label }) => {
      const before = original.get(isoWeekday) || null;
      const after = draft.get(isoWeekday) || null;
      if (!before && !after) return [];
      const changes = COMPARED_FIELDS.flatMap((field) => {
        const previousValue = before?.[field] ?? null;
        const nextValue = after?.[field] ?? null;
        return sameValue(previousValue, nextValue) ? [] : [{ field, previousValue, nextValue }];
      });
      return changes.length ? [{ isoWeekday, label, before, after, changes }] : [];
    });
  }

  function summarizeWeeklyStatus(rows) {
    const normalized = normalizeWeeklyRows(rows);
    const rowCount = normalized.length;
    const unknownDays = normalized.filter((row) => row.day_status === "unknown").length;
    const unverifiedDays = normalized.filter((row) => !row.last_verified_at).length;
    if (rowCount === 0) {
      return { kind: "legacy", rowCount, unknownDays, unverifiedDays, label: "기존 영업정보 사용 중 · 새 시간표 미등록" };
    }
    if (!hasCompleteWeek(normalized)) {
      return { kind: "incomplete", rowCount, unknownDays, unverifiedDays, label: `영업시간 데이터 불완전 (${rowCount}/7)` };
    }
    if (unknownDays > 0) {
      return { kind: "unknown", rowCount, unknownDays, unverifiedDays, label: `정보 미확인 ${unknownDays}일 · 확인 필요` };
    }
    if (unverifiedDays > 0) {
      return { kind: "unverified", rowCount, unknownDays, unverifiedDays, label: "이전 데이터 이관 · 확인 필요" };
    }
    return { kind: "verified", rowCount, unknownDays, unverifiedDays, label: "영업시간 확인 완료" };
  }

  function minutes(value) {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function validateWeeklyDraft(rows) {
    const normalized = normalizeWeeklyRows(rows);
    const errors = [];
    if (!hasCompleteWeek(normalized)) {
      errors.push({ isoWeekday: null, field: "rows", message: "월요일부터 일요일까지 정확히 7개 요일이 필요합니다." });
      return { valid: false, errors };
    }
    for (const row of normalized) {
      const day = row.iso_weekday;
      if (!DAY_STATUSES.includes(row.day_status)) {
        errors.push({ isoWeekday: day, field: "day_status", message: "요일 상태가 올바르지 않습니다." });
        continue;
      }
      if (row.day_status === "open") {
        const openTime = validateAdminTime(row.open_time);
        const closeTime = validateAdminTime(row.close_time, { allow24: true });
        if (openTime.empty) errors.push({ isoWeekday: day, field: "open_time", message: "오픈 시간을 입력해주세요." });
        else if (!openTime.valid) errors.push({ isoWeekday: day, field: "open_time", message: openTime.error });
        if (closeTime.empty) errors.push({ isoWeekday: day, field: "close_time", message: "마감 시간을 입력해주세요." });
        else if (!closeTime.valid) errors.push({ isoWeekday: day, field: "close_time", message: closeTime.error });
        if (openTime.valid && closeTime.valid && !row.closes_next_day && minutes(closeTime.value) <= minutes(openTime.value)) {
          errors.push({ isoWeekday: day, field: "close_time", message: "마감이 다음 날이라면 '자정을 넘어 영업해요'를 선택해주세요." });
        }
        if (!BREAK_STATUSES.includes(row.break_status)) {
          errors.push({ isoWeekday: day, field: "break_status", message: "브레이크 상태가 올바르지 않습니다." });
        } else if (row.break_status === "scheduled") {
          const breakStart = validateAdminTime(row.break_start);
          const breakEnd = validateAdminTime(row.break_end);
          if (breakStart.empty || breakEnd.empty) {
            errors.push({ isoWeekday: day, field: "break_time", message: "브레이크 시작·종료 시간을 모두 입력해주세요." });
          } else {
            if (!breakStart.valid) errors.push({ isoWeekday: day, field: "break_start", message: breakStart.error });
            if (!breakEnd.valid) errors.push({ isoWeekday: day, field: "break_end", message: breakEnd.error });
          }
        }
      } else if (row.open_time || row.close_time || row.closes_next_day || row.break_start || row.break_end) {
        errors.push({ isoWeekday: day, field: "shape", message: "휴무 또는 미확인 요일에는 시간값을 둘 수 없습니다." });
      } else if (row.day_status === "closed" && row.break_status !== "none") {
        errors.push({ isoWeekday: day, field: "break_status", message: "정기휴무의 브레이크 상태는 없음이어야 합니다." });
      } else if (row.day_status === "unknown" && row.break_status !== "unknown") {
        errors.push({ isoWeekday: day, field: "break_status", message: "정보 미확인 요일의 브레이크도 미확인이어야 합니다." });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  function formatWeeklySummary(row) {
    if (!row) return "정보 없음";
    if (row.day_status === "closed") return "정기휴무";
    if (row.day_status === "unknown") return "정보 미확인";
    const openTime = formatAdminTimeInput(row.open_time).displayValue || "--:--";
    const closeTime = formatAdminTimeInput(row.close_time, { allow24: true, closesNextDay: row.closes_next_day });
    const closeLabel = row.closes_next_day && closeTime.displayValue !== "24:00"
      ? `다음 날 ${closeTime.displayValue || "--:--"}`
      : closeTime.displayValue || "--:--";
    const hours = `${openTime} ~ ${closeLabel}`;
    if (row.break_status === "scheduled") return `${hours} · 브레이크 ${row.break_start || "--:--"} ~ ${row.break_end || "--:--"}`;
    if (row.break_status === "none") return `${hours} · 브레이크 없음`;
    return `${hours} · 브레이크 미확인`;
  }

  function isRequestCurrent(current, request) {
    return Boolean(
      current && request &&
      current.generation === request.generation &&
      current.source === request.source &&
      current.restaurantId === request.restaurantId,
    );
  }

  function createSaveError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  function canonicalDbTime(value) {
    const normalized = normalizeTime(value);
    return normalized && /^\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  }

  function rowFieldsEqual(left, right, fields) {
    const normalizedLeft = normalizeWeeklyRow(left, left?.restaurant_id || right?.restaurant_id);
    const normalizedRight = normalizeWeeklyRow(right, right?.restaurant_id || left?.restaurant_id);
    return fields.every((field) => sameValue(normalizedLeft[field], normalizedRight[field]));
  }

  function weeklySnapshotsMatch(expectedRows, actualRows) {
    const expected = normalizeWeeklyRows(expectedRows);
    const actual = normalizeWeeklyRows(actualRows);
    if (expected.length !== actual.length) return false;
    const actualByDay = rowMap(actual);
    return expected.every((row) => {
      const candidate = actualByDay.get(row.iso_weekday);
      return candidate && rowFieldsEqual(row, candidate, STALE_FIELDS);
    });
  }

  function weeklyDraftToDbRows({
    restaurantId,
    originalRows = [],
    draftRows,
    verificationConfirmed = false,
    verifiedAt = null,
  }) {
    const original = normalizeWeeklyRows(originalRows, restaurantId);
    const draft = normalizeWeeklyRows(draftRows, restaurantId);
    if (!restaurantId || !draft.every((row) => row.restaurant_id === restaurantId)) {
      throw createSaveError("restaurant-mismatch", "저장 대상 가게가 일치하지 않습니다.");
    }
    if (original.length !== 0 && !hasCompleteWeek(original)) {
      throw createSaveError("partial-original", "영업시간 데이터가 7일 기준과 맞지 않아 저장할 수 없습니다. 데이터를 먼저 확인해주세요.");
    }
    const validation = validateWeeklyDraft(draft);
    if (!validation.valid) {
      throw createSaveError("invalid-draft", "요일별 영업시간 입력을 확인해주세요.", validation.errors);
    }
    if (verificationConfirmed && (!verifiedAt || Number.isNaN(Date.parse(verifiedAt)))) {
      throw createSaveError("invalid-verification-time", "영업시간 확인 시각을 만들지 못했습니다.");
    }
    const originalByDay = rowMap(original);
    return draft.map((row) => {
      const before = originalByDay.get(row.iso_weekday) || null;
      const scheduleChanged = !before || !rowFieldsEqual(before, row, SCHEDULE_FIELDS);
      const editableChanged = !before || !rowFieldsEqual(before, row, EDITABLE_FIELDS);
      const source = verificationConfirmed || editableChanged ? "admin_manual" : before?.source || null;
      const lastVerifiedAt = verificationConfirmed
        ? verifiedAt
        : !before || scheduleChanged
          ? null
          : before.last_verified_at;
      return {
        restaurant_id: restaurantId,
        iso_weekday: row.iso_weekday,
        day_status: row.day_status,
        open_time: canonicalDbTime(row.open_time),
        close_time: canonicalDbTime(row.close_time),
        closes_next_day: row.closes_next_day,
        break_status: row.break_status,
        break_start: canonicalDbTime(row.break_start),
        break_end: canonicalDbTime(row.break_end),
        note: row.note,
        source,
        last_verified_at: lastVerifiedAt,
      };
    });
  }

  function buildWeeklySavePlan(options) {
    const originalRows = normalizeWeeklyRows(options?.originalRows, options?.restaurantId);
    const expectedRows = weeklyDraftToDbRows(options || {});
    const mode = originalRows.length === 0 ? "insert" : "upsert";
    const originalByDay = rowMap(originalRows);
    const changedRows = mode === "insert"
      ? expectedRows
      : expectedRows.filter((row) => !rowFieldsEqual(originalByDay.get(row.iso_weekday), row, DB_WRITE_FIELDS));
    return {
      restaurantId: options.restaurantId,
      mode,
      originalRows: cloneRows(originalRows),
      changedRows: cloneRows(changedRows),
      expectedRows: cloneRows(expectedRows),
      changedIsoWeekdays: changedRows.map((row) => row.iso_weekday),
      verificationConfirmed: options.verificationConfirmed === true,
      verifiedAt: options.verificationConfirmed === true ? options.verifiedAt : null,
    };
  }

  function assessWeeklySave(options = {}) {
    if (options.source !== "supabase") return { canSave: false, code: "static-source", message: "정적 데이터에서는 영업시간을 저장할 수 없습니다.", plan: null };
    if (!options.adminAuthorized || !options.catalogEditable) return { canSave: false, code: "unauthorized", message: "영업시간을 수정할 관리자 권한이 없습니다.", plan: null };
    if (!options.restaurantExists) return { canSave: false, code: "restaurant-mismatch", message: "저장할 가게를 다시 선택해주세요.", plan: null };
    if (!options.restaurantId || options.restaurantId !== options.selectedRestaurantId) return { canSave: false, code: "restaurant-mismatch", message: "저장할 가게를 다시 선택해주세요.", plan: null };
    if (options.generation !== options.currentGeneration) return { canSave: false, code: "stale-context", message: "가게 선택 상태가 변경되었습니다. 다시 확인해주세요.", plan: null };
    if (options.saving) return { canSave: false, code: "saving", message: "저장 중입니다.", plan: null };
    if (options.hasSpecialClosure) return { canSave: false, code: "special-closure", message: "특수 휴무 규칙이 있어 기본 주간 시간표만 저장할 수 없습니다. 특수 휴무 기능 구현 후 처리해주세요.", plan: null };
    const originalRows = Array.isArray(options.originalRows) ? options.originalRows : [];
    const draftRows = Array.isArray(options.draftRows) ? options.draftRows : [];
    if (
      originalRows.some((row) => row?.restaurant_id !== options.restaurantId) ||
      draftRows.some((row) => row?.restaurant_id !== options.restaurantId)
    ) {
      return { canSave: false, code: "restaurant-mismatch", message: "저장할 가게를 다시 선택해주세요.", plan: null };
    }
    let plan;
    try {
      plan = buildWeeklySavePlan(options);
    } catch (error) {
      return { canSave: false, code: error.code || "invalid-draft", message: error.message, plan: null, details: error.details || null };
    }
    if (plan.changedRows.length === 0) return { canSave: false, code: "clean", message: "변경된 영업시간이 없습니다.", plan };
    return { canSave: true, code: "ready", message: "저장할 수 있습니다.", plan };
  }

  function verifyWeeklyWriteResult(plan, rows) {
    const normalized = normalizeWeeklyRows(rows, plan.restaurantId);
    if (normalized.length !== plan.changedRows.length) return false;
    const expectedKeys = new Set(plan.changedRows.map((row) => `${row.restaurant_id}:${row.iso_weekday}`));
    return normalized.every((row) => expectedKeys.has(`${row.restaurant_id}:${row.iso_weekday}`));
  }

  function verifyWeeklyReadBack(plan, rows) {
    const actual = normalizeWeeklyRows(rows, plan.restaurantId);
    if (!hasCompleteWeek(actual) || actual.some((row) => !row.updated_at)) return false;
    const actualByDay = rowMap(actual);
    const originalByDay = rowMap(plan.originalRows);
    const changedDays = new Set(plan.changedIsoWeekdays);
    for (const expected of plan.expectedRows) {
      const candidate = actualByDay.get(expected.iso_weekday);
      if (!candidate || !rowFieldsEqual(expected, candidate, DB_WRITE_FIELDS)) return false;
      const before = originalByDay.get(expected.iso_weekday);
      if (!changedDays.has(expected.iso_weekday) && before && !sameValue(before.updated_at, candidate.updated_at)) return false;
      if (changedDays.has(expected.iso_weekday) && before?.updated_at && sameValue(before.updated_at, candidate.updated_at)) return false;
    }
    return true;
  }

  function createWeeklyHoursPersistence(client) {
    if (!client?.from) throw createSaveError("client-unavailable", "Supabase 연결을 확인해주세요.");
    async function unwrap(query, fallbackMessage) {
      const { data, error } = await query;
      if (error) {
        if (!error.message) error.message = fallbackMessage;
        throw error;
      }
      return Array.isArray(data) ? data : [];
    }
    return Object.freeze({
      preRead(restaurantId) {
        return unwrap(
          client.from("restaurant_weekly_hours").select(WEEKLY_SELECT_COLUMNS).eq("restaurant_id", restaurantId).order("iso_weekday", { ascending: true }),
          "현재 영업시간을 확인하지 못했습니다.",
        );
      },
      insertRows(rows) {
        return unwrap(
          client.from("restaurant_weekly_hours").insert(rows).select(WEEKLY_SELECT_COLUMNS),
          "요일별 영업시간 생성에 실패했습니다.",
        );
      },
      upsertRows(rows) {
        return unwrap(
          client.from("restaurant_weekly_hours").upsert(rows, { onConflict: "restaurant_id,iso_weekday" }).select(WEEKLY_SELECT_COLUMNS),
          "요일별 영업시간 수정에 실패했습니다.",
        );
      },
      readBack(restaurantId) {
        return unwrap(
          client.from("restaurant_weekly_hours").select(WEEKLY_SELECT_COLUMNS).eq("restaurant_id", restaurantId).order("iso_weekday", { ascending: true }),
          "저장 결과를 확인하지 못했습니다.",
        );
      },
    });
  }

  async function executeWeeklyHoursSave({ permissionGranted, persistence, plan, isCurrent = () => true }) {
    if (permissionGranted !== true) throw createSaveError("unauthorized", "영업시간을 수정할 관리자 권한이 없습니다.");
    if (!plan?.changedRows?.length) throw createSaveError("clean", "저장할 영업시간 변경 사항이 없습니다.");
    if (!isCurrent()) throw createSaveError("stale-context", "가게 선택 상태가 변경되었습니다. 다시 확인해주세요.");
    const currentRows = await persistence.preRead(plan.restaurantId);
    if (!isCurrent()) throw createSaveError("stale-context", "가게 선택 상태가 변경되었습니다. 다시 확인해주세요.");
    if (!weeklySnapshotsMatch(plan.originalRows, currentRows)) {
      throw createSaveError("stale-data", "영업시간 정보가 다른 곳에서 변경되었습니다. 새로고침 후 다시 확인해주세요.");
    }
    const writtenRows = plan.mode === "insert"
      ? await persistence.insertRows(plan.changedRows)
      : await persistence.upsertRows(plan.changedRows);
    if (!verifyWeeklyWriteResult(plan, writtenRows)) {
      throw createSaveError("write-count-mismatch", "저장된 요일 수가 예상과 다릅니다.");
    }
    if (!isCurrent()) throw createSaveError("stale-context", "가게 선택 상태가 변경되었습니다. 저장 결과를 새 화면에 반영하지 않습니다.");
    const readBackRows = await persistence.readBack(plan.restaurantId);
    if (!isCurrent()) throw createSaveError("stale-context", "가게 선택 상태가 변경되었습니다. 저장 결과를 새 화면에 반영하지 않습니다.");
    if (!verifyWeeklyReadBack(plan, readBackRows)) {
      throw createSaveError("readback-mismatch", "저장 결과 확인에 실패했습니다.");
    }
    return normalizeWeeklyRows(readBackRows, plan.restaurantId);
  }

  return Object.freeze({
    BREAK_STATUSES,
    DB_WRITE_FIELDS,
    DAY_STATUS_LABELS,
    DAY_STATUSES,
    EDITABLE_FIELDS,
    MINUTE_QUICK_OPTIONS,
    SCHEDULE_FIELDS,
    STALE_FIELDS,
    WEEKDAYS,
    adminTimeOptions,
    applyDayToTargets,
    assessWeeklySave,
    buildWeeklySavePlan,
    cloneRows,
    createUnknownDraft,
    createWeeklyHoursPersistence,
    diffWeeklyHours,
    dayStatusLabel,
    formatAdminTimeInput,
    formatWeeklySummary,
    hasSpecialClosureRule,
    isRequestCurrent,
    executeWeeklyHoursSave,
    normalizeWeeklyRows,
    parseAdminTimeInput,
    summarizeWeeklyStatus,
    updateAdminTimeField,
    updateDayField,
    validateAdminTime,
    validateWeeklyDraft,
    verifyWeeklyReadBack,
    weeklyDraftToDbRows,
    weeklySnapshotsMatch,
  });
});
