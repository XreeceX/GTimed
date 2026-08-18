import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GithubAction, GithubTarget, Job, JobKind } from "./store.js";
import { commandsEqual, ensureHome, homeDir, logsDir } from "./store.js";

export const DEFAULT_CLOUD_URL = "https://gtimed.vercel.app";

const LOCAL_WHEN = new Set(["clean", "dirty", "staged", "stg", "behind"]);

export interface CloudConfig {
  url: string;
  token: string;
  machineId: string;
  enabled: boolean;
  githubUser?: string;
}

export class CloudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudError";
  }
}

export function cloudPath(): string {
  return path.join(homeDir(), "cloud.json");
}

export function loadCloudConfig(): CloudConfig | undefined {
  let text: string;
  try {
    text = fs.readFileSync(cloudPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const raw = JSON.parse(text) as Partial<CloudConfig>;
    const url = (process.env.GTIMED_CLOUD_URL?.trim() || raw.url || "").replace(/\/+$/, "");
    const token = typeof raw.token === "string" ? raw.token : "";
    const machineId = typeof raw.machineId === "string" && raw.machineId ? raw.machineId : newMachineId();
    if (!url && !token) return undefined;
    return {
      url: url || DEFAULT_CLOUD_URL,
      token,
      machineId,
      enabled: raw.enabled !== false,
      githubUser: typeof raw.githubUser === "string" ? raw.githubUser : undefined,
    };
  } catch {
    return undefined;
  }
}

export function saveCloudConfig(cfg: CloudConfig): void {
  ensureHome();
  const out: CloudConfig = {
    url: cfg.url.replace(/\/+$/, ""),
    token: cfg.token,
    machineId: cfg.machineId || newMachineId(),
    enabled: cfg.enabled,
    githubUser: cfg.githubUser,
  };
  const file = cloudPath();
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
}

export function clearCloudConfig(): void {
  try {
    fs.unlinkSync(cloudPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function newMachineId(): string {
  return randomUUID();
}

export function isCloudOn(cfg = loadCloudConfig()): boolean {
  return Boolean(cfg?.enabled && cfg.token && cfg.url);
}

export function cloudBaseUrl(cfg = loadCloudConfig()): string {
  const env = process.env.GTIMED_CLOUD_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  return (cfg?.url || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
}

const FORCE_LOCAL_WHEN = new Set([...LOCAL_WHEN]);

export function whenForcesLocal(when: string[]): boolean {
  for (const spec of when) {
    const s = spec.trim().toLowerCase();
    if (FORCE_LOCAL_WHEN.has(s)) return true;
    if (s.startsWith("file=") || s.startsWith("cmd:") || s.startsWith("branch=")) return true;
  }
  return false;
}

export function parseGithubRemote(url: string): { owner: string; repo: string } | undefined {
  const s = url.trim().replace(/\.git$/i, "");
  const m = /(?:github\.com[:/]|github\.com\/)([^/]+)\/([^/]+)$/i.exec(s);
  if (!m?.[1] || !m[2]) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, "") };
}

export function githubActionFor(
  command: string[],
): { action: GithubAction; remote: string; branch?: string; tagName?: string; prTitle?: string; prBody?: string; prBase?: string } | undefined {
  if (command[0] === "gh" && command[1] === "pr" && (command[2] === "create" || command[2] === "new")) {
    const title = flagValue(command, "--title") ?? flagValue(command, "-t");
    const body = flagValue(command, "--body") ?? flagValue(command, "-b");
    const base = flagValue(command, "--base") ?? flagValue(command, "-B");
    return { action: "pr", remote: "origin", prTitle: title, prBody: body, prBase: base };
  }
  if (command[0] !== "git" || command[1] !== "push") return undefined;

  const args = command.slice(2);
  const remote = firstRemote(args);
  if (args.includes("--tags") || args.includes("--follow-tags")) {
    return { action: "tag", remote };
  }
  const tagPos = args.indexOf("tag");
  if (tagPos >= 0 && args[tagPos + 1] && !args[tagPos + 1]!.startsWith("-")) {
    return { action: "tag", remote, tagName: args[tagPos + 1] };
  }
  const tagRef = args.find((a) => a.startsWith("refs/tags/"));
  if (tagRef) {
    return { action: "tag", remote, tagName: tagRef.slice("refs/tags/".length).split(":")[0] };
  }
  const positional = args.filter((a) => !a.startsWith("-"));
  let branch: string | undefined;
  if (positional[0] === remote && positional[1]) {
    const refspec = positional[1];
    branch = refspec.includes(":") ? refspec.split(":").pop() : refspec;
    if (branch?.startsWith("refs/heads/")) branch = branch.slice("refs/heads/".length);
  }
  return { action: "push", remote, branch };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) return args[i + 1];
  const prefix = `${flag}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function firstRemote(args: string[]): string {
  const positional = args.filter((a) => !a.startsWith("-"));
  if (positional[0] && positional[0] !== "tag" && !positional[0].includes(":") && !positional[0].startsWith("refs/")) {
    return positional[0];
  }
  return "origin";
}

export function classifyJobKind(command: string[], when: string[], cron?: string): JobKind {
  if (cron) return "local";
  if (whenForcesLocal(when)) return "local";
  if (githubActionFor(command)) return "github";
  return "local";
}

function gitOut(cwd: string, args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return undefined;
  return (r.stdout ?? "").trim();
}

export function gitRemoteUrl(cwd: string, remote = "origin"): string | undefined {
  return gitOut(cwd, ["remote", "get-url", remote]);
}

export function gitHeadSha(cwd: string): string | undefined {
  return gitOut(cwd, ["rev-parse", "HEAD"]);
}

export function gitCurrentBranch(cwd: string): string | undefined {
  const b = gitOut(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return b && b !== "HEAD" ? b : undefined;
}

export function uploadHoldingRef(cwd: string, jobId: string, remote = "origin"): string {
  const ref = `refs/gtimed/${jobId}`;
  if (process.env.GTIMED_CLOUD_SKIP_UPLOAD === "1") return ref;
  const r = spawnSync("git", ["push", "--force", remote, `HEAD:${ref}`], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new CloudError(`could not upload holding ref ${ref}: ${(r.stderr || r.stdout || "").trim() || "git push failed"}`);
  }
  return ref;
}

export function prepareGithubTarget(job: Job): { kind: JobKind; github?: GithubTarget; note?: string } {
  const kind = classifyJobKind(job.command, job.when, job.cron);
  if (kind !== "github") return { kind: "local" };

  const parsed = githubActionFor(job.command);
  if (!parsed) return { kind: "local" };

  const remote = parsed.remote || "origin";
  const url = gitRemoteUrl(job.cwd, remote);
  if (!url) {
    return { kind: "local", note: `no git remote "${remote}"; this job will run on this machine` };
  }
  const repo = parseGithubRemote(url);
  if (!repo) {
    return { kind: "local", note: `${remote} is not GitHub; this job will run on this machine` };
  }
  const sha = gitHeadSha(job.cwd);
  if (!sha) {
    return { kind: "local", note: "no HEAD commit to upload; this job will run on this machine" };
  }
  const branch = parsed.branch || gitCurrentBranch(job.cwd);
  const holdingRef = uploadHoldingRef(job.cwd, job.id, remote);
  const github: GithubTarget = {
    owner: repo.owner,
    repo: repo.repo,
    sha,
    action: parsed.action,
    branch,
    holdingRef,
    tagName: parsed.tagName,
    prTitle: parsed.prTitle,
    prBody: parsed.prBody,
    prBase: parsed.prBase,
    remote,
  };
  return { kind: "github", github };
}

async function cloudFetch(cfg: CloudConfig, pathname: string, init: RequestInit = {}): Promise<Response> {
  const url = `${cloudBaseUrl(cfg)}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const headers = new Headers(init.headers);
  if (cfg.token) headers.set("Authorization", `Bearer ${cfg.token}`);
  if (cfg.machineId) headers.set("X-GTimed-Machine", cfg.machineId);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    const timeoutMs = Number(process.env.GTIMED_CLOUD_TIMEOUT_MS) || 20_000;
    res = await fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 20_000),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new CloudError(`cloud unreachable (${cloudBaseUrl(cfg)}): ${why}. Scheduling with cloud on needs network.`);
  }
  return res;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CloudError(`cloud returned non-JSON (${res.status})`);
  }
}

