import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function homeDir(): string {
  return process.env.GTIMED_HOME?.trim() || path.join(os.homedir(), ".gtimed");
}

export function jobsPath(): string {
  return path.join(homeDir(), "jobs.json");
}

export function logsDir(): string {
  return path.join(homeDir(), "logs");
}

export function shimDir(): string {
  return path.join(homeDir(), "shim");
}

let ensuredHome = "";

export function ensureHome(): void {
  const home = homeDir();
  if (ensuredHome === home) return;
  fs.mkdirSync(logsDir(), { recursive: true });
  ensuredHome = home;
}

export type JobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export interface Job {
  id: string;
  name?: string;
  createdAt: string;
  command: string[];
  cwd: string;
  gitRoot?: string;
  branch?: string;
  at?: string;
  cron?: string;
  when: string[];
  until?: string;
  everyMs: number;
  timeoutMs: number;
  retry: number;
  attempts: number;
  requireSameBranch: boolean;
  dryRun: boolean;
  status: JobStatus;
  lastCheckedAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastCronMinute?: string;
  exitCode?: number;
  lastError?: string;
  logFile: string;
}

export interface StoreFile {
  jobs: Job[];
}

export function loadStore(): StoreFile {
  ensureHome();
  let text: string;
  try {
    text = fs.readFileSync(jobsPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { jobs: [] };
    throw err;
  }
  try {
    const raw = JSON.parse(text) as StoreFile;
    return { jobs: Array.isArray(raw.jobs) ? raw.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

export function saveStore(store: StoreFile): void {
  ensureHome();
  fs.writeFileSync(jobsPath(), JSON.stringify(store), "utf8");
}

export function getJob(id: string): Job | undefined {
  const prefix = id.toLowerCase();
  const matches = loadStore().jobs.filter(
    (j) => j.id === id || j.id.toLowerCase().startsWith(prefix),
  );
  return matches.length === 1 ? matches[0] : matches.find((j) => j.id === id);
}

export function pendingJobs(): Job[] {
  return loadStore().jobs.filter((j) => j.status === "pending");
}

export function commandsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameCwd(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Newest pending job with the same command in the same working directory. */
export function findPendingDuplicate(
  command: string[],
  cwd: string,
  jobs?: readonly Job[],
): Job | undefined {
  let best: Job | undefined;
  for (const j of jobs ?? loadStore().jobs) {
    if (j.status !== "pending") continue;
    if (!commandsEqual(j.command, command) || !sameCwd(j.cwd, cwd)) continue;
    if (!best || j.createdAt.localeCompare(best.createdAt) > 0) best = j;
  }
  return best;
}

export function cancelOtherPendingDuplicates(command: string[], cwd: string, keepId: string): Job[] {
  const store = loadStore();
  const targets: Job[] = [];
  for (const job of store.jobs) {
    if (
      job.status === "pending" &&
      job.id !== keepId &&
      commandsEqual(job.command, command) &&
      sameCwd(job.cwd, cwd)
    ) {
      job.status = "cancelled";
      targets.push(job);
    }
  }
  if (targets.length) saveStore(store);
  return targets;
}

/** Cancel other pending duplicates of this job and upsert it, in one write. */
export function putJobCancellingDuplicates(job: Job, store?: StoreFile): void {
  const s = store ?? loadStore();
  for (const j of s.jobs) {
    if (
      j.status === "pending" &&
      j.id !== job.id &&
      commandsEqual(j.command, job.command) &&
      sameCwd(j.cwd, job.cwd)
    ) {
      j.status = "cancelled";
    }
  }
  const i = s.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) s.jobs[i] = job;
  else s.jobs.push(job);
  saveStore(s);
}

export function cancelPending(which: "all" | "last" | string): Job[] {
  const store = loadStore();
  const pending = store.jobs.filter((j) => j.status === "pending");
  let targets: Job[] = [];

  if (which === "all") {
    targets = pending;
  } else if (which === "last") {
    let last: Job | undefined;
    for (const j of pending) {
      if (!last || j.createdAt.localeCompare(last.createdAt) > 0) last = j;
    }
    if (last) targets = [last];
  } else {
    const prefix = which.toLowerCase();
    const matches = pending.filter(
      (j) => j.id === which || j.id.toLowerCase().startsWith(prefix),
    );
    const hit = matches.length === 1 ? matches[0] : matches.find((j) => j.id === which);
    if (hit) targets = [hit];
  }

  for (const job of targets) {
    job.status = "cancelled";
  }
  if (targets.length) saveStore(store);
  return targets;
}

export function upsertJob(job: Job): void {
  const store = loadStore();
  const i = store.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) store.jobs[i] = job;
  else store.jobs.push(job);
  saveStore(store);
}

export function newJobId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Most recently run job, or most recently created if none have run. */
export function latestJob(): Job | undefined {
  let best: Job | undefined;
  for (const job of loadStore().jobs) {
    if (!best) {
      best = job;
      continue;
    }
    const ta = job.lastRunAt ?? job.createdAt;
    const tb = best.lastRunAt ?? best.createdAt;
    if (ta.localeCompare(tb) > 0) best = job;
  }
  return best;
}
