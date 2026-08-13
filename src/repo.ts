import { spawnSync } from "node:child_process";

export interface RepoFile {
  path: string;
  x: string;
  y: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface RepoState {
  cwd: string;
  root?: string;
  branch?: string;
  files: RepoFile[];
  error?: string;
}

function unquoteGitPath(p: string): string {
  const trimmed = p.replace(/\r$/, "");
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? "").replace(/\r/g, ""),
    stderr: (r.stderr ?? "").trim(),
  };
}

export function repoState(cwd: string): RepoState {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (root.status !== 0) {
    return { cwd, files: [], error: root.stderr || "not a git repository" };
  }
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const st = git(cwd, ["status", "--porcelain", "-uall"]);
  const files: RepoFile[] = [];
  for (const line of st.stdout.split("\n")) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    let filePath = unquoteGitPath(line.slice(3));
    const arrow = filePath.lastIndexOf(" -> ");
    if (arrow >= 0) filePath = unquoteGitPath(filePath.slice(arrow + 4));
    files.push({
      path: filePath,
      x,
      y,
      staged: x !== " " && x !== "?",
      unstaged: y !== " " || x === "?",
      untracked: x === "?" && y === "?",
    });
  }
  return {
    cwd,
    root: root.stdout.trim(),
    branch: branch.stdout.trim(),
    files,
  };
}

export function stagePaths(cwd: string, paths: string[], staged: boolean): { ok: boolean; error?: string } {
  if (!paths.length) return { ok: true };
  const r = staged
    ? git(cwd, ["add", "--", ...paths])
    : git(cwd, ["restore", "--staged", "--", ...paths]);
  if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
  return { ok: true };
}
