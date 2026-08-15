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

test("gtimed ls is an alias of list", () => {
  const home = isolatedHome();
  const a = runCli(home, ["list"]);
  const b = runCli(home, ["ls"]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
});

test("gtimed -V prints the same version as version", () => {
  const home = isolatedHome();
  const a = runCli(home, ["version"]);
  const b = runCli(home, ["-V"]);
  const c = runCli(home, ["--version"]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout, c.stdout);
});

test("gtimed push --in 20m schedules git push", () => {
  const home = isolatedHome();
  const r = runCli(home, ["push", "--in", "20m"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scheduled [0-9a-f]{8}/);
  assert.match(r.stdout, /git push/);
  assert.match(r.stdout, /not run yet/);
  assert.doesNotMatch(r.stdout, /run a tick with/);
  assert.doesNotMatch(r.stdout, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
});

test("gtimed tick on a future job says nothing due and still waiting", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const r = runCli(home, ["tick"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nothing due to run/);
  assert.match(r.stdout, /still waiting:/);
});

test("gtimed --tick is the same as tick", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const a = runCli(home, ["tick"]);
  const b = runCli(home, ["--tick"]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
});

test("gtimed --sb --dry --to schedules with the long-flag meaning", () => {
  const home = isolatedHome();
  const r = runCli(home, ["status", "--now", "--sb", "--dry", "--to", "2m"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /[0-9a-f]{8} -> done/);
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

test("gtimed --log with no jobs", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--log"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no jobs/);
});

test("gtimed --log prints the latest job log", () => {
  const home = isolatedHome();
  const ran = runCli(home, ["status", "--now", "--dry-run"]);
  assert.equal(ran.status, 0, ran.stderr);
  const id = /([0-9a-f]{8}) -> done/.exec(ran.stdout)?.[1];
  assert.ok(id);
  const log = runCli(home, ["--log"]);
  assert.equal(log.status, 0, log.stderr);
  assert.match(log.stdout, new RegExp(`^${id} `, "m"));
  assert.match(log.stdout, /dry-run: would execute git status/);
});

test("gtimed --log last and logs default to latest", () => {
  const home = isolatedHome();
  runCli(home, ["status", "--now", "--dry-run"]);
  const a = runCli(home, ["--log", "last"]);
  const b = runCli(home, ["logs"]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
});

test("gtimed --log=<id> prints that job", () => {
  const home = isolatedHome();
  const first = runCli(home, ["push", "--in", "20m"]);
  const id = /scheduled ([0-9a-f]{8})/.exec(first.stdout)?.[1];
  assert.ok(id);
  const log = runCli(home, [`--log=${id}`]);
  assert.equal(log.status, 0, log.stderr);
  assert.match(log.stdout, new RegExp(`^${id} `, "m"));
  assert.match(log.stdout, /scheduled/);
  assert.doesNotMatch(log.stdout, /no log yet/);
});

test("gtimed --now --dry-run runs immediately", () => {
  const home = isolatedHome();
  const r = runCli(home, ["status", "--now", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /[0-9a-f]{8} -> done/);
});

test("gtimed list marks pending jobs as waiting", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const r = runCli(home, ["list"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pending\s+waiting /);
  assert.doesNotMatch(r.stdout, /pending\s+ran /);
});

test("gtimed cancel with no id does not look like it cancelled", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const r = runCli(home, ["cancel"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nothing cancelled/);
  assert.doesNotMatch(r.stdout, /^cancelled /m);
});

test("gtimed --now does not say ran when --when fails", () => {
  const home = isolatedHome();
  const r = runCli(home, ["status", "--now", "--when", 'cmd:node -e "process.exit(2)"']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /did not run/);
  assert.doesNotMatch(r.stdout, / ran /);
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

test("gtimed log --in schedules git log, not the log command", () => {
  const home = isolatedHome();
  const r = runCli(home, ["log", "--in", "20m"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scheduled [0-9a-f]{8}/);
  assert.match(r.stdout, /git log/);
});

test("gtimed --help mentions --log", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gtimed --log/);
});

test("gtimed cancel --all aborts pending jobs", () => {
  const home = isolatedHome();
  runCli(home, ["push", "--in", "20m"]);
  const r = runCli(home, ["cancel", "--all"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /aborted 1 pending job/);
});

test("gtimed --help documents gtm and not Graphite's gt", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /or: gtm/);
  assert.match(r.stdout, /gtm is the same CLI/);
  assert.match(r.stdout, /gtm push --at/);
  assert.doesNotMatch(r.stdout, /\bgt push\b/);
  assert.doesNotMatch(r.stdout, /or: gt /);
});

test("gtm __complete offers the same first-token hits as gtimed", () => {
  const home = isolatedHome();
  const timed = runCli(home, ["__complete", "1", "--", "gtimed", "ca"]);
  const short = runCli(home, ["__complete", "1", "--", "gtm", "ca"]);
  assert.equal(timed.status, 0, timed.stderr);
  assert.equal(short.status, 0, short.stderr);
  assert.equal(timed.stdout, short.stdout);
  assert.match(short.stdout, /^cancel$/m);
});

test("gt __complete stays empty so Graphite is not hijacked", () => {
  const home = isolatedHome();
  const r = runCli(home, ["__complete", "1", "--", "gt", "ca"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "");
});