function apiError(res: Response, body: unknown): CloudError {
  const msg =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : `cloud request failed (${res.status})`;
  return new CloudError(msg);
}

export async function cloudLoginWithToken(token: string, url?: string): Promise<CloudConfig> {
  const existing = loadCloudConfig();
  const cfg: CloudConfig = {
    url: (url || cloudBaseUrl(existing)).replace(/\/+$/, ""),
    token: "",
    machineId: existing?.machineId || newMachineId(),
    enabled: true,
  };
  const res = await cloudFetch(cfg, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ githubAccessToken: token }),
  });
  const body = (await readJson(res)) as { token?: string; githubUser?: string; error?: string };
  if (!res.ok || !body.token) throw apiError(res, body);
  const next: CloudConfig = {
    url: cfg.url,
    token: body.token,
    machineId: cfg.machineId,
    enabled: true,
    githubUser: body.githubUser,
  };
  saveCloudConfig(next);
  return next;
}

export async function githubDeviceLogin(clientId: string): Promise<string> {
  const started = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "repo" }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await started.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    error?: string;
  };
  if (!started.ok || !data.device_code || !data.user_code) {
    throw new CloudError(data.error || "GitHub device login failed");
  }
  console.log(`Open ${data.verification_uri ?? "https://github.com/login/device"}`);
  console.log(`Enter code ${data.user_code}`);
  const interval = Math.max(5, data.interval ?? 5) * 1000;
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const polled = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: data.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await polled.json()) as { access_token?: string; error?: string };
    if (body.access_token) return body.access_token;
    if (body.error === "authorization_pending" || body.error === "slow_down") continue;
    throw new CloudError(body.error || "GitHub device login failed");
  }
  throw new CloudError("GitHub device login timed out");
}

