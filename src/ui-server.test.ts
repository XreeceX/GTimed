import assert from "node:assert/strict";
import test from "node:test";
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
