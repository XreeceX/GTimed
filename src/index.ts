#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installCompletion, scriptFor, suggestions, uninstallCompletion } from "./completion.js";
import { installTick, uninstallTick } from "./install.js";
import { GIT_VERBS, MANAGEMENT, parseScheduleArgs, quote } from "./parse.js";
import { buildJob, executeJob, nextHint, tick } from "./runner.js";
import {
  argsHaveScheduleFlags,
  discoverRealGit,
  prependShimToUserPath,
  removeShim,
  removeShimFromUserPath,
  writeShim,
} from "./shim.js";
import { cancelPending, getJob, loadStore, newJobId, pendingJobs, shimDir, upsertJob } from "./store.js";
import { openBrowser, startUi } from "./ui-server.js";

const VERSION = "0.1.0";

function help(): string {
  return `
gtimed — schedule git (or any CLI) for later, on a cron, or when a condition matches.

After gtimed install, these flags work on normal git:

  git commit -m "Hello world" --in 20m
  git push --at "tomorrow 9am"
  git fetch --cron "0 */4 * * *"
  git push --when clean

Same flags on gtimed / any CLI:
  gtimed commit --at "tomorrow 9am" -m "ship docs"
  gtimed --in 30m -- gh pr create --fill

Conditions (--when, repeatable; all must pass):
  clean | dirty | staged | ahead | behind | remote-ok
  branch=main | file=README.md | cmd:<shell, exit 0 means yes>

Jobs:
  gtimed list
  gtimed cancel <id>              abort one job (id prefix is enough)
  gtimed abort                    abort every pending job
  gtimed cancel --all | last
  gtimed logs <id>
  gtimed run <id>                 run now (still checks --when)
  gtimed tick                     run whatever is due (call from Task Scheduler/cron)
  gtimed daemon                   loop ticks every 15s while this process lives
  gtimed install                  git flags on PATH + OS minute tick + tab completion
  gtimed completion               bash | zsh | fish | powershell | install
  gtimed ui                       Source Control GUI (browser)
  gtimed uninstall

Store: ~/.gtimed/jobs.json    Logs: ~/.gtimed/logs/<id>.log
`.trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "help";

  if (cmd === "__shim") {
    await runShim(argv.slice(1));
    return;
  }
  if (cmd === "__complete") {
    runComplete(argv.slice(1));
    return;
  }

  if (MANAGEMENT.has(cmd) && !GIT_VERBS.has(cmd)) {
    await manage(cmd, argv.slice(1));
    return;
  }

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(help());
    return;
  }
  if (cmd === "version" || cmd === "-V" || cmd === "--version") {
    console.log(VERSION);
    return;
  }

  await schedule(argv);
}

async function manage(cmd: string, rest: string[]): Promise<void> {
  switch (cmd) {
    case "list":
    case "ls":
      printList();
      return;
    case "cancel":
    case "abort": {
      handleCancel(cmd, rest);
      return;
    }
    case "logs": {
      const id = rest[0];
      if (!id) throw new Error("usage: gtimed logs <id>");
      const job = requireJob(id);
      if (!fs.existsSync(job.logFile)) {
        console.log("(no log yet)");
        return;
      }
      console.log(fs.readFileSync(job.logFile, "utf8"));
      return;
    }
    case "run": {
      const id = rest[0];
      if (!id) throw new Error("usage: gtimed run <id>");
      const job = await executeJob(requireJob(id));
      console.log(`${job.id} -> ${job.status}${job.lastError ? ` (${job.lastError})` : ""}`);
      return;
    }
    case "tick": {
      const ran = await tick();
      if (!ran.length) console.log("nothing due");
      else ran.forEach((j) => console.log(`${j.id} -> ${j.status}`));
      const waiting = loadStore().jobs.filter((j) => j.status === "pending");
      for (const j of waiting) {
        console.log(`${j.id}  still waiting  ${nextHint(j)}`);
      }
      return;
    }
    case "daemon": {
      console.log("gtimed daemon ticking every 15s (Ctrl+C to stop)");
      await tick();
      setInterval(() => {
        tick().catch((err) => console.error(err));
      }, 15_000);
      await new Promise(() => {});
      return;
    }
    case "install": {
      const dir = writeShim();
      console.log(`git shim: ${dir}`);
      console.log(prependShimToUserPath(dir));
      console.log(installTick());
      console.log(installCompletion());
      console.log("Installed for this machine (survives closing Cursor):");
      console.log("  • gtimed on PATH (npm global)");
      console.log("  • git --in / --at via shim (Git Bash, PowerShell, cmd)");
      console.log("  • jobs fire every minute via Task Scheduler / cron (PC must be on)");
      console.log("Open a NEW terminal (or restart Cursor once), then:");
      console.log('  git commit -m "Hello world" --in 20m');
      return;
    }
    case "uninstall":
      console.log(uninstallTick());
      console.log(removeShimFromUserPath(shimDir()));
      removeShim();
      console.log(uninstallCompletion());
      console.log("Removed git shim.");
      return;
    case "completion":
      handleCompletion(rest);
      return;
    case "ui":
      await startUiCli(rest);
      return;
    case "shim":
      handleShim(rest);
      return;
    case "help":
    case "-h":
    case "--help":
      console.log(help());
      return;
    case "version":
    case "-V":
    case "--version":
      console.log(VERSION);
      return;
    default:
      console.log(help());
  }
}

