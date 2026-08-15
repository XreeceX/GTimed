import assert from "node:assert/strict";
import test from "node:test";
import { formatWhen, minuteKey, parseDurationMs, parseWhen } from "./time.js";

test("parseDurationMs 30s", () => {
  assert.equal(parseDurationMs("30s"), 30_000);
});

test("parseDurationMs 30 sec", () => {
  assert.equal(parseDurationMs("30 sec"), 30_000);
});

test("parseDurationMs 5m", () => {
  assert.equal(parseDurationMs("5m"), 5 * 60_000);
});

test("parseDurationMs 5 minutes", () => {
  assert.equal(parseDurationMs("5 minutes"), 5 * 60_000);
});

test("parseDurationMs 2h", () => {
  assert.equal(parseDurationMs("2h"), 2 * 3_600_000);
});

test("parseDurationMs 2 hours", () => {
  assert.equal(parseDurationMs("2 hours"), 2 * 3_600_000);
});

test("parseDurationMs 1d", () => {
  assert.equal(parseDurationMs("1d"), 86_400_000);
});

test("parseDurationMs 1w", () => {
  assert.equal(parseDurationMs("1w"), 7 * 86_400_000);
});

test("parseDurationMs 1.5d", () => {
  assert.equal(parseDurationMs("1.5d"), 1.5 * 86_400_000);
});

test("parseDurationMs 0.1m is six seconds", () => {
  assert.equal(parseDurationMs("0.1m"), 6_000);
});

test("parseDurationMs .1m is six seconds not one minute", () => {
  assert.equal(parseDurationMs(".1m"), 6_000);
});

test("parseDurationMs 250ms", () => {
  assert.equal(parseDurationMs("250ms"), 250);
});

test("parseDurationMs trims whitespace", () => {
  assert.equal(parseDurationMs("  10m  "), 10 * 60_000);
});

test("parseDurationMs rejects empty", () => {
  assert.equal(parseDurationMs(""), null);
});

test("parseDurationMs rejects garbage", () => {
  assert.equal(parseDurationMs("nope"), null);
});

test("parseDurationMs rejects unit only", () => {
  assert.equal(parseDurationMs("m"), null);
});

test("parseWhen duration from a fixed now", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  assert.equal(parseWhen("45m", now).toISOString(), "2026-08-13T12:45:00.000Z");
});

test("parseWhen ISO timestamp", () => {
  const d = parseWhen("2026-08-14T09:00:00.000Z");
  assert.equal(d.toISOString(), "2026-08-14T09:00:00.000Z");
});

test("parseWhen throws on unparseable input", () => {
  assert.throws(() => parseWhen("not a time at all xyz"), /Could not parse time/);
});

test("parseWhen understands tomorrow 9am", () => {
  const now = new Date("2026-08-13T12:00:00");
  const d = parseWhen("tomorrow 9am", now);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 0);
});

test("formatWhen uses the given timezone, not a UTC Z suffix", () => {
  const d = new Date("2026-08-14T10:45:30.827Z");
  const london = formatWhen(d, "Europe/London");
  assert.match(london, /^2026-08-14 11:45:30 /);
  assert.doesNotMatch(london, /T10:45:30/);
  assert.doesNotMatch(london, /Z$/);
  assert.match(london, /BST|GMT\+1/);
  const utc = formatWhen(d, "UTC");
  assert.match(utc, /^2026-08-14 10:45:30 /);
  assert.match(utc, /UTC|GMT$/);
});

test("formatWhen accepts an ISO string and follows the machine timezone by default", () => {
  const iso = "2026-08-14T10:45:30.827Z";
  const text = formatWhen(iso);
  assert.match(text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S/);
  assert.doesNotMatch(text, /T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  assert.equal(text, formatWhen(new Date(iso)));
});

test("minuteKey zeros seconds and ms", () => {
  const d = new Date("2026-08-14T10:45:30.827Z");
  assert.match(minuteKey(d), /T10:45:00\.000Z$/);
});
