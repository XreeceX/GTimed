import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHome, homeDir } from "./store.js";

export function selfCommand(): { exe: string; args: string[] } {
  const entry = path.resolve(fileURLToPath(new URL("./index.js", import.meta.url)));
  return { exe: process.execPath, args: [entry] };
}

/** Use the global install when it exists, so ticks do not depend on this checkout. */
export function persistentEntry(): { exe: string; entry: string } {
  const exe = process.execPath;
  const globalEntry = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "npm",
    "node_modules",
    "gtimed",
    "dist",
    "index.js",
  );
  if (process.platform === "win32" && fs.existsSync(globalEntry)) {
    return { exe, entry: globalEntry };
  }
  const { args } = selfCommand();
  return { exe, entry: args[0] };
}

export function tickCmdPath(): string {
  return path.join(homeDir(), "tick.cmd");
}

export function tickVbsPath(): string {
  return path.join(homeDir(), "tick.vbs");
}

export function writeTickLauncher(): string {
  ensureHome();
  const { exe, entry } = persistentEntry();
  if (process.platform === "win32") {
    const cmd = tickCmdPath();
    const vbs = tickVbsPath();
    const log = path.join(homeDir(), "tick.log");
    fs.writeFileSync(
      cmd,
      `@echo off\r\n"${exe}" "${entry}" tick >> "${log}" 2>&1\r\n`,
      "utf8",
    );
    // wscript Run style 0 = hidden; schtasks running .cmd would flash a console.
    const cmdEsc = cmd.replaceAll('"', '""');
    fs.writeFileSync(
      vbs,
      `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "cmd /c ""${cmdEsc}""", 0, True\r\n`,
      "utf8",
    );
    return vbs;
  }
  const file = path.join(homeDir(), "tick.sh");
  fs.writeFileSync(
    file,
    `#!/bin/sh\n"${exe}" "${entry}" tick >> "${path.join(homeDir(), "tick.log")}" 2>&1\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  return file;
}

function schtasks(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("cmd.exe", ["/c", "schtasks", ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function installTick(): string {
  const launcher = writeTickLauncher();

  if (process.platform === "win32") {
    const minute = schtasks([
      "/Create",
      "/TN",
      "GTimed",
      "/TR",
      `wscript.exe //nologo "${launcher}"`,
      "/SC",
      "MINUTE",
      "/MO",
      "1",
      "/F",
    ]);
    if (minute.status !== 0) {
      throw new Error(minute.stderr || minute.stdout || `schtasks failed (${minute.status})`);
    }
    schtasks([
      "/Create",
      "/TN",
      "GTimedLogon",
      "/TR",
      `wscript.exe //nologo "${launcher}"`,
      "/SC",
      "ONLOGON",
      "/F",
    ]);
    return [
      "Task Scheduler will run jobs every minute (PC must be on and awake).",
      `  task: GTimed`,
      `  logon: GTimedLogon`,
      `  runs: ${launcher}`,
    ].join("\n");
  }

  const { exe, entry } = persistentEntry();
  const quoted = [exe, entry, "tick"].map(q).join(" ");
  const line = `* * * * * ${quoted} >/tmp/gtimed.tick.log 2>&1`;
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const existing = current.status === 0 ? current.stdout : "";
  if (existing.includes("gtimed") && existing.includes(" tick")) {
    return "crontab already contains a gtimed tick line.";
  }
  const next = `${existing.trimEnd()}\n${line}\n`;
  const tmp = path.join(os.tmpdir(), "gtimed.cron");
  fs.writeFileSync(tmp, next, "utf8");
  const r = spawnSync("crontab", [tmp], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr || "failed to install crontab");
  }
  return `Installed crontab tick (runs with the terminal closed):\n  ${line}`;
}

export function uninstallTick(): string {
  if (process.platform === "win32") {
    schtasks(["/Delete", "/TN", "GTimed", "/F"]);
    schtasks(["/Delete", "/TN", "GTimedLogon", "/F"]);
    const cmd = tickCmdPath();
    const vbs = tickVbsPath();
    if (fs.existsSync(cmd)) fs.unlinkSync(cmd);
    if (fs.existsSync(vbs)) fs.unlinkSync(vbs);
    return 'Removed Task Scheduler jobs "GTimed" and "GTimedLogon".';
  }
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (current.status !== 0) return "No crontab to edit.";
  const next = current.stdout
    .split("\n")
    .filter((l) => !(l.includes("gtimed") && l.includes(" tick")))
    .join("\n");
  const tmp = path.join(os.tmpdir(), "gtimed.cron");
  fs.writeFileSync(tmp, next, "utf8");
  spawnSync("crontab", [tmp], { encoding: "utf8" });
  return "Removed gtimed tick from crontab.";
}

export function npmGlobalBin(): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Roaming", "npm");
  }
  const r = spawnSync("npm", ["bin", "-g"], { encoding: "utf8" });
  return (r.stdout || "").trim() || "/usr/local/bin";
}

function q(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}
