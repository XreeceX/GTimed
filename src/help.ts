import { GIT_VERBS, MANAGEMENT, canonicalCommand } from "./parse.js";

export function wantsHelp(argv: string[]): boolean {
  const head = argv[0];
  if (head === "help" || head === "-h" || head === "--help") return true;
  const end = argv.indexOf("--");
  const before = end === -1 ? argv : argv.slice(0, end);
  return before.some((a) => a === "-h" || a === "--help");
}

export function helpFor(argv: string[]): string {
  const head = argv[0];
  if (!head || head === "help" || head === "-h" || head === "--help") return help();
  const topic = canonicalCommand(head);
  if (MANAGEMENT.has(topic) && !GIT_VERBS.has(topic)) {
    return commandHelp(topic) ?? help();
  }
  return scheduleHelp();
}

export function help(): string {
  return `
Usage: gtimed [options] <command>
   or: gtm     [options] <command>
   or: gtimed [options] <git-verb | command...> --in <dur> | --at <when> | --cron <expr> | --when <spec> | --now

Schedule git (or any CLI) for later, on a cron, or when a repo condition matches.
git itself is unchanged. Delay flags live on gtimed only. gtm is the same CLI; gt is Graphite's.

Examples:
  gtimed commit --in 20m -m "Hello world"
  gtm push --at "tomorrow 9am"
  gtimed fetch --cron "0 */4 * * *"
  gtimed --when clean -- git push
  gtimed --in 30m -- gh pr create --fill

Commands:
  list, ls              Show the job queue
  cancel <id>           Abort one pending job (id prefix is enough)
  abort                 Abort every pending job
  logs [id]             Print job output (also: gtimed --log [id|last])
  run <id>              Run a job now (still checks --when)
  tick, --tick          Run jobs that are already due
  daemon, dm            Tick every 15s in this terminal
  ui                    Open the local Source Control UI
  install               PATH, OS minute tick, tab completion
  uninstall             Remove the tick and completion hooks
  completion            bash | zsh | fish | powershell | install
  help                  Show this help
  version               Print version

Schedule options:
  --in <duration>       Once, after 30s / 5m / 2h / 1d (also 0.1m)
  --at <when>           Once, at a local time ("tomorrow 9am")
  --cron <expr>         Each matching minute (5-field)
  --when <spec>         Repeatable condition; all must pass
  --until, --til <when> Give up if conditions never match
  --now                 Run on this invocation (still honors --when)
  --dry-run, --dry      Log the command, do not spawn it
  --same-branch, --sb   Skip if HEAD moved since you scheduled
  --cwd <dir>           Working directory (default: current)
  --name <label>        Label in gtimed list
  --timeout, --to <dur> Kill the process after this
  --retry, --rt <n>     Extra tries after a non-zero exit
  --every <dur>         Stored on the job; OS tick is still 1 min

  -h, --help            Show this help
  -V, --version         Print version

Conditions (--when):
  clean | dirty | staged (stg) | ahead | behind | remote-ok (ro)
  branch=<name> | file=<path> | cmd:<shell>

Rescheduling the same command in the same directory replaces the pending job
with the new --in / --at / --cron / --when.

Store: ~/.gtimed/jobs.json    Logs: ~/.gtimed/logs/<id>.log
`.trim();
}

function scheduleHelp(): string {
  return `
Usage: gtimed <command> [args] --in <dur> | --at <when> | --cron <expr> | --when <spec> | --now
   or: gtimed [options] -- <command> [args]

<command> runs later in the current folder (or --cwd). Git verbs such as
commit and push get "git" prepended.

Examples:
  gtimed commit --in 20m -m "Hello world"
  gtimed push --at "tomorrow 9am"
  gtimed --when clean -- git push
  gtimed --in 30m -- gh pr create --fill

Need at least one of --in, --at, --cron, --when, or --now.

Run gtimed --help for all flags, conditions, and job commands.
`.trim();
}

function commandHelp(cmd: string): string | undefined {
  const pages: Record<string, string> = {
    list: `Usage: gtimed list
   or: gtimed ls

Print the job queue. Pending jobs say waiting; finished jobs say ran.`,
    ls: `Usage: gtimed list
   or: gtimed ls

Print the job queue. Pending jobs say waiting; finished jobs say ran.`,
    cancel: `Usage: gtimed cancel <id>
   or: gtimed cancel last | --all

Abort one pending job. An id prefix is enough.`,
    abort: `Usage: gtimed abort
   or: gtimed cancel --all

Abort every pending job.`,
    logs: `Usage: gtimed logs [id]
   or: gtimed --log [id|last]

Print a job's output. With no id, uses the latest job.`,
    "--log": `Usage: gtimed logs [id]
   or: gtimed --log [id|last]

Print a job's output. With no id, uses the latest job.`,
    run: `Usage: gtimed run <id>

Run that job now. --when still has to pass.`,
    tick: `Usage: gtimed tick
   or: gtimed --tick

Run jobs whose time has already arrived. Future jobs stay waiting.

After gtimed install you do not need this; Task Scheduler ticks every minute.`,
    daemon: `Usage: gtimed daemon
   or: gtimed dm

Tick every 15 seconds in this terminal until you Ctrl+C.`,
    install: `Usage: gtimed install

Put gtimed on PATH, register a minute tick, and hook tab completion.`,
    uninstall: `Usage: gtimed uninstall

Remove the OS tick, leftover git shim, and completion hooks.`,
    completion: `Usage: gtimed completion install | uninstall
   or: gtimed completion bash | zsh | fish | powershell

Install shell completion, or print a completion script.`,
    ui: `Usage: gtimed ui [--port 8787] [--cwd <dir>] [--no-open]

Open the local Source Control UI at http://127.0.0.1:8787.`,
    version: `Usage: gtimed version
   or: gtimed -V | --version

Print the gtimed version.`,
    "-V": `Usage: gtimed version
   or: gtimed -V | --version

Print the gtimed version.`,
    "--version": `Usage: gtimed version
   or: gtimed -V | --version

Print the gtimed version.`,
  };
  return pages[cmd];
}
