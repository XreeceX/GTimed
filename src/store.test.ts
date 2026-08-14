import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  cancelOtherPendingDuplicates,
  cancelPending,
  commandsEqual,
  findPendingDuplicate,
  getJob,
  jobsPath,
  latestJob,
  loadStore,
  newJobId,
  pendingJobs,
  upsertJob,
  type Job,
} from "./store.js";
import { isolatedHome } from "./test-util.js";

function job(partial: Partial<Job>): Job {
  return {
    id: "aaaa1111",
    createdAt: "2026-08-14T10:00:00.000Z",
    command: ["git", "push"],
    cwd: "/repo",
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

test("loadStore returns empty when missing", () => {
  isolatedHome();
  assert.deepEqual(loadStore().jobs, []);
});

test("loadStore recovers from corrupt json", () => {
  const home = isolatedHome();
  fs.writeFileSync(path.join(home, "jobs.json"), "{not json", "utf8");
  assert.deepEqual(loadStore().jobs, []);
});

test("upsertJob inserts then replaces by id", () => {
  isolatedHome();
  upsertJob(job({ id: "abc" }));
  upsertJob(job({ id: "abc", status: "done" }));
  assert.equal(loadStore().jobs.length, 1);
  assert.equal(loadStore().jobs[0]?.status, "done");
});

test("jobs.json is written under GTIMED_HOME", () => {
  const home = isolatedHome();
  upsertJob(job({ id: "filecheck" }));
  assert.equal(jobsPath(), path.join(home, "jobs.json"));
  assert.equal(fs.existsSync(jobsPath()), true);
});

test("newJobId is 8 hex chars", () => {
  assert.match(newJobId(), /^[0-9a-f]{8}$/);
});

test("getJob matches unique prefix", () => {
  isolatedHome();
  upsertJob(job({ id: "abc12345" }));
  upsertJob(job({ id: "def67890", command: ["git", "status"] }));
  assert.equal(getJob("abc")?.id, "abc12345");
});

test("getJob returns undefined when prefix is ambiguous", () => {
  isolatedHome();
  upsertJob(job({ id: "aaa11111" }));
  upsertJob(job({ id: "aaa22222", command: ["git", "status"] }));
  assert.equal(getJob("aaa"), undefined);
});

test("pendingJobs ignores done jobs", () => {
  isolatedHome();
  upsertJob(job({ id: "p", status: "pending" }));
  upsertJob(job({ id: "d", status: "done", command: ["git", "status"] }));
  assert.deepEqual(pendingJobs().map((j) => j.id), ["p"]);
});

test("cancelPending all", () => {
  isolatedHome();
  upsertJob(job({ id: "one" }));
  upsertJob(job({ id: "two", command: ["git", "status"] }));
  const cancelled = cancelPending("all");
  assert.equal(cancelled.length, 2);
  assert.equal(pendingJobs().length, 0);
});

test("cancelPending last uses newest createdAt", () => {
  isolatedHome();
  upsertJob(job({ id: "old", createdAt: "2026-08-14T10:00:00.000Z" }));
  upsertJob(job({ id: "new", createdAt: "2026-08-14T11:00:00.000Z", command: ["git", "status"] }));
  const cancelled = cancelPending("last");
  assert.equal(cancelled[0]?.id, "new");
  assert.equal(getJob("old")?.status, "pending");
});

test("cancelPending by id prefix", () => {
  isolatedHome();
  upsertJob(job({ id: "beef0001" }));
  const cancelled = cancelPending("beef");
  assert.equal(cancelled[0]?.id, "beef0001");
  assert.equal(cancelled[0]?.status, "cancelled");
});

test("commandsEqual", () => {
  assert.equal(commandsEqual(["git", "push"], ["git", "push"]), true);
  assert.equal(commandsEqual(["git", "push"], ["git", "push", "origin"]), false);
});

test("findPendingDuplicate matches command and cwd", () => {
  isolatedHome();
  upsertJob(job({ id: "keep", cwd: process.cwd(), command: ["git", "push"] }));
  const hit = findPendingDuplicate(["git", "push"], process.cwd());
  assert.equal(hit?.id, "keep");
  assert.equal(findPendingDuplicate(["git", "commit"], process.cwd()), undefined);
});

test("findPendingDuplicate ignores done jobs", () => {
  isolatedHome();
  upsertJob(job({ id: "old", cwd: process.cwd(), status: "done" }));
  assert.equal(findPendingDuplicate(["git", "push"], process.cwd()), undefined);
});

test("cancelOtherPendingDuplicates leaves keepId", () => {
  isolatedHome();
  upsertJob(job({ id: "keep", cwd: process.cwd() }));
  upsertJob(job({ id: "drop", cwd: process.cwd(), createdAt: "2026-08-14T09:00:00.000Z" }));
  const dropped = cancelOtherPendingDuplicates(["git", "push"], process.cwd(), "keep");
  assert.equal(dropped[0]?.id, "drop");
  assert.equal(getJob("keep")?.status, "pending");
  assert.equal(getJob("drop")?.status, "cancelled");
});

test("latestJob prefers lastRunAt then createdAt", () => {
  isolatedHome();
  upsertJob(job({ id: "older", createdAt: "2026-08-14T10:00:00.000Z", lastRunAt: "2026-08-14T12:00:00.000Z" }));
  upsertJob(job({ id: "newer", createdAt: "2026-08-14T11:00:00.000Z", command: ["git", "status"] }));
  assert.equal(latestJob()?.id, "older");
});

test("latestJob is undefined when the store is empty", () => {
  isolatedHome();
  assert.equal(latestJob(), undefined);
});
