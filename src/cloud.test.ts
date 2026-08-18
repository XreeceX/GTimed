import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  classifyJobKind,
  githubActionFor,
  parseGithubRemote,
  whenForcesLocal,
} from "./cloud.js";
import { git, gitRepo, isolatedHome, runCli, runCliAsync } from "./test-util.js";

type FakeJob = {
  id: string;
  createdAt: string;
  command: string[];
  cwd: string;
  when: string[];
  status: string;
  kind: string;
  machineId?: string;
  at?: string;
  cron?: string;
  until?: string;
  logFile?: string;
  lastError?: string;
  [key: string]: unknown;
};

type FakeState = {
  sessions: Map<string, { userId: string; githubUser: string }>;
  jobs: Map<string, FakeJob[]>;
  fireCalls: string[];
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sameCwd(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

function commandsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((x, i) => x === right[i]);
}

function matchJob(jobs: FakeJob[], id: string): FakeJob | undefined {
  const prefix = id.toLowerCase();
  const matches = jobs.filter((j) => j.id === id || j.id.toLowerCase().startsWith(prefix));
  return matches.length === 1 ? matches[0] : matches.find((j) => j.id === id);
}

function dueAt(job: FakeJob, now: Date): boolean {
  if (job.cron) return true;
  if (job.at) return now.getTime() >= Date.parse(job.at);
  return true;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const v = JSON.parse(raw) as unknown;
        resolve(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function bearer(req: http.IncomingMessage): string | undefined {
  const auth = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1]?.trim() || undefined;
}

/** Protocol fake of the hosted API. No GTimed-cloud imports. */
function createFakeApi(): { state: FakeState; handle: http.RequestListener } {
  const state: FakeState = {
    sessions: new Map(),
    jobs: new Map(),
    fireCalls: [],
  };

  const handle: http.RequestListener = (req, res) => {
    void (async () => {
      try {
        const host = String(req.headers.host ?? "127.0.0.1");
        const url = new URL(req.url ?? "/", `http://${host}`);
        const method = (req.method ?? "GET").toUpperCase();
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        const body = await readBody(req);

        if (method === "GET" && pathname === "/api/auth/config") {
          json(res, 200, {});
          return;
        }

        if (method === "POST" && pathname === "/api/auth/login") {
          const access =
            (typeof body.githubAccessToken === "string" && body.githubAccessToken) ||
            (typeof body.token === "string" && body.token) ||
            "";
          if (!access) {
            json(res, 400, { error: "missing githubAccessToken" });
            return;
          }
          const token = `gtm_${state.sessions.size + 1}_session`;
          state.sessions.set(token, { userId: "tester", githubUser: "tester" });
          json(res, 200, { token, githubUser: "tester" });
          return;
        }

        const session = state.sessions.get(bearer(req) ?? "");
        if (!session) {
          json(res, 401, { error: "unauthorized" });
          return;
        }

        const jobs = state.jobs.get(session.userId) ?? [];
        const save = () => state.jobs.set(session.userId, jobs);
        const machine = String(req.headers["x-gtimed-machine"] ?? "");

        if (method === "GET" && pathname === "/api/jobs") {
          let out = jobs.slice();
          const kind = url.searchParams.get("kind");
          const status = url.searchParams.get("status");
          const machineQ = url.searchParams.get("machine") ?? machine;
          if (kind) out = out.filter((j) => (j.kind ?? "local") === kind);
          if (status) out = out.filter((j) => j.status === status);
          if (machineQ && kind === "local") out = out.filter((j) => j.machineId === machineQ);
          json(res, 200, { jobs: out });
          return;
        }

        if (method === "POST" && pathname === "/api/jobs") {
          const job = { ...(body.job as FakeJob) };
          if (!job?.id || !Array.isArray(job.command)) {
            json(res, 400, { error: "invalid job" });
            return;
          }
          if (machine && !job.machineId) job.machineId = machine;
          if (!job.kind) job.kind = job.github ? "github" : "local";
          job.status = job.status || "pending";
          job.createdAt = job.createdAt || new Date().toISOString();
          const existing = jobs.find(
            (j) => j.status === "pending" && commandsEqual(j.command, job.command) && sameCwd(j.cwd, job.cwd),
          );
          let replaced = false;
          if (existing) {
            job.id = existing.id;
            replaced = true;
          }
          const idx = jobs.findIndex((j) => j.id === job.id);
          if (idx >= 0) jobs[idx] = job;
          else jobs.push(job);
          save();
          json(res, 200, { job, replaced });
          return;
        }

        if (method === "POST" && pathname === "/api/jobs/cancel") {
          const which = String(body.which ?? "");
          const pending = jobs.filter((j) => j.status === "pending");
          let targets: FakeJob[] = [];
          if (which === "all") targets = pending;
          else if (which === "last") {
            let last: FakeJob | undefined;
            for (const j of pending) {
              if (!last || j.createdAt.localeCompare(last.createdAt) > 0) last = j;
            }
            if (last) targets = [last];
          } else {
            const hit = matchJob(pending, which);
            if (hit) targets = [hit];
          }
          for (const job of targets) job.status = "cancelled";
          save();
          json(res, 200, { jobs: targets });
          return;
        }

        if (method === "POST" && pathname === "/api/jobs/claim") {
          const id = String(body.id ?? "");
          const job = matchJob(jobs, id);
          if (!job) {
            json(res, 404, { error: "unknown job" });
            return;
          }
          if (job.kind === "github") {
            json(res, 409, { error: "github jobs are not claimed locally" });
            return;
          }
          if (job.status !== "pending") {
            json(res, 409, { error: "job is not pending" });
            return;
          }
          if (job.machineId && machine && job.machineId !== machine) {
            json(res, 409, { error: "job belongs to another machine" });
            return;
          }
          if (!dueAt(job, new Date())) {
            json(res, 409, { error: "job is not due" });
            return;
          }
          job.status = "running";
          save();
          json(res, 200, { job });
          return;
        }

        const jobFire = /^\/api\/jobs\/([^/]+)\/fire$/.exec(pathname);
        if (method === "POST" && jobFire?.[1]) {
          const job = matchJob(jobs, decodeURIComponent(jobFire[1]));
          if (!job) {
            json(res, 404, { error: "unknown job" });
            return;
          }
          state.fireCalls.push(job.id);
          job.status = "done";
          save();
          json(res, 200, { job });
          return;
        }

        const jobResult = /^\/api\/jobs\/([^/]+)\/result$/.exec(pathname);
        if (method === "POST" && jobResult?.[1]) {
          const id = decodeURIComponent(jobResult[1]);
          const idx = jobs.findIndex((j) => j.id === id || j.id.startsWith(id));
          if (idx < 0) {
            json(res, 404, { error: "unknown job" });
            return;
          }
          const prev = jobs[idx]!;
          const patch = (body.job ?? body) as FakeJob;
          jobs[idx] = { ...prev, ...patch, id: prev.id, kind: prev.kind, machineId: prev.machineId };
          save();
          json(res, 200, { job: jobs[idx] });
          return;
        }

        const jobGet = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
        if (method === "GET" && jobGet?.[1]) {
          const job = matchJob(jobs, decodeURIComponent(jobGet[1]));
          if (!job) {
            json(res, 404, { error: "unknown job" });
            return;
          }
          json(res, 200, { job });
          return;
        }

        json(res, 404, { error: "not found" });
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  };

  return { state, handle };
}

async function listen() {
  const { state, handle } = createFakeApi();
  const server = http.createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const url = `http://127.0.0.1:${addr.port}`;
  const probe = await fetch(`${url}/api/auth/config`);
  assert.equal(probe.ok, true, await probe.text());
  return { server, state, url };
}

async function loginHome(url: string, token = "ghp_secret_test_token") {
  const home = isolatedHome();
  const env = { GTIMED_CLOUD_URL: url };
  const set = await runCliAsync(home, ["cloud", "set", url], process.cwd(), env);
  assert.equal(set.status, 0, set.stderr + set.stdout);
  const login = await runCliAsync(home, ["cloud", "login", "--token", token, "--url", url], process.cwd(), env);
  assert.equal(login.status, 0, `${login.status}\n${login.stderr}\n${login.stdout}`);
  assert.match(login.stdout, /logged in as tester/);
  assert.doesNotMatch(login.stdout, /ghp_secret_test_token/);
  const on = await runCliAsync(home, ["cloud", "on"], process.cwd(), env);
  assert.equal(on.status, 0, on.stderr);
  return home;
}

test("classifyJobKind treats push and gh pr as github unless when/cron force local", () => {
  assert.equal(classifyJobKind(["git", "push"], []), "github");
  assert.equal(classifyJobKind(["git", "push", "origin", "main"], []), "github");
  assert.equal(classifyJobKind(["gh", "pr", "create", "--fill"], []), "github");
  assert.equal(classifyJobKind(["git", "push"], [], "0 * * * *"), "local");
  assert.equal(classifyJobKind(["git", "push"], ["clean"]), "local");
  assert.equal(classifyJobKind(["git", "commit", "-m", "x"], []), "local");
  assert.equal(classifyJobKind(["npm", "test"], []), "local");
  assert.equal(classifyJobKind(["git", "push"], ["ahead"]), "github");
  assert.equal(classifyJobKind(["git", "push"], ["remote-ok"]), "github");
});

test("whenForcesLocal covers disk conditions only", () => {
  assert.equal(whenForcesLocal(["clean"]), true);
  assert.equal(whenForcesLocal(["file=a.ts"]), true);
  assert.equal(whenForcesLocal(["ahead", "ro"]), false);
});

test("parseGithubRemote accepts ssh and https", () => {
  assert.deepEqual(parseGithubRemote("https://github.com/acme/demo.git"), { owner: "acme", repo: "demo" });
  assert.deepEqual(parseGithubRemote("git@github.com:acme/demo.git"), { owner: "acme", repo: "demo" });
  assert.equal(parseGithubRemote("https://gitlab.com/acme/demo.git"), undefined);
});

test("githubActionFor maps push, tag, and pr", () => {
  assert.equal(githubActionFor(["git", "push"])?.action, "push");
  assert.equal(githubActionFor(["git", "push", "origin", "--tags"])?.action, "tag");
  assert.equal(githubActionFor(["git", "push", "origin", "tag", "v1"])?.tagName, "v1");
  assert.equal(githubActionFor(["gh", "pr", "create", "--title", "hi"])?.action, "pr");
  assert.equal(githubActionFor(["git", "commit", "-m", "x"]), undefined);
});

test("cloud off never writes cloud.json or calls the network", () => {
  const home = isolatedHome();
  const r = runCli(home, ["push", "--in", "20m"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(home, "cloud.json")), false);
  assert.equal(fs.existsSync(path.join(home, "jobs.json")), true);
});

test("gtimed cloud with no login explains how to log in", () => {
  const home = isolatedHome();
  const r = runCli(home, ["cloud"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cloud is off/);
  assert.match(r.stdout, /cloud login --token/);
  assert.doesNotMatch(r.stdout, /gtm_[0-9a-f]/);
});

test("cloud login --token stores 600 cloud.json and hides the pat", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    const cfgPath = path.join(home, "cloud.json");
    const raw = fs.readFileSync(cfgPath, "utf8");
    assert.doesNotMatch(raw, /ghp_secret_test_token/);
    const st = fs.statSync(cfgPath);
    if (process.platform !== "win32") {
      assert.equal(st.mode & 0o777, 0o600);
    }
    const status = runCli(home, ["cloud"]);
    assert.match(status.stdout, /cloud is on/);
    assert.match(status.stdout, /tester/);
    assert.doesNotMatch(status.stdout, /gtm_/);
  } finally {
    server.close();
  }
});

test("cloud on posts commit and push and does not write jobs.json", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    const repo = gitRepo();
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "t"]);
    git(repo, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

    const commit = await runCliAsync(home, ["commit", "--in", "20m", "-m", "x"], repo, {
      GTIMED_CLOUD_URL: url,
      GTIMED_CLOUD_SKIP_UPLOAD: "1",
    });
    assert.equal(commit.status, 0, commit.stderr + commit.stdout);
    assert.match(commit.stdout, /scheduled [0-9a-f]{8}/);
    assert.match(commit.stdout, /stored; this machine runs it/);

    const push = await runCliAsync(home, ["push", "--in", "20m"], repo, {
      GTIMED_CLOUD_URL: url,
      GTIMED_CLOUD_SKIP_UPLOAD: "1",
    });
    assert.equal(push.status, 0, push.stderr + push.stdout);
    assert.match(push.stdout, /github \(can fire while this PC sleeps\)/);

    assert.equal(fs.existsSync(path.join(home, "jobs.json")), false);
    const list = await runCliAsync(home, ["list"], repo, { GTIMED_CLOUD_URL: url });
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /git commit/);
    assert.match(list.stdout, /git push/);
    assert.doesNotMatch(list.stdout, /ghp_secret/);
  } finally {
    server.close();
  }
});

