import assert from "node:assert/strict";
import test from "node:test";
import { scriptFor, suggestions } from "./completion.js";

test("gtimed ca → cancel", () => {
  const out = suggestions(["gtimed", "ca"], 1);
  assert.ok(out.includes("cancel"));
  assert.ok(!out.includes("commit"));
});

test("gtimed --i → --in", () => {
  const out = suggestions(["gtimed", "--i"], 1);
  assert.ok(out.includes("--in"));
});

test("gtimed commit --w → --when", () => {
  const out = suggestions(["gtimed", "commit", "--w"], 2);
  assert.ok(out.includes("--when"));
});

test("gtimed --when c → clean", () => {
  const out = suggestions(["gtimed", "--when", "c"], 2);
  assert.ok(out.includes("clean"));
  assert.ok(out.includes("cmd:"));
});

test("gtimed --in → durations", () => {
  const out = suggestions(["gtimed", "--in", "2"], 2);
  assert.ok(out.includes("20m"));
  assert.ok(out.includes("2h"));
});

test("gtimed cancel prefix matches job ids", () => {
  const out = suggestions(["gtimed", "cancel", "ab"], 2, { jobs: ["abc123", "fff"] });
  assert.deepEqual(out, ["abc123"]);
});

test("git itself is not completed by gtimed", () => {
  const out = suggestions(["git", "commit", "--i"], 2);
  assert.deepEqual(out, []);
});

test("shell scripts complete gtimed only", () => {
  const zsh = scriptFor("zsh");
  const bash = scriptFor("bash");
  assert.match(zsh, /compdef _gtimed gtimed/);
  assert.doesNotMatch(zsh, /git-timed/);
  assert.doesNotMatch(zsh, /compdef _gtimed_git git/);
  assert.doesNotMatch(bash, /git-timed/);
  assert.doesNotMatch(bash, /complete .* git\b/);
});
