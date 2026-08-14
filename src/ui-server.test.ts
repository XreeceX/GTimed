import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveUiFile, startUi, uiRoot } from "./ui-server.js";

test("resolveUiFile blocks path traversal and sibling ui-* prefixes", () => {
  const root = path.resolve("/tmp/gtimed-ui");
  assert.equal(resolveUiFile(root, "/"), path.resolve(root, "index.html"));
  assert.equal(resolveUiFile(root, "/app.js"), path.resolve(root, "app.js"));
  assert.equal(resolveUiFile(root, "/../package.json"), null);
  assert.equal(resolveUiFile(root, "/..%2Fpackage.json".replace("%2F", "/")), null);
  assert.equal(resolveUiFile(root, "/../ui-secret/x"), null);
  assert.equal(resolveUiFile(root, "/..\\package.json"), null);
});

test("startUi binds 127.0.0.1 and serves /api/repo", async () => {
  const server = await startUi({ cwd: process.cwd(), port: 0, host: "127.0.0.1" });
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    assert.equal(addr.address, "127.0.0.1");
    assert.ok(addr.port > 0);
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/repo`);
    assert.equal(res.ok, true);
    const body = (await res.json()) as { cwd?: string; error?: string; files?: unknown[] };
    assert.equal(typeof body.cwd, "string");
    const html = await fetch(`http://127.0.0.1:${addr.port}/`);
    assert.equal(html.ok, true);
    const missing = await fetch(`http://127.0.0.1:${addr.port}/no-such-file.js`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("uiRoot finds index.html", () => {
  assert.ok(uiRoot().endsWith("ui") || uiRoot().replaceAll("\\", "/").endsWith("/ui"));
});

test("GET /api/jobs returns the queue", async () => {
  const server = await startUi({ cwd: process.cwd(), port: 0, host: "127.0.0.1" });
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/jobs`);
    assert.equal(res.ok, true);
    const body = (await res.json()) as { jobs?: unknown[] };
    assert.ok(Array.isArray(body.jobs));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("HTTP path traversal is forbidden", async () => {
  const server = await startUi({ cwd: process.cwd(), port: 0, host: "127.0.0.1" });
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const res = await fetch(`http://127.0.0.1:${addr.port}/../package.json`);
    assert.ok(res.status === 403 || res.status === 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /api/schedule overwrites the same commit message", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-home-"));
  process.env.GTIMED_HOME = home;
  const server = await startUi({ cwd: process.cwd(), port: 0, host: "127.0.0.1" });
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const body = {
      message: "same msg",
      mode: "in",
      in: "20m",
      when: [],
    };
    const first = await fetch(`http://127.0.0.1:${addr.port}/api/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(first.ok, true);
    const a = (await first.json()) as { commit: { id: string } };
    const second = await fetch(`http://127.0.0.1:${addr.port}/api/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, in: "5m" }),
    });
    const b = (await second.json()) as { commit: { id: string } };
    assert.equal(b.commit.id, a.commit.id);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
