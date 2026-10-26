"use strict";

// Dependency-free entry point shared by Windows and GitHub Actions.
// This runs repository code: review changed tests before running locally.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const excluded = new Set([
  ".git", ".vercel", ".codex", "node_modules", "coverage",
  "test-results", "playwright-report",
]);

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) return javascriptFiles(absolute);
    if (entry.isFile() && /\.(?:c|m)?js$/.test(entry.name)) return [absolute];
    return [];
  }).sort();
}

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    timeout: 120000,
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

const sources = javascriptFiles(root);
const testsRoot = path.join(root, "tests") + path.sep;
const tests = sources.filter((file) => file.startsWith(testsRoot) && file.endsWith(".test.js"));
if (tests.length === 0) {
  console.error("No tests found; refusing to report success.");
  process.exit(1);
}
for (const source of sources) run(["--check", source]);
console.log(`Syntax checks passed: ${sources.length} files. Running ${tests.length} test files.`);
run(["--test", ...tests]);
