import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { repoState, stagePaths } from "./repo.js";
import { enqueueJob, executeJob } from "./runner.js";
import { getJob, loadStore, upsertJob } from "./store.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

let cachedUiRoot: string | undefined;

export function uiRoot(): string {
  if (cachedUiRoot) return cachedUiRoot;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.join(here, "..", "ui"), path.join(process.cwd(), "ui")]) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      cachedUiRoot = dir;
      return dir;
    }
  }
  throw new Error("ui/ folder not found (expected index.html next to the project root)");
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Resolve a URL path under the UI root, or null if it would escape the folder. */
export function resolveUiFile(root: string, urlPath: string): string | null {
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  rel = (rel.split("?")[0] ?? rel).replace(/\\/g, "/");
  if (!rel || rel.includes("\0")) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  const extra = path.relative(base, file);
  if (!extra || extra.startsWith("..") || path.isAbsolute(extra)) return null;
  return file;
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const file = resolveUiFile(uiRoot(), urlPath);
  if (!file) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  if (st.isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function startUi(opts: { cwd: string; port: number; host: string }): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void handle(req, res, opts.cwd);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, defaultCwd: string): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const cwd = url.searchParams.get("cwd") || defaultCwd;

    if (req.method === "GET" && url.pathname === "/api/repo") {
      json(res, 200, repoState(cwd));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/jobs") {
      json(res, 200, { jobs: loadStore().jobs });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/stage") {
      const body = JSON.parse(await readBody(req)) as { paths?: string[]; staged?: boolean; cwd?: string };
      const result = stagePaths(body.cwd || cwd, body.paths ?? [], body.staged !== false);
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/schedule") {
      const body = JSON.parse(await readBody(req)) as ScheduleBody;
      const jobCwd = body.cwd || cwd;
      const command = ["git", "commit", "-m", body.message?.trim() || "scheduled commit"];
      const parsed = {
        command,
        in: body.mode === "in" ? body.in : undefined,
        at: body.mode === "at" ? body.at : undefined,
        cron: body.mode === "cron" ? body.cron : undefined,
        when: body.when ?? [],
        now: body.mode === "now",
        dryRun: Boolean(body.dryRun),
        sameBranch: Boolean(body.sameBranch),
        name: body.name,
        cwd: undefined as string | undefined,
        until: body.until,
        retry: body.retry,
      };
      const commitJob = enqueueJob({
        ...parsed,
        when: parsed.when,
        dryRun: parsed.dryRun,
        now: parsed.now,
        sameBranch: parsed.sameBranch,
        cwd: jobCwd,
      }).job;

      let pushJob = null;
      if (body.push) {
        pushJob = enqueueJob({
          command: ["git", "push"],
          in: parsed.in,
          at: parsed.at,
          cron: parsed.cron,
          when: [...parsed.when, "ahead"],
          dryRun: parsed.dryRun,
          now: parsed.now,
          sameBranch: parsed.sameBranch,
          cwd: jobCwd,
          name: "push",
        }).job;
      }

      if (parsed.now) {
        await executeJob(commitJob);
        if (pushJob) await executeJob(pushJob);
      }

      json(res, 200, { commit: commitJob, push: pushJob });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
      const id = url.pathname.split("/")[3] ?? "";
      const job = getJob(id);
      if (!job) {
        json(res, 404, { error: "unknown job" });
        return;
      }
      job.status = "cancelled";
      upsertJob(job);
      json(res, 200, { job });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/run")) {
      const id = url.pathname.split("/")[3] ?? "";
      const job = getJob(id);
      if (!job) {
        json(res, 404, { error: "unknown job" });
        return;
      }
      json(res, 200, { job: await executeJob(job) });
      return;
    }

    if (req.method === "GET") {
      serveStatic(res, url.pathname);
      return;
    }
    res.writeHead(404).end("not found");
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

interface ScheduleBody {
  cwd?: string;
  message?: string;
  mode?: "now" | "in" | "at" | "cron";
  in?: string;
  at?: string;
  cron?: string;
  when?: string[];
  until?: string;
  push?: boolean;
  sameBranch?: boolean;
  dryRun?: boolean;
  name?: string;
  retry?: string;
}

export function openBrowser(url: string): void {
  const plat = process.platform;
  if (plat === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  else if (plat === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" });
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}
