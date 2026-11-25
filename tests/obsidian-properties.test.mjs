import assert from "node:assert/strict";
import test from "node:test";
import {
  missingProperties,
  normalizeTags
} from "../tools/obsidian-slytxt/src/lib/note-properties.ts";

const base = { defaultCategory: "comic" };

test("obsidian: 空のプロパティを本文から埋める", () => {
  const patch = missingProperties({
    ...base,
    frontmatter: null,
    body: "## ジャンプ感想\n\nあかね、もう最高だった。\n\n![](https://media.slytxt.dev/a.jpg)\n\n#漫画 #ジャンプ",
    inlineTags: ["漫画", "ジャンプ"]
  });
  assert.deepEqual(patch, {
    category: "comic",
    title: "ジャンプ感想",
    description: "あかね、もう最高だった。",
    tags: ["漫画", "ジャンプ"],
    cover: "https://media.slytxt.dev/a.jpg"
  });
});

test("obsidian: 既にある値には触らない", () => {
  const patch = missingProperties({
    ...base,
    frontmatter: {
      title: "自分で決めた題",
      category: "tech",
      description: "自分で書いた説明",
      tags: ["既存"],
      cover: "https://media.slytxt.dev/b.jpg"
    },
    body: "## 見出し\n\n本文。"
  });
  assert.deepEqual(patch, {});
});

test("obsidian: カテゴリが無い・不正なら既定値にする", () => {
  assert.equal(missingProperties({ ...base, frontmatter: {}, body: "本文。" }).category, "comic");
  assert.equal(
    missingProperties({ ...base, frontmatter: { category: "unknown" }, body: "本文。" }).category,
    "comic"
  );
  // 既に正しいカテゴリなら触らない。
  assert.equal(
    "category" in missingProperties({ ...base, frontmatter: { category: "tech" }, body: "本文。" }),
    false
  );
});

test("obsidian: misc はタイトルを作らない", () => {
  const patch = missingProperties({
    defaultCategory: "misc",
    frontmatter: null,
    body: "短いメモです。"
  });
  assert.equal("title" in patch, false);
  assert.equal(patch.category, "misc");
});

test("obsidian: 本文が空で公開の値も無ければ何もしない", () => {
  assert.deepEqual(missingProperties({ ...base, frontmatter: null, body: "  " }), {});
});

test("obsidian: タイトルに使った見出しは説明文から除く", () => {
  const patch = missingProperties({
    ...base,
    frontmatter: { title: "自分で決めた題" },
    body: "## 本文の見出し\n\n説明に使う本文。"
  });
  assert.equal(patch.description, "本文の見出し 説明に使う本文。");
});

test("obsidian: タグは配列・文字列のどちらでも正規化し、10件までにする", () => {
  assert.deepEqual(normalizeTags("漫画, ジャンプ 、#漫画"), ["漫画", "ジャンプ"]);
  assert.deepEqual(normalizeTags(["#a", " b ", ""]), ["a", "b"]);
  assert.equal(normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`)).length, 10);
  assert.deepEqual(normalizeTags(undefined), []);
});