test("local tick claims due local jobs and never executes github-kind", async () => {
  const { server, url, state } = await listen();
  try {
    const home = await loginHome(url);
    const repo = gitRepo();
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "t"]);
    git(repo, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

    const commit = await runCliAsync(home, ["status", "--at", "2020-01-01T00:00:00Z", "--dry"], repo, {
      GTIMED_CLOUD_URL: url,
    });
    assert.equal(commit.status, 0, commit.stderr + commit.stdout);
    await runCliAsync(home, ["push", "--in", "20m"], repo, { GTIMED_CLOUD_URL: url, GTIMED_CLOUD_SKIP_UPLOAD: "1" });

    const tick = await runCliAsync(home, ["tick"], repo, { GTIMED_CLOUD_URL: url });
    assert.equal(tick.status, 0, tick.stderr + tick.stdout);
    assert.match(tick.stdout, /ran 1 job/);
    assert.match(tick.stdout, /still waiting:/);
    assert.match(tick.stdout, /git push/);
    assert.equal(state.fireCalls.length, 0);
  } finally {
    server.close();
  }
});

test("offline with cloud on does not fall back to jobs.json", async () => {
  const home = isolatedHome();
  fs.writeFileSync(
    path.join(home, "cloud.json"),
    JSON.stringify({
      url: "http://127.0.0.1:1",
      token: "gtm_deadbeef",
      machineId: "m1",
      enabled: true,
      githubUser: "tester",
    }),
    "utf8",
  );
  const r = runCli(home, ["commit", "--in", "20m", "-m", "x"], process.cwd(), {
    GTIMED_CLOUD_TIMEOUT_MS: "1500",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cloud unreachable|network/i);
  assert.equal(fs.existsSync(path.join(home, "jobs.json")), false);
});

test("cancel and abort hit the API", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    await runCliAsync(home, ["status", "--in", "20m", "--dry"], process.cwd(), { GTIMED_CLOUD_URL: url });
    const abort = await runCliAsync(home, ["abort"], process.cwd(), { GTIMED_CLOUD_URL: url });
    assert.equal(abort.status, 0, abort.stderr);
    assert.match(abort.stdout, /aborted 1 pending job/);
    const list = await runCliAsync(home, ["list"], process.cwd(), { GTIMED_CLOUD_URL: url });
    assert.match(list.stdout, /cancelled/);
  } finally {
    server.close();
  }
});

