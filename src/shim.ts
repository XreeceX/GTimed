import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FLAGS } from "./parse.js";
import { homeDir, shimDir } from "./store.js";

export const SHIM_FLAGS = new Set(Object.keys(FLAGS));

export function argsHaveScheduleFlags(argv: string[]): boolean {
  return argv.some((a) => SHIM_FLAGS.has(a.split("=")[0]));
}

function realGitRecord(): string {
  return path.join(homeDir(), "real-git");
}

export function discoverRealGit(): string {
  if (process.env.GTIMED_REAL_GIT?.trim()) return process.env.GTIMED_REAL_GIT.trim();

  const recorded = realGitRecord();
  if (fs.existsSync(recorded)) {
    const saved = fs.readFileSync(recorded, "utf8").trim();
    if (saved && fs.existsSync(saved) && !isShimPath(saved)) return saved;
  }

  const locator = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(locator, ["git"], { encoding: "utf8", windowsHide: true });
  const found = (r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !isShimPath(p));

  const preferred =
    found.find((p) => p.toLowerCase().endsWith("git.exe")) ?? found[0];
  if (preferred) return preferred;

  const fallbacks =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\cmd\\git.exe",
          "C:\\Program Files\\Git\\bin\\git.exe",
        ]
      : ["/usr/bin/git", "/usr/local/bin/git"];

  return fallbacks.find((p) => fs.existsSync(p)) || "git";
}

function isShimPath(p: string): boolean {
  const shim = shimDir().toLowerCase();
  return path.resolve(p).toLowerCase().startsWith(shim);
}

export function removeShim(): void {
  const dir = shimDir();
  for (const name of ["git", "git.cmd", "git.ps1"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const recorded = realGitRecord();
  if (fs.existsSync(recorded)) fs.unlinkSync(recorded);
  const env = path.join(homeDir(), "env.sh");
  if (fs.existsSync(env)) fs.unlinkSync(env);
}

export function ensureNpmOnUserPath(): string {
  if (process.platform !== "win32") {
    return "Use `npm install -g gtimed` (or npm link) so gtimed is on PATH.";
  }
  const npm = path.join(os.homedir(), "AppData", "Roaming", "npm");
  return prependWindowsUserPath(npm);
}

export function removeShimFromUserPath(dir: string): string {
  if (process.platform === "win32") {
    const win = removeWindowsUserPath(dir);
    const bash = removeUnixPath("$HOME/.gtimed/shim");
    return `${win}\n${bash}`;
  }
  return removeUnixPath(dir);
}

function prependWindowsUserPath(dir: string): string {
  const script = `
$dir = '${dir.replaceAll("'", "''")}'
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $user) { $user = '' }
$parts = $user -split ';' | Where-Object { $_ -and ($_ -ne $dir) }
$next = (@($dir) + $parts) -join ';'
[Environment]::SetEnvironmentVariable('Path', $next, 'User')
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || "failed to update user PATH");
  }
  return `Prepended ${dir} to your user PATH. Open a new terminal for gtimed to work.`;
}

function removeWindowsUserPath(dir: string): string {
  const script = `
$dir = '${dir.replaceAll("'", "''")}'
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $user) { exit 0 }
$parts = $user -split ';' | Where-Object { $_ -and ($_ -ne $dir) }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
`;
  spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return `Removed ${dir} from your user PATH.`;
}

const PATH_MARK = "# gtimed git shim";

function profileFiles(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".zshrc"),
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
  ];
}

function removeUnixPath(dir: string): string {
  for (const file of profileFiles()) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const next: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(PATH_MARK)) {
        if (i + 1 < lines.length) i += 1;
        continue;
      }
      if (lines[i].includes(".gtimed/env.sh")) continue;
      if (lines[i].includes(dir) && lines[i].includes("gtimed") && lines[i].includes("shim")) {
        continue;
      }
      next.push(lines[i]);
    }
    fs.writeFileSync(file, next.join("\n"), "utf8");
  }
  return `Removed leftover git shim PATH hooks from shell profiles.`;
}
