import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { argsHaveScheduleFlags, discoverRealGit, removeShim } from "./shim.js";
import { isolatedHome } from "./test-util.js";
import { shimDir } from "./store.js";

test("argsHaveScheduleFlags detects --in", () => {
  assert.equal(argsHaveScheduleFlags(["commit", "--in", "20m"]), true);
});

test("argsHaveScheduleFlags detects --in=20m", () => {
  assert.equal(argsHaveScheduleFlags(["commit", "--in=20m"]), true);
});

test("argsHaveScheduleFlags detects --when", () => {
  assert.equal(argsHaveScheduleFlags(["push", "--when", "clean"]), true);
});

test("argsHaveScheduleFlags ignores plain git argv", () => {
  assert.equal(argsHaveScheduleFlags(["status", "--porcelain"]), false);
  assert.equal(argsHaveScheduleFlags(["commit", "-m", "hi", "--include"]), false);
});

test("argsHaveScheduleFlags detects --dry-run and --now", () => {
  assert.equal(argsHaveScheduleFlags(["status", "--dry-run"]), true);
  assert.equal(argsHaveScheduleFlags(["status", "--now"]), true);
});

test("discoverRealGit honors GTIMED_REAL_GIT", () => {
  const prev = process.env.GTIMED_REAL_GIT;
  process.env.GTIMED_REAL_GIT = "C:\\made-up\\git.exe";
  try {
    assert.equal(discoverRealGit(), "C:\\made-up\\git.exe");
  } finally {
    if (prev == null) delete process.env.GTIMED_REAL_GIT;
    else process.env.GTIMED_REAL_GIT = prev;
  }
});

test("removeShim deletes leftover wrapper files", () => {
  isolatedHome();
  const dir = shimDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "git.cmd"), "echo shim", "utf8");
  fs.writeFileSync(path.join(dir, "git"), "#!/bin/sh\n", "utf8");
  fs.writeFileSync(path.join(process.env.GTIMED_HOME!, "env.sh"), "export PATH\n", "utf8");
  fs.writeFileSync(path.join(process.env.GTIMED_HOME!, "real-git"), "git", "utf8");
  removeShim();
  assert.equal(fs.existsSync(path.join(dir, "git.cmd")), false);
  assert.equal(fs.existsSync(path.join(dir, "git")), false);
  assert.equal(fs.existsSync(path.join(process.env.GTIMED_HOME!, "env.sh")), false);
  assert.equal(fs.existsSync(path.join(process.env.GTIMED_HOME!, "real-git")), false);
});
