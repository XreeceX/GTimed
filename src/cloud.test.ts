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
import { fireGithubJob } from "../cloud/lib/github.js";
import { createTestDeps, handleRequest, type TestDeps } from "../cloud/lib/app.js";
import type { CloudJob } from "../cloud/lib/types.js";
import { git, gitRepo, isolatedHome, runCli, runCliAsync } from "./test-util.js";

async function listen(deps: TestDeps = createTestDeps()) {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const host = String(req.headers.host ?? "127.0.0.1");
        const url = new URL(req.url ?? "/", `http://${host}`);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const result = await handleRequest(
          {
            method: req.method ?? "GET",
            pathname: url.pathname,
            search: url.search.startsWith("?") ? url.search.slice(1) : url.search,
            headers: req.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          },
          deps,
        );
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const url = `http://127.0.0.1:${addr.port}`;
  const probe = await fetch(`${url}/api/auth/config`);
  assert.equal(probe.ok, true, await probe.text());
  return { server, deps, url };
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
  const { server, url, deps } = await listen();
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
    assert.equal(deps.githubCalls.filter((c) => c.method === "PATCH").length, 0);
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

test("github fire uses the GitHub API mapping, not a shell", async () => {
  const deps = createTestDeps();
  const login = await handleRequest(
    {
      method: "POST",
      pathname: "/api/auth/login",
      headers: {},
      body: JSON.stringify({ githubAccessToken: "pat" }),
    },
    deps,
  );
  const { token } = JSON.parse(login.body) as { token: string };
  const created = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers: { authorization: `Bearer ${token}`, "x-gtimed-machine": "m1" },
      body: JSON.stringify({
        job: {
          id: "abcd1234",
          createdAt: new Date().toISOString(),
          command: ["git", "push"],
          cwd: "/tmp",
          when: [],
          everyMs: 0,
          timeoutMs: 0,
          retry: 0,
          attempts: 0,
          requireSameBranch: false,
          dryRun: false,
          status: "pending",
          logFile: "abcd1234.log",
          kind: "github",
          at: "2020-01-01T00:00:00.000Z",
          github: {
            owner: "acme",
            repo: "demo",
            sha: "deadbeef",
            action: "push",
            branch: "main",
            holdingRef: "refs/gtimed/abcd1234",
          },
        },
      }),
    },
    deps,
  );
  assert.equal(created.status, 200, created.body);
  const fired = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs/abcd1234/fire",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
    },
    deps,
  );
  assert.equal(fired.status, 200, fired.body);
  const job = (JSON.parse(fired.body) as { job: { status: string; lastError?: string } }).job;
  assert.equal(job.status, "done", job.lastError);
  assert.ok(deps.githubCalls.some((c) => c.method === "PATCH" && c.path.includes("/git/refs/heads/main")));
  assert.ok(!deps.githubCalls.some((c) => String(c.body ?? "").includes("child_process")));
});

test("QStash-style wake is scheduled for github jobs", async () => {
  const wakes: { jobId: string; dueAt: string }[] = [];
  const deps = createTestDeps({
    wake: {
      async schedule(opts) {
        wakes.push({ jobId: opts.jobId, dueAt: opts.dueAt });
      },
    },
  });
  const login = await handleRequest(
    {
      method: "POST",
      pathname: "/api/auth/login",
      headers: {},
      body: JSON.stringify({ githubAccessToken: "pat" }),
    },
    deps,
  );
  const { token } = JSON.parse(login.body) as { token: string };
  const created = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        job: {
          id: "wake0001",
          createdAt: new Date().toISOString(),
          command: ["git", "push"],
          cwd: "/tmp",
          when: [],
          everyMs: 0,
          timeoutMs: 0,
          retry: 0,
          attempts: 0,
          requireSameBranch: false,
          dryRun: false,
          status: "pending",
          logFile: "w.log",
          kind: "github",
          at: "2026-08-18T12:00:00.000Z",
          github: { owner: "acme", repo: "demo", sha: "abc", action: "push", branch: "main" },
        },
      }),
    },
    deps,
  );
  assert.equal(created.status, 200, created.body);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]?.jobId, "wake0001");
});

