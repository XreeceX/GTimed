import { spawnSync } from "node:child_process";
import type { Job } from "./store.js";

export interface ConditionResult {
  ok: boolean;
  detail: string;
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

function porcelain(cwd: string): string {
  return git(cwd, ["status", "--porcelain"]).stdout;
}

export function evalCondition(cwd: string, spec: string): ConditionResult {
  const raw = spec.trim();
  const lower = raw.toLowerCase();

  if (lower === "clean") {
    const p = porcelain(cwd);
    return { ok: p.length === 0, detail: p ? "working tree dirty" : "working tree clean" };
  }
  if (lower === "dirty") {
    const p = porcelain(cwd);
    return { ok: p.length > 0, detail: p ? "working tree dirty" : "working tree clean" };
  }
  if (lower === "staged") {
    const r = git(cwd, ["diff", "--cached", "--name-only"]);
    return { ok: r.stdout.length > 0, detail: r.stdout ? "has staged files" : "nothing staged" };
  }
  if (lower === "ahead") {
    const r = git(cwd, ["rev-list", "--count", "@{u}..HEAD"]);
    if (r.status !== 0) return { ok: false, detail: "no upstream (cannot check ahead)" };
    const n = Number(r.stdout || "0");
    return { ok: n > 0, detail: n > 0 ? `${n} commit(s) ahead` : "not ahead of upstream" };
  }
  if (lower === "behind") {
    const r = git(cwd, ["rev-list", "--count", "HEAD..@{u}"]);
    if (r.status !== 0) return { ok: false, detail: "no upstream (cannot check behind)" };
    const n = Number(r.stdout || "0");
    return { ok: n > 0, detail: n > 0 ? `${n} commit(s) behind` : "not behind upstream" };
  }
  if (lower === "remote-ok") {
    const r = git(cwd, ["ls-remote", "--exit-code", "origin", "HEAD"]);
    return { ok: r.status === 0, detail: r.status === 0 ? "origin reachable" : "origin not reachable" };
  }

  if (lower.startsWith("branch=")) {
    const want = raw.slice("branch=".length);
    const have = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
    return { ok: have === want, detail: `branch is ${have || "unknown"} (want ${want})` };
  }

  if (lower.startsWith("file=")) {
    const file = raw.slice("file=".length);
    const r = git(cwd, ["status", "--porcelain", "--", file]);
    return { ok: r.stdout.length > 0, detail: r.stdout ? `${file} changed` : `${file} unchanged` };
  }

  if (lower.startsWith("cmd:")) {
    const command = raw.slice("cmd:".length);
    const r = spawnSync(command, {
      cwd,
      encoding: "utf8",
      shell: true,
      windowsHide: true,
    });
    return {
      ok: (r.status ?? 1) === 0,
      detail: `cmd exit ${r.status ?? 1}`,
    };
  }

  throw new Error(
    `Unknown condition "${spec}". Use clean, dirty, staged, ahead, behind, remote-ok, branch=<name>, file=<path>, or cmd:<shell>.`,
  );
}

export function evalAllConditions(job: Job): ConditionResult {
  if (!job.when.length) return { ok: true, detail: "no conditions" };
  for (const spec of job.when) {
    const result = evalCondition(job.cwd, spec);
    if (!result.ok) return result;
  }
  return { ok: true, detail: "all conditions matched" };
}

export function repoMeta(cwd: string): { gitRoot?: string; branch?: string } {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    gitRoot: root.status === 0 ? root.stdout : undefined,
    branch: branch.status === 0 ? branch.stdout : undefined,
  };
}
