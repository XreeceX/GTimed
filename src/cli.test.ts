import assert from "node:assert/strict";
import test from "node:test";
import { isolatedHome, runCli } from "./test-util.js";

test("gtimed with no args prints help", () => {
  const home = isolatedHome();
  const r = runCli(home, []);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gtimed commit --in/);
  assert.doesNotMatch(r.stdout, /git commit -m .* --in/);
});

test("gtimed --help mentions overwrite", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /replaces the pending job/);
});

test("gtimed version prints semver", () => {
  const home = isolatedHome();
  const r = runCli(home, ["version"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("gtimed list on empty store", () => {
  const home = isolatedHome();
  const r = runCli(home, ["list"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no jobs/);
});

test("gtimed push --in 20m schedules git push", () => {
  const home = isolatedHome();
  const r = runCli(home, ["push", "--in", "20m"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scheduled [0-9a-f]{8}/);
  assert.match(r.stdout, /git push/);
});

test("gtimed tick on a future job says nothing due and still waiting", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const r = runCli(home, ["tick"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nothing due/);
  assert.match(r.stdout, /still waiting/);
});

test("reschedule prints updated and keeps one job", () => {
  const home = isolatedHome();
  const first = runCli(home, ["push", "--in", "20m"]);
  const id = /scheduled ([0-9a-f]{8})/.exec(first.stdout)?.[1];
  assert.ok(id);
  const second = runCli(home, ["push", "--in", "5m"]);
  assert.match(second.stdout, new RegExp(`updated ${id}`));
  const list = runCli(home, ["list"]);
  const pending = list.stdout.split("\n").filter((l) => l.includes("pending"));
  assert.equal(pending.length, 1);
});

test("gtimed abort cancels pending jobs", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const r = runCli(home, ["abort"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /aborted 1 pending job/);
  const list = runCli(home, ["list"]);
  assert.match(list.stdout, /cancelled/);
});

test("gtimed cancel last", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  runCli(home, ["status", "--in", "20m", "--dry-run"]);
  const r = runCli(home, ["cancel", "last"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cancelled/);
});

test("gtimed logs unknown id fails", () => {
  const home = isolatedHome();
  const r = runCli(home, ["logs", "deadbeef"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown job/);
});

test("gtimed --now --dry-run runs immediately", () => {
  const home = isolatedHome();
  const r = runCli(home, ["status", "--now", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ran [0-9a-f]{8} -> done/);
});

test("git-style flags after -- are not stolen from gh", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--in", "1h", "--", "gh", "pr", "create", "--fill"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gh pr create --fill/);
});

test("missing schedule flag errors", () => {
  const home = isolatedHome();
  const r = runCli(home, ["push"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Provide --at, --in, --cron, --when, or --now/);
});