test("cloud off after login schedules locally again", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    const off = await runCliAsync(home, ["cloud", "off"], process.cwd(), { GTIMED_CLOUD_URL: url });
    assert.equal(off.status, 0, off.stderr);
    const r = runCli(home, ["push", "--in", "20m"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(home, "jobs.json")), true);
  } finally {
    server.close();
  }
});

test("help and nextHint never print the cloud token", () => {
  const home = isolatedHome();
  const help = runCli(home, ["--help"]);
  assert.match(help.stdout, /cloud/);
  assert.doesNotMatch(help.stdout, /gtm_[0-9a-f]{8}/);
  const topic = runCli(home, ["cloud", "--help"]);
  assert.equal(topic.status, 0, topic.stderr);
  assert.match(topic.stdout, /Usage: gtimed cloud/);
  assert.doesNotMatch(topic.stdout, /ghp_/);
});

test("cloud logout drops the token file", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    assert.equal(fs.existsSync(path.join(home, "cloud.json")), true);
    const out = await runCliAsync(home, ["cloud", "logout"], process.cwd(), { GTIMED_CLOUD_URL: url });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(fs.existsSync(path.join(home, "cloud.json")), false);
    const status = runCli(home, ["cloud"]);
    assert.match(status.stdout, /not logged in/);
  } finally {
    server.close();
  }
});

