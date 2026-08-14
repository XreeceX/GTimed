import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isolatedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-home-"));
  process.env.GTIMED_HOME = home;
  return home;
}

export function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-repo-"));
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", windowsHide: true });
  spawnSync("git", ["config", "user.email", "t@t.test"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, windowsHide: true });
  return dir;
}

export function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `git ${args.join(" ")} failed`);
  }
  return (r.stdout ?? "").trim();
}

export function runCli(home: string, args: string[], cwd = process.cwd()) {
  const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  return spawnSync(process.execPath, [tsx, entry, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GTIMED_HOME: home },
    windowsHide: true,
    timeout: 20_000,
  });
}
