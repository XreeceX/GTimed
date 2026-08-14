import assert from "node:assert/strict";
import test from "node:test";
import { FLAGS, GIT_VERBS, MANAGEMENT, parseScheduleArgs, quote } from "./parse.js";
import { argsHaveScheduleFlags } from "./shim.js";

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

test("git commit -m message --in 20m", () => {
  const p = parseScheduleArgs(["git", "commit", "-m", "Hello world", "--in", "20m"]);
  assert.deepEqual(p.command, ["git", "commit", "-m", "Hello world"]);
  assert.equal(p.in, "20m");
  assert.equal(argsHaveScheduleFlags(["commit", "-m", "Hello world", "--in", "20m"]), true);
  assert.equal(argsHaveScheduleFlags(["status", "--porcelain"]), false);
});

test("inline --in=10m", () => {
  const p = parseScheduleArgs(["push", "--in=10m"]);
  assert.equal(p.in, "10m");
  assert.deepEqual(p.command, ["git", "push"]);
});

test("boolean flags", () => {
  const p = parseScheduleArgs(["status", "--now", "--dry-run", "--same-branch"]);
  assert.equal(p.now, true);
  assert.equal(p.dryRun, true);
  assert.equal(p.sameBranch, true);
  assert.deepEqual(p.command, ["git", "status"]);
});

test("name timeout retry cwd until cron", () => {
  const p = parseScheduleArgs([
    "fetch",
    "--name",
    "nightly",
    "--timeout",
    "2m",
    "--retry",
    "3",
    "--cwd",
    "../other",
    "--until",
    "Fri 6pm",
    "--cron",
    "0 18 * * 1-5",
  ]);
  assert.equal(p.name, "nightly");
  assert.equal(p.timeout, "2m");
  assert.equal(p.retry, "3");
  assert.equal(p.cwd, "../other");
  assert.equal(p.until, "Fri 6pm");
  assert.equal(p.cron, "0 18 * * 1-5");
  assert.deepEqual(p.command, ["git", "fetch"]);
});

test("does not double-prefix git", () => {
  const p = parseScheduleArgs(["git", "push", "origin", "main", "--in", "1h"]);
  assert.deepEqual(p.command, ["git", "push", "origin", "main"]);
});

test("-- stops flag parsing so wrapped --in is kept", () => {
  const p = parseScheduleArgs(["--in", "1h", "--", "tool", "--in", "mine"]);
  assert.equal(p.in, "1h");
  assert.deepEqual(p.command, ["tool", "--in", "mine"]);
});

test("missing value for --in throws", () => {
  assert.throws(() => parseScheduleArgs(["push", "--in"]), /Missing value for --in/);
});

test("missing value when next token is a flag throws", () => {
  assert.throws(() => parseScheduleArgs(["push", "--in", "--when", "clean"]), /Missing value for --in/);
});

test("unknown dashes stay on the wrapped command", () => {
  const p = parseScheduleArgs(["push", "--force-with-lease", "--in", "5m"]);
  assert.deepEqual(p.command, ["git", "push", "--force-with-lease"]);
  assert.equal(p.in, "5m");
});

test("quote wraps spaces and escaped quotes", () => {
  assert.equal(quote(["git", "commit", "-m", "Hello world"]), 'git commit -m "Hello world"');
  assert.equal(quote(["say", 'he said "hi"']), 'say "he said \\"hi\\""');
});

test("status is a git verb so it is scheduled not a management command", () => {
  assert.equal(GIT_VERBS.has("status"), true);
  assert.equal(MANAGEMENT.has("status"), true);
});

test("FLAGS cover in at when cron now", () => {
  assert.equal(FLAGS["--in"], "value");
  assert.equal(FLAGS["--when"], "repeat");
  assert.equal(FLAGS["--now"], "boolean");
});

test("every git verb used in docs is recognized", () => {
  for (const v of ["commit", "push", "fetch", "add", "pull", "status", "log"]) {
    assert.equal(GIT_VERBS.has(v), true, v);
  }
});
