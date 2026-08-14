import { isWhenSpec, WHEN_KEYWORDS } from "./conditions.js";
import {
  COMMAND_ALIASES,
  FLAGS,
  GIT_VERBS,
  MANAGEMENT,
  canonicalCommand,
  canonicalFlag,
  quote,
} from "./parse.js";
import { argsHaveScheduleFlags } from "./shim.js";

const HELP_HINT = "Try gtimed --help";

const COMMANDS = [
  ...MANAGEMENT,
  ...Object.keys(COMMAND_ALIASES),
  ...GIT_VERBS,
];

const EXTRA_OPTIONS = new Set(["--all", "-a", "--port", "--no-open"]);
const OPTIONS = [...Object.keys(FLAGS), "--help", "--version", "--log", "--tick"];

export function distance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp: number[] = new Array(rows * cols);
  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j] + 1,
        dp[i * cols + j - 1] + 1,
        dp[(i - 1) * cols + j - 1] + cost,
      );
    }
  }
  return dp[rows * cols - 1] ?? 0;
}

function isClose(typed: string, candidate: string, d: number): boolean {
  const a = typed.toLowerCase();
  const b = candidate.toLowerCase();
  if (a === b) return false;
  if (a.startsWith("-") !== b.startsWith("-")) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (d <= 1) return true;
  if (d !== 2 || Math.min(a.length, b.length) < 5) return false;
  const aKey = a.replace(/^-+/, "")[0];
  const bKey = b.replace(/^-+/, "")[0];
  return Boolean(aKey && aKey === bKey);
}

export function closeMatches(typed: string, candidates: Iterable<string>, limit = 3): string[] {
  const input = typed.toLowerCase();
  if (!input) return [];
  const scored: { value: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const value = canonicalCommand(canonicalFlag(raw));
    if (seen.has(value)) continue;
    const lower = raw.toLowerCase();
    if (lower === input) continue;
    const d = distance(input, lower);
    const prefix = lower.startsWith(input) && input.length >= 3;
    if (!prefix && !isClose(input, lower, d)) continue;
    seen.add(value);
    scored.push({ value, score: prefix ? Math.min(d, 0.5) : d });
  }
  scored.sort((a, b) => a.score - b.score || a.value.length - b.value.length);
  return scored.slice(0, limit).map((s) => s.value);
}

function beforeDashDash(argv: string[]): string[] {
  const end = argv.indexOf("--");
  return end === -1 ? argv : argv.slice(0, end);
}

function knownCommand(token: string): boolean {
  if (token === "--log" || token.startsWith("--log=")) return true;
  const canon = canonicalCommand(token);
  return MANAGEMENT.has(canon) || GIT_VERBS.has(token) || token === "git";
}

function knownOption(token: string): boolean {
  const name = token.split("=")[0] ?? token;
  if (FLAGS[canonicalFlag(name)]) return true;
  if (EXTRA_OPTIONS.has(name)) return true;
  return name === "--help" || name === "--version" || name === "--log" || name === "--tick";
}

function rewritten(argv: string[], index: number, replacement: string): string {
  const next = [...argv];
  const current = next[index] ?? "";
  const eq = current.indexOf("=");
  next[index] = eq > 0 ? `${replacement}=${current.slice(eq + 1)}` : replacement;
  return `gtimed ${quote(next)}`;
}

function unknown(kind: string, token: string, suggestions: string[], argv: string[], index: number): string {
  if (!suggestions.length) {
    return `unknown ${kind} "${token}"\n${HELP_HINT}`;
  }
  const lines = [`unknown ${kind} "${token}"`, "Did you mean:"];
  for (const item of suggestions) {
    lines.push(`  ${rewritten(argv, index, item)}`);
  }
  return lines.join("\n");
}

/** Return an error message, or null if argv should run as-is. */
export function diagnose(argv: string[]): string | null {
  if (!argv.length) return null;
  const head = argv[0] ?? "";
  if (head === "__shim" || head === "__complete") return null;

  const slice = beforeDashDash(argv);

  for (let i = 0; i < slice.length; i++) {
    const token = slice[i] ?? "";
    if (token === "--when" || token.startsWith("--when=")) {
      const inline = token.startsWith("--when=") ? token.slice("--when=".length) : slice[i + 1];
      const valueIndex = token.startsWith("--when=") ? i : i + 1;
      if (!inline || inline.startsWith("--")) continue;
      if (isWhenSpec(inline)) continue;
      const hits = closeMatches(inline, WHEN_KEYWORDS);
      return unknown("condition", inline, hits, argv, valueIndex);
    }
  }

  for (let i = 0; i < slice.length; i++) {
    const token = slice[i] ?? "";
    if (!token.startsWith("--") || token === "--") continue;
    const name = token.split("=")[0] ?? token;
    if (knownOption(name)) continue;
    const hits = closeMatches(name, OPTIONS);
    if (hits.length) return unknown("option", name, hits, argv, i);
  }

  if (knownCommand(head)) return null;

  const commandHits = closeMatches(head, COMMANDS);
  if (commandHits.length) return unknown("command", head, commandHits, argv, 0);
  if (!argsHaveScheduleFlags(slice)) {
    return `unknown command "${head}"\n${HELP_HINT}`;
  }
  return null;
}
