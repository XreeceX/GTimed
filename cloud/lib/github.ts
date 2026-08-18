import type { CloudJob, GithubFetch } from "./types.js";

function refName(ref: string): string {
  return ref.replace(/^refs\//, "");
}

export async function fireGithubJob(job: CloudJob, githubFetch: GithubFetch, token?: string): Promise<CloudJob> {
  const gh = job.github;
  if (!gh) {
    job.status = "failed";
    job.lastError = "missing github target";
    return job;
  }
  if (job.dryRun) {
    job.status = job.cron ? "pending" : "done";
    job.lastRunAt = new Date().toISOString();
    job.logText = `${job.logText ?? ""}dry-run: would ${gh.action} ${gh.owner}/${gh.repo}@${gh.sha}\n`;
    return job;
  }

  const when = (job.when ?? []).map((s) => s.trim().toLowerCase());
  if (when.includes("remote-ok") || when.includes("ro")) {
    const probe = await githubFetch(`/repos/${gh.owner}/${gh.repo}`, { token });
    if (probe.status >= 400) {
      job.status = "pending";
      job.lastError = "origin not reachable";
      return job;
    }
  }
  if (when.includes("ahead") && gh.branch) {
    const cmp = await githubFetch(
      `/repos/${gh.owner}/${gh.repo}/compare/${encodeURIComponent(gh.branch)}...${encodeURIComponent(gh.sha)}`,
      { token },
    );
    const ahead = (cmp.json as { ahead_by?: number } | undefined)?.ahead_by ?? 0;
    if (cmp.status >= 400 || ahead <= 0) {
      job.status = "pending";
      job.lastError = ahead <= 0 ? "not ahead of upstream" : "could not check ahead";
      return job;
    }
  }

  if (gh.action === "push") {
    await fastForward(gh.owner, gh.repo, gh.branch || "main", gh.sha, githubFetch, token);
  } else if (gh.action === "pr") {
    await openPr(job, githubFetch, token);
  } else if (gh.action === "tag") {
    await createTag(job, githubFetch, token);
  } else {
    job.status = "failed";
    job.lastError = `unknown github action`;
    return job;
  }

  if (gh.holdingRef) {
    await githubFetch(`/repos/${gh.owner}/${gh.repo}/git/refs/${refName(gh.holdingRef)}`, {
      method: "DELETE",
      token,
    });
  }

  job.status = "done";
  job.exitCode = 0;
  job.lastError = undefined;
  job.lastRunAt = new Date().toISOString();
  job.attempts = (job.attempts ?? 0) + 1;
  job.logText = `${job.logText ?? ""}github ${gh.action} ${gh.owner}/${gh.repo}@${gh.sha}\n`;
  return job;
}

async function fastForward(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  githubFetch: GithubFetch,
  token?: string,
): Promise<void> {
  const path = `/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  const existing = await githubFetch(path, { token });
  if (existing.status === 404) {
    const created = await githubFetch(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      token,
      body: { ref: `refs/heads/${branch}`, sha },
    });
    if (created.status >= 300) throw new Error(`could not create branch ${branch}`);
    return;
  }
  const patched = await githubFetch(path, {
    method: "PATCH",
    token,
    body: { sha, force: false },
  });
  if (patched.status >= 300) throw new Error(`could not fast-forward ${branch} to ${sha}`);
}

async function openPr(job: CloudJob, githubFetch: GithubFetch, token?: string): Promise<void> {
  const gh = job.github!;
  const head = gh.holdingRef ? gh.holdingRef.replace(/^refs\//, "") : gh.branch;
  const title = gh.prTitle?.trim() || job.name || `gtimed ${job.id}`;
  const created = await githubFetch(`/repos/${gh.owner}/${gh.repo}/pulls`, {
    method: "POST",
    token,
    body: {
      title,
      head: head?.replace(/^heads\//, "") || gh.sha,
      base: gh.prBase || "main",
      body: gh.prBody ?? "",
    },
  });
  if (created.status >= 300) throw new Error("could not open pull request");
}

async function createTag(job: CloudJob, githubFetch: GithubFetch, token?: string): Promise<void> {
  const gh = job.github!;
  const name = gh.tagName || gh.branch;
  if (!name) throw new Error("missing tag name");
  const created = await githubFetch(`/repos/${gh.owner}/${gh.repo}/git/refs`, {
    method: "POST",
    token,
    body: { ref: `refs/tags/${name}`, sha: gh.sha },
  });
  if (created.status >= 300) throw new Error(`could not create tag ${name}`);
}
