import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoState, stagePaths } from "./repo.js";

test("repoState reads porcelain in a temp repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-repo-"));
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@t.test"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  const before = repoState(dir);
  assert.equal(before.error, undefined);
  assert.equal(before.files.length, 1);
  assert.equal(before.files[0]?.untracked, true);
  const staged = stagePaths(dir, ["a.txt"], true);
  assert.equal(staged.ok, true);
  const after = repoState(dir);
  assert.equal(after.files[0]?.staged, true);

  fs.writeFileSync(path.join(dir, "hello world.txt"), "x");
  const spaced = repoState(dir);
  const hit = spaced.files.find((f) => f.path === "hello world.txt");
  assert.ok(hit, `expected unquoted path, got ${JSON.stringify(spaced.files.map((f) => f.path))}`);
  assert.equal(hit.untracked, true);
  const stagedSpace = stagePaths(dir, ["hello world.txt"], true);
  assert.equal(stagedSpace.ok, true);
});
