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
  extractTarGz,
  formatPlan,
  githubArchiveUrl,
  install,
  installHelp,
  parseInstallArgs,
  parseNodeMajor,
  tarArchiveArg,
  tarBin,
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
  assert.match(readme, /not Git Bash/);
});

test("install.mjs extracts with cwd dest, not tar -C on a drive path", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "install.mjs"), "utf8");
  assert.match(src, /cwd: path\.resolve\(dest\)/);
  assert.doesNotMatch(src, /\["-xzf", archive, "-C"/);
});

test("tarArchiveArg is relative and has no drive letter", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-tararg-"));
  const archive = path.join(tmp, "a.tar.gz");
  fs.writeFileSync(archive, "x");
  const dest = path.join(tmp, "unpack");
  fs.mkdirSync(dest);
  const arg = tarArchiveArg(archive, dest);
  assert.equal(arg.includes(":"), false);
  assert.doesNotMatch(arg, /^[A-Za-z]:/);
  assert.equal(path.isAbsolute(arg), false);
});

function packSampleArchive(tmp: string): string {
  const folder = path.join(tmp, "GTimed-master");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  fs.writeFileSync(path.join(folder, "package.json"), '{"name":"gtimed"}\n');
  fs.writeFileSync(path.join(folder, "src", "index.js"), "ok\n");
  const pack = spawnSync(tarBin(), ["-czf", "gtimed.tar.gz", "GTimed-master"], {
    cwd: tmp,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const archive = path.join(tmp, "gtimed.tar.gz");
  assert.equal(fs.existsSync(archive), true);
  assert.ok(fs.statSync(archive).size > 50);
  return archive;
}

test("extractTarGz unpacks a gzip tarball without a C: host error", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-tar-"));
  const archive = packSampleArchive(tmp);
  const dest = path.join(tmp, "unpack");
  const out = extractTarGz(archive, dest);
  assert.equal(path.basename(out), "GTimed-master");
  assert.match(fs.readFileSync(path.join(out, "package.json"), "utf8"), /gtimed/);
  assert.equal(fs.readFileSync(path.join(out, "src", "index.js"), "utf8"), "ok\n");
});

test("extractTarGz accepts an absolute Windows-style archive path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-tarabs-"));
  const archive = packSampleArchive(tmp);
  const dest = path.join(tmp, "unpack");
  const out = extractTarGz(path.resolve(archive), path.resolve(dest));
  assert.equal(fs.existsSync(path.join(out, "package.json")), true);
});

test("extractTarGz fails on a missing archive", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-tarmiss-"));
  assert.throws(() => extractTarGz(path.join(tmp, "nope.tar.gz"), path.join(tmp, "out")));
});

test("PATH tar with -C drive letter is the Windows one-line install bug", () => {
  if (process.platform !== "win32") return;
  const ver = spawnSync("tar", ["--version"], { encoding: "utf8", windowsHide: true });
  if (!`${ver.stdout}${ver.stderr}`.includes("GNU tar")) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-targnu-"));
  const archive = packSampleArchive(tmp);
  const dest = path.join(tmp, "unpack");
  fs.mkdirSync(dest);
  const r = spawnSync("tar", ["-xzf", archive, "-C", dest], { encoding: "utf8", windowsHide: true });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stderr}${r.stdout}`, /Cannot connect to C:/);
  const out = extractTarGz(archive, dest);
  assert.equal(fs.existsSync(path.join(out, "package.json")), true);
});

test("tarBin prefers Windows System32 tar on this OS", () => {
  const bin = tarBin();
  if (process.platform === "win32") {
    assert.match(bin.replaceAll("/", "\\"), /\\tar\.exe$/i);
    assert.equal(fs.existsSync(bin), true);
  } else {
    assert.equal(bin, "tar");
  }
});
