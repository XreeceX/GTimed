export type JobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export type JobKind = "github" | "local";

export type GithubAction = "push" | "pr" | "tag";

export interface GithubTarget {
  owner: string;
  repo: string;
  sha: string;
  action: GithubAction;
  branch?: string;
  holdingRef?: string;
  tagName?: string;
  prTitle?: string;
  prBody?: string;
  prBase?: string;
  remote?: string;
}

export interface CloudJob {
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
  kind?: JobKind;
  machineId?: string;
  github?: GithubTarget;
  logText?: string;
}

export interface CloudUser {
  id: string;
  githubUser: string;
  createdAt: string;
}

export interface Session {
  tokenHash: string;
  userId: string;
  githubUser: string;
}

export interface CloudReq {
  method: string;
  pathname: string;
  search?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface CloudRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface JobStore {
  getSession(tokenHash: string): Promise<Session | undefined>;
  putSession(session: Session): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  listJobs(userId: string): Promise<CloudJob[]>;
  putJobs(userId: string, jobs: CloudJob[]): Promise<void>;
}

export type GithubFetch = (
  path: string,
  init?: { method?: string; body?: unknown; token?: string },
) => Promise<{ status: number; json: unknown }>;

export interface WakeScheduler {
  schedule(opts: { userId: string; jobId: string; dueAt: string }): Promise<void>;
}

export interface CloudDeps {
  store: JobStore;
  now: () => Date;
  newToken: () => string;
  hashToken: (token: string) => string;
  githubUser: (accessToken: string) => Promise<{ login: string } | undefined>;
  githubFetch: GithubFetch;
  wake?: WakeScheduler;
  fireSecret?: string;
  githubClientId?: string;
  allowDevLogin?: boolean;
  publicUrl?: string;
}

export function jsonRes(status: number, body: unknown): CloudRes {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
