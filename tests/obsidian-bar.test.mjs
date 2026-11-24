import assert from "node:assert/strict";
import test from "node:test";
import {
  addTags,
  barStateFromNote,
  frontmatterPatchFor,
  nextCategory,
  normalizeTags,
  parseTagInput,
  removeTag
} from "../tools/obsidian-slytxt/src/lib/bar.ts";

test("obsidian bar: frontmatter の tags は配列でもカンマ区切りでも読める", () => {
  assert.deepEqual(normalizeTags(["a", "b", "a", ""]), ["a", "b"]);
  assert.deepEqual(normalizeTags("a, b、c"), ["a", "b", "c"]);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.equal(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
});

test("obsidian bar: タグ入力はカンマでも空白でも受け付ける", () => {
  assert.deepEqual(parseTagInput("新しい,タグ"), ["新しい", "タグ"]);
  assert.deepEqual(parseTagInput("   "), []);
  assert.deepEqual(addTags(["a"], "a, b"), ["a", "b"]);
  assert.deepEqual(removeTag(["a", "b"], "a"), ["b"]);
});

test("obsidian bar: カテゴリのチップは並び順に巡回する", () => {
  assert.equal(nextCategory("tech"), "misc");
  assert.equal(nextCategory("anime"), "tech");
});

test("obsidian bar: 開いた時点で本文から決まる値が入る", () => {
  const body = "# 最初の見出し\n\n本文の書き出しです。\n\n![](https://media.slytxt.dev/a.jpg)\n";
  const state = barStateFromNote({}, body, "tech");
  assert.equal(state.category, "tech");
  assert.deepEqual(state.tags, []);
  assert.equal(state.title, "最初の見出し");
  assert.equal(state.description, "本文の書き出しです。");
  assert.equal(state.cover, "https://media.slytxt.dev/a.jpg");
  // misc はタイトルを持たないので空のまま（公開時の扱いと同じ）。
  assert.equal(barStateFromNote({ category: "misc" }, body, "tech").title, "");
});

test("obsidian bar: frontmatter の値があればそちらを優先する", () => {
  const state = barStateFromNote(
    {
      category: "comic",
      title: "与えた題名",
      description: "与えた説明",
      cover: "https://media.slytxt.dev/cover.jpg",
      tags: ["漫画"]
    },
    "![](https://media.slytxt.dev/body.jpg)\n",
    "misc"
  );
  assert.equal(state.category, "comic");
  assert.equal(state.title, "与えた題名");
  assert.equal(state.description, "与えた説明");
  assert.equal(state.cover, "https://media.slytxt.dev/cover.jpg");
  assert.deepEqual(state.tags, ["漫画"]);
});

test("obsidian bar: 不正なカテゴリは既定に落とし、カバーは URL のときだけ拾う", () => {
  const state = barStateFromNote(
    { category: "unknown", cover: "" },
    "![[local-image.png]]\n",
    "tech"
  );
  assert.equal(state.category, "tech");
  // Vault 内の画像はアップロードが要るので、バーの時点では空のまま。
  assert.equal(state.cover, "");
});

test("obsidian bar: frontmatter への書き戻しは管理キーだけ", () => {
  const patch = frontmatterPatchFor({
    category: "tech",
    tags: ["a"],
    cover: "",
    title: "題名",
    description: "説明"
  });
  // バーで編集できるのはカテゴリ・タグ・カバーだけ。タイトルと説明は
  // 公開時に本文から決まるので、frontmatter には書き戻さない。
  assert.deepEqual(patch, {
    category: "tech",
    tags: ["a"],
    cover: ""
  });
});
