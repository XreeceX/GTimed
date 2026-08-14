import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scriptFor, suggestions } from "./completion.js";
import { wantsHelp } from "./help.js";
import { FLAGS, parseScheduleArgs } from "./parse.js";
import { argsHaveScheduleFlags } from "./shim.js";
import { isolatedHome, runCli } from "./test-util.js";

const pkg = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
) as { name: string; bin: Record<string, string> };

test("package bin is gtimed and gtm, not Graphite's gt", () => {
  assert.equal(pkg.name, "gtimed");
  assert.deepEqual(Object.keys(pkg.bin), ["gtimed", "gtm"]);
  assert.equal(pkg.bin.gtimed, pkg.bin.gtm);
  assert.ok(!Object.keys(pkg.bin).includes("gt"));
});

test("git short flags are not treated as gtimed flags", () => {
  for (const flag of ["-m", "-a", "-u", "-f", "-n", "-v", "-C", "-c", "-s", "-p"]) {
    assert.equal(FLAGS[flag], undefined, flag);
  }
  const p = parseScheduleArgs(["commit", "-am", "ship", "--in", "20m"]);
  assert.deepEqual(p.command, ["git", "commit", "-am", "ship"]);
  assert.equal(p.in, "20m");
});

test("ffmpeg-style -to is not timeout (Graphite/ffmpeg keep their own flags)", () => {
  const p = parseScheduleArgs(["--in", "1h", "--", "ffmpeg", "-to", "00:00:10", "-i", "in.mp4", "out.mp4"]);
  assert.equal(p.timeout, undefined);
  assert.deepEqual(p.command, ["ffmpeg", "-to", "00:00:10", "-i", "in.mp4", "out.mp4"]);
  assert.equal(argsHaveScheduleFlags(["ffmpeg", "-to", "00:00:10"]), false);
});

test("-- after gtimed keeps wrapped --to --dry --help", () => {
  const p = parseScheduleArgs(["--in", "1h", "--", "tool", "--to", "dst", "--dry", "--help"]);
  assert.equal(p.in, "1h");
  assert.equal(p.timeout, undefined);
  assert.equal(p.dryRun, false);
  assert.deepEqual(p.command, ["tool", "--to", "dst", "--dry", "--help"]);
});

test("wantsHelp does not steal --help after --", () => {
  assert.equal(wantsHelp(["--in", "1h", "--", "gh", "pr", "create", "--help"]), false);
  assert.equal(wantsHelp(["--in", "1h", "--", "tool", "-h"]), false);
});

test("completion hooks claim gtimed and gtm, not gt or git", () => {
  for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
    const script = scriptFor(shell);
    assert.match(script, /\bgtm\b/);
    assert.doesNotMatch(script, /complete -c gt\b/);
    assert.doesNotMatch(script, /CommandName gtimed,gt,/);
    assert.doesNotMatch(script, /compdef _gtimed gtimed gt$/m);
    assert.doesNotMatch(script, /complete .* git\b/);
  }
  assert.deepEqual(suggestions(["gt", "abort"], 1), []);
  assert.deepEqual(suggestions(["git", "commit", "--in"], 2), []);
  assert.ok(suggestions(["gtm", "ca"], 1).includes("cancel"));
});

test("gtimed commit -m is still git's message flag", () => {
  const home = isolatedHome();
  const r = runCli(home, ["commit", "-m", "Hello world", "--in", "20m", "--dry"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /git commit -m "Hello world"/);
});
