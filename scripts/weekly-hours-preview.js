const fs = require("node:fs");
const path = require("node:path");

const WEEKDAYS = Object.freeze([
  { isoWeekday: 1, key: "mon", label: "월", legacyLabel: "월요일" },
  { isoWeekday: 2, key: "tue", label: "화", legacyLabel: "화요일" },
  { isoWeekday: 3, key: "wed", label: "수", legacyLabel: "수요일" },
  { isoWeekday: 4, key: "thu", label: "목", legacyLabel: "목요일" },
  { isoWeekday: 5, key: "fri", label: "금", legacyLabel: "금요일" },
  { isoWeekday: 6, key: "sat", label: "토", legacyLabel: "토요일" },
  { isoWeekday: 7, key: "sun", label: "일", legacyLabel: "일요일" },
]);

const CLASSIFICATIONS = Object.freeze({
  AUTO_SAFE: "AUTO_SAFE",
  UNKNOWN: "UNKNOWN",
  CLOSED_UNKNOWN: "MANUAL_REVIEW_CLOSED_UNKNOWN",
  CLOSED_RULE: "MANUAL_REVIEW_CLOSED_RULE",
  BREAK: "MANUAL_REVIEW_BREAK",
  TIME: "MANUAL_REVIEW_TIME",
  OVERNIGHT: "OVERNIGHT_REVIEW",
});

