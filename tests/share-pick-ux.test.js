const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const fixtures = [
  { id: "M010", name: "섞어 부리또", restaurant: { name: "리코리코" }, price: 5000, available: true },
  { id: "M031", name: "된장찌개", restaurant: { name: "엄마손" }, price: 6000, available: true },
  { id: "M043", name: "베이컨 크림 리조또", restaurant: { name: "레빗테이블" }, price: 11000, available: true },
];

const sharedPickMessage = new Function(
  "money",
  `${extractFunctionSource(appSource, "sharedPickMessage")}; return sharedPickMessage;`,
)((value) => `${Number(value).toLocaleString("ko-KR")}원`);

const shareUrlRuntime = new Function(
  "URL",
  "APP_SHARE_URL",
  "ACQUISITION_SOURCE_PARAM",
  "SHARE_ACQUISITION_SOURCE",
  "SHARED_PICK_VERSION_PARAM",
  "SHARED_PICK_VERSION",
  "SHARED_PICK_MENUS_PARAM",
  `${extractFunctionSource(appSource, "buildOfficialShareUrl")};
   ${extractFunctionSource(appSource, "buildSharedPickUrl")};
   return { buildSharedPickUrl };`,
)(URL, "https://changwon-food-app.vercel.app/", "src", "share", "sharedPick", "v1", "menus");

const sharedUrl = shareUrlRuntime.buildSharedPickUrl(fixtures.map((item) => item.id));
const expectedClipboardMessage = [
  "묵찌 PICK! 메뉴 3개 - 오늘 뭐 먹지?",
  "묵찌가 3개 골랐어!",
  "",
  "1. 섞어 부리또 · 리코리코 · 5,000원",
  "2. 된장찌개 · 엄마손 · 6,000원",
  "3. 베이컨 크림 리조또 · 레빗테이블 · 11,000원",
  "",
  "우리 뭐 먹을까?",
  sharedUrl,
].join("\n");

function createShareRuntime(navigatorValue, copyResult = true) {
  const copiedValues = [];
  const recordedMethods = [];
  const toasts = [];
  const state = { sharePickPending: false, quickItems: fixtures.map((item) => ({ ...item })) };
  const button = { disabled: false };
  const shareCurrentPick = new Function(
    "state",
    "navigator",
    "buildSharedPickUrl",
    "sharedPickMessage",
    "els",
    "toast",
    "copyTextToClipboard",
    "analyticsClient",
    `${extractFunctionSource(appSource, "shareCurrentPick").replace(/^function /, "async function ")}; return shareCurrentPick;`,
  )(
    state,
    navigatorValue,
    shareUrlRuntime.buildSharedPickUrl,
    sharedPickMessage,
    { sharePickButton: button },
    (message) => toasts.push(message),
    async (value) => {
      copiedValues.push(value);
      return copyResult;
    },
    { recordShareSuccess: (method) => recordedMethods.push(method) },
  );
  return { button, copiedValues, recordedMethods, shareCurrentPick, state, toasts };
}

test("clipboard fallback copies all three menu details and the ordered sharedPick URL", async () => {
  const runtime = createShareRuntime({});
  await runtime.shareCurrentPick();

  assert.deepEqual(runtime.copiedValues, [expectedClipboardMessage]);
  assert.equal(runtime.copiedValues[0].split("\n").at(-1), sharedUrl);
  assert.deepEqual(runtime.recordedMethods, ["clipboard"]);
  assert.deepEqual(runtime.toasts, ["추천 메뉴와 링크를 복사했어요. 채팅방에 붙여넣어 주세요."]);
  assert.equal(runtime.state.sharePickPending, false);
  assert.equal(runtime.button.disabled, false);
});

test("supported Web Share receives title, menu text, and URL without clipboard fallback", async () => {
  const payloads = [];
  const canSharePayloads = [];
  const runtime = createShareRuntime({
    canShare: (payload) => { canSharePayloads.push(payload); return true; },
    share: async (payload) => { payloads.push(payload); },
  });
  await runtime.shareCurrentPick();

  assert.equal(payloads.length, 1);
  assert.deepEqual(canSharePayloads, payloads);
  assert.equal(payloads[0].title, "묵찌 PICK! 메뉴 3개");
  fixtures.forEach((item) => assert.match(payloads[0].text, new RegExp(item.name)));
  assert.equal(payloads[0].url, sharedUrl);
  assert.deepEqual(runtime.copiedValues, []);
  assert.deepEqual(runtime.recordedMethods, ["web_share"]);
});

