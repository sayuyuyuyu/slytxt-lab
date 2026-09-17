import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFrontmatter, stringifyFrontmatter } from "../tools/writer/frontmatter.mjs";
import { plainText, renderMarkdown } from "../tools/writer/markdown.mjs";
import { normalizeSlug } from "../tools/writer/publish.mjs";

test("frontmatter: 往復しても値が変わらない", () => {
  const data = {
    title: "技術メモ：長い見出し",
    description: "一覧に出す1文。",
    published: "2026-09-17",
    tags: ["Astro", "MCP", "長いタグ"],
    draft: false
  };
  const source = stringifyFrontmatter(data, "本文\n\n## 見出し\n");
  const parsed = parseFrontmatter(source);

  assert.equal(parsed.hasFrontmatter, true);
  assert.deepEqual(parsed.data, data);
  assert.equal(parsed.body, "本文\n\n## 見出し\n");
});

test("frontmatter: ブロック配列とクォートを読める", () => {
  const parsed = parseFrontmatter(
    '---\ntitle: "コロン: を含む"\nstatus: memo\ntags:\n  - Astro\n  - MCP\n---\n\n本文\n'
  );

  assert.equal(parsed.data.title, "コロン: を含む");
  assert.deepEqual(parsed.data.tags, ["Astro", "MCP"]);
  assert.equal(parsed.body, "本文\n");
});

test("frontmatter: 無いときは本文だけ返す", () => {
  const parsed = parseFrontmatter("# ただの本文\n");
  assert.equal(parsed.hasFrontmatter, false);
  assert.equal(parsed.body, "# ただの本文\n");
});

test("slug: 日本語や記号から作れないときは日付に落とす", () => {
  assert.equal(normalizeSlug("mcp-server-first-try"), "mcp-server-first-try");
  assert.equal(normalizeSlug("MCP Server First Try"), "mcp-server-first-try");
  assert.equal(normalizeSlug("--MCP---サーバー--"), "mcp");
  assert.equal(normalizeSlug("日本語だけ", "20260917"), "post-20260917");
  assert.equal(normalizeSlug("", "20260917"), "post-20260917");
});

test("markdown: 見出しと段落", () => {
  assert.equal(renderMarkdown("## 見出し"), "<h2>見出し</h2>");
  assert.equal(renderMarkdown("ただの文。"), "<p>ただの文。</p>");
});

test("markdown: 箇条書きと番号付きを混ぜない", () => {
  const html = renderMarkdown("1. 番号\n2. 番号2\n\n- 箇条書き\n- つぎ\n");
  assert.match(html, /<ol>\n<li>番号<\/li>\n<li>番号2<\/li>\n<\/ol>/);
  assert.match(html, /<ul>\n<li>箇条書き<\/li>\n<li>つぎ<\/li>\n<\/ul>/);
});

test("markdown: 入れ子のリスト", () => {
  const html = renderMarkdown("- 親\n  - 子\n");
  assert.match(html, /<li>親\n<ul>\n<li>子<\/li>\n<\/ul><\/li>/);
});

test("markdown: タスクリスト", () => {
  const html = renderMarkdown("- [ ] やること\n- [x] 済み\n");
  assert.match(html, /<input type="checkbox" disabled \/> やること/);
  assert.match(html, /<input type="checkbox" disabled checked \/> 済み/);
});

test("markdown: 表と右寄せ", () => {
  const html = renderMarkdown("| 項目 | 値 |\n| --- | ---: |\n| a | 1 |\n");
  assert.match(html, /<th>項目<\/th><th style="text-align:right">値<\/th>/);
  assert.match(html, /<td>a<\/td><td style="text-align:right">1<\/td>/);
});

test("markdown: コードブロックは中身を変換しない", () => {
  const html = renderMarkdown("```ts\nconst a = 1 < 2 && 3 > 2;\n```");
  assert.equal(
    html,
    '<pre><code class="language-ts">const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2;</code></pre>'
  );
});

