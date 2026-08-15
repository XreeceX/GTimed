import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type Chrono = typeof import("chrono-node");
let chrono: Chrono | undefined;

function parseNaturalDate(input: string, now: Date): Date | null {
  chrono ??= require("chrono-node") as Chrono;
  return chrono.parseDate(input, now, { forwardDate: true });
}

const DURATION = /^(\d*\.?\d+)\s*(ms|s|m|h|d|w|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)$/i;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

export function parseDurationMs(input: string): number | null {
  const trimmed = input.trim();
  const match = DURATION.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  return n * (UNIT_MS[unit] ?? 0);
}

export function parseWhen(input: string, now = new Date()): Date {
  const duration = parseDurationMs(input);
  if (duration != null) {
    return new Date(now.getTime() + duration);
  }

  const iso = Date.parse(input);
  if (!Number.isNaN(iso) && looksLikeAbsoluteDate(input)) {
    return new Date(iso);
  }

  const parsed = parseNaturalDate(input, now);
  if (!parsed) {
    throw new Error(
      `Could not parse time "${input}". Try ISO (2026-08-14T09:00), "tomorrow 5pm", or a duration like 30m / 2h.`,
    );
  }
  return parsed;
}

function looksLikeAbsoluteDate(input: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(input) || /T\d{2}:/.test(input);
}

const WHEN_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
};

const whenFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = whenFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", { ...WHEN_FORMAT, timeZone });
    whenFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function pad2(value: string): string {
  return value.length === 1 ? `0${value}` : value;
}

/** Print a stored instant in the user's local timezone (or `timeZone` in tests). */
export function formatWhen(input: Date | string, timeZone?: string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const bag: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of formatterFor(tz).formatToParts(date)) {
    bag[p.type] = p.value;
  }
  return `${bag.year}-${pad2(bag.month ?? "")}-${pad2(bag.day ?? "")} ${pad2(bag.hour ?? "")}:${pad2(bag.minute ?? "")}:${pad2(bag.second ?? "")} ${bag.timeZoneName || tz}`;
}

export function minuteKey(date = new Date()): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}
