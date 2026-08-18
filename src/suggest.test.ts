import assert from "node:assert/strict";
import test from "node:test";
import { closeMatches, diagnose, distance } from "./suggest.js";
import { isolatedHome, runCli } from "./test-util.js";

test("distance is 0 for the same string", () => {
  assert.equal(distance("tick", "tick"), 0);
});

test("closeMatches finds nearby commands", () => {
  assert.deepEqual(closeMatches("tck", ["tick", "list", "daemon"]), ["tick"]);
  assert.ok(closeMatches("comit", ["commit", "completion", "config"]).includes("commit"));
  assert.deepEqual(closeMatches("zzzzz", ["tick", "list"]), []);
});

test("diagnose suggests tick for tck", () => {
  const msg = diagnose(["tck"]);
  assert.match(msg ?? "", /unknown command "tck"/);
  assert.match(msg ?? "", /gtimed tick/);
  assert.doesNotMatch(msg ?? "", /Try gtimed --help/);
});

test("diagnose points at --help when the token is nonsense", () => {
  const msg = diagnose(["zzzzz"]);
  assert.match(msg ?? "", /unknown command "zzzzz"/);
  assert.match(msg ?? "", /Try gtimed --help/);
  assert.doesNotMatch(msg ?? "", /Did you mean/);
});

test("diagnose suggests commit for a close git verb", () => {
  const msg = diagnose(["comit", "--in", "20m", "-m", "hi"]);
  assert.match(msg ?? "", /unknown command "comit"/);
  assert.match(msg ?? "", /gtimed commit --in 20m -m hi/);
});

test("diagnose leaves unknown CLIs with schedule flags alone", () => {
  assert.equal(diagnose(["eslint", "--in", "20m"]), null);
  assert.equal(diagnose(["gh", "pr", "create", "--in", "1h"]), null);
});

test("diagnose does not treat cancel --all or --log=<id> as typos", () => {
  assert.equal(diagnose(["cancel", "--all"]), null);
  assert.equal(diagnose(["--log=abc123"]), null);
});

test("diagnose leaves cloud login --token alone", () => {
  assert.equal(diagnose(["cloud", "login", "--token", "ghp_secret"]), null);
  assert.equal(diagnose(["cloud", "set", "https://example.vercel.app"]), null);
});

test("diagnose suggests --timeout for --timout", () => {
  const msg = diagnose(["push", "--in", "5m", "--timout", "2m"]);
  assert.match(msg ?? "", /unknown option "--timout"/);
  assert.match(msg ?? "", /--timeout/);
});

test("diagnose does not steal git's --force-with-lease", () => {
  assert.equal(diagnose(["push", "--force-with-lease", "--in", "5m"]), null);
});

test("diagnose suggests clean for --when clen", () => {
  const msg = diagnose(["push", "--when", "clen", "--in", "5m"]);
  assert.match(msg ?? "", /unknown condition "clen"/);
  assert.match(msg ?? "", /--when clean/);
});

test("diagnose tells you to use --help for a bogus --when", () => {
  const msg = diagnose(["push", "--when", "purple", "--now"]);
  assert.match(msg ?? "", /unknown condition "purple"/);
  assert.match(msg ?? "", /Try gtimed --help/);
});

test("gtimed tck suggests tick", () => {
  const home = isolatedHome();
  const r = runCli(home, ["tck"]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Did you mean/);
  assert.match(r.stderr, /gtimed tick/);
});

test("gtimed zzzzz points at --help", () => {
  const home = isolatedHome();
  const r = runCli(home, ["zzzzz"]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Try gtimed --help/);
  assert.doesNotMatch(r.stderr, /Did you mean/);
});

test("gtimed comit --in 20m suggests commit and does not schedule", () => {
  const home = isolatedHome();
  const r = runCli(home, ["comit", "--in", "20m"]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /gtimed commit --in 20m/);
  assert.doesNotMatch(r.stdout, /scheduled/);
});

test("gtimed --in 20m without a command points at --help", () => {
  const home = isolatedHome();
  const r = runCli(home, ["--in", "20m"]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /missing a command/);
  assert.match(r.stderr, /Try gtimed --help/);
});

test("gtimed push without a time still errors with an example", () => {
  const home = isolatedHome();
  const r = runCli(home, ["push"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Provide --at, --in, --cron, --when, or --now/);
  assert.match(r.stderr, /gtimed push --in 20m/);
});