test("markdown: インラインとエスケープ", () => {
  const html = renderMarkdown("**太字** と `code` と <script>alert(1)</script>");
  assert.match(html, /<strong>太字<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("markdown: リンクと画像", () => {
  const html = renderMarkdown("[リンク](https://example.com) と ![代替](/a.png)");
  assert.match(html, /<a href="https:\/\/example.com">リンク<\/a>/);
  assert.match(html, /<img src="\/a.png" alt="代替" \/>/);
});

test("markdown: 引用", () => {
  assert.equal(renderMarkdown("> 引用\n> 二行目\n"), "<blockquote>\n<p>引用\n二行目</p>\n</blockquote>");
});

test("frontmatter: 引用符とバックスラッシュを保存のたびに増やさない", () => {
  const data = {
    title: 'He said "hi"',
    windows: "C:\\Users\\slytxt",
    mixed: 'a\\b "c" だ'
  };
  const first = parseFrontmatter(stringifyFrontmatter(data, "本文\n"));
  assert.deepEqual(first.data, data);

  const second = parseFrontmatter(stringifyFrontmatter(first.data, first.body));
  assert.deepEqual(second.data, data);
});

test("frontmatter: 生の行を返す", () => {
  const parsed = parseFrontmatter("---\ntitle: タイトル\n# メモ\nslug: my-slug\n---\n\n本文\n");
  assert.deepEqual(parsed.raw, ["title: タイトル", "# メモ", "slug: my-slug"]);
});

test("markdown: 自動リンク", () => {
  assert.equal(
    renderMarkdown("<https://example.com>"),
    '<p><a href="https://example.com">https://example.com</a></p>'
  );
});

test("markdown: javascript: と data: のURLを無効にする", () => {
  assert.equal(renderMarkdown("[クリック](javascript:alert(1))"), "<p>クリック</p>");
  assert.doesNotMatch(renderMarkdown("![絵](data:text/html,boom)"), /<img/);
  assert.match(renderMarkdown("[ok](https://example.com)"), /<a href="https:\/\/example.com">ok<\/a>/);
});

test("markdown: URL の括弧を切らない", () => {
  assert.match(
    renderMarkdown("[w](https://en.wikipedia.org/wiki/Foo_(bar)) です"),
    /<a href="https:\/\/en.wikipedia.org\/wiki\/Foo_\(bar\)">w<\/a> です/
  );
});

test("drafts: 手で足したキーとコメントを消さない", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "slytxt-drafts-"));
  process.env.SLYTXT_DRAFTS_DIR = dir;
  const drafts = await import(`../tools/writer/drafts.mjs?case=carry-${Date.now()}`);

  await writeFile(
    path.join(dir, "sample.md"),
    '---\ntitle: 元のタイトル\ncategory: life\nstatus: memo\n# 作業メモ\nslug: my-slug\n---\n\n本文\n',
    "utf8"
  );

  const loaded = await drafts.readDraft("sample");
  assert.deepEqual(loaded.extras, ["# 作業メモ", "slug: my-slug"]);

  await drafts.writeDraft("sample", { body: "書き直した本文" });
  const saved = await readFile(path.join(dir, "sample.md"), "utf8");
  assert.match(saved, /# 作業メモ/);
  assert.match(saved, /slug: my-slug/);
  assert.match(saved, /書き直した本文/);
  assert.match(saved, /title: 元のタイトル/);
});

test("drafts: 同じタイトルを並行で作っても衝突しない", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "slytxt-drafts-"));
  process.env.SLYTXT_DRAFTS_DIR = dir;
  const drafts = await import(`../tools/writer/drafts.mjs?case=race-${Date.now()}`);

  const made = await Promise.all([
    drafts.createDraft({ title: "同じタイトル" }),
    drafts.createDraft({ title: "同じタイトル" }),
    drafts.createDraft({ title: "同じタイトル" })
  ]);

  assert.equal(new Set(made.map((draft) => draft.id)).size, 3);
  assert.equal((await drafts.listDrafts()).length, 3);
});

test("plainText: 記号を落として1行にする", () => {
  assert.equal(
    plainText("## 見出し\n\n本文 **強調** [リンク](https://x) です。\n\n```ts\ncode\n```"),
    "見出し 本文 強調 リンク です。"
  );
});
