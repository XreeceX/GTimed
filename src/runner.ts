import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import { evalAllConditions, repoMeta } from "./conditions.js";
import {
  findPendingDuplicate,
  loadStore,
  logsDir,
  newJobId,
  putJobCancellingDuplicates,
  saveStore,
  type Job,
  upsertJob,
} from "./store.js";
import { minuteKey, parseDurationMs, parseWhen } from "./time.js";

const require = createRequire(import.meta.url);

type CronParser = typeof import("cron-parser");
let cronParser: CronParser | undefined;

function parseCron(expr: string, opts?: { currentDate: Date }) {
  cronParser ??= require("cron-parser") as CronParser;
  return opts
    ? cronParser.CronExpressionParser.parse(expr, opts)
    : cronParser.CronExpressionParser.parse(expr);
}

function logLine(job: Job, line: string): void {
  fs.appendFileSync(job.logFile, `[${new Date().toISOString()}] ${line}\n`, "utf8");
}

export function dueByTime(job: Job, now: Date): boolean {
  if (job.cron) {
    const key = minuteKey(now);
    if (job.lastCronMinute === key) return false;
    try {
      // cron-parser's prev()/next() treat currentDate as exclusive, so a tick at
      // second 0 (Task Scheduler's default) would skip the current minute.
      const minuteStart = new Date(now);
      minuteStart.setSeconds(0, 0);
      const expr = parseCron(job.cron, {
        currentDate: new Date(minuteStart.getTime() - 1),
      });
      return minuteKey(expr.next().toDate()) === key;
    } catch {
      return false;
    }
  }
  if (job.at) {
    return now.getTime() >= Date.parse(job.at);
  }
  return true;
}

