import { createSign, randomBytes } from "node:crypto";
import { createMemoryStore, createUpstashStore, sha256 } from "./store.js";
import type { CloudDeps, GithubFetch, WakeScheduler } from "./types.js";

export function createProductionDeps(): CloudDeps {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const store = redisUrl && redisToken ? createUpstashStore(redisUrl, redisToken) : createMemoryStore();

  return {
    store,
    now: () => new Date(),
    newToken: () => `gtm_${randomBytes(24).toString("hex")}`,
    hashToken: (t) => sha256(t),
    githubUser: lookupGithubUser,
    githubFetch: productionGithubFetch,
    wake: qstashWake(),
    fireSecret: process.env.GTIMED_FIRE_SECRET?.trim(),
    githubClientId: process.env.GITHUB_CLIENT_ID?.trim(),
    allowDevLogin: process.env.ALLOW_DEV_LOGIN === "1",
    publicUrl: (process.env.GTIMED_PUBLIC_URL || process.env.VERCEL_URL || "").replace(/\/+$/, ""),
  };
}

async function lookupGithubUser(accessToken: string): Promise<{ login: string } | undefined> {
  if (process.env.ALLOW_DEV_LOGIN === "1") return { login: "dev" };
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gtimed-cloud",
    },
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { login?: string };
  return json.login ? { login: json.login } : undefined;
}

function qstashWake(): WakeScheduler | undefined {
  const token = process.env.QSTASH_TOKEN?.trim();
  const publicUrl = (process.env.GTIMED_PUBLIC_URL || "").replace(/\/+$/, "");
  const fireSecret = process.env.GTIMED_FIRE_SECRET?.trim();
  if (!token || !publicUrl) return undefined;

  return {
    async schedule(opts) {
      const due = Date.parse(opts.dueAt);
      const delaySec = Math.max(0, Math.ceil((due - Date.now()) / 1000));
      const dest = `${publicUrl}/api/internal/fire`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Upstash-Delay": `${Math.min(delaySec, 7 * 24 * 3600)}s`,
      };
      if (fireSecret) headers["Upstash-Forward-Authorization"] = `Bearer ${fireSecret}`;
      const res = await fetch(`https://qstash.upstash.io/v2/publish/${dest}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: opts.userId, jobId: opts.jobId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`QStash publish failed: ${text || res.status}`);
      }
    },
  };
}

async function appInstallationToken(): Promise<string | undefined> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const pem = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  if (!appId || !pem || !installationId) return process.env.GITHUB_TOKEN?.trim();

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId })).toString("base64url");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${sign.sign(pem, "base64url")}`;
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gtimed-cloud",
    },
  });
  if (!res.ok) return process.env.GITHUB_TOKEN?.trim();
  const json = (await res.json()) as { token?: string };
  return json.token || process.env.GITHUB_TOKEN?.trim();
}

const productionGithubFetch: GithubFetch = async (path, init) => {
  const token = init?.token || (await appInstallationToken());
  if (!token) return { status: 401, json: { message: "no GitHub token configured" } };
  const res = await fetch(`https://api.github.com${path.startsWith("/") ? path : `/${path}`}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gtimed-cloud",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { status: res.status, json };
};
