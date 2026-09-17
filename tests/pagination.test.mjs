import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateEntries,
  pageCount,
  pagePath,
  visiblePages,
} from "../src/lib/pagination.ts";

test("empty collections still have a valid first page", () => {
  assert.deepEqual(paginateEntries([], "/tech"), {
    entries: [],
    totalEntries: 0,
    currentPage: 1,
    totalPages: 1,
    prevUrl: undefined,
    nextUrl: undefined,
  });
});
test("page boundaries preserve every entry and canonical first-page links", () => {
  const entries = Array.from({ length: 21 }, (_, index) => index);
  const pages = [1, 2, 3].map((page) =>
    paginateEntries(entries, "/tech", page),
  );
  assert.deepEqual(
    pages.flatMap((page) => page.entries),
    entries,
  );
  assert.equal(pages[1].prevUrl, "/tech/");
  assert.equal(pages[2].nextUrl, undefined);
  assert.equal(pages[0].nextUrl, "/tech/page/2/");
  assert.equal(pagePath("/life", 1), "/life/");
  assert.equal(pageCount(10), 1);
});
test("out-of-range inputs are clamped and invalid sizes rejected", () => {
  assert.equal(paginateEntries([1, 2], "/tech", 100, 1).currentPage, 2);
  assert.equal(paginateEntries([1, 2], "/tech", -10, 1).currentPage, 1);
  assert.equal(paginateEntries([1, 2], "/tech", NaN, 1).currentPage, 1);
  assert.throws(() => paginateEntries([], "/tech", 1, 0), RangeError);
});
test("large archives keep current and boundary pages visible with bounded navigation", () => {
  for (let current = 1; current <= 200; current++) {
    const pages = visiblePages(current, 200);
    assert.ok(pages.includes(current));
    assert.equal(pages[0], 1);
    assert.equal(pages.at(-1), 200);
    assert.ok(pages.length <= 7);
    assert.equal(
      new Set(pages.filter((p) => p !== "gap")).size,
      pages.filter((p) => p !== "gap").length,
    );
  }
});
