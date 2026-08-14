import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const tests = fs
  .readdirSync(src)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join(src, name));

if (!tests.length) {
  console.error("no src/*.test.ts files found");
  process.exit(1);
}

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const r = spawnSync(process.execPath, [tsx, "--test", "--test-reporter", "spec", ...tests], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
process.exit(r.status ?? 1);
