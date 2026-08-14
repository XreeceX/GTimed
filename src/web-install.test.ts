import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REF,
  DEFAULT_REPO,
  MIN_NODE_MAJOR,
  assertNodeVersion,
  bootstrapUrl,
  buildPlan,
  formatPlan,
  githubArchiveUrl,
  install,
  installHelp,
  parseInstallArgs,
  parseNodeMajor,
} from "../scripts/install.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("githubArchiveUrl points at the GitHub tarball, not a git clone", () => {
  assert.equal(
    githubArchiveUrl(),
    `https://github.com/${DEFAULT_REPO}/archive/refs/heads/${DEFAULT_REF}.tar.gz`,
  );
  assert.equal(
    githubArchiveUrl("acme/gtimed", "one-line-install"),
    "https://github.com/acme/gtimed/archive/refs/heads/one-line-install.tar.gz",
  );
});

test("bootstrapUrl is a raw GitHub file people can curl", () => {
  assert.equal(
    bootstrapUrl(),
    `https://raw.githubusercontent.com/${DEFAULT_REPO}/${DEFAULT_REF}/scripts/install.mjs`,
  );
  assert.match(bootstrapUrl(DEFAULT_REPO, DEFAULT_REF, "install.sh"), /\/scripts\/install\.sh$/);
  assert.match(bootstrapUrl(DEFAULT_REPO, DEFAULT_REF, "install.ps1"), /\/scripts\/install\.ps1$/);
});

test("parseNodeMajor reads v18.20.0", () => {
  assert.equal(parseNodeMajor("v18.20.0"), 18);
  assert.equal(parseNodeMajor("22.11.0"), 22);
});

test("assertNodeVersion rejects Node 16", () => {
  assert.throws(() => assertNodeVersion("v16.20.0"), /Node.js 18/);
  assert.doesNotThrow(() => assertNodeVersion("v18.0.0"));
});

test("parseInstallArgs reads flags", () => {
  const p = parseInstallArgs(["--from", ".", "--skip-global", "--dry-run", "--ref", "one-line-install"]);
  assert.equal(p.from, ".");
  assert.equal(p.skipGlobal, true);
  assert.equal(p.dryRun, true);
  assert.equal(p.ref, "one-line-install");
  assert.equal(p.repo, DEFAULT_REPO);
});

test("parseInstallArgs unknown flag explains --help", () => {
  assert.throws(() => parseInstallArgs(["--nope"]), /unknown installer flag "--nope"/);
});

test("buildPlan skip-global only installs and builds", () => {
  const plan = buildPlan({ repo: DEFAULT_REPO, ref: DEFAULT_REF, dryRun: true, skipGlobal: true }, "/tmp/src");
  assert.deepEqual(plan.commands, [
    ["npm", "install"],
    ["npm", "run", "build"],
  ]);
  assert.match(plan.archiveUrl, /archive\/refs\/heads\/master\.tar\.gz$/);
});

test("buildPlan default includes global install and gtimed install", () => {
  const src = path.join(os.tmpdir(), "gtimed-src");
  const plan = buildPlan({ repo: DEFAULT_REPO, ref: "master", dryRun: true, skipGlobal: false }, src);
  assert.equal(plan.commands[2]?.[0], "npm");
  assert.deepEqual(plan.commands[2]?.slice(1), ["install", "-g", "."]);
  assert.equal(plan.commands[3]?.[1], path.join(src, "dist", "index.js"));
  assert.equal(plan.commands[3]?.[2], "install");
});

test("dry-run --from this repo does not spawn npm install -g", async () => {
  const plan = await install({
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    from: root,
    dryRun: true,
    skipGlobal: false,
  });
  assert.equal(plan.source, root);
  const text = formatPlan(plan);
  assert.match(text, /npm install -g \./);
  assert.match(text, /npm run build/);
});

test("install --from missing package.json fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-empty-"));
  await assert.rejects(
    install({ repo: DEFAULT_REPO, ref: DEFAULT_REF, from: dir, dryRun: false, skipGlobal: true }),
    /not a GTimed checkout/,
  );
});

test("install --help prints the copy-paste one-liners", () => {
  const text = installHelp();
  assert.match(text, /irm https:\/\/raw\.githubusercontent\.com\/XreeceX\/GTimed\/master\/scripts\/install\.ps1 \| iex/);
  assert.match(text, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/XreeceX\/GTimed\/master\/scripts\/install\.sh \| sh/);
});

test("install.sh is a curl | sh bootstrap that does not git clone", () => {
  const sh = fs.readFileSync(path.join(root, "scripts", "install.sh"), "utf8");
  assert.match(sh, /curl -fsSL/);
  assert.match(sh, /scripts\/install\.mjs/);
  assert.match(sh, /exec node/);
  assert.doesNotMatch(sh, /git clone/);
  assert.match(sh, /nodejs\.org/);
});

test("install.ps1 is an irm | iex bootstrap that does not git clone", () => {
  const ps = fs.readFileSync(path.join(root, "scripts", "install.ps1"), "utf8");
  assert.match(ps, /Invoke-WebRequest/);
  assert.match(ps, /scripts\/install\.mjs/);
  assert.match(ps, /& node/);
  assert.doesNotMatch(ps, /git clone/);
  assert.match(ps, /nodejs\.org/);
});

test("node scripts/install.mjs --help exits 0", () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "--help"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /curl -fsSL/);
  assert.match(r.stdout, /install\.ps1 \| iex/);
});

test("node scripts/install.mjs --dry-run --from . --skip-global prints local steps", () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "install.mjs"), "--dry-run", "--from", root, "--skip-global"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /npm install/);
  assert.match(r.stdout, /npm run build/);
  assert.doesNotMatch(r.stdout, /npm install -g/);
});

test("README shows the copy-paste install lines", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /irm https:\/\/raw\.githubusercontent\.com\/XreeceX\/GTimed\/master\/scripts\/install\.ps1 \| iex/);
  assert.match(readme, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/XreeceX\/GTimed\/master\/scripts\/install\.sh \| sh/);
});