export async function fetchAuthConfig(url?: string): Promise<{ githubClientId?: string }> {
  const cfg: CloudConfig = {
    url: (url || cloudBaseUrl()).replace(/\/+$/, ""),
    token: "",
    machineId: loadCloudConfig()?.machineId || newMachineId(),
    enabled: false,
  };
  const res = await cloudFetch(cfg, "/api/auth/config");
  const body = (await readJson(res)) as { githubClientId?: string };
  if (!res.ok) throw apiError(res, body);
  return body;
}

function requireCloud(): CloudConfig {
  const cfg = loadCloudConfig();
  if (!isCloudOn(cfg) || !cfg) {
    throw new CloudError("cloud is off. gtimed cloud login, then gtimed cloud on.");
  }
  return cfg;
}

export async function cloudList(): Promise<Job[]> {
  const res = await cloudFetch(requireCloud(), "/api/jobs");
  const body = (await readJson(res)) as { jobs?: Job[]; error?: string };
  if (!res.ok) throw apiError(res, body);
  return Array.isArray(body.jobs) ? body.jobs.map(hydrateJob) : [];
}

export async function cloudGet(id: string): Promise<Job | undefined> {
  const res = await cloudFetch(requireCloud(), `/api/jobs/${encodeURIComponent(id)}`);
  if (res.status === 404) return undefined;
  const body = (await readJson(res)) as { job?: Job; error?: string };
  if (!res.ok) throw apiError(res, body);
  return body.job ? hydrateJob(body.job) : undefined;
}

export async function cloudEnqueue(job: Job): Promise<{ job: Job; replaced: boolean }> {
  const res = await cloudFetch(requireCloud(), "/api/jobs", {
    method: "POST",
    body: JSON.stringify({ job }),
  });
  const body = (await readJson(res)) as { job?: Job; replaced?: boolean; error?: string };
  if (!res.ok || !body.job) throw apiError(res, body);
  return { job: hydrateJob(body.job), replaced: Boolean(body.replaced) };
}

export async function cloudCancel(which: "all" | "last" | string): Promise<Job[]> {
  const res = await cloudFetch(requireCloud(), "/api/jobs/cancel", {
    method: "POST",
    body: JSON.stringify({ which }),
  });
  const body = (await readJson(res)) as { jobs?: Job[]; error?: string };
  if (!res.ok) throw apiError(res, body);
  return Array.isArray(body.jobs) ? body.jobs.map(hydrateJob) : [];
}

export async function cloudPendingLocal(): Promise<Job[]> {
  const cfg = requireCloud();
  const q = new URLSearchParams({ kind: "local", status: "pending", machine: cfg.machineId });
  const res = await cloudFetch(cfg, `/api/jobs?${q.toString()}`);
  const body = (await readJson(res)) as { jobs?: Job[]; error?: string };
  if (!res.ok) throw apiError(res, body);
  return Array.isArray(body.jobs) ? body.jobs.map(hydrateJob) : [];
}

