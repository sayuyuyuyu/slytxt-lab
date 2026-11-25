import assert from "node:assert/strict";
import test from "node:test";
import { collectTags, slugifyTag, tagCounts, tagFilterPath } from "../src/lib/tags.ts";

test("タグの絞り込み URL は一覧と slug で決まる", () => {
  assert.equal(slugifyTag("ジャンプ感想"), "ジャンプ感想");
  assert.equal(tagFilterPath("/articles", "ジャンプ感想"), "/articles/?tag=%E3%82%B8%E3%83%A3%E3%83%B3%E3%83%97%E6%84%9F%E6%83%B3");
  assert.equal(tagFilterPath("/projects/", "hello world"), "/projects/?tag=hello-world");
  assert.equal(slugifyTag("hello world"), "hello-world");
});

test("tags that differ only in symbols get different slugs", () => {
  assert.equal(slugifyTag("C++"), "cplusplus");
  assert.equal(slugifyTag("C#"), "csharp");
  assert.equal(slugifyTag("C"), "c");
  assert.equal(slugifyTag(".NET"), "dotnet");
  assert.equal(slugifyTag("NET"), "net");
  assert.equal(slugifyTag("Node.js"), "nodejs");
});

test("symbol-only tags do not produce an empty slug", () => {
  assert.notEqual(slugifyTag("!!!"), "");
  assert.equal(tagFilterPath("/articles", "!!!"), "/articles/?tag=~21~~21~~21~");
});

test("collectTags keeps symbol-differing tags separate and skips empty tags", () => {
  const entries = [
    { data: { tags: ["C++", ""] } },
    { data: { tags: ["C#", "   "] } },
    { data: { tags: ["!!!"] } },
  ];
  const tags = collectTags(entries);
  assert.equal(tags.size, 3);
  assert.equal(tags.get("cplusplus"), "C++");
  assert.equal(tags.get("csharp"), "C#");
  assert.equal(tags.get("~21~~21~~21~"), "!!!");
});

test("tagCounts counts each entry once per tag and sorts by count", () => {
  const entries = [
    { data: { tags: ["漫画", "漫画", "技術"] } },
    { data: { tags: ["漫画"] } },
    { data: { tags: ["技術"] } },
  ];
  // 同じ件数は日本語の照合順（技術 → 漫画）。
  assert.deepEqual(tagCounts(entries), [
    { slug: "技術", label: "技術", count: 2 },
    { slug: "漫画", label: "漫画", count: 2 },
  ]);
});
