import { randomBytes } from "node:crypto";
import { fireGithubJob } from "./github.js";
import { createMemoryStore } from "./store.js";
import type { CloudDeps, CloudJob, CloudReq, CloudRes } from "./types.js";
import { jsonRes } from "./types.js";

const BEARER = /^Bearer\s+/i;

export interface TestDeps extends CloudDeps {
  githubCalls: { path: string; method: string; body?: unknown }[];
}

export function createTestDeps(overrides: Partial<CloudDeps> = {}): TestDeps {
  const githubCalls: TestDeps["githubCalls"] = [];
  const deps: TestDeps = {
    store: createMemoryStore(),
    now: () => new Date(),
    newToken: () => `gtm_${randomBytes(16).toString("hex")}`,
    hashToken: (t) => t,
    githubUser: async (accessToken) => (accessToken ? { login: "tester" } : undefined),
    githubFetch: async (path, init) => {
      githubCalls.push({ path, method: init?.method ?? "GET", body: init?.body });
      return { status: 200, json: { ahead_by: 1, sha: "abc" } };
    },
    allowDevLogin: true,
    githubCalls,
    ...overrides,
  };
  if (!overrides.githubFetch) {
    deps.githubFetch = async (path, init) => {
      githubCalls.push({ path, method: init?.method ?? "GET", body: init?.body });
      return { status: 200, json: { ahead_by: 1, sha: "abc" } };
    };
  }
  return deps;
}

