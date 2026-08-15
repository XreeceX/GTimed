import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildJob, dueByTime, enqueueJob, executeJob, nextHint, quoteWinCmdArg, statusHint, tick } from "./runner.js";
import type { Job } from "./store.js";
import { loadStore, upsertJob } from "./store.js";
import { formatWhen, minuteKey } from "./time.js";

function isolatedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-home-"));
  process.env.GTIMED_HOME = home;
  return home;
}

function stubJob(partial: Partial<Job>): Job {
  return {
    id: "j1",
    createdAt: new Date().toISOString(),
    command: ["git", "status"],
    cwd: process.cwd(),
    when: [],
    everyMs: 15_000,
    timeoutMs: 0,
    retry: 0,
    attempts: 0,
    requireSameBranch: false,
    dryRun: true,
    status: "pending",
    logFile: "x.log",
    ...partial,
  };
}

test("cron is due at exact second 0 (Task Scheduler tick)", () => {
  const now = new Date();
  now.setHours(18, 0, 0, 0);
  const job = stubJob({ cron: "0 18 * * *" });
  assert.equal(dueByTime(job, now), true);
});

test("cron is not due a minute after the slot", () => {
  const now = new Date();
  now.setHours(18, 1, 0, 0);
  const job = stubJob({ cron: "0 18 * * *" });
  assert.equal(dueByTime(job, now), false);
});

test("cron every-minute is due at second 0", () => {
  const now = new Date();
  now.setSeconds(0, 0);
  const job = stubJob({ cron: "* * * * *" });
  assert.equal(dueByTime(job, now), true);
});

test("cron does not re-fire in the same minute", () => {
  const now = new Date();
  now.setSeconds(0, 0);
  const job = stubJob({ cron: "* * * * *", lastCronMinute: minuteKey(now) });
  assert.equal(dueByTime(job, now), false);
});

test("future --in job is not due yet", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const job = stubJob({ at: "2026-08-13T13:00:00.000Z" });
  assert.equal(dueByTime(job, now), false);
});

test("past --at job is due", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const job = stubJob({ at: "2026-08-13T11:00:00.000Z" });
  assert.equal(dueByTime(job, now), true);
});

test("quoteWinCmdArg keeps Program Files and messages intact", () => {
  assert.equal(quoteWinCmdArg("git"), "git");
  assert.equal(quoteWinCmdArg("C:\\Program Files\\nodejs\\node.exe"), '"C:\\Program Files\\nodejs\\node.exe"');
  assert.equal(quoteWinCmdArg("Hello world"), '"Hello world"');
  assert.equal(quoteWinCmdArg(""), '""');
});

test("executeJob preserves args with spaces", async () => {
  isolatedHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-job-"));
  const script = path.join(dir, "check.js");
  fs.writeFileSync(script, "process.exit(process.argv[2] === 'Hello world' ? 0 : 1);\n");
  const job = buildJob({
    command: [process.execPath, script, "Hello world"],
    cwd: dir,
    when: [],
    dryRun: false,
    now: true,
    sameBranch: false,
    id: "spacearg",
  });
  const ran = await executeJob(job);
  assert.equal(ran.status, "done", ran.lastError);
});

test("missing command fails instead of hanging", async () => {
  isolatedHome();
  const job = buildJob({
    command: ["definitely-not-a-gtimed-binary-xyz"],
    cwd: os.tmpdir(),
    when: [],
    dryRun: false,
    now: true,
    sameBranch: false,
    id: "missing",
  });
  const ran = await Promise.race([
    executeJob(job),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung")), 5_000)),
  ]);
  assert.equal(ran.status, "failed");
});

test("failed cron job still records lastCronMinute so daemon does not burn retries", async () => {
  isolatedHome();
  const job = buildJob({
    command: [process.execPath, "-e", "process.exit(2)"],
    cwd: os.tmpdir(),
    cron: "* * * * *",
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
    retry: "3",
    id: "cronfail",
  });
  const ran = await executeJob(job);
  assert.equal(ran.status, "pending");
  assert.ok(ran.lastCronMinute);
  assert.equal(dueByTime(ran, new Date()), false);
});

