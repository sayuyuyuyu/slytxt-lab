import assert from "node:assert/strict";
import test from "node:test";
import { wrapText } from "../src/lib/og-wrap.ts";

test("full-width titles keep the previous 17-character wrapping", () => {
  assert.deepEqual(wrapText("あ".repeat(40)), [
    "あ".repeat(17),
    "あ".repeat(17),
    "あ".repeat(6),
  ]);
});

test("full-width titles longer than three lines are truncated with an ellipsis", () => {
  const lines = wrapText("あ".repeat(60));
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "あ".repeat(16) + "…");
});

test("half-width titles fit more than 17 characters per line", () => {
  const lines = wrapText("Hello world this is a test title for open graph");
  assert.ok(lines.length >= 2);
  assert.ok(lines[0].length > 17);
});

test("wrapping does not split words when a space break is available", () => {
  const title = "Hello world this is a test title for open graph images";
  const lines = wrapText(title);
  assert.ok(lines.length <= 3);
  assert.equal(lines.join(" "), title);
});

test("a single word longer than one line still wraps by width", () => {
  const lines = wrapText("a".repeat(120));
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "a".repeat(34));
  assert.equal(lines[2], "a".repeat(32) + "…");
});
