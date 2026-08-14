import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
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
