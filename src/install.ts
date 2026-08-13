import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function selfCommand(): { exe: string; args: string[] } {
  const entry = path.resolve(fileURLToPath(new URL("./index.js", import.meta.url)));
  return { exe: process.execPath, args: [entry] };
}

export function installTick(): string {
  const { exe, args } = selfCommand();
  const quoted = [exe, ...args, "tick"].map(q).join(" ");

  if (process.platform === "win32") {
    const r = spawnSync(
      "schtasks",
      ["/Create", "/TN", "GTimed", "/TR", quoted, "/SC", "MINUTE", "/MO", "1", "/F"],
      { encoding: "utf8", windowsHide: true },
    );
    if (r.status !== 0) {
      throw new Error(r.stderr || r.stdout || `schtasks failed (${r.status})`);
    }
    return `Windows Task Scheduler job "GTimed" runs every minute:\n  ${quoted}`;
  }

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
  return `Installed crontab tick:\n  ${line}`;
}

export function uninstallTick(): string {
  if (process.platform === "win32") {
    spawnSync("schtasks", ["/Delete", "/TN", "GTimed", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return 'Removed Task Scheduler job "GTimed".';
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

function q(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}
