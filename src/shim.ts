import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHome, homeDir, shimDir } from "./store.js";

function entryJs(): string {
  return path.resolve(fileURLToPath(new URL("./index.js", import.meta.url)));
}

export const SHIM_FLAGS = new Set([
  "--at",
  "--in",
  "--cron",
  "--when",
  "--until",
  "--every",
  "--timeout",
  "--retry",
  "--name",
  "--cwd",
  "--dry-run",
  "--now",
  "--same-branch",
]);

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

export function writeShim(): string {
  ensureHome();
  const dir = shimDir();
  const node = process.execPath;
  const entry = entryJs();
  const real = discoverRealGit();
  fs.writeFileSync(realGitRecord(), real, "utf8");

  const cmd = `@echo off\r
set "GTIMED_REAL_GIT=${real}"\r
"${node}" "${entry}" __shim git %*\r
`;
  fs.writeFileSync(path.join(dir, "git.cmd"), cmd, "utf8");

  const ps1 = `$env:GTIMED_REAL_GIT = '${real.replaceAll("'", "''")}'
& "${node}" "${entry}" __shim git @args
`;
  fs.writeFileSync(path.join(dir, "git.ps1"), ps1, "utf8");

  const sh = `#!/usr/bin/env bash
export GTIMED_REAL_GIT=${shellQuote(real)}
exec ${shellQuote(node)} ${shellQuote(entry)} __shim git "$@"
`;
  fs.writeFileSync(path.join(dir, "git"), sh, { encoding: "utf8", mode: 0o755 });

  return dir;
}

export function removeShim(): void {
  const dir = shimDir();
  for (const name of ["git", "git.cmd", "git.ps1"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const recorded = realGitRecord();
  if (fs.existsSync(recorded)) fs.unlinkSync(recorded);
}

export function prependShimToUserPath(dir: string): string {
  writeBashEnv();
  if (process.platform === "win32") {
    const win = prependWindowsUserPath(dir);
    const npm = prependWindowsUserPath(path.join(os.homedir(), "AppData", "Roaming", "npm"));
    const bash = upsertBashPath();
    return `${win}\n${npm}\nGit Bash: ${bash}`;
  }
  return upsertBashPath();
}

export function removeShimFromUserPath(dir: string): string {
  if (process.platform === "win32") {
    const win = removeWindowsUserPath(dir);
    const bash = removeUnixPath("$HOME/.gtimed/shim");
    return `${win}\n${bash}`;
  }
  return removeUnixPath(dir);
}

function writeBashEnv(): void {
  ensureHome();
  const env = path.join(homeDir(), "env.sh");
  fs.writeFileSync(
    env,
    `# sourced from ~/.bashrc so Git Bash finds the shim after /usr/bin/git\nexport PATH="$HOME/.gtimed/shim:$PATH"\n`,
    "utf8",
  );
}

function upsertBashPath(): string {
  const line = `[ -f "$HOME/.gtimed/env.sh" ] && . "$HOME/.gtimed/env.sh"`;
  const block = `\n${PATH_MARK}\n${line}\n`;
  const files = [
    path.join(os.homedir(), ".bashrc"),
    path.join(os.homedir(), ".bash_profile"),
    path.join(os.homedir(), ".profile"),
  ];
  const touched: string[] = [];
  for (const file of files) {
    let cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (cur.includes(PATH_MARK)) {
      cur = cur.replace(/\n?# gtimed git shim\n(?:.*\n)?/, block);
      fs.writeFileSync(file, cur, "utf8");
    } else {
      fs.appendFileSync(file, block, "utf8");
    }
    touched.push(file);
  }
  return `Hooked ${touched.join(", ")} (new Git Bash windows load the shim automatically).`;
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
  return `Prepended ${dir} to your user PATH. Open a new terminal for git --in / --at to work.`;
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
    path.join(home, ".profile"),
  ];
}

function prependUnixPath(dir: string): string {
  const line = `export PATH="${dir}:$PATH"`;
  const block = `\n${PATH_MARK}\n${line}\n`;
  const targets = profileFiles().filter((p) => fs.existsSync(p));
  const files = targets.length ? targets : [path.join(os.homedir(), ".profile")];
  for (const file of files) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (cur.includes(PATH_MARK)) continue;
    fs.appendFileSync(file, block, "utf8");
  }
  return `Added ${dir} to PATH in ${files.join(", ")}. Open a new shell, or: export PATH="${dir}:$PATH"`;
}

function removeUnixPath(dir: string): string {
  for (const file of profileFiles()) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const next: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(PATH_MARK)) {
        if (lines[i + 1]?.includes(dir)) i += 1;
        continue;
      }
      if (lines[i].includes(dir) && lines[i].includes("gtimed") && lines[i].includes("shim")) {
        continue;
      }
      next.push(lines[i]);
    }
    fs.writeFileSync(file, next.join("\n"), "utf8");
  }
  return `Removed ${dir} from shell profiles.`;
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