export function header(req: CloudReq, name: string): string | undefined {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function bearer(req: CloudReq): string | undefined {
  const auth = header(req, "authorization");
  if (!auth || !BEARER.test(auth)) return undefined;
  return auth.replace(BEARER, "").trim() || undefined;
}

function parseBody(req: CloudReq): Record<string, unknown> {
  if (!req.body?.trim()) return {};
  try {
    const v = JSON.parse(req.body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function sameCwd(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

function commandsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((x, i) => x === right[i]);
}

function dueAt(job: CloudJob, now: Date): boolean {
  if (job.cron) return true;
  if (job.at) return now.getTime() >= Date.parse(job.at);
  return true;
}

function expired(job: CloudJob, now: Date): boolean {
  return Boolean(job.until && now.getTime() > Date.parse(job.until));
}

function matchJob(jobs: CloudJob[], id: string): CloudJob | undefined {
  const prefix = id.toLowerCase();
  const matches = jobs.filter((j) => j.id === id || j.id.toLowerCase().startsWith(prefix));
  return matches.length === 1 ? matches[0] : matches.find((j) => j.id === id);
}

function asJob(raw: unknown): CloudJob {
  const j = raw as CloudJob;
  if (!j || typeof j !== "object" || typeof j.id !== "string" || !Array.isArray(j.command)) {
    throw Object.assign(new Error("invalid job"), { status: 400 });
  }
  return {
    ...j,
    when: Array.isArray(j.when) ? j.when : [],
    command: j.command.map(String),
    cwd: String(j.cwd ?? ""),
    status: j.status ?? "pending",
    kind: j.kind === "github" ? "github" : "local",
    createdAt: j.createdAt || new Date().toISOString(),
    everyMs: Number(j.everyMs) || 15_000,
    timeoutMs: Number(j.timeoutMs) || 0,
    retry: Number(j.retry) || 0,
    attempts: Number(j.attempts) || 0,
    requireSameBranch: Boolean(j.requireSameBranch),
    dryRun: Boolean(j.dryRun),
    logFile: j.logFile || `${j.id}.log`,
  };
}

async function auth(req: CloudReq, deps: CloudDeps) {
  const token = bearer(req);
  if (!token) return undefined;
  return deps.store.getSession(deps.hashToken(token));
}

function pathAndSearch(req: CloudReq): { pathname: string; search: URLSearchParams } {
  const raw = req.pathname || "/";
  const cut = raw.indexOf("?");
  const pathOnly = normalizePath(cut >= 0 ? raw.slice(0, cut) : raw);
  const search = new URLSearchParams(cut >= 0 ? raw.slice(cut + 1) : (req.search ?? ""));
  return { pathname: pathOnly, search };
}

export async function handleRequest(req: CloudReq, deps: CloudDeps): Promise<CloudRes> {
  try {
    const { pathname, search } = pathAndSearch(req);
    const method = req.method.toUpperCase();
    req = { ...req, pathname, search: search.toString() };

    if (method === "GET" && pathname === "/api/auth/config") {
      return jsonRes(200, { githubClientId: deps.githubClientId || undefined });
    }

    if (method === "POST" && pathname === "/api/auth/login") {
      return login(req, deps);
    }

    if (method === "POST" && pathname === "/api/internal/fire") {
      return internalFire(req, deps);
    }

    const session = await auth(req, deps);
    if (!session) return jsonRes(401, { error: "unauthorized" });

    if (method === "GET" && pathname === "/api/jobs") {
      return listJobs(req, deps, session.userId);
    }
    if (method === "POST" && pathname === "/api/jobs") {
      return createJob(req, deps, session.userId);
    }
    if (method === "POST" && pathname === "/api/jobs/cancel") {
      return cancelJobs(req, deps, session.userId);
    }
    if (method === "POST" && pathname === "/api/jobs/claim") {
      return claimJob(req, deps, session.userId);
    }

    const jobFire = /^\/api\/jobs\/([^/]+)\/fire$/.exec(pathname);
    if (method === "POST" && jobFire?.[1]) {
      return userFire(deps, session.userId, decodeURIComponent(jobFire[1]));
    }
    const jobResult = /^\/api\/jobs\/([^/]+)\/result$/.exec(pathname);
    if (method === "POST" && jobResult?.[1]) {
      return resultJob(req, deps, session.userId, decodeURIComponent(jobResult[1]));
    }
    const jobGet = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
    if (method === "GET" && jobGet?.[1]) {
      const jobs = await deps.store.listJobs(session.userId);
      const job = matchJob(jobs, decodeURIComponent(jobGet[1]));
      if (!job) return jsonRes(404, { error: "unknown job" });
      return jsonRes(200, { job });
    }

    return jsonRes(404, { error: "not found" });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    return jsonRes(status, { error: message });
  }
}

async function login(req: CloudReq, deps: CloudDeps): Promise<CloudRes> {
  const body = parseBody(req);
  const access =
    (typeof body.githubAccessToken === "string" && body.githubAccessToken) ||
    (typeof body.token === "string" && body.token) ||
    (typeof body.devToken === "string" && body.devToken) ||
    "";
  if (!access) return jsonRes(400, { error: "missing githubAccessToken" });

  let loginName: string | undefined;
  if (deps.allowDevLogin) {
    loginName = access.startsWith("gtm_") ? "dev" : (await deps.githubUser(access))?.login ?? "dev";
  } else {
    loginName = (await deps.githubUser(access))?.login;
  }
  if (!loginName) return jsonRes(401, { error: "invalid GitHub token" });

  const token = deps.newToken();
  const userId = loginName.toLowerCase();
  await deps.store.putSession({
    tokenHash: deps.hashToken(token),
    userId,
    githubUser: loginName,
  });
  return jsonRes(200, { token, githubUser: loginName });
}

async function listJobs(req: CloudReq, deps: CloudDeps, userId: string): Promise<CloudRes> {
  const query = new URLSearchParams(req.search ?? "");
  let jobs = await deps.store.listJobs(userId);
  const kind = query.get("kind");
  const status = query.get("status");
  const machine = query.get("machine") ?? header(req, "x-gtimed-machine");
  if (kind) jobs = jobs.filter((j) => (j.kind ?? "local") === kind);
  if (status) jobs = jobs.filter((j) => j.status === status);
  if (machine && kind === "local") jobs = jobs.filter((j) => j.machineId === machine);
  return jsonRes(200, { jobs });
}

async function createJob(req: CloudReq, deps: CloudDeps, userId: string): Promise<CloudRes> {
  const body = parseBody(req);
  const job = asJob(body.job);
  const machine = header(req, "x-gtimed-machine");
  if (machine && !job.machineId) job.machineId = machine;
  if (!job.kind) job.kind = job.github ? "github" : "local";
  job.status = job.status || "pending";

  const jobs = await deps.store.listJobs(userId);
  const existing = jobs.find(
    (j) => j.status === "pending" && commandsEqual(j.command, job.command) && sameCwd(j.cwd, job.cwd),
  );
  let replaced = false;
  if (existing) {
    job.id = existing.id;
    replaced = true;
  }
  for (const j of jobs) {
    if (
      j.status === "pending" &&
      j.id !== job.id &&
      commandsEqual(j.command, job.command) &&
      sameCwd(j.cwd, job.cwd)
    ) {
      j.status = "cancelled";
    }
  }
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  await deps.store.putJobs(userId, jobs);
  if (job.kind === "github" && job.at && deps.wake) {
    await deps.wake.schedule({ userId, jobId: job.id, dueAt: job.at });
  }
  return jsonRes(200, { job, replaced });
}

async function cancelJobs(req: CloudReq, deps: CloudDeps, userId: string): Promise<CloudRes> {
  const body = parseBody(req);
  const which = String(body.which ?? "");
  const jobs = await deps.store.listJobs(userId);
  const pending = jobs.filter((j) => j.status === "pending");
  let targets: CloudJob[] = [];
  if (which === "all") targets = pending;
  else if (which === "last") {
    let last: CloudJob | undefined;
    for (const j of pending) {
      if (!last || j.createdAt.localeCompare(last.createdAt) > 0) last = j;
    }
    if (last) targets = [last];
  } else {
    const hit = matchJob(pending, which);
    if (hit) targets = [hit];
  }
  for (const job of targets) job.status = "cancelled";
  if (targets.length) await deps.store.putJobs(userId, jobs);
  return jsonRes(200, { jobs: targets });
}

async function claimJob(req: CloudReq, deps: CloudDeps, userId: string): Promise<CloudRes> {
  const body = parseBody(req);
  const id = String(body.id ?? "");
  const machine = header(req, "x-gtimed-machine");
  const now = deps.now();
  const jobs = await deps.store.listJobs(userId);
  const job = matchJob(jobs, id);
  if (!job) return jsonRes(404, { error: "unknown job" });
  if (job.kind === "github") return jsonRes(409, { error: "github jobs are not claimed locally" });
  if (job.status !== "pending") return jsonRes(409, { error: "job is not pending" });
  if (job.machineId && machine && job.machineId !== machine) {
    return jsonRes(409, { error: "job belongs to another machine" });
  }
  if (expired(job, now)) {
    job.status = "failed";
    job.lastError = "deadline passed before conditions were met";
    await deps.store.putJobs(userId, jobs);
    return jsonRes(409, { error: job.lastError });
  }
  if (!dueAt(job, now)) return jsonRes(409, { error: "job is not due" });
  job.status = "running";
  job.lastRunAt = now.toISOString();
  await deps.store.putJobs(userId, jobs);
  return jsonRes(200, { job });
}

async function resultJob(req: CloudReq, deps: CloudDeps, userId: string, id: string): Promise<CloudRes> {
  const body = parseBody(req);
  const patch = asJob(body.job ?? body);
  const jobs = await deps.store.listJobs(userId);
  const idx = jobs.findIndex((j) => j.id === id || j.id.startsWith(id));
  if (idx < 0) return jsonRes(404, { error: "unknown job" });
  const prev = jobs[idx]!;
  jobs[idx] = {
    ...prev,
    ...patch,
    id: prev.id,
    kind: prev.kind,
    machineId: prev.machineId,
    github: prev.github,
  };
  await deps.store.putJobs(userId, jobs);
  return jsonRes(200, { job: jobs[idx] });
}

async function userFire(deps: CloudDeps, userId: string, id: string): Promise<CloudRes> {
  return fireOne(deps, userId, id);
}

async function internalFire(req: CloudReq, deps: CloudDeps): Promise<CloudRes> {
  const secret = header(req, "authorization")?.replace(BEARER, "").trim();
  const qstash = header(req, "upstash-signature");
  if (deps.fireSecret && secret === deps.fireSecret) {
    /* ok */
  } else if (qstash) {
    /* QStash-signed requests are accepted; verification is in the Vercel wrapper */
  } else if (deps.fireSecret) {
    return jsonRes(401, { error: "unauthorized" });
  } else if (!deps.allowDevLogin) {
    return jsonRes(401, { error: "unauthorized" });
  }
  const body = parseBody(req);
  const userId = String(body.userId ?? "");
  const jobId = String(body.jobId ?? body.id ?? "");
  if (!userId || !jobId) return jsonRes(400, { error: "missing userId or jobId" });
  return fireOne(deps, userId, jobId);
}

async function fireOne(deps: CloudDeps, userId: string, id: string): Promise<CloudRes> {
  const jobs = await deps.store.listJobs(userId);
  const job = matchJob(jobs, id);
  if (!job) return jsonRes(404, { error: "unknown job" });
  if (job.kind !== "github") return jsonRes(400, { error: "not a github job" });
  if (job.status === "done" || job.status === "cancelled") return jsonRes(200, { job });
  try {
    const next = await fireGithubJob(job, deps.githubFetch);
    const idx = jobs.findIndex((j) => j.id === job.id);
    jobs[idx] = next;
    await deps.store.putJobs(userId, jobs);
    return jsonRes(200, { job: next });
  } catch (err) {
    job.status = "failed";
    job.lastError = err instanceof Error ? err.message : String(err);
    const idx = jobs.findIndex((j) => j.id === job.id);
    jobs[idx] = job;
    await deps.store.putJobs(userId, jobs);
    return jsonRes(200, { job });
  }
}
