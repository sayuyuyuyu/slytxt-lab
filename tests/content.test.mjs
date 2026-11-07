import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdjacentArticles,
  getEntriesByTag,
  getEntryDescription,
  getEntryDisplayTitle,
  getEntryPreview,
  toPlainText,
} from "../src/lib/entries.ts";

function entry(overrides = {}) {
  return {
    id: "2026-01-01-memo.md",
    collection: "notes",
    body: "",
    data: { title: "", description: undefined, tags: [] },
    ...overrides,
  };
}

test("display title uses the explicit title when present", () => {
  const e = entry({ data: { title: " 付けたタイトル ", tags: [] }, body: "本文の書き出し" });
  assert.equal(getEntryDisplayTitle(e), "付けたタイトル");
});

test("display title falls back to the body preview when title is empty", () => {
  const e = entry({ body: "本文の書き出しです\n次の行" });
  assert.equal(getEntryDisplayTitle(e), "本文の書き出しです 次の行");
});

test("display title is （無題） for an empty body and for an embed-only body", () => {
  assert.equal(getEntryDisplayTitle(entry({ body: "" })), "（無題）");
  assert.equal(getEntryDisplayTitle(entry({ body: undefined })), "（無題）");
  assert.equal(
    getEntryDisplayTitle(entry({ body: "https://www.youtube.com/watch?v=abc" })),
    "（無題）",
  );
  assert.equal(
    getEntryDisplayTitle(entry({ body: "<https://example.com/page>" })),
    "（無題）",
  );
  assert.equal(
    getEntryDisplayTitle(
      entry({ body: "[https://example.com/page](https://example.com/page)" }),
    ),
    "（無題）",
  );
});

test("preview skips embed-only lines and uses only the first three text lines", () => {
  const e = entry({
    body: "https://www.youtube.com/watch?v=abc\n1行目\n2行目\n3行目\n4行目",
  });
  assert.equal(getEntryPreview(e), "1行目 2行目 3行目");
  assert.equal(getEntryPreview(entry({ body: "" })), "");
  assert.equal(
    getEntryPreview(entry({ body: "https://example.com/only" })),
    "",
  );
});

test("preview truncation is by code point and adds an ellipsis only when cut", () => {
  const exact = "あ".repeat(90);
  assert.equal(getEntryPreview(entry({ body: exact })), exact);
  const over = "あ".repeat(91);
  assert.equal(getEntryPreview(entry({ body: over })), `${"あ".repeat(90)}…`);
  // An emoji at the boundary must not be split into a lone surrogate.
  const emojiBody = `${"a".repeat(89)}😀${"b".repeat(10)}`;
  assert.equal(
    getEntryPreview(entry({ body: emojiBody })),
    `${"a".repeat(89)}😀…`,
  );
  assert.equal(getEntryPreview(entry({ body: "abcdef" }), 3), "abc…");
  assert.equal(getEntryPreview(entry({ body: "abc" }), 3), "abc");
});

test("description uses an explicit description that differs from the display title", () => {
  const e = entry({
    data: { title: "タイトル", description: "説明文です", tags: [] },
    body: "本文",
  });
  assert.equal(getEntryDescription(e), "説明文です");
});

test("description falls back when the explicit description equals the display title", () => {
  const sameAsTitle = entry({
    data: { title: "タイトル", description: "タイトル", tags: [] },
    body: "本文の書き出しで、タイトルとは別の文",
  });
  assert.equal(
    getEntryDescription(sameAsTitle),
    "本文の書き出しで、タイトルとは別の文",
  );
  // Title-less entry whose preview is the display title: preview must not
  // be reused as the description.
  const titleFromBody = entry({ body: "短いメモ" });
  assert.equal(getEntryDisplayTitle(titleFromBody), "短いメモ");
  assert.equal(getEntryDescription(titleFromBody), undefined);
  const empty = entry({ body: "" });
  assert.equal(getEntryDescription(empty), undefined);
});

test("toPlainText strips markdown, html and embed-only lines", () => {
  assert.equal(
    toPlainText("# 見出し\n**太字**と[リンク](https://example.com)と`code`"),
    "見出し 太字とリンクとcode",
  );
  assert.equal(toPlainText("前\n```\ncode block\n```\n後"), "前 後");
  assert.equal(toPlainText("行1<br />行2"), "行1 行2");
  assert.equal(toPlainText("https://example.com/embed\n残る文"), "残る文");
  assert.equal(toPlainText(""), "");
});

test("adjacent articles at the edges, in the middle, and for a single entry", () => {
  const a = entry({ id: "a" });
  const b = entry({ id: "b" });
  const c = entry({ id: "c" });
  const list = [a, b, c];
  assert.deepEqual(getAdjacentArticles(list, "a"), {
    previous: undefined,
    next: b,
  });
  assert.deepEqual(getAdjacentArticles(list, "b"), { previous: a, next: c });
  assert.deepEqual(getAdjacentArticles(list, "c"), {
    previous: b,
    next: undefined,
  });
  assert.deepEqual(getAdjacentArticles([a], "a"), {
    previous: undefined,
    next: undefined,
  });
  assert.deepEqual(getAdjacentArticles(list, "missing"), {
    previous: undefined,
    next: undefined,
  });
  assert.deepEqual(getAdjacentArticles([], "a"), {
    previous: undefined,
    next: undefined,
  });
});

test("entries by tag matches on the slugified tag", () => {
  const cpp = entry({
    id: "cpp",
    data: { title: "", tags: ["C++"] },
  });
  const journal = entry({
    id: "journal",
    data: { title: "", tags: ["ジャンプ感想"] },
  });
  const other = entry({ id: "other", data: { title: "", tags: ["C"] } });
  const all = [cpp, journal, other];
  assert.deepEqual(getEntriesByTag(all, "cplusplus"), [cpp]);
  assert.deepEqual(getEntriesByTag(all, "ジャンプ感想"), [journal]);
  assert.deepEqual(getEntriesByTag(all, "c"), [other]);
  assert.deepEqual(getEntriesByTag(all, "missing"), []);
});