test("canShare false or throw uses clipboard without invoking native share", async () => {
  for (const canShare of [() => false, () => { throw new Error("blocked"); }]) {
    let shareCalls = 0;
    const runtime = createShareRuntime({
      canShare,
      share: async () => { shareCalls += 1; },
    });
    await runtime.shareCurrentPick();
    assert.equal(shareCalls, 0);
    assert.deepEqual(runtime.copiedValues, [expectedClipboardMessage]);
    assert.deepEqual(runtime.recordedMethods, ["clipboard"]);
  }
});

test("Web Share remains compatible when canShare is unavailable", async () => {
  let shareCalls = 0;
  const runtime = createShareRuntime({ share: async () => { shareCalls += 1; } });
  await runtime.shareCurrentPick();
  assert.equal(shareCalls, 1);
  assert.deepEqual(runtime.copiedValues, []);
  assert.deepEqual(runtime.recordedMethods, ["web_share"]);
});

test("sharePickPending prevents concurrent share and analytics duplication", async () => {
  let resolveShare;
  let shareCalls = 0;
  const runtime = createShareRuntime({
    share: () => {
      shareCalls += 1;
      return new Promise((resolve) => { resolveShare = resolve; });
    },
  });
  const first = runtime.shareCurrentPick();
  const second = runtime.shareCurrentPick();
  assert.equal(shareCalls, 1);
  assert.equal(runtime.state.sharePickPending, true);
  resolveShare();
  await Promise.all([first, second]);
  assert.deepEqual(runtime.recordedMethods, ["web_share"]);
  assert.equal(runtime.state.sharePickPending, false);
});

test("user cancellation does not copy, toast, or record analytics", async () => {
  const runtime = createShareRuntime({
    share: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
  });
  await runtime.shareCurrentPick();
  assert.deepEqual(runtime.copiedValues, []);
  assert.deepEqual(runtime.recordedMethods, []);
  assert.deepEqual(runtime.toasts, []);
});

test("non-Abort native errors fall back once and clipboard failures record no success", async () => {
  const failedNative = { share: async () => { throw new Error("failed"); } };
  const copied = createShareRuntime(failedNative, true);
  await copied.shareCurrentPick();
  assert.deepEqual(copied.copiedValues, [expectedClipboardMessage]);
  assert.deepEqual(copied.recordedMethods, ["clipboard"]);

  const copyFailed = createShareRuntime(failedNative, false);
  await copyFailed.shareCurrentPick();
  assert.deepEqual(copyFailed.recordedMethods, []);
  assert.deepEqual(copyFailed.toasts, ["추천 메뉴를 복사하지 못했어요. 다시 시도해 주세요."]);
});

test("sharedPick v1 parses and restores exactly three menu IDs in the original order", () => {
  const windowValue = { location: { href: sharedUrl, origin: "https://changwon-food-app.vercel.app" } };
  const data = { menus: fixtures.map((item) => ({ ...item })) };
  const parseSharedPickFromUrl = new Function(
    "window",
    "DATA",
    "SHARED_PICK_VERSION_PARAM",
    "SHARED_PICK_MENUS_PARAM",
    "SHARED_PICK_VERSION",
    `${extractFunctionSource(appSource, "parseSharedPickFromUrl")}; return parseSharedPickFromUrl;`,
  )(windowValue, data, "sharedPick", "menus", "v1");
  const resolveSharedPickItems = new Function(
    "DATA",
    "FALLBACK_LOCATION",
    "scoreMenu",
    `${extractFunctionSource(appSource, "resolveSharedPickItems")}; return resolveSharedPickItems;`,
  )(data, { lat: 35.2438, lng: 128.6916 }, (menu) => ({ ...menu }));

  const parsed = parseSharedPickFromUrl(sharedUrl);
  assert.deepEqual(parsed, { present: true, valid: true, ids: ["M010", "M031", "M043"] });
  assert.deepEqual(resolveSharedPickItems(parsed.ids).map((item) => item.id), ["M010", "M031", "M043"]);
  assert.equal(new URL(sharedUrl).searchParams.get("menus"), "M010,M031,M043");
});
