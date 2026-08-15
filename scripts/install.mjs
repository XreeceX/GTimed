#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "XreeceX/GTimed";
export const DEFAULT_REF = "master";
export const MIN_NODE_MAJOR = 18;

export function githubArchiveUrl(repo = DEFAULT_REPO, ref = DEFAULT_REF) {
  return `https://github.com/${repo}/archive/refs/heads/${encodeURIComponent(ref)}.tar.gz`;
}

export function bootstrapUrl(repo = DEFAULT_REPO, ref = DEFAULT_REF, file = "install.mjs") {
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/scripts/${file}`;
}

export function parseNodeMajor(version) {
  const match = /^v?(\d+)/.exec(String(version).trim());
  if (!match) throw new Error(`Could not parse Node version "${version}"`);
  return Number(match[1]);
}

export function assertNodeVersion(version = process.versions.node) {
  const major = parseNodeMajor(version);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(
      `GTimed needs Node.js ${MIN_NODE_MAJOR}+ (found ${version}). Install from https://nodejs.org`,
    );
  }
}

export function parseInstallArgs(argv) {
  const out = {
    repo: process.env.GTIMED_REPO?.trim() || DEFAULT_REPO,
    ref: process.env.GTIMED_INSTALL_REF?.trim() || DEFAULT_REF,
    dryRun: process.env.GTIMED_INSTALL_DRY_RUN === "1",
    skipGlobal: false,
    from: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--skip-global") out.skipGlobal = true;
    else if (arg === "--from") out.from = argv[++i];
    else if (arg === "--ref") out.ref = argv[++i] ?? out.ref;
    else if (arg === "--repo") out.repo = argv[++i] ?? out.repo;
    else if (arg === "--help" || arg === "-h") throw new Error("help");
    else if (arg) throw new Error(`unknown installer flag "${arg}"\nTry: node scripts/install.mjs --help`);
  }
  return out;
}

export function installHelp() {
  return `
Usage: node scripts/install.mjs [options]

Download GTimed from GitHub, build it, and install the gtimed command.

  --from <dir>     Use a local checkout instead of downloading
  --ref <branch>   GitHub branch (default: master)
  --repo <owner/name>
  --dry-run        Print steps, do not run them
  --skip-global    Build only; do not npm install -g or gtimed install
  -h, --help

Copy-paste (no git clone):

  Windows PowerShell:
    irm https://raw.githubusercontent.com/XreeceX/GTimed/master/scripts/install.ps1 | iex

  macOS / Linux:
    curl -fsSL https://raw.githubusercontent.com/XreeceX/GTimed/master/scripts/install.sh | sh
`.trim();
}

export function buildPlan(opts, sourceDir) {
  const commands = [
    ["npm", "install"],
    ["npm", "run", "build"],
  ];
  if (!opts.skipGlobal) {
    commands.push(["npm", "install", "-g", "."]);
    commands.push([process.execPath, path.join(sourceDir, "dist", "index.js"), "install"]);
  }
  return {
    archiveUrl: githubArchiveUrl(opts.repo, opts.ref),
    source: sourceDir,
    commands,
  };
}

export function formatPlan(plan) {
  const lines = [`source  ${plan.source}`, `archive ${plan.archiveUrl}`, "steps:"];
  for (const cmd of plan.commands) lines.push(`  ${cmd.join(" ")}`);
  return lines.join("\n");
}

function run(cmd, cwd) {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if ((r.status ?? 1) !== 0) {
    throw new Error(`command failed (${r.status}): ${cmd.join(" ")}`);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`download failed (${code}): ${url}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close((err) => (err ? reject(err) : resolve())));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

/** Windows GNU tar (Git Bash) treats `C:\\...` as a remote host named C. */
export function tarBin() {
  if (process.platform === "win32") {
    const root = process.env.SystemRoot || "C:\\Windows";
    for (const dir of ["System32", "Sysnative"]) {
      const candidate = path.join(root, dir, "tar.exe");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "tar";
}

export function tarArchiveArg(archive, dest) {
  const absArchive = path.resolve(archive);
  const absDest = path.resolve(dest);
  const rel = path.relative(absDest, absArchive);
  if (rel && !path.isAbsolute(rel) && !rel.includes(":")) {
    return rel.split(path.sep).join("/");
  }
  const copy = path.join(absDest, "gtimed-download.tar.gz");
  fs.copyFileSync(absArchive, copy);
  return "gtimed-download.tar.gz";
}

export function extractTarGz(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const arg = tarArchiveArg(archive, dest);
  const r = spawnSync(tarBin(), ["-xzf", arg], {
    cwd: path.resolve(dest),
    encoding: "utf8",
    windowsHide: true,
  });
  if ((r.status ?? 1) !== 0) {
    throw new Error(
      `${(r.stderr || r.stdout || "tar failed").trim()} — Windows 10+, macOS, and Linux all ship tar`,
    );
  }
  const names = fs.readdirSync(dest).filter((name) => name !== "gtimed-download.tar.gz");
  const folder = names.find((name) => fs.statSync(path.join(dest, name)).isDirectory());
  if (!folder) throw new Error("archive did not contain a folder");
  return path.join(dest, folder);
}

export async function install(opts) {
  assertNodeVersion();
  if (!opts.from) {
    const npm = spawnSync("npm", ["--version"], { encoding: "utf8", shell: true, windowsHide: true });
    if ((npm.status ?? 1) !== 0) {
      throw new Error("GTimed needs npm (it comes with Node.js). Install from https://nodejs.org");
    }
  }

  let source = opts.from ? path.resolve(opts.from) : "";
  if (source) {
    if (!fs.existsSync(path.join(source, "package.json"))) {
      throw new Error(`not a GTimed checkout: ${source}`);
    }
  } else if (opts.dryRun) {
    source = path.join(os.tmpdir(), "gtimed-download");
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtimed-install-"));
    const archive = path.join(tmp, "gtimed.tar.gz");
    const url = githubArchiveUrl(opts.repo, opts.ref);
    console.log(`Downloading ${url}`);
    await download(url, archive);
    if (!fs.existsSync(archive) || fs.statSync(archive).size < 100) {
      throw new Error(`download was empty: ${url}`);
    }
    source = extractTarGz(archive, path.join(tmp, "unpack"));
  }

  const plan = buildPlan(opts, source);
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    return plan;
  }

  console.log(`Installing from ${source}`);
  for (const cmd of plan.commands) {
    console.log(`> ${cmd.join(" ")}`);
    run(cmd, source);
  }
  console.log("Done. Open a new terminal, then try:  gtimed --help");
  return plan;
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseInstallArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "help") {
      console.log(installHelp());
      return;
    }
    throw err;
  }
  await install(opts);
}

function isDirectRun() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return path.normalize(self) === path.normalize(invoked);
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
