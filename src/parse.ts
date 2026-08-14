export const MANAGEMENT = new Set([
  "list",
  "ls",
  "cancel",
  "abort",
  "rm",
  "status",
  "logs",
  "log",
  "run",
  "tick",
  "daemon",
  "install",
  "uninstall",
  "shim",
  "completion",
  "ui",
  "help",
  "-h",
  "--help",
  "version",
  "-V",
  "--version",
  "__shim",
  "__complete",
]);

export const GIT_VERBS = new Set([
  "add",
  "am",
  "bisect",
  "blame",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "config",
  "diff",
  "fetch",
  "grep",
  "init",
  "log",
  "ls-files",
  "merge",
  "mv",
  "notes",
  "pull",
  "push",
  "rebase",
  "remote",
  "reset",
  "restore",
  "revert",
  "rm",
  "show",
  "sparse-checkout",
  "stash",
  "status",
  "submodule",
  "switch",
  "tag",
  "worktree",
]);

export type FlagKind = "value" | "boolean" | "repeat";

export const FLAGS: Record<string, FlagKind> = {
  "--at": "value",
  "--in": "value",
  "--cron": "value",
  "--when": "repeat",
  "--until": "value",
  "--every": "value",
  "--timeout": "value",
  "--retry": "value",
  "--name": "value",
  "--cwd": "value",
  "--dry-run": "boolean",
  "--now": "boolean",
  "--same-branch": "boolean",
};

export interface ParsedCli {
  command: string[];
  at?: string;
  in?: string;
  cron?: string;
  when: string[];
  until?: string;
  every?: string;
  timeout?: string;
  retry?: string;
  name?: string;
  cwd?: string;
  dryRun: boolean;
  now: boolean;
  sameBranch: boolean;
}

export function parseScheduleArgs(argv: string[]): ParsedCli {
  const out: ParsedCli = {
    command: [],
    when: [],
    dryRun: false,
    now: false,
    sameBranch: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      out.command.push(...argv.slice(i + 1));
      break;
    }

    const eq = arg.indexOf("=");
    const flag = eq >= 0 && arg.startsWith("--") ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 && arg.startsWith("--") ? arg.slice(eq + 1) : undefined;
    const kind = FLAGS[flag];

    if (!kind) {
      out.command.push(arg);
      continue;
    }

    if (kind === "boolean") {
      assignBoolean(out, flag);
      continue;
    }

    const value = inline ?? argv[++i];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    assignValue(out, flag, value);
  }

  if (out.command[0] && GIT_VERBS.has(out.command[0]) && out.command[0] !== "git") {
    out.command = ["git", ...out.command];
  }

  return out;
}

function assignBoolean(out: ParsedCli, flag: string): void {
  if (flag === "--dry-run") out.dryRun = true;
  if (flag === "--now") out.now = true;
  if (flag === "--same-branch") out.sameBranch = true;
}

function assignValue(out: ParsedCli, flag: string, value: string): void {
  switch (flag) {
    case "--at":
      out.at = value;
      break;
    case "--in":
      out.in = value;
      break;
    case "--cron":
      out.cron = value;
      break;
    case "--when":
      out.when.push(value);
      break;
    case "--until":
      out.until = value;
      break;
    case "--every":
      out.every = value;
      break;
    case "--timeout":
      out.timeout = value;
      break;
    case "--retry":
      out.retry = value;
      break;
    case "--name":
      out.name = value;
      break;
    case "--cwd":
      out.cwd = value;
      break;
  }
}

export function quote(args: string[]): string {
  return args
    .map((a) => (/\s/.test(a) || a.includes('"') ? `"${a.replaceAll('"', '\\"')}"` : a))
    .join(" ");
}
