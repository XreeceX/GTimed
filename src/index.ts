#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installCompletion, scriptFor, suggestions, uninstallCompletion } from "./completion.js";
import { installTick, uninstallTick } from "./install.js";
import { GIT_VERBS, MANAGEMENT, canonicalCommand, parseScheduleArgs, quote } from "./parse.js";
import { enqueueJob, executeJob, nextHint, statusHint, tick } from "./runner.js";
import { help, helpFor, wantsHelp } from "./help.js";
import {
  argsHaveScheduleFlags,
  discoverRealGit,
  ensureNpmOnUserPath,
  removeShim,
  removeShimFromUserPath,
} from "./shim.js";
import { cancelPending, getJob, latestJob, loadStore, pendingJobs, shimDir, type Job } from "./store.js";
import { openBrowser, startUi } from "./ui-server.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = canonicalCommand(argv[0] ?? "help");

  if (cmd === "__shim") {
    await runShim(argv.slice(1));
    return;
  }
  if (cmd === "__complete") {
    runComplete(argv.slice(1));
    return;
  }

  if (wantsHelp(argv)) {
    console.log(helpFor(argv));
    return;
  }

  if (cmd === "--log" || cmd.startsWith("--log=")) {
    const rest = cmd.startsWith("--log=") ? [cmd.slice("--log=".length), ...argv.slice(1)] : argv.slice(1);
    handleLogs(rest);
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
    case "logs":
      handleLogs(rest);
      return;
    case "run": {
      const id = rest[0];
      if (!id) throw new Error("usage: gtimed run <id>");
      printJobOutcome(await executeJob(requireJob(id)));
      return;
    }
    case "tick": {
      printTick(await tick());
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
      console.log(removeShimFromUserPath(shimDir()));
      removeShim();
      console.log(ensureNpmOnUserPath());
      console.log(installTick());
      console.log(installCompletion());
      console.log("Installed on this machine:");
      console.log("  • gtimed on PATH (npm global)");
      console.log("  • jobs fire every minute via Task Scheduler / cron (PC must be on)");
      console.log("Open a new terminal, then:");
      console.log('  gtimed commit --in 20m -m "Hello world"');
      return;
    }
    case "uninstall":
      console.log(uninstallTick());
      console.log(removeShimFromUserPath(shimDir()));
      removeShim();
      console.log(uninstallCompletion());
      console.log("Uninstalled gtimed tick, leftover git shim, and completion hooks.");
      return;
    case "completion":
      handleCompletion(rest);
      return;
    case "ui":
      await startUiCli(rest);
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
    console.log("nothing cancelled — pick a job:");
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

function handleLogs(rest: string[]): void {
  const arg = rest[0];
  const job = !arg || arg === "last" ? latestJob() : requireJob(arg);
  if (!job) {
    console.log("no jobs");
    return;
  }
  console.log(`${job.id}  ${statusHint(job)}  ${quote(job.command)}`);
  const hasLog = fs.existsSync(job.logFile) && fs.statSync(job.logFile).size > 0;
  if (!hasLog) {
    if (job.status === "pending") {
      console.log(`has not run yet  (waiting ${nextHint(job)})`);
    } else {
      console.log("(no log yet)");
    }
    return;
  }
  process.stdout.write(fs.readFileSync(job.logFile, "utf8"));
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

async function runShim(argv: string[]): Promise<void> {
  const rest = argv.slice(1);
  if (argsHaveScheduleFlags(rest)) {
    console.error("git does not accept --in / --at / --when / --cron.");
    console.error('Schedule with gtimed instead, e.g.  gtimed commit --in 20m -m "..."');
    process.exitCode = 2;
    return;
  }
  const r = spawnSync(discoverRealGit(), rest, { stdio: "inherit", windowsHide: true });
  process.exitCode = r.status ?? 1;
}

async function schedule(argv: string[]): Promise<void> {
  const parsed = parseScheduleArgs(argv);
  if (!parsed.command.length) {
    console.log(help());
    return;
  }

  const { job, replaced } = enqueueJob({
    ...parsed,
    cwd: parsed.cwd ? path.resolve(parsed.cwd) : process.cwd(),
  });

  if (parsed.now) {
    printJobOutcome(await executeJob(job));
    return;
  }

  console.log(`${replaced ? "updated" : "scheduled"} ${job.id}`);
  console.log(`  cmd   ${quote(job.command)}`);
  console.log(`  cwd   ${job.cwd}`);
  console.log(`  not run yet — waiting ${nextHint(job)}${job.when.length ? ` if ${job.when.join(" & ")}` : ""}`);
}

function printJobOutcome(job: Job): void {
  if (job.status === "pending") {
    console.log(`${job.id}  did not run  ${job.lastError ?? statusHint(job)}`);
    return;
  }
  if (job.status === "skipped") {
    console.log(`${job.id}  skipped  ${job.lastError ?? ""}`.trim());
    return;
  }
  console.log(`${job.id} -> ${job.status}${job.lastError ? ` (${job.lastError})` : ""}`);
}

function printTick(ran: Job[]): void {
  if (ran.length) {
    console.log(`ran ${ran.length} job(s):`);
    for (const j of ran) printJobOutcome(j);
  } else {
    console.log("nothing due to run");
  }
  const waiting = loadStore().jobs.filter((j) => j.status === "pending");
  if (!waiting.length) return;
  console.log("still waiting:");
  for (const j of waiting) {
    console.log(`  ${j.id}  ${quote(j.command)}  ${statusHint(j)}`);
  }
}

function printList(): void {
  const jobs = loadStore().jobs;
  if (!jobs.length) {
    console.log("no jobs");
    return;
  }
  for (const j of jobs) {
    const name = j.name ? ` ${j.name}` : "";
    console.log(`${j.id}${name}  ${j.status.padEnd(10)}  ${statusHint(j)}  ${quote(j.command)}`);
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