function readCatalog(dataPath) {
  const source = fs.readFileSync(dataPath, "utf8");
  const match = source.match(/window\.CHANGWON_FOOD_DATA\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  if (!match) throw new Error(`Could not parse catalog data: ${dataPath}`);
  return JSON.parse(match[1]);
}

function isUnknown(value) {
  return value == null || String(value).trim() === "" || String(value).trim() === "X";
}

function parseClock(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (!match) return null;
  return {
    text,
    minutes: Number(match[1]) * 60 + Number(match[2]),
  };
}

function parseBreak(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return {
    start: `${match[1]}:${match[2]}`,
    end: `${match[3]}:${match[4]}`,
  };
}

function parseSimpleClosedDays(value) {
  const text = String(value || "").trim();
  const labels = text.split(",").map((item) => item.trim()).filter(Boolean);
  if (!labels.length || labels.some((label) => !WEEKDAYS.some((day) => day.legacyLabel === label))) return null;
  return new Set(labels);
}

function breakIssue(value) {
  if (parseBreak(value)) return "BREAK_SCHEDULED_CLEAR";
  if (String(value || "").trim() === "") return "BREAK_BLANK_UNCONFIRMED";
  if (String(value || "").trim() === "X") return "BREAK_UNKNOWN";
  return CLASSIFICATIONS.BREAK;
}

function classifyRestaurant(restaurant) {
  const open = parseClock(restaurant.openTime);
  const close = parseClock(restaurant.closeTime);
  const closedText = String(restaurant.closedDays || "").trim();
  const secondaryIssue = breakIssue(restaurant.breakTime);

  if (isUnknown(restaurant.openTime) || isUnknown(restaurant.closeTime)) {
    return {
      classification: CLASSIFICATIONS.UNKNOWN,
      autoMigrate: true,
      reason: "Legacy opening, closing, and closure information is unavailable; preserve seven unknown days.",
      secondaryIssue,
    };
  }
  if (!open || !close) {
    return {
      classification: CLASSIFICATIONS.TIME,
      autoMigrate: false,
      reason: "Legacy opening or closing time is malformed.",
      secondaryIssue,
    };
  }
  if (close.minutes <= open.minutes) {
    return {
      classification: CLASSIFICATIONS.OVERNIGHT,
      autoMigrate: false,
      reason: "Closing time is not later than opening time and needs overnight review.",
      secondaryIssue,
    };
  }
  if (closedText.includes("번째")) {
    return {
      classification: CLASSIFICATIONS.CLOSED_RULE,
      autoMigrate: false,
      reason: "The recurring monthly closure cannot be represented by weekly rows alone.",
      secondaryIssue,
    };
  }
  if (isUnknown(closedText)) {
    return {
      classification: CLASSIFICATIONS.CLOSED_UNKNOWN,
      autoMigrate: false,
      reason: "Opening hours are known but weekly closure days are unverified; create no rows.",
      secondaryIssue,
    };
  }
  if (!parseSimpleClosedDays(closedText)) {
    return {
      classification: CLASSIFICATIONS.CLOSED_RULE,
      autoMigrate: false,
      reason: "The closure text is not a simple weekly rule.",
      secondaryIssue,
    };
  }
  return {
    classification: CLASSIFICATIONS.AUTO_SAFE,
    autoMigrate: true,
    reason: "Opening, closing, and simple weekly closure values are explicit.",
    secondaryIssue,
  };
}

function baseRow(restaurant, day) {
  return {
    restaurantId: restaurant.id,
    isoWeekday: day.isoWeekday,
    closesNextDay: false,
    note: null,
    source: "legacy-hours-v1",
    lastVerifiedAt: null,
  };
}

function buildGeneratedRows(restaurant, classification) {
  if (classification === CLASSIFICATIONS.UNKNOWN) {
    return WEEKDAYS.map((day) => ({
      ...baseRow(restaurant, day),
      dayStatus: "unknown",
      openTime: null,
      closeTime: null,
      breakStatus: "unknown",
      breakStart: null,
      breakEnd: null,
      note: "Legacy weekly hours are unavailable.",
    }));
  }

  if (classification !== CLASSIFICATIONS.AUTO_SAFE) return [];

  const closedDays = parseSimpleClosedDays(restaurant.closedDays);
  const scheduledBreak = parseBreak(restaurant.breakTime);
  return WEEKDAYS.map((day) => {
    if (closedDays.has(day.legacyLabel)) {
      return {
        ...baseRow(restaurant, day),
        dayStatus: "closed",
        openTime: null,
        closeTime: null,
        breakStatus: "none",
        breakStart: null,
        breakEnd: null,
      };
    }
    return {
      ...baseRow(restaurant, day),
      dayStatus: "open",
      openTime: restaurant.openTime,
      closeTime: restaurant.closeTime,
      breakStatus: scheduledBreak ? "scheduled" : "unknown",
      breakStart: scheduledBreak?.start || null,
      breakEnd: scheduledBreak?.end || null,
      note: scheduledBreak ? null : "Legacy break time is unverified.",
    };
  });
}

function buildRestaurantPreview(restaurant) {
  const classification = classifyRestaurant(restaurant);
  const generatedRows = buildGeneratedRows(restaurant, classification.classification);
  const generatedByDay = new Map(generatedRows.map((row) => [row.isoWeekday, row]));
  return {
    id: restaurant.id,
    name: restaurant.name,
    legacyBefore: {
      openTime: restaurant.openTime,
      closeTime: restaurant.closeTime,
      breakTime: restaurant.breakTime,
      closedDays: restaurant.closedDays,
    },
    ...classification,
    generatedRows,
    proposedAfter: WEEKDAYS.map((day) => ({
      isoWeekday: day.isoWeekday,
      label: day.label,
      action: generatedByDay.has(day.isoWeekday) ? "insert" : "no-row",
      row: generatedByDay.get(day.isoWeekday) || null,
    })),
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key];
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function buildPreview(catalog) {
  const restaurants = [...catalog.restaurants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(buildRestaurantPreview);
  const generatedRows = restaurants.flatMap((restaurant) => restaurant.generatedRows);
  return {
    version: 1,
    strategy: "weekly-v1-with-legacy-fallback",
    restaurantCount: restaurants.length,
    expectedCompleteWeeklyRows: restaurants.length * WEEKDAYS.length,
    immediatelySafeRows: generatedRows.length,
    manualReviewRows: restaurants.filter((item) => !item.autoMigrate).length * WEEKDAYS.length,
    futureRecurringRowsForC024: 2,
    classifications: countBy(restaurants, "classification"),
    secondaryIssues: countBy(restaurants, "secondaryIssue"),
    generatedRows,
    restaurants,
  };
}

function scheduleCell(day) {
  if (day.action === "no-row") return "NO ROW";
  const row = day.row;
  if (row.dayStatus === "closed") return "closed; time NULL; break none";
  if (row.dayStatus === "unknown") return "unknown; time NULL; break unknown";
  const breakText = row.breakStatus === "scheduled"
    ? `break ${row.breakStart}-${row.breakEnd}`
    : "break unknown";
  return `open ${row.openTime}-${row.closeTime}; ${breakText}`;
}

function renderMarkdown(preview, options = {}) {
  const snapshotSha = options.snapshotSha || "not-recorded";
  const lines = [
    "# Weekly Hours Migration Preview",
    "",
    "> Historical preview record. The schema and this 112-row dataset were applied manually on 2026-08-16; the user app still uses the legacy hours reader.",
    "",
    "## Baseline",
    "",
    `- Live/static restaurant count: ${preview.restaurantCount}`,
    `- Live snapshot SHA-256: \`${snapshotSha}\``,
    "- Live/static legacy-hours differences: 0",
    `- Immediately safe weekly rows: ${preview.immediatelySafeRows}`,
    `- Manual-review weekly rows not generated: ${preview.manualReviewRows}`,
    `- Complete weekly target: ${preview.expectedCompleteWeeklyRows}`,
    "",
    "## Rules",
    "",
    "- AUTO_SAFE creates seven rows and maps simple closed weekdays to `closed`.",
    "- Empty or `X` break values become `break_status = unknown`, never `none`.",
    "- UNKNOWN creates seven explicit unknown rows.",
    "- CLOSED_UNKNOWN and special closure rules create no rows.",
    "- `closes_next_day` is false for every current preview row.",
    "",
    "## 29 Restaurants",
    "",
    "| ID | Name | Legacy before | Classification / auto | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const restaurant of preview.restaurants) {
    const before = restaurant.legacyBefore;
    const legacy = `open=${before.openTime || "(blank)"}; close=${before.closeTime || "(blank)"}; break=${before.breakTime || "(blank)"}; closed=${before.closedDays || "(blank)"}`;
    const cells = restaurant.proposedAfter.map(scheduleCell);
    lines.push(
      `| ${restaurant.id} | ${restaurant.name} | ${legacy} | ${restaurant.classification} / ${restaurant.autoMigrate ? "YES" : "NO"} | ${cells.join(" | ")} | ${restaurant.reason} |`,
    );
  }

  lines.push(
    "",
    "## C024",
    "",
    "C024 remains on the legacy reader. Weekly rows are not generated because `2,4번째 일요일` cannot be represented as every-Sunday closure. A future recurring-closure design would add two rows for ISO weekday 7 and weeks 2 and 4.",
    "",
    "## 3C-2 Initial Migration Package",
    "",
    "The initial migration contains only the 12 AUTO_SAFE and 4 UNKNOWN restaurants: 16 restaurants, 112 rows, and seven ISO weekdays per restaurant. All 13 manual-review restaurants, including C024, remain at zero rows.",
    "",
    "The field-level BEFORE to AFTER review is in `initial-migration-preview.md`; the deterministic 112-row dataset is in `initial-migration-preview.json`.",
    "",
    "## Row Counts",
    "",
    "- AUTO_SAFE: 12 x 7 = 84 rows",
    "- UNKNOWN: 4 x 7 = 28 rows",
    "- Immediately safe total: 112 rows",
    "- CLOSED_UNKNOWN: 12 x 7 = 84 rows after manual verification",
    "- C024: 7 weekly rows plus 2 future recurring rows after recurring support",
    "- Complete weekly table: 29 x 7 = 203 rows",
  );
  return `${lines.join("\n")}\n`;
}

if (require.main === module) {
  const dataPath = process.argv.find((argument) => argument.endsWith(".js"))
    || path.join(__dirname, "..", "data.js");
  const preview = buildPreview(readCatalog(dataPath));
  if (process.argv.includes("--markdown")) {
    process.stdout.write(renderMarkdown(preview));
  } else {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  }
}

module.exports = {
  CLASSIFICATIONS,
  WEEKDAYS,
  buildPreview,
  buildRestaurantPreview,
  classifyRestaurant,
  parseBreak,
  parseClock,
  readCatalog,
  renderMarkdown,
};