/** Quote one argv token so cmd.exe /s /c "..." keeps it as a single argument. */
export function quoteWinCmdArg(s: string): string {
  if (s.length === 0) return '""';
  const escaped = s.replace(/%/g, "%%").replace(/"/g, '""');
  if (!/[\s&|<>()^%!"]/.test(s)) return s;
  return `"${escaped}"`;
}

function expired(job: Job, now: Date): boolean {
  return Boolean(job.until && now.getTime() > Date.parse(job.until));
}

function runCommand(job: Job): Promise<{ code: number }> {
  return new Promise((resolve) => {
    if (job.dryRun) {
      logLine(job, `dry-run: would execute ${job.command.join(" ")}`);
      resolve({ code: 0 });
      return;
    }

    const opts = {
      cwd: job.cwd,
      env: process.env,
      windowsHide: true,
    };
    // Windows + shell:true concatenates argv with spaces (breaks "Hello world"
    // and C:\Program Files\...). Pass one quoted command line instead.
    const child =
      process.platform === "win32"
        ? spawn(job.command.map(quoteWinCmdArg).join(" "), { ...opts, shell: true })
        : spawn(job.command[0], job.command.slice(1), opts);

    const out = fs.createWriteStream(job.logFile, { flags: "a" });
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);

    const timer =
      job.timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            logLine(job, `timed out after ${job.timeoutMs}ms`);
          }, job.timeoutMs)
        : undefined;

    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      out.end();
      resolve({ code });
    };
    child.on("error", (err) => {
      logLine(job, `spawn error: ${err.message}`);
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

export async function executeJob(job: Job): Promise<Job> {
  job.status = "running";
  job.lastRunAt = new Date().toISOString();
  job.attempts += 1;
  upsertJob(job);

  if (job.requireSameBranch && job.branch) {
    const meta = repoMeta(job.cwd);
    if (meta.branch && meta.branch !== job.branch) {
      job.status = "skipped";
      job.lastError = `branch changed from ${job.branch} to ${meta.branch}`;
      logLine(job, job.lastError);
      upsertJob(job);
      return job;
    }
  }

  const cond = job.when.length ? evalAllConditions(job) : { ok: true, detail: "no conditions" };
  if (!cond.ok) {
    job.status = "pending";
    job.lastError = cond.detail;
    logLine(job, `condition not met: ${cond.detail}`);
    upsertJob(job);
    return job;
  }

  logLine(job, `running: ${job.command.join(" ")} (cwd=${job.cwd})`);
  const { code } = await runCommand(job);
  job.exitCode = code;
  if (job.cron) job.lastCronMinute = minuteKey();

  if (code === 0) {
    job.lastError = undefined;
    if (job.cron) {
      job.status = "pending";
    } else {
      job.status = "done";
    }
    logLine(job, `exit 0`);
  } else if (job.attempts <= job.retry) {
    job.status = "pending";
    job.lastError = `exit ${code}, will retry (${job.attempts}/${job.retry})`;
    logLine(job, job.lastError);
  } else {
    job.status = "failed";
    job.lastError = `exit ${code}`;
    logLine(job, job.lastError);
  }

  upsertJob(job);
  return job;
}

export async function tick(now = new Date()): Promise<Job[]> {
  const ran: Job[] = [];
  const store = loadStore();
  let dirty = false;

  const persist = () => {
    if (!dirty) return;
    saveStore(store);
    dirty = false;
  };

  for (const job of store.jobs) {
    if (job.status !== "pending") continue;

    if (expired(job, now)) {
      job.status = "failed";
      job.lastError = "deadline passed before conditions were met";
      job.lastCheckedAt = now.toISOString();
      logLine(job, job.lastError);
      dirty = true;
      continue;
    }

    if (!dueByTime(job, now)) {
      continue;
    }

    if (job.when.length) {
      const cond = evalAllConditions(job);
      if (!cond.ok) {
        job.lastError = cond.detail;
        job.lastCheckedAt = now.toISOString();
        dirty = true;
        continue;
      }
    }

    persist();
    ran.push(await executeJob(job));
  }

  persist();
  return ran;
}

export function nextHint(job: Job): string {
  if (job.cron) return `cron ${job.cron}`;
  if (job.at) return job.at;
  if (job.when.length) return `when ${job.when.join(" & ")}`;
  return "soon";
}

/** List/logs line. Pending jobs say "waiting", not "ran". */
export function statusHint(job: Job): string {
  switch (job.status) {
    case "pending":
      return `waiting ${nextHint(job)}`;
    case "done":
      return job.lastRunAt ? `ran ${job.lastRunAt}` : "done";
    case "failed":
      return job.lastError ? `failed ${job.lastError}` : "failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return job.lastError ? `skipped ${job.lastError}` : "skipped";
    case "running":
      return "running";
    default:
      return nextHint(job);
  }
}

export function buildJob(opts: {
  command: string[];
  cwd: string;
  at?: string;
  in?: string;
  cron?: string;
  when: string[];
  until?: string;
  every?: string;
  timeout?: string;
  retry?: string;
  name?: string;
  dryRun: boolean;
  now: boolean;
  sameBranch: boolean;
  id: string;
}): Job {
  const now = new Date();
  let at: string | undefined;

  if (opts.now) {
    at = now.toISOString();
  } else if (opts.in) {
    at = parseWhen(opts.in, now).toISOString();
  } else if (opts.at) {
    at = parseWhen(opts.at, now).toISOString();
  }

  const everyMs = opts.every ? parseDurationMs(opts.every) ?? 15_000 : 15_000;
  const timeoutMs = opts.timeout ? parseDurationMs(opts.timeout) ?? 0 : 0;
  const retry = opts.retry ? Number(opts.retry) : 0;
  const meta = repoMeta(opts.cwd);

  if (!opts.cron && !at && !opts.when.length) {
    throw new Error("Provide --at, --in, --cron, --when, or --now.");
  }
  if (opts.cron) {
    parseCron(opts.cron);
  }

  const job: Job = {
    id: opts.id,
    name: opts.name,
    createdAt: now.toISOString(),
    command: opts.command,
    cwd: opts.cwd,
    gitRoot: meta.gitRoot,
    branch: meta.branch,
    at,
    cron: opts.cron,
    when: opts.when,
    until: opts.until ? parseWhen(opts.until, now).toISOString() : undefined,
    everyMs,
    timeoutMs,
    retry: Number.isFinite(retry) ? retry : 0,
    attempts: 0,
    requireSameBranch: opts.sameBranch,
    dryRun: opts.dryRun,
    status: "pending",
    logFile: `${logsDir()}/${opts.id}.log`,
  };

  return job;
}

/** Create or replace the pending job for this command in this directory. */
export function enqueueJob(
  opts: Omit<Parameters<typeof buildJob>[0], "id"> & { id?: string },
): { job: Job; replaced: boolean } {
  const store = loadStore();
  const existing = findPendingDuplicate(opts.command, opts.cwd, store.jobs);
  const id = existing?.id ?? opts.id ?? newJobId();
  const job = buildJob({ ...opts, id });
  putJobCancellingDuplicates(job, store);
  const replaced = Boolean(existing);
  logLine(
    job,
    `${replaced ? "updated" : "scheduled"}  ${nextHint(job)}${job.when.length ? ` if ${job.when.join(" & ")}` : ""}`,
  );
  return { job, replaced };
}
