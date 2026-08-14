import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { selfCommand } from "./install.js";
import { FLAGS, GIT_VERBS, canonicalFlag } from "./parse.js";
import { homeDir, loadStore } from "./store.js";

export const ROOT_COMMANDS = [
  "list",
  "ls",
  "cancel",
  "abort",
  "logs",
  "--log",
  "run",
  "tick",
  "--tick",
  "daemon",
  "dm",
  "install",
  "uninstall",
  "completion",
  "ui",
  "help",
  "--help",
  "-h",
  "version",
  "--version",
  "-V",
];

export const WHEN_VALUES = [
  "clean",
  "dirty",
  "staged",
  "stg",
  "ahead",
  "behind",
  "remote-ok",
  "ro",
  "branch=",
  "file=",
  "cmd:",
];

export const DURATIONS = ["30s", "1m", "5m", "10m", "15m", "20m", "30m", "1h", "2h", "6h", "1d"];

const JOB_CMDS = new Set(["cancel", "abort", "logs", "log", "--log", "run"]);
const CANCEL_EXTRAS = ["--all", "all", "last"];
const COMPLETION_CMDS = ["bash", "zsh", "fish", "powershell", "install", "uninstall"];
const FLAG_NAMES = Object.keys(FLAGS);
const VALUE_FLAGS = new Set(
  Object.entries(FLAGS)
    .filter(([, kind]) => kind !== "boolean")
    .map(([name]) => name),
);

const MARK = "# gtimed completion";

export interface SuggestOpts {
  jobs?: string[];
}

const COMPLETION_BINS = new Set(["gtimed", "gtm"]);

export function suggestions(words: string[], cword: number, opts: SuggestOpts = {}): string[] {
  const current = words[cword] ?? "";
  const prev = cword > 0 ? (words[cword - 1] ?? "") : "";
  const bin =
    (words[0] ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.cmd$/i, "")
      ?.replace(/\.exe$/i, "") ?? "";

  let pool: string[] = [];

  if (!COMPLETION_BINS.has(bin)) {
    return [];
  }

  const prevFlag = canonicalFlag(prev);

  if (prevFlag === "--when") pool = WHEN_VALUES;
  else if (prevFlag === "--in" || prevFlag === "--every" || prevFlag === "--timeout") pool = DURATIONS;
  else if (prevFlag === "--retry") pool = ["0", "1", "2", "3"];
  else if (prevFlag === "--cron") pool = ["0 * * * *", "0 */4 * * *", "0 9 * * 1-5", "0 18 * * 1-5"];
  else if (VALUE_FLAGS.has(prev) || VALUE_FLAGS.has(prevFlag)) pool = [];
  else if (cword <= 1) {
    pool = [...ROOT_COMMANDS, ...GIT_VERBS, ...FLAG_NAMES];
  } else if (words[1] === "completion" && cword === 2) {
    pool = COMPLETION_CMDS;
  } else if (
    (words[1] === "cancel" || words[1] === "abort") &&
    cword === 2
  ) {
    pool = [...CANCEL_EXTRAS, ...(opts.jobs ?? loadStore().jobs.filter((j) => j.status === "pending").map((j) => j.id))];
  } else if (JOB_CMDS.has(words[1] ?? "") && cword === 2) {
    pool = ["last", ...(opts.jobs ?? loadStore().jobs.map((j) => j.id))];
  } else if (current.startsWith("-")) {
    pool = FLAG_NAMES;
  } else {
    pool = [...GIT_VERBS, ...FLAG_NAMES];
  }

  return [...new Set(pool.filter((s) => matches(s, current)))];
}

function matches(candidate: string, current: string): boolean {
  if (!current) return true;
  return candidate.toLowerCase().startsWith(current.toLowerCase());
}

