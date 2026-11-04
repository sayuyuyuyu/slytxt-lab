import assert from "node:assert/strict";
import test from "node:test";
import { collectTags, slugifyTag, tagPath } from "../src/lib/tags.ts";

test("existing public tag keeps its URL", () => {
  assert.equal(slugifyTag("ジャンプ感想"), "ジャンプ感想");
  assert.equal(tagPath("ジャンプ感想"), "/tags/ジャンプ感想/");
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
  assert.equal(tagPath("!!!"), "/tags/~21~~21~~21~/");
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