test("claim refuses github-kind jobs", async () => {
  const deps = createTestDeps();
  const login = await handleRequest(
    {
      method: "POST",
      pathname: "/api/auth/login",
      headers: {},
      body: JSON.stringify({ githubAccessToken: "pat" }),
    },
    deps,
  );
  const { token } = JSON.parse(login.body) as { token: string };
  await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers: { authorization: `Bearer ${token}`, "x-gtimed-machine": "m1" },
      body: JSON.stringify({
        job: {
          id: "gh000001",
          createdAt: new Date().toISOString(),
          command: ["git", "push"],
          cwd: "/tmp",
          when: [],
          everyMs: 0,
          timeoutMs: 0,
          retry: 0,
          attempts: 0,
          requireSameBranch: false,
          dryRun: false,
          status: "pending",
          logFile: "g.log",
          kind: "github",
          machineId: "m1",
          at: "2020-01-01T00:00:00.000Z",
          github: { owner: "acme", repo: "demo", sha: "abc", action: "push", branch: "main" },
        },
      }),
    },
    deps,
  );
  const claimed = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs/claim",
      headers: { authorization: `Bearer ${token}`, "x-gtimed-machine": "m1" },
      body: JSON.stringify({ id: "gh000001" }),
    },
    deps,
  );
  assert.equal(claimed.status, 409);
});

function jobStub(partial: Record<string, unknown> = {}): CloudJob {
  return {
    id: "job00001",
    createdAt: new Date().toISOString(),
    command: ["git", "push"],
    cwd: "/tmp",
    when: [],
    everyMs: 0,
    timeoutMs: 0,
    retry: 0,
    attempts: 0,
    requireSameBranch: false,
    dryRun: false,
    status: "pending",
    logFile: "j.log",
    kind: "github",
    ...partial,
  } as CloudJob;
}

async function apiLogin(deps: TestDeps = createTestDeps()) {
  const login = await handleRequest(
    {
      method: "POST",
      pathname: "/api/auth/login",
      headers: {},
      body: JSON.stringify({ githubAccessToken: "pat" }),
    },
    deps,
  );
  const { token } = JSON.parse(login.body) as { token: string };
  return {
    deps,
    token,
    headers: { authorization: `Bearer ${token}`, "x-gtimed-machine": "m1" } as Record<string, string>,
  };
}

test("fireGithubJob opens a PR through the GitHub API", async () => {
  const deps = createTestDeps();
  const job = await fireGithubJob(
    jobStub({
      command: ["gh", "pr", "create", "--title", "hi"],
      github: {
        owner: "acme",
        repo: "demo",
        sha: "abc",
        action: "pr",
        holdingRef: "refs/gtimed/job00001",
        prTitle: "hi",
        prBase: "main",
      },
    }),
    deps.githubFetch,
  );
  assert.equal(job.status, "done");
  assert.ok(deps.githubCalls.some((c) => c.method === "POST" && c.path.endsWith("/pulls")));
  assert.ok(deps.githubCalls.some((c) => c.method === "DELETE" && c.path.includes("/git/refs/gtimed/")));
});

test("fireGithubJob creates a tag ref", async () => {
  const deps = createTestDeps();
  const job = await fireGithubJob(
    jobStub({
      github: { owner: "acme", repo: "demo", sha: "abc", action: "tag", tagName: "v1.2.3" },
    }),
    deps.githubFetch,
  );
  assert.equal(job.status, "done");
  const create = deps.githubCalls.find((c) => c.method === "POST" && c.path.endsWith("/git/refs"));
  assert.deepEqual(create?.body, { ref: "refs/tags/v1.2.3", sha: "abc" });
});

test("fireGithubJob dry-run does not call GitHub", async () => {
  const deps = createTestDeps();
  const job = await fireGithubJob(
    jobStub({
      dryRun: true,
      github: { owner: "acme", repo: "demo", sha: "abc", action: "push", branch: "main" },
    }),
    deps.githubFetch,
  );
  assert.equal(job.status, "done");
  assert.equal(deps.githubCalls.length, 0);
  assert.match(job.logText ?? "", /dry-run/);
});

