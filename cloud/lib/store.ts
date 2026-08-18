import { createHash } from "node:crypto";
import type { CloudJob, JobStore, Session } from "./types.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createMemoryStore(): JobStore {
  const sessions = new Map<string, Session>();
  const jobs = new Map<string, CloudJob[]>();
  return {
    async getSession(tokenHash) {
      return sessions.get(tokenHash);
    },
    async putSession(session) {
      sessions.set(session.tokenHash, session);
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async listJobs(userId) {
      return (jobs.get(userId) ?? []).map((j) => ({ ...j }));
    },
    async putJobs(userId, next) {
      jobs.set(
        userId,
        next.map((j) => ({ ...j })),
      );
    },
  };
}

export function createUpstashStore(url: string, token: string): JobStore {
  const base = url.replace(/\/+$/, "");

  async function cmd(args: string[]): Promise<unknown> {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok) throw new Error(json.error || `redis ${res.status}`);
    return json.result;
  }

  return {
    async getSession(tokenHash) {
      const raw = await cmd(["GET", `sess:${tokenHash}`]);
      if (typeof raw !== "string" || !raw) return undefined;
      try {
        return JSON.parse(raw) as Session;
      } catch {
        return undefined;
      }
    },
    async putSession(session) {
      await cmd(["SET", `sess:${session.tokenHash}`, JSON.stringify(session)]);
    },
    async deleteSession(tokenHash) {
      await cmd(["DEL", `sess:${tokenHash}`]);
    },
    async listJobs(userId) {
      const raw = await cmd(["GET", `jobs:${userId}`]);
      if (typeof raw !== "string" || !raw) return [];
      try {
        const parsed = JSON.parse(raw) as CloudJob[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async putJobs(userId, next) {
      await cmd(["SET", `jobs:${userId}`, JSON.stringify(next)]);
    },
  };
}
