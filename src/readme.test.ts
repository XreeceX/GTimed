import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScheduleArgs } from "./parse.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

function countSuiteTests(): number {
  const dir = path.join(root, "src");
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".test.ts")) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    n += [...text.matchAll(/^test\(/gm)].length;
  }
  return n;
}

function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

test("README test badge matches the number of test() cases", () => {
  const n = countSuiteTests();
  assert.match(readme, new RegExp(`tests-${n}`));
  assert.match(readme, new RegExp(`${n} tests`));
});

test("README in-page links match GitHub heading slugs", () => {
  const headings = [...readme.matchAll(/^#{1,6} (.+)$/gm)].map((m) => githubSlug(m[1] ?? ""));
  const slugs = new Set(headings);
  const links = [...readme.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)].map((m) => m[1] ?? "");
  assert.ok(links.length > 0);
  for (const id of links) {
    assert.ok(slugs.has(id), `missing heading for #${id} (have ${[...slugs].join(", ")})`);
  }
});

test("README points at files that exist in this repo", () => {
  for (const rel of [
    "LICENSE",
    "scripts/install.sh",
    "scripts/install.ps1",
    "scripts/install.mjs",
    ".github/workflows/ci.yml",
    "vscode-extension/README.md",
    "vscode-extension/extension.js",
    "ui/index.html",
    "ui/app.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  }
});

test("README install one-liners match the bootstrap scripts", () => {
  assert.match(readme, /irm https:\/\/raw\.githubusercontent\.com\/XreeceX\/GTimed\/master\/scripts\/install\.ps1 \| iex/);
  assert.match(readme, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/XreeceX\/GTimed\/master\/scripts\/install\.sh \| sh/);
  assert.match(readme, /not Git Bash/);
  const ps = fs.readFileSync(path.join(root, "scripts", "install.ps1"), "utf8");
  const sh = fs.readFileSync(path.join(root, "scripts", "install.sh"), "utf8");
  assert.match(ps, /scripts\/install\.mjs/);
  assert.match(sh, /scripts\/install\.mjs/);
  assert.doesNotMatch(ps, /git clone/);
  assert.doesNotMatch(sh, /git clone/);
});

test("README schedule examples parse as real gtimed jobs", () => {
  const examples: string[][] = [
    ["commit", "--in", "20m", "-m", "Hello world"],
    ["push", "--at", "tomorrow 9am"],
    ["--when", "clean", "--", "git", "push"],
    ["commit", "--in", "20m", "-m", "fix login"],
    ["push", "--in", "10m"],
    ["fetch", "--cron", "0 */4 * * *"],
    ["--in", "30m", "--", "gh", "pr", "create", "--fill"],
    ["push", "--in", "20m"],
    ["commit", "--in", "1h", "-m", "a"],
    ["commit", "-m", "x", "--in", "1h"],
    ["git", "push", "origin", "main", "--in", "1h"],
    ["--in", "1h", "--", "git", "push", "origin", "main"],
    ["push", "--in", "20m", "--sb", "--to", "2m", "--dry"],
    ["--when", "clean", "--when", "ahead", "--", "git", "push"],
    ["--when", "branch=main", "--when", "remote-ok", "--", "git", "push"],
    ["--when", "file=package.json", "--", "git", "add", "package.json"],
    ["--when", "cmd:npm test", "--", "git", "push"],
    ["--when", "dirty", "--until", "tomorrow 6pm", "--", "git", "add", "-A"],
  ];
  for (const argv of examples) {
    const p = parseScheduleArgs(argv);
    assert.ok(p.command.length, argv.join(" "));
    assert.ok(p.in || p.at || p.cron || p.when.length || p.now, argv.join(" "));
  }
});

test("README documents gtm and not Graphite's gt", () => {
  assert.match(readme, /\bgtm\b/);
  assert.doesNotMatch(readme, /\bgt push\b/);
  assert.doesNotMatch(readme, /or: gt /);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    bin: Record<string, string>;
    engines: { node: string };
    license: string;
  };
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["gtimed", "gtm"]);
  assert.equal(pkg.engines.node, ">=18");
  assert.equal(pkg.license, "MIT");
  assert.match(fs.readFileSync(path.join(root, "LICENSE"), "utf8"), /MIT License/);
});

test("README matches local timezone, Node 18, and uninstall", () => {
  assert.match(readme, /machine’s timezone|machine's timezone/);
  assert.match(readme, /Jobs are still stored as UTC/);
  assert.match(readme, /Node\.js 18/);
  assert.match(readme, /npm uninstall -g gtimed/);
  assert.match(readme, /Task Scheduler on Windows, crontab on macOS\/Linux/);
  assert.match(readme, /127\.0\.0\.1:8787/);
  assert.match(readme, /~\/\.gtimed\/jobs\.json/);
});