test("fireGithubJob fails without a github target", async () => {
  const deps = createTestDeps();
  const job = await fireGithubJob(jobStub({ github: undefined, kind: "github" }), deps.githubFetch);
  assert.equal(job.status, "failed");
  assert.match(job.lastError ?? "", /missing github target/);
});

test("fireGithubJob stays pending when remote-ok fails", async () => {
  const job = await fireGithubJob(
    jobStub({
      when: ["remote-ok"],
      github: { owner: "acme", repo: "demo", sha: "abc", action: "push", branch: "main" },
    }),
    async () => ({ status: 503, json: {} }),
  );
  assert.equal(job.status, "pending");
  assert.match(job.lastError ?? "", /not reachable/);
});

test("API rejects unauthenticated list", async () => {
  const res = await handleRequest(
    { method: "GET", pathname: "/api/jobs", headers: {}, body: "" },
    createTestDeps(),
  );
  assert.equal(res.status, 401);
});

test("API get, duplicate replace, and cancel last", async () => {
  const { deps, headers } = await apiLogin();
  const first = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers,
      body: JSON.stringify({
        job: jobStub({ id: "aaaa1111", command: ["git", "push"], cwd: "/repo", at: "2026-08-18T12:00:00.000Z" }),
      }),
    },
    deps,
  );
  assert.equal(first.status, 200, first.body);
  const second = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers,
      body: JSON.stringify({
        job: jobStub({ id: "bbbb2222", command: ["git", "push"], cwd: "/repo", at: "2026-08-18T13:00:00.000Z" }),
      }),
    },
    deps,
  );
  const body = JSON.parse(second.body) as { replaced: boolean; job: { id: string; at?: string } };
  assert.equal(body.replaced, true);
  assert.equal(body.job.id, "aaaa1111");
  assert.equal(body.job.at, "2026-08-18T13:00:00.000Z");

  const got = await handleRequest(
    { method: "GET", pathname: "/api/jobs/aaaa1111", headers, body: "" },
    deps,
  );
  assert.equal(got.status, 200);

  const cancelled = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs/cancel",
      headers,
      body: JSON.stringify({ which: "last" }),
    },
    deps,
  );
  assert.equal(cancelled.status, 200);
  const jobs = (JSON.parse(cancelled.body) as { jobs: { id: string; status: string }[] }).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.status, "cancelled");
});

test("claim refuses a job owned by another machine", async () => {
  const { deps, token } = await apiLogin();
  await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers: { authorization: `Bearer ${token}`, "x-gtimed-machine": "laptop-a" },
      body: JSON.stringify({
        job: jobStub({
          id: "loc00001",
          kind: "local",
          machineId: "laptop-a",
          command: ["git", "status"],
          at: "2020-01-01T00:00:00.000Z",
        }),
      }),
    },
    deps,
  );
  const claimed = await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs/claim",
      headers: { authorization: `Bearer ${token}`, "x-gtimed-machine": "laptop-b" },
      body: JSON.stringify({ id: "loc00001" }),
    },
    deps,
  );
  assert.equal(claimed.status, 409);
});

test("internal fire accepts the fire secret", async () => {
  const deps = createTestDeps({ fireSecret: "s3cret" });
  const { token } = await apiLogin(deps);
  await handleRequest(
    {
      method: "POST",
      pathname: "/api/jobs",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        job: jobStub({
          id: "fire0001",
          github: { owner: "acme", repo: "demo", sha: "abc", action: "push", branch: "main" },
        }),
      }),
    },
    deps,
  );
  const denied = await handleRequest(
    {
      method: "POST",
      pathname: "/api/internal/fire",
      headers: {},
      body: JSON.stringify({ userId: "tester", jobId: "fire0001" }),
    },
    deps,
  );
  assert.equal(denied.status, 401);
  const ok = await handleRequest(
    {
      method: "POST",
      pathname: "/api/internal/fire",
      headers: { authorization: "Bearer s3cret" },
      body: JSON.stringify({ userId: "tester", jobId: "fire0001" }),
    },
    deps,
  );
  assert.equal(ok.status, 200, ok.body);
  assert.equal((JSON.parse(ok.body) as { job: { status: string } }).job.status, "done");
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
