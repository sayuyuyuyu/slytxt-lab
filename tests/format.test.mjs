import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, getYear } from "../src/lib/format.ts";

test("formatDate formats a date-only value as the same calendar day in JST", () => {
  // Frontmatter dates are parsed as UTC midnight; JST is UTC+9, so the
  // calendar day is unchanged.
  assert.equal(formatDate(new Date("2026-11-06T00:00:00Z")), "2026/11/06");
  assert.equal(formatDate(new Date("2026-01-01T00:00:00Z")), "2026/01/01");
});

test("formatDate uses the JST calendar day for timestamps near midnight UTC", () => {
  // 2026-01-01T15:30:00Z is 2026-01-02 00:30 in JST.
  assert.equal(formatDate(new Date("2026-01-01T15:30:00Z")), "2026/01/02");
  // 2026-01-01T14:59:00Z is still 2026-01-01 23:59 in JST.
  assert.equal(formatDate(new Date("2026-01-01T14:59:00Z")), "2026/01/01");
  // An explicit +09:00 timestamp keeps its JST day regardless of build TZ.
  assert.equal(formatDate(new Date("2026-11-06T00:30:00+09:00")), "2026/11/06");
});

test("getYear uses the JST year at the year boundary", () => {
  assert.equal(getYear(new Date("2026-06-15T00:00:00Z")), "2026");
  // 2025-12-31T15:30:00Z is already 2026-01-01 in JST.
  assert.equal(getYear(new Date("2025-12-31T15:30:00Z")), "2026");
  assert.equal(formatDate(new Date("2025-12-31T15:30:00Z")), "2026/01/01");
  // 2025-12-31T14:59:00Z is still 2025 in JST.
  assert.equal(getYear(new Date("2025-12-31T14:59:00Z")), "2025");
});
