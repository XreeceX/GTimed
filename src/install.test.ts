import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { npmGlobalBin, persistentEntry, selfCommand, tickCmdPath, tickVbsPath, writeTickLauncher } from "./install.js";
import { isolatedHome } from "./test-util.js";

test("selfCommand points at this package's index.js", () => {
  const { exe, args } = selfCommand();
  assert.equal(exe, process.execPath);
  assert.match(args[0] ?? "", /index\.js$/);
});

test("persistentEntry returns an existing or source entry", () => {
  const { exe, entry } = persistentEntry();
  assert.equal(exe, process.execPath);
  assert.ok(entry.includes("index.js"));
});

test("writeTickLauncher writes a hidden Windows tick", () => {
  const home = isolatedHome();
  const launcher = writeTickLauncher();
  if (process.platform === "win32") {
    assert.equal(launcher, tickVbsPath());
    assert.equal(fs.existsSync(tickCmdPath()), true);
    assert.equal(fs.existsSync(tickVbsPath()), true);
    const cmd = fs.readFileSync(tickCmdPath(), "utf8");
    assert.match(cmd, / tick /);
    const vbs = fs.readFileSync(tickVbsPath(), "utf8");
    assert.match(vbs, /wscript|WScript/i);
    assert.match(vbs, /0, True/);
  } else {
    assert.equal(path.basename(launcher), "tick.sh");
    assert.equal(fs.existsSync(launcher), true);
  }
  assert.ok(launcher.startsWith(home) || launcher.includes(".gtimed") || launcher.includes(home));
});

test("npmGlobalBin is a directory path", () => {
  const bin = npmGlobalBin();
  assert.ok(bin.length > 0);
  if (process.platform === "win32") {
    assert.match(bin.replaceAll("\\", "/"), /npm$/);
  }
});
