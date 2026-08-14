import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evalAllConditions, evalCondition, repoMeta } from "./conditions.js";
import { git, gitRepo } from "./test-util.js";
import type { Job } from "./store.js";

function stub(cwd: string, when: string[]): Job {
  return {
    id: "c",
    createdAt: new Date().toISOString(),
    command: ["git", "status"],
    cwd,
    when,
    everyMs: 15_000,
    timeoutMs: 0,
    retry: 0,
    attempts: 0,
    requireSameBranch: false,
    dryRun: true,
    status: "pending",
    logFile: "x.log",
  };
}

test("clean passes on a fresh commit", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  const r = evalCondition(dir, "clean");
  assert.equal(r.ok, true);
});

test("clean fails when dirty", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  const r = evalCondition(dir, "clean");
  assert.equal(r.ok, false);
  assert.match(r.detail, /dirty/);
});

test("dirty is the inverse of clean", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  assert.equal(evalCondition(dir, "dirty").ok, true);
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  assert.equal(evalCondition(dir, "dirty").ok, false);
});

test("staged detects the index", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  assert.equal(evalCondition(dir, "staged").ok, false);
  git(dir, ["add", "a.txt"]);
  assert.equal(evalCondition(dir, "staged").ok, true);
});

test("branch= matches current branch", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  const name = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  assert.equal(evalCondition(dir, `branch=${name}`).ok, true);
  assert.equal(evalCondition(dir, "branch=definitely-not").ok, false);
});

test("file= passes only when that path is dirty", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  fs.writeFileSync(path.join(dir, "b.txt"), "hi");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "changed");
  assert.equal(evalCondition(dir, "file=a.txt").ok, true);
  assert.equal(evalCondition(dir, "file=b.txt").ok, false);
});

test("cmd: uses exit code", () => {
  const dir = gitRepo();
  assert.equal(evalCondition(dir, "cmd:node -e \"process.exit(0)\"").ok, true);
  assert.equal(evalCondition(dir, "cmd:node -e \"process.exit(2)\"").ok, false);
});

test("ahead without upstream is false", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  const r = evalCondition(dir, "ahead");
  assert.equal(r.ok, false);
  assert.match(r.detail, /upstream/);
});

test("behind without upstream is false", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  const r = evalCondition(dir, "behind");
  assert.equal(r.ok, false);
});

test("ahead is true after a local commit on a clone", () => {
  const origin = gitRepo();
  fs.writeFileSync(path.join(origin, "a.txt"), "hi");
  git(origin, ["add", "a.txt"]);
  git(origin, ["commit", "-m", "init"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-clone-"));
  fs.rmSync(dir, { recursive: true, force: true });
  const cloned = spawnSync("git", ["clone", origin, dir], { encoding: "utf8", windowsHide: true });
  assert.equal(cloned.status, 0, cloned.stderr || cloned.stdout);
  git(dir, ["config", "user.email", "t@t.test"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  assert.equal(evalCondition(dir, "ahead").ok, false);
  fs.writeFileSync(path.join(dir, "b.txt"), "x");
  git(dir, ["add", "b.txt"]);
  git(dir, ["commit", "-m", "local"]);
  assert.equal(evalCondition(dir, "ahead").ok, true);
  assert.equal(evalCondition(dir, "behind").ok, false);
});

test("unknown condition throws", () => {
  const dir = gitRepo();
  assert.throws(() => evalCondition(dir, "purple"), /Unknown condition/);
});

test("evalAllConditions ANDs specs and short-circuits", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  const all = evalAllConditions(stub(dir, ["dirty", "clean"]));
  assert.equal(all.ok, false);
  const none = evalAllConditions(stub(dir, []));
  assert.equal(none.ok, true);
  assert.equal(none.detail, "no conditions");
});

test("repoMeta reports git root and branch", () => {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  const meta = repoMeta(dir);
  assert.ok(meta.gitRoot);
  assert.ok(meta.branch);
});
