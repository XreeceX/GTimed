import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleArgs } from "./parse.js";
import { argsHaveScheduleFlags } from "./shim.js";
import { parseDurationMs, parseWhen } from "./time.js";

test("duration parser", () => {
  assert.equal(parseDurationMs("30m"), 30 * 60_000);
  assert.equal(parseDurationMs("2h"), 2 * 3_600_000);
  assert.equal(parseDurationMs("1.5d"), 1.5 * 86_400_000);
  assert.equal(parseDurationMs("nope"), null);
});

test("strips schedule flags and implies git", () => {
  const p = parseScheduleArgs(["commit", "--at", "tomorrow 9am", "-m", "ship"]);
  assert.deepEqual(p.command, ["git", "commit", "-m", "ship"]);
  assert.equal(p.at, "tomorrow 9am");
});

test("keeps non-git CLIs intact", () => {
  const p = parseScheduleArgs(["--in", "20m", "--", "gh", "pr", "create", "--fill"]);
  assert.deepEqual(p.command, ["gh", "pr", "create", "--fill"]);
  assert.equal(p.in, "20m");
});

test("repeatable --when", () => {
  const p = parseScheduleArgs(["push", "--when", "clean", "--when", "ahead"]);
  assert.deepEqual(p.when, ["clean", "ahead"]);
  assert.deepEqual(p.command, ["git", "push"]);
});

test("parseWhen duration", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const d = parseWhen("45m", now);
  assert.equal(d.getTime() - now.getTime(), 45 * 60_000);
});

test("git commit -m message --in 20m", () => {
  const p = parseScheduleArgs([
    "git",
    "commit",
    "-m",
    "Hello world",
    "--in",
    "20m",
  ]);
  assert.deepEqual(p.command, ["git", "commit", "-m", "Hello world"]);
  assert.equal(p.in, "20m");
  assert.equal(argsHaveScheduleFlags(["commit", "-m", "Hello world", "--in", "20m"]), true);
  assert.equal(argsHaveScheduleFlags(["status", "--porcelain"]), false);
});