test("cloud login without a token prints usage", async () => {
  const { server, url } = await listen();
  try {
    const home = isolatedHome();
    const r = await runCliAsync(home, ["cloud", "login", "--url", url], process.cwd(), {
      GTIMED_CLOUD_URL: url,
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /cloud login --token/);
    assert.doesNotMatch(r.stderr, /gtm_/);
  } finally {
    server.close();
  }
});

test("non-GitHub origin is stored as a local cloud job", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    const repo = gitRepo();
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "t"]);
    git(repo, ["remote", "add", "origin", "https://gitlab.com/acme/demo.git"]);
    const r = await runCliAsync(home, ["push", "--in", "20m"], repo, {
      GTIMED_CLOUD_URL: url,
      GTIMED_CLOUD_SKIP_UPLOAD: "1",
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /stored; this machine runs it/);
    assert.match(r.stdout, /not GitHub/);
    assert.equal(fs.existsSync(path.join(home, "jobs.json")), false);
  } finally {
    server.close();
  }
});

test("cloud logs for a pending job say it has not run", async () => {
  const { server, url } = await listen();
  try {
    const home = await loginHome(url);
    const scheduled = await runCliAsync(home, ["status", "--in", "20m", "--dry"], process.cwd(), {
      GTIMED_CLOUD_URL: url,
    });
    assert.equal(scheduled.status, 0, scheduled.stderr);
    const id = /scheduled ([0-9a-f]{8})/.exec(scheduled.stdout)?.[1];
    assert.ok(id);
    const logs = await runCliAsync(home, ["logs", id], process.cwd(), { GTIMED_CLOUD_URL: url });
    assert.equal(logs.status, 0, logs.stderr);
    assert.match(logs.stdout, new RegExp(`^${id} `, "m"));
    assert.match(logs.stdout, /scheduled|has not run yet/);
    assert.doesNotMatch(logs.stdout, /gtm_/);
  } finally {
    server.close();
  }
});