test("tick runs a due dry-run cron job once per minute", async () => {
  isolatedHome();
  const job = buildJob({
    command: ["git", "status"],
    cwd: process.cwd(),
    cron: "* * * * *",
    when: [],
    dryRun: true,
    now: false,
    sameBranch: false,
    id: "crontick",
  });
  upsertJob(job);
  const now = new Date();
  now.setSeconds(0, 0);
  const ran = await tick(now);
  assert.equal(ran.length, 1);
  const ran2 = await tick(now);
  assert.equal(ran2.length, 0);
});

test("rescheduling the same command overwrites the pending time", () => {
  isolatedHome();
  const cwd = process.cwd();
  const first = enqueueJob({
    command: ["git", "push"],
    cwd,
    in: "20m",
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
  });
  assert.equal(first.replaced, false);

  const second = enqueueJob({
    command: ["git", "push"],
    cwd,
    in: "5m",
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
  });
  assert.equal(second.replaced, true);
  assert.equal(second.job.id, first.job.id);
  assert.ok(second.job.at);
  assert.ok(first.job.at);
  assert.ok(Date.parse(second.job.at!) < Date.parse(first.job.at!));

  const pending = loadStore().jobs.filter((j) => j.status === "pending" && j.command[1] === "push");
  assert.equal(pending.length, 1);
});

test("a different command or cwd keeps a separate job", () => {
  isolatedHome();
  const cwd = process.cwd();
  const push = enqueueJob({
    command: ["git", "push"],
    cwd,
    in: "20m",
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
  });
  const commit = enqueueJob({
    command: ["git", "commit", "-m", "x"],
    cwd,
    in: "20m",
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
  });
  assert.equal(commit.replaced, false);
  assert.notEqual(commit.job.id, push.job.id);

  const other = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-cwd-"));
  const pushOther = enqueueJob({
    command: ["git", "push"],
    cwd: other,
    in: "5m",
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
  });
  assert.equal(pushOther.replaced, false);
  assert.notEqual(pushOther.job.id, push.job.id);
});

test("tick of a future job returns nothing due", async () => {
  isolatedHome();
  const job = buildJob({
    command: ["git", "push"],
    cwd: process.cwd(),
    at: "2099-01-01T00:00:00.000Z",
    when: [],
    dryRun: true,
    now: false,
    sameBranch: false,
    id: "later",
  });
  upsertJob(job);
  const ran = await tick(new Date("2026-08-14T10:00:00.000Z"));
  assert.equal(ran.length, 0);
  assert.equal(loadStore().jobs[0]?.status, "pending");
});