export async function cloudClaim(id: string): Promise<Job | undefined> {
  const res = await cloudFetch(requireCloud(), "/api/jobs/claim", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  if (res.status === 409) return undefined;
  const body = (await readJson(res)) as { job?: Job; error?: string };
  if (!res.ok) throw apiError(res, body);
  return body.job ? hydrateJob(body.job) : undefined;
}

export async function cloudResult(job: Job): Promise<Job> {
  const payload = { ...job, logText: job.logText ?? readLogTail(job) };
  const res = await cloudFetch(requireCloud(), `/api/jobs/${encodeURIComponent(job.id)}/result`, {
    method: "POST",
    body: JSON.stringify({ job: payload }),
  });
  const body = (await readJson(res)) as { job?: Job; error?: string };
  if (!res.ok) throw apiError(res, body);
  return body.job ? hydrateJob(body.job) : job;
}

export async function cloudFire(id: string): Promise<Job> {
  const res = await cloudFetch(requireCloud(), `/api/jobs/${encodeURIComponent(id)}/fire`, {
    method: "POST",
    body: "{}",
  });
  const body = (await readJson(res)) as { job?: Job; error?: string };
  if (!res.ok || !body.job) throw apiError(res, body);
  return hydrateJob(body.job);
}

function readLogTail(job: Job): string | undefined {
  try {
    const text = fs.readFileSync(job.logFile, "utf8");
    return text.length > 32_000 ? text.slice(-32_000) : text;
  } catch {
    return job.logText;
  }
}

export function hydrateJob(raw: Job): Job {
  const logFile = raw.logFile?.trim() ? raw.logFile : path.join(logsDir(), `${raw.id}.log`);
  return { ...raw, when: raw.when ?? [], logFile };
}

export function findJobMatch(jobs: Job[], id: string): Job | undefined {
  const prefix = id.toLowerCase();
  const matches = jobs.filter((j) => j.id === id || j.id.toLowerCase().startsWith(prefix));
  return matches.length === 1 ? matches[0] : matches.find((j) => j.id === id);
}

export function sameCwd(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function pendingDuplicate(jobs: Job[], command: string[], cwd: string): Job | undefined {
  let best: Job | undefined;
  for (const j of jobs) {
    if (j.status !== "pending") continue;
    if (!commandsEqual(j.command, command) || !sameCwd(j.cwd, cwd)) continue;
    if (!best || j.createdAt.localeCompare(best.createdAt) > 0) best = j;
  }
  return best;
}

export function redactSecrets(text: string, token?: string): string {
  let out = text;
  if (token) out = out.split(token).join("[redacted]");
  return out;
}

export function sessionToken(): string {
  return `gtm_${randomBytes(24).toString("hex")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listQueue(): Promise<Job[]> {
  if (isCloudOn()) return cloudList();
  const { loadStore } = await import("./store.js");
  return loadStore().jobs;
}

export async function getQueueJob(id: string): Promise<Job | undefined> {
  if (isCloudOn()) {
    const jobs = await cloudList();
    const hit = findJobMatch(jobs, id);
    if (hit) return hit;
    return cloudGet(id);
  }
  const { getJob } = await import("./store.js");
  return getJob(id);
}

export async function latestQueueJob(): Promise<Job | undefined> {
  const jobs = await listQueue();
  let best: Job | undefined;
  for (const job of jobs) {
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

export async function cancelQueue(which: "all" | "last" | string): Promise<Job[]> {
  if (isCloudOn()) return cloudCancel(which);
  const { cancelPending } = await import("./store.js");
  return cancelPending(which);
}

export async function pendingQueue(): Promise<Job[]> {
  const jobs = await listQueue();
  return jobs.filter((j) => j.status === "pending");
}

export function formatCloudStatus(cfg = loadCloudConfig()): string {
  if (!cfg?.token) {
    return [
      "cloud is off (not logged in)",
      `  url  ${cloudBaseUrl(cfg)}`,
      "  gtimed cloud login --token <github-pat>",
    ].join("\n");
  }
  return [
    `cloud is ${cfg.enabled ? "on" : "off"}`,
    `  url      ${cloudBaseUrl(cfg)}`,
    `  user     ${cfg.githubUser ?? "(unknown)"}`,
    `  machine  ${cfg.machineId}`,
  ].join("\n");
}
