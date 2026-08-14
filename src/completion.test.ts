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

test("gtimed ab → abort", () => {
  const out = suggestions(["gtimed", "ab"], 1);
  assert.ok(out.includes("abort"));
});

test("gtimed li → list", () => {
  const out = suggestions(["gtimed", "li"], 1);
  assert.ok(out.includes("list"));
});

test("gtimed completion b → bash", () => {
  const out = suggestions(["gtimed", "completion", "b"], 2);
  assert.ok(out.includes("bash"));
});

test("gtimed --retry suggests numbers", () => {
  const out = suggestions(["gtimed", "--retry", ""], 2);
  assert.deepEqual(out, ["0", "1", "2", "3"]);
});

test("gtimed --cron suggests expressions", () => {
  const out = suggestions(["gtimed", "--cron", "0"], 2);
  assert.ok(out.some((s) => s.startsWith("0")));
});

test("gtimed --at has no canned values", () => {
  const out = suggestions(["gtimed", "--at", "tom"], 2);
  assert.deepEqual(out, []);
});

test("gtimed logs matches job ids from opts", () => {
  const out = suggestions(["gtimed", "logs", "ff"], 2, { jobs: ["ff00aa", "abc"] });
  assert.deepEqual(out, ["ff00aa"]);
});

test("gtimed --l → --log", () => {
  const out = suggestions(["gtimed", "--l"], 1);
  assert.ok(out.includes("--log"));
});

test("gtimed --log suggests last and job ids", () => {
  const out = suggestions(["gtimed", "--log", "la"], 2, { jobs: ["abc123"] });
  assert.deepEqual(out, ["last"]);
});

test("root commands do not include shim", () => {
  const out = suggestions(["gtimed", "sh"], 1);
  assert.ok(!out.includes("shim"));
});

test("fish and powershell scripts do not wrap git", () => {
  const fish = scriptFor("fish");
  const ps = scriptFor("powershell");
  assert.doesNotMatch(fish, /git-timed/);
  assert.doesNotMatch(ps, /git-timed/);
  assert.match(fish, /complete -c gtimed/);
  assert.match(ps, /CommandName gtimed/);
});

test("unknown shell throws", () => {
  assert.throws(() => scriptFor("tcsh"), /unknown shell/);
});