test("tick of a future job does not rewrite jobs.json", async () => {
  const home = isolatedHome();
  const job = buildJob({
    command: ["git", "push"],
    cwd: process.cwd(),
    at: "2099-01-01T00:00:00.000Z",
    when: [],
    dryRun: true,
    now: false,
    sameBranch: false,
    id: "later",
  });
  upsertJob(job);
  const file = path.join(home, "jobs.json");
  const before = fs.readFileSync(file, "utf8");
  await tick(new Date("2026-08-14T10:00:00.000Z"));
  await tick(new Date("2026-08-14T10:01:00.000Z"));
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("tick fails a job whose --until has passed", async () => {
  const home = isolatedHome();
  const job = stubJob({
    id: "late",
    until: "2026-08-14T10:00:00.000Z",
    at: "2026-08-14T12:00:00.000Z",
    logFile: path.join(home, "late.log"),
  });
  upsertJob(job);
  const ran = await tick(new Date("2026-08-14T11:00:00.000Z"));
  assert.equal(ran.length, 0);
  assert.equal(loadStore().jobs[0]?.status, "failed");
  assert.match(loadStore().jobs[0]?.lastError ?? "", /deadline/);
});

test("tick leaves pending when --when fails", async () => {
  const home = isolatedHome();
  const job = stubJob({
    id: "whenfail",
    at: "2026-08-14T10:00:00.000Z",
    when: ['cmd:node -e "process.exit(2)"'],
    logFile: path.join(home, "when.log"),
  });
  upsertJob(job);
  const ran = await tick(new Date("2026-08-14T11:00:00.000Z"));
  assert.equal(ran.length, 0);
  assert.equal(loadStore().jobs[0]?.status, "pending");
});

test("executeJob dry-run succeeds without spawning", async () => {
  isolatedHome();
  const job = buildJob({
    command: ["definitely-not-a-gtimed-binary-xyz"],
    cwd: os.tmpdir(),
    when: [],
    dryRun: true,
    now: true,
    sameBranch: false,
    id: "dry",
  });
  const ran = await executeJob(job);
  assert.equal(ran.status, "done");
});

test("buildJob requires a schedule", () => {
  isolatedHome();
  assert.throws(
    () =>
      buildJob({
        command: ["git", "push"],
        cwd: process.cwd(),
        when: [],
        dryRun: false,
        now: false,
        sameBranch: false,
        id: "nosched",
      }),
    /Provide --at, --in, --cron, --when, or --now/,
  );
});

test("buildJob rejects invalid cron", () => {
  isolatedHome();
  assert.throws(
    () =>
      buildJob({
        command: ["git", "fetch"],
        cwd: process.cwd(),
        cron: "not-a-cron",
        when: [],
        dryRun: true,
        now: false,
        sameBranch: false,
        id: "badcron",
      }),
    /Error/,
  );
});

test("nextHint prefers cron then at then when", () => {
  assert.equal(nextHint(stubJob({ cron: "0 9 * * *" })), "cron 0 9 * * *");
  assert.equal(nextHint(stubJob({ at: "2026-08-14T10:45:00.000Z" })), formatWhen("2026-08-14T10:45:00.000Z"));
  assert.equal(nextHint(stubJob({ when: ["clean", "ahead"] })), "when clean & ahead");
  assert.equal(nextHint(stubJob({})), "soon");
});

test("enqueueJob stores UTC ISO even though nextHint is local", () => {
  isolatedHome();
  const { job } = enqueueJob({
    command: ["git", "push"],
    cwd: process.cwd(),
    at: "2026-08-14T10:45:00.000Z",
    when: [],
    dryRun: true,
    now: false,
    sameBranch: false,
  });
  assert.equal(job.at, "2026-08-14T10:45:00.000Z");
  const stored = JSON.parse(fs.readFileSync(path.join(process.env.GTIMED_HOME!, "jobs.json"), "utf8")) as {
    jobs: { at?: string }[];
  };
  assert.equal(stored.jobs[0]?.at, "2026-08-14T10:45:00.000Z");
  assert.equal(nextHint(job), formatWhen("2026-08-14T10:45:00.000Z"));
  assert.doesNotMatch(nextHint(job), /T10:45:00/);
});

test("statusHint does not make a pending job look finished", () => {
  const pending = stubJob({ status: "pending", at: "2026-08-14T10:45:00.000Z" });
  assert.equal(statusHint(pending), `waiting ${formatWhen("2026-08-14T10:45:00.000Z")}`);
  assert.doesNotMatch(statusHint(pending), /T10:45:00\.000Z/);
  assert.match(statusHint(stubJob({ status: "done", lastRunAt: "2026-08-14T10:45:00.000Z" })), /^ran /);
  assert.equal(
    statusHint(stubJob({ status: "done", lastRunAt: "2026-08-14T10:45:00.000Z" })),
    `ran ${formatWhen("2026-08-14T10:45:00.000Z")}`,
  );
  assert.equal(statusHint(stubJob({ status: "cancelled" })), "cancelled");
  assert.match(statusHint(stubJob({ status: "failed", lastError: "exit 1" })), /failed exit 1/);
  assert.equal(statusHint(stubJob({ status: "running" })), "running");
  assert.match(statusHint(stubJob({ status: "skipped", lastError: "branch changed" })), /skipped branch changed/);
});

test("quoteWinCmdArg quotes shell metacharacters", () => {
  assert.equal(quoteWinCmdArg("a&b"), '"a&b"');
  assert.equal(quoteWinCmdArg("100%"), '"100%%"');
});

test("when-only job is due by time", () => {
  const job = stubJob({ when: ["clean"] });
  assert.equal(dueByTime(job, new Date()), true);
});

test("one-shot failure with retry stays pending", async () => {
  isolatedHome();
  const job = buildJob({
    command: [process.execPath, "-e", "process.exit(2)"],
    cwd: os.tmpdir(),
    when: [],
    dryRun: false,
    now: true,
    sameBranch: false,
    retry: "1",
    id: "retry1",
  });
  const ran = await executeJob(job);
  assert.equal(ran.status, "pending");
  assert.match(ran.lastError ?? "", /will retry/);
});