async function startUiCli(rest: string[]): Promise<void> {
  let port = 8787;
  let cwd = process.cwd();
  let open = true;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--port") port = Number(rest[++i]);
    else if (rest[i] === "--cwd") cwd = path.resolve(rest[++i] ?? cwd);
    else if (rest[i] === "--no-open") open = false;
  }
  if (!Number.isFinite(port) || port < 0) throw new Error("invalid --port");
  const host = "127.0.0.1";
  const server = await startUi({ cwd, port, host });
  const addr = server.address();
  const bound = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://${host}:${bound}`;
  console.log(`GTimed UI ${url}`);
  console.log(`  cwd ${cwd}`);
  if (open) openBrowser(url);
  await new Promise(() => {});
}

function handleCancel(cmd: string, rest: string[]): void {
  const arg = rest[0];
  const all =
    (cmd === "abort" && !arg) ||
    arg === "--all" ||
    arg === "-a" ||
    arg === "all" ||
    arg === "*";

  if (all) {
    const cancelled = cancelPending("all");
    if (!cancelled.length) {
      console.log("no pending jobs");
      return;
    }
    for (const job of cancelled) {
      console.log(`cancelled ${job.id}  ${job.command.join(" ")}`);
    }
    console.log(`aborted ${cancelled.length} pending job(s)`);
    return;
  }

  if (!arg) {
    const pending = pendingJobs();
    if (!pending.length) {
      console.log("no pending jobs");
      return;
    }
    console.log("pending jobs:");
    for (const j of pending) {
      console.log(`  ${j.id}  ${nextHint(j)}  ${j.command.join(" ")}`);
    }
    console.log("usage: gtimed cancel <id> | last | --all");
    console.log("       gtimed abort              (same as cancel --all)");
    return;
  }

  const cancelled = cancelPending(arg === "last" ? "last" : arg);
  if (!cancelled.length) {
    throw new Error(`no pending job matching "${arg}"`);
  }
  for (const job of cancelled) {
    console.log(`cancelled ${job.id}  ${job.command.join(" ")}`);
  }
}

function handleCompletion(rest: string[]): void {
  const sub = rest[0] ?? "help";
  if (sub === "install") {
    console.log(installCompletion());
    return;
  }
  if (sub === "uninstall") {
    console.log(uninstallCompletion());
    return;
  }
  if (["bash", "zsh", "fish", "powershell", "pwsh"].includes(sub)) {
    process.stdout.write(scriptFor(sub));
    return;
  }
  console.log(`usage:
  gtimed completion install
  gtimed completion uninstall
  gtimed completion bash|zsh|fish|powershell`);
}

function runComplete(argv: string[]): void {
  let cword = Number(argv[0]);
  const dash = argv.indexOf("--");
  const words = dash >= 0 ? argv.slice(dash + 1) : argv.slice(Number.isFinite(cword) ? 1 : 0);
  if (!Number.isFinite(cword) || cword < 0) cword = Math.max(0, words.length - 1);
  for (const item of suggestions(words, cword)) {
    console.log(item);
  }
}

function handleShim(rest: string[]): void {
  const action = rest[0] ?? "status";
  if (action === "install") {
    const dir = writeShim();
    console.log(`Wrote git shim in ${dir}`);
    console.log(prependShimToUserPath(dir));
    console.log("Commands without --in / --at / --when still go to real git.");
    console.log('  git commit -m "Hello world" --in 20m');
    return;
  }
  if (action === "uninstall") {
    console.log(removeShimFromUserPath(shimDir()));
    removeShim();
    console.log("Removed git shim.");
    return;
  }
  const dir = shimDir();
  const present = fs.existsSync(path.join(dir, "git.cmd")) || fs.existsSync(path.join(dir, "git"));
  console.log(present ? `shim present: ${dir}` : "shim not installed (gtimed install)");
  console.log(`real git: ${discoverRealGit()}`);
}

async function runShim(argv: string[]): Promise<void> {
  const tool = argv[0] ?? "git";
  const rest = argv.slice(1);
  if (!argsHaveScheduleFlags(rest)) {
    const r = spawnSync(discoverRealGit(), rest, { stdio: "inherit", windowsHide: true });
    process.exitCode = r.status ?? 1;
    return;
  }
  await schedule([tool, ...rest]);
}

async function schedule(argv: string[]): Promise<void> {
  const parsed = parseScheduleArgs(argv);
  if (!parsed.command.length) {
    console.log(help());
    return;
  }

  const job = buildJob({
    ...parsed,
    cwd: parsed.cwd ? path.resolve(parsed.cwd) : process.cwd(),
    id: newJobId(),
  });
  upsertJob(job);

  if (parsed.now) {
    const ran = await executeJob(job);
    console.log(`ran ${ran.id} -> ${ran.status}`);
    return;
  }

  console.log(`scheduled ${job.id}`);
  console.log(`  cmd   ${quote(job.command)}`);
  console.log(`  cwd   ${job.cwd}`);
  console.log(`  when  ${nextHint(job)}${job.when.length ? ` if ${job.when.join(" & ")}` : ""}`);
  console.log("  run a tick with: gtimed tick   (or: gtimed install / gtimed daemon)");
}

function printList(): void {
  const jobs = loadStore().jobs;
  if (!jobs.length) {
    console.log("no jobs");
    return;
  }
  for (const j of jobs) {
    const name = j.name ? ` ${j.name}` : "";
    console.log(
      `${j.id}${name}  ${j.status.padEnd(10)}  ${nextHint(j)}  ${quote(j.command)}`,
    );
  }
}

function requireJob(id: string) {
  const job = getJob(id);
  if (!job) throw new Error(`unknown job "${id}"`);
  return job;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
