import assert from "node:assert/strict";
import test from "node:test";
import { help, helpFor, wantsHelp } from "./help.js";
import { isolatedHome, runCli } from "./test-util.js";

test("wantsHelp treats --help and -h like other CLIs", () => {
  assert.equal(wantsHelp([]), false);
  assert.equal(wantsHelp(["--help"]), true);
  assert.equal(wantsHelp(["-h"]), true);
  assert.equal(wantsHelp(["help"]), true);
  assert.equal(wantsHelp(["commit", "--help"]), true);
  assert.equal(wantsHelp(["tick", "-h"]), true);
  assert.equal(wantsHelp(["list", "--help"]), true);
  assert.equal(wantsHelp(["--in", "1h", "--", "gh", "--help"]), false);
  assert.equal(wantsHelp(["push", "--in", "20m"]), false);
});

test("full help looks like a Unix usage page", () => {
  const text = help();
  assert.match(text, /^Usage: gtimed /);
  assert.match(text, /-h, --help/);
  assert.match(text, /-V, --version/);
  assert.match(text, /Commands:/);
  assert.match(text, /Schedule options:/);
  assert.match(text, /gtimed commit --in/);
  assert.match(text, /gtm push --at/);
  assert.match(text, /replaces the pending job/);
  assert.match(text, /gtimed --log/);
  assert.match(text, /local timezone/);
  assert.doesNotMatch(text, /\bgt push\b/);
  assert.doesNotMatch(text, /or: gt /);
});

test("gtimed --help and -h print the usage page", () => {
  const home = isolatedHome();
  const a = runCli(home, ["--help"]);
  const b = runCli(home, ["-h"]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.match(a.stdout, /^Usage: gtimed /);
});

test("gtimed commit --help explains scheduling instead of erroring", () => {
  const home = isolatedHome();
  const r = runCli(home, ["commit", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: gtimed <command>/);
  assert.doesNotMatch(r.stderr, /Provide --at/);
});

test("gtimed tick --help prints tick usage", () => {
  const home = isolatedHome();
  const r = runCli(home, ["tick", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: gtimed tick/);
  assert.match(r.stdout, /already arrived/);
});

test("gtimed --in 1h -- tool --help still schedules", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--in", "1h", "--", "gh", "pr", "create", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scheduled [0-9a-f]{8}/);
  assert.match(r.stdout, /gh pr create --help/);
});

test("helpFor uses aliases", () => {
  assert.match(helpFor(["--tick", "--help"]), /Usage: gtimed tick/);
  assert.match(helpFor(["dm", "-h"]), /Usage: gtimed daemon/);
  assert.match(helpFor(["ls", "--help"]), /Usage: gtimed list/);
});

test("helpFor cloud explains the hosted queue", () => {
  const text = helpFor(["cloud", "--help"]);
  assert.match(text, /Usage: gtimed cloud/);
  assert.match(text, /login --token/);
  assert.doesNotMatch(text, /gtm_/);
  assert.doesNotMatch(text, /\bgt push\b/);
});