function psQuote(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

function shQuote(s: string): string {
  if (!/[^\w./:=-]/.test(s)) return s;
  return `"${s.replaceAll('"', '\\"')}"`;
}

export function scriptFor(shell: string): string {
  const { exe, args } = selfCommand();
  switch (shell) {
    case "bash":
      return bashScript(exe, args[0]);
    case "zsh":
      return zshScript(exe, args[0]);
    case "fish":
      return fishScript(exe, args[0]);
    case "powershell":
    case "pwsh":
      return powershellScript(exe, args[0]);
    default:
      throw new Error(`unknown shell "${shell}". Use bash, zsh, fish, or powershell.`);
  }
}

function bashScript(exe: string, entry: string): string {
  const invoke = `${shQuote(exe)} ${shQuote(entry)}`;
  return `${MARK}
_gtimed() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\\n'
  local out
  out="$(${invoke} __complete "$COMP_CWORD" -- "\${COMP_WORDS[@]}" 2>/dev/null)"
  COMPREPLY=( $(compgen -W "$out" -- "$cur") )
}

complete -o default -F _gtimed gtimed gtm
`;
}

function zshScript(exe: string, entry: string): string {
  const invoke = `${shQuote(exe)} ${shQuote(entry)}`;
  return `${MARK}
_gtimed() {
  local -a opts
  local cword=$(( CURRENT - 1 ))
  opts=("\${(@f)$(${invoke} __complete $cword -- \${words[@]} 2>/dev/null)}")
  compadd -a opts
}

compdef _gtimed gtimed gtm
`;
}

function fishScript(exe: string, entry: string): string {
  const invoke = `${shQuote(exe)} ${shQuote(entry)}`;
  return `${MARK}
function __gtimed_complete
  set -l tokens (commandline -opc)
  set -l current (commandline -ct)
  set -l cword (count $tokens)
  ${invoke} __complete $cword -- $tokens $current
end

complete -c gtimed -f -a '(__gtimed_complete)'
complete -c gtm -f -a '(__gtimed_complete)'
`;
}

function powershellScript(exe: string, entry: string): string {
  return `${MARK}
$gtimedNode = ${psQuote(exe)}
$gtimedEntry = ${psQuote(entry)}

$gtimedCompleter = {
  param($wordToComplete, $commandAst, $cursorPosition)
  $tokens = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  if ($tokens.Count -eq 0) { return }
  $cword = $tokens.Count - 1
  if ([string]::IsNullOrEmpty($wordToComplete)) { $cword = $tokens.Count }
  $raw = & $gtimedNode $gtimedEntry __complete $cword -- @tokens 2>$null
  if (-not $raw) { return }
  $raw | Where-Object { $_ -and ($_ -like "$wordToComplete*") } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
  }
}

Register-ArgumentCompleter -Native -CommandName gtimed,gtm -ScriptBlock $gtimedCompleter
`;
}

export function completionDir(): string {
  return path.join(homeDir(), "completion");
}

export function writeCompletionScripts(): string {
  const dir = completionDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "gtimed.bash"), scriptFor("bash"), "utf8");
  fs.writeFileSync(path.join(dir, "gtimed.zsh"), scriptFor("zsh"), "utf8");
  fs.writeFileSync(path.join(dir, "gtimed.fish"), scriptFor("fish"), "utf8");
  fs.writeFileSync(path.join(dir, "gtimed.ps1"), scriptFor("powershell"), "utf8");
  return dir;
}

export function installCompletion(): string {
  const dir = writeCompletionScripts();
  const notes: string[] = [`Wrote scripts in ${dir}`];

  if (process.platform === "win32") {
    notes.push(installPowerShellProfile(path.join(dir, "gtimed.ps1")));
    notes.push(sourceLine(path.join(os.homedir(), ".bashrc"), `source "${path.join(dir, "gtimed.bash").replaceAll("\\", "/")}"`));
  } else {
    notes.push(sourceLine(path.join(os.homedir(), ".bashrc"), `source "${path.join(dir, "gtimed.bash")}"`));
    notes.push(sourceLine(path.join(os.homedir(), ".zshrc"), `source "${path.join(dir, "gtimed.zsh")}"`));
    const fish = path.join(os.homedir(), ".config", "fish", "completions", "gtimed.fish");
    fs.mkdirSync(path.dirname(fish), { recursive: true });
    fs.copyFileSync(path.join(dir, "gtimed.fish"), fish);
    notes.push(`Copied fish completions to ${fish}`);
  }

  notes.push("Open a new terminal, then: gtimed ca<Tab>  or  gtm ca<Tab>  →  cancel");
  return notes.filter(Boolean).join("\n");
}

export function uninstallCompletion(): string {
  stripMarkedBlock(path.join(os.homedir(), ".bashrc"));
  stripMarkedBlock(path.join(os.homedir(), ".zshrc"));
  for (const p of powershellProfiles()) {
    stripMarkedBlock(p);
  }
  const fish = path.join(os.homedir(), ".config", "fish", "completions", "gtimed.fish");
  if (fs.existsSync(fish)) fs.unlinkSync(fish);
  return "Removed gtimed completion hooks from shell profiles.";
}

function sourceLine(file: string, line: string): string {
  const exists = fs.existsSync(file);
  if (!exists) return "";
  const cur = fs.readFileSync(file, "utf8");
  if (cur.includes(MARK)) return `Completion already referenced in ${file}`;
  fs.appendFileSync(file, `\n${MARK}\n${line}\n`, "utf8");
  return `Added source line to ${file}`;
}

function installPowerShellProfile(script: string): string {
  const profiles = powershellProfiles();
  if (!profiles.length) {
    const fallback = path.join(os.homedir(), "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
    profiles.push(fallback);
  }
  const line = `. ${psQuote(script)}`;
  const touched: string[] = [];
  for (const file of profiles) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (cur.includes(MARK)) {
      touched.push(file);
      continue;
    }
    fs.appendFileSync(file, `\n${MARK}\n${line}\n`, "utf8");
    touched.push(file);
  }
  return `Hooked PowerShell profile: ${touched.join(", ")}`;
}

function powershellProfiles(): string[] {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "$PROFILE.CurrentUserAllHosts; $PROFILE.CurrentUserCurrentHost"],
    { encoding: "utf8", windowsHide: true },
  );
  const fromShell = (r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromShell.length) return [...new Set(fromShell)];
  const home = os.homedir();
  return [
    path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
  ];
}

function stripMarkedBlock(file: string): void {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const next: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(MARK)) {
      if (i + 1 < lines.length) i += 1;
      continue;
    }
    next.push(lines[i]);
  }
  fs.writeFileSync(file, next.join("\n"), "utf8");
}
