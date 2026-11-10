import assert from "node:assert/strict";
import test from "node:test";
import { createDraftStore, normalizeDraft } from "../tools/writer-cloudflare/src/drafts-kv.mjs";
import { parseFrontmatter, stringifyFrontmatter } from "../tools/writer-cloudflare/src/frontmatter.mjs";
import {
  loneEmbedUrls,
  plainText,
  renderMarkdown,
  renderPreviewMarkdown,
  truncateText
} from "../tools/writer-cloudflare/src/markdown.mjs";
import {
  deriveDescription,
  normalizeSlug,
  publicUrl,
  publishPost,
  publishStatus
} from "../tools/writer-cloudflare/src/publish.mjs";
import {
  mediaStatus,
  publishMedia,
  serveDraftMedia,
  uploadMedia
} from "../tools/writer-cloudflare/src/media.mjs";
import { cleanSummary, generateSummary, summaryConfig } from "../tools/writer-cloudflare/src/summary.mjs";
import { listPublished, openPublished } from "../tools/writer-cloudflare/src/published.mjs";
import {
  drivePendingPublishes,
  listPublishResults
} from "../tools/writer-cloudflare/src/driver.mjs";
import writerWorker from "../tools/writer-cloudflare/src/index.mjs";
import { today } from "../tools/writer-cloudflare/src/date.mjs";

/**
 * drafts-kv のテスト用に、Cloudflare KV の最小インターフェースを
 * メモリ上で再現する（get / put / delete / list）。
 */
function memoryKv() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...map.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    }
  };
}

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

test("publish: 公開 URL はサイト側のパスに対応する", () => {
  assert.equal(publicUrl("notes", "my-note"), "https://slytxt.dev/notes/my-note/");
  assert.equal(publicUrl("tech", "my-post"), "https://slytxt.dev/articles/tech/my-post/");
  assert.equal(publicUrl("journal", "my-post"), "https://slytxt.dev/articles/journal/my-post/");
  assert.equal(publicUrl("projects", "my-post"), "");
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

test("preview: YouTube の単独 URL は埋め込みになる", () => {
  const html = renderPreviewMarkdown("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.match(
    html,
    /<div class="embed embed--youtube"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/
  );
  const short = renderPreviewMarkdown("<https://youtu.be/dQw4w9WgXcQ>");
  assert.match(short, /embed\/dQw4w9WgXcQ/);
});

test("preview: Spotify はロケール付き URL でも埋め込みになり、高さが種別で変わる", () => {
  const track = renderPreviewMarkdown(
    "https://open.spotify.com/intl-ja/track/5oCptG3RbPTbXKFpVjUgmw?si=abc123"
  );
  assert.match(
    track,
    /<div class="embed embed--spotify"><iframe src="https:\/\/open\.spotify\.com\/embed\/track\/5oCptG3RbPTbXKFpVjUgmw"[^>]*height="152"/
  );
  const album = renderPreviewMarkdown("https://open.spotify.com/album/0sNOF9WDwhWunNAHPD3Baj");
  assert.match(album, /embed\/album\/0sNOF9WDwhWunNAHPD3Baj"[^>]*height="352"/);
});

test("preview: X のポスト URL は公式ウィジェット用の blockquote になる", () => {
  const html = renderPreviewMarkdown("https://x.com/slytxt/status/1234567890123456789");
  assert.match(
    html,
    /<div class="embed embed--x"><blockquote class="twitter-tweet" data-dnt="true"><a href="https:\/\/x\.com\/slytxt\/status\/1234567890123456789">/
  );
});

test("preview: 一般 URL はタイトル＝URL のリンクカードになる", () => {
  const html = renderPreviewMarkdown("https://example.com/some/page?a=1&b=2");
  assert.match(html, /<a class="link-card" href="https:\/\/example\.com\/some\/page\?a=1&amp;b=2"/);
  assert.match(html, /<span class="link-card__host">example\.com<\/span>/);
});

test("preview: 文中の URL や別ラベルのリンクは埋め込みにしない", () => {
  const inText = renderPreviewMarkdown("これ https://www.youtube.com/watch?v=dQw4w9WgXcQ 見て");
  assert.doesNotMatch(inText, /embed--youtube/);
  const labeled = renderPreviewMarkdown("[動画](https://www.youtube.com/watch?v=dQw4w9WgXcQ)");
  assert.doesNotMatch(labeled, /embed--youtube/);
  assert.match(labeled, /<a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ">動画<\/a>/);
});

test("preview: キャプション付きの単独画像は figure になる", () => {
  const html = renderPreviewMarkdown('![代替テキスト](https://example.com/a.png "説明文です")');
  assert.equal(
    html,
    '<figure><img src="https://example.com/a.png" alt="代替テキスト" /><figcaption>説明文です</figcaption></figure>'
  );
  const noCaption = renderPreviewMarkdown("![代替テキスト](https://example.com/a.png)");
  assert.match(noCaption, /<p><img src="https:\/\/example\.com\/a\.png" alt="代替テキスト" \/><\/p>/);
  const inText = renderPreviewMarkdown('前 ![代替テキスト](https://example.com/a.png "説明文です") 後');
  assert.doesNotMatch(inText, /<figure>/);
});

test("preview: <br /> だけの行は文字列ではなく改行になる", () => {
  const html = renderPreviewMarkdown("前\n\n<br />\n\n後");
  assert.match(html, /<p>前<\/p>\n<br \/>\n<p>後<\/p>/);
  assert.doesNotMatch(html, /&lt;br/);
});

test("preview: 行末のバックスラッシュは強制改行になる", () => {
  const html = renderPreviewMarkdown("1行目\\\n2行目");
  assert.match(html, /<p>1行目<br \/>\n2行目<\/p>/);
  // エスケープされた \\ は改行にしない。
  const escaped = renderPreviewMarkdown("末尾\\\\\n次");
  assert.doesNotMatch(escaped, /<br \/>/);
});

test("preview: 実例の組み合わせ（見出し・<br />・Spotify の autolink）", () => {
  const body = [
    "## Challenger",
    "",
    "<br />",
    "",
    "<https://open.spotify.com/track/5oCptG3RbPTbXKFpVjUgmw?si=abc&utm_source=copy-link>",
    "",
    "感想。\\",
    "続き"
  ].join("\n");
  const html = renderPreviewMarkdown(body);
  assert.match(html, /<h2>Challenger<\/h2>/);
  assert.match(
    html,
    /<div class="embed embed--spotify"><iframe src="https:\/\/open\.spotify\.com\/embed\/track\/5oCptG3RbPTbXKFpVjUgmw"/
  );
  assert.match(html, /感想。<br \/>\n続き/);
});

test("markdown: loneEmbedUrls は単独段落の埋め込み対象だけを拾う", () => {
  const found = loneEmbedUrls(
    [
      "## 見出し",
      "",
      "<https://open.spotify.com/track/5oCptG3RbPTbXKFpVjUgmw?si=x>",
      "",
      "https://example.com/page",
      "",
      "文中の https://www.youtube.com/watch?v=dQw4w9WgXcQ は対象外",
      "",
      "https://x.com/slytxt/status/1234567890123456789"
    ].join("\n")
  );
  assert.deepEqual(
    found.map((item) => item.type),
    ["spotify", "x"]
  );
  assert.deepEqual(loneEmbedUrls("ただの文章\n\nhttps://example.com/page"), []);
});

test("drafts: 手で足したキーとコメントを消さない", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  kv.map.set(
    "draft:sample",
    '---\ntitle: 元のタイトル\ncategory: life\n# 作業メモ\nmemo: あとで書く\nslug: my-slug\n---\n\n本文\n'
  );

  const loaded = await store.readDraft("sample");
  assert.deepEqual(loaded.extras, ["# 作業メモ", "memo: あとで書く"]);
  assert.equal(loaded.slug, "my-slug");

  await store.writeDraft("sample", { body: "書き直した本文" });
  const saved = kv.map.get("draft:sample");
  assert.match(saved, /# 作業メモ/);
  assert.match(saved, /memo: あとで書く/);
  assert.match(saved, /slug: my-slug/);
  assert.match(saved, /書き直した本文/);
  assert.match(saved, /title: 元のタイトル/);
});

test("drafts: 同じタイトルで作り続けても衝突しない", async () => {
  // KV には排他作成が無いため、並行作成の衝突回避は保証されない
  // （drafts-kv.mjs のコメント参照）。ここでは順に作った場合の採番を見る。
  const store = createDraftStore(memoryKv());

  const made = [];
  for (let i = 0; i < 3; i += 1) {
    made.push(await store.createDraft({ title: "同じタイトル" }));
  }

  assert.equal(new Set(made.map((draft) => draft.id)).size, 3);
  assert.equal((await store.listDrafts()).length, 3);
});

test("date: today は Asia/Tokyo の日付を返し、UTC の前日にならない", () => {
  // JST 2026-01-01 00:30 は UTC では 2025-12-31 15:30。toISOString だと前日になる境界。
  assert.equal(today(new Date("2026-01-01T00:30:00+09:00")), "2026-01-01");
  assert.equal(today(new Date("2025-12-31T23:30:00+09:00")), "2025-12-31");
});

test("drafts: 新規作成の id は JST の今日から始まる", async () => {
  const store = createDraftStore(memoryKv());
  const draft = await store.createDraft({ title: "日付確認" });
  assert.ok(draft.id.startsWith(`${today()}-`), `id=${draft.id} today=${today()}`);
});

test("drafts: 削除した id は再利用できる", async () => {
  const store = createDraftStore(memoryKv());

  const first = await store.createDraft({ title: "同じタイトル" });
  await store.writeDraft(first.id, { body: "前のメモ" });
  await store.deleteDraft(first.id);

  const second = await store.createDraft({ title: "同じタイトル" });
  assert.equal(second.id, first.id);
  assert.equal(second.body, "");
});

test("plainText: 記号を落として1行にする", () => {
  assert.equal(
    plainText("## 見出し\n\n本文 **強調** [リンク](https://x) です。\n\n```ts\ncode\n```"),
    "見出し 本文 強調 リンク です。"
  );
});

test("plainText: 埋め込みになる単独 URL 行を落とす", () => {
  assert.equal(
    plainText("https://open.spotify.com/track/abc123\n\n次のテキストです。"),
    "次のテキストです。"
  );
  assert.equal(plainText("<https://example.com/a>\n\n本文です。"), "本文です。");
  assert.equal(
    plainText("[https://example.com/a](https://example.com/a)\n\n本文です。"),
    "本文です。"
  );
  assert.equal(plainText("https://open.spotify.com/track/abc123"), "");
  // 文中の URL は行として単独でないので残す。
  assert.equal(plainText("見て https://example.com/a これ"), "見て https://example.com/a これ");
});

test("plainText: 生の HTML タグを落とす", () => {
  assert.equal(
    plainText("1行目です。\n\n<br />\n\n2行目です。<br>続き。"),
    "1行目です。 2行目です。 続き。"
  );
});

test("drafts: 存在しないドラフトを保存で作り直さない", async () => {
  const store = createDraftStore(memoryKv());

  await assert.rejects(
    () => store.writeDraft("missing", { body: "よみがえらないでほしい" }),
    /ありません/
  );
  assert.deepEqual(await store.listDrafts(), []);
});

test("description: 本文の書き出しから最小限だけ作る", () => {
  assert.equal(deriveDescription("## 見出し\n\n本文の1行目。\n2行目。"), "本文の1行目。 2行目。");
  assert.equal(deriveDescription(""), "");
  const long = deriveDescription("あ".repeat(200));
  assert.equal(long.length, 90);
  assert.ok(long.endsWith("…"));
});

test("description: <br /> が文字列として残らない", () => {
  const body = "皆さま、これが本文です。\n\n<br />\n\n次の段落です。";
  const description = deriveDescription(body);
  assert.equal(description, "皆さま、これが本文です。 次の段落です。");
  assert.ok(!description.includes("<"));
});

test("description: 長い本文は文の途中で切らない", () => {
  const body =
    "一文目は短いです。二文目は少し長くして、全体が制限の九十字を超えるように調整します。三文目も同じくらいの長さで続きますが、ここで制限に届くはずです。四文目は制限の外にあるので、抜粋には含まれません。";
  const description = deriveDescription(body);
  assert.ok(description.length <= 90);
  assert.ok(description.endsWith("。"), description);
  assert.ok(!description.includes("四文目"), description);
});

test("description: 埋め込みの単独 URL 行は含めない", () => {
  const body = "動画を見た。\n\nhttps://www.youtube.com/watch?v=example\n\n面白かった。";
  assert.equal(deriveDescription(body), "動画を見た。 面白かった。");
});

test("truncate: 絵文字をコードポイント単位で切り、分断しない", () => {
  assert.equal(truncateText("あ😀い", 2), "あ😀");
  assert.equal(truncateText("😀".repeat(5), 3), "😀".repeat(3));
  assert.equal(truncateText("短い", 10), "短い");
});

test("description: 境界の絵文字を分断しない", () => {
  const body = `${"😀".repeat(50)}。${"あ".repeat(100)}`;
  assert.equal(deriveDescription(body), `${"😀".repeat(50)}。`);
});

test("summary: 絵文字をコードポイント単位で切り詰める", () => {
  const cleaned = cleanSummary("😀".repeat(250));
  assert.equal(cleaned, "😀".repeat(200));
  assert.equal(Array.from(cleaned).length, 200);
});

test("drafts: 一覧の excerpt が絵文字を分断しない", async () => {
  const store = createDraftStore(memoryKv());
  const draft = await store.createDraft({ title: "絵文字確認" });
  await store.writeDraft(draft.id, { body: "😀".repeat(150) });
  const [listed] = await store.listDrafts();
  assert.equal(listed.excerpt, "😀".repeat(120));
});

test("drafts: 旧 life は journal として読む", () => {
  assert.equal(normalizeDraft("x", { category: "life" }, "").category, "journal");
  assert.equal(normalizeDraft("y", { category: "notes" }, "").category, "notes");
});

test("drafts: 見出し画像（cover）が往復し、空にすると消える", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const draft = await store.createDraft({ title: "カバー確認" });

  await store.writeDraft(draft.id, { cover: "https://slytxt.dev/media/abc.png" });
  const loaded = await store.readDraft(draft.id);
  assert.equal(loaded.cover, "https://slytxt.dev/media/abc.png");
  assert.match(kv.map.get(`draft:${draft.id}`), /cover: "https:\/\/slytxt\.dev\/media\/abc\.png"/);

  await store.writeDraft(draft.id, { cover: "" });
  assert.equal((await store.readDraft(draft.id)).cover, "");
  assert.doesNotMatch(kv.map.get(`draft:${draft.id}`), /cover:/);
});

/**
 * GitHub REST API の最小フェイク（冪等フローの検証用）。
 * global fetch を差し替えて使い、PR の実状態（open / ci / BEHIND / merged /
 * closed）をテスト側で操作できるようにする。マージは mergeable_state が
 * "behind" の間は 405 で失敗させ、ruleset（最新化必須）の挙動を再現する。
 */
function fakeGitHub() {
  const state = {
    mainSha: "main-sha-0",
    mainFiles: new Map(),
    branches: new Map(),
    branchFiles: new Map(),
    pulls: [],
    checks: new Map(),
    calls: [],
    nextPr: 1,
    updateCount: 0,
    updateBranchFails: false,
    mergeSabotageBehindOnce: false
  };
  const respond = (status, body) =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body ?? {}), {
          status,
          headers: { "content-type": "application/json" }
        });
  const prView = (pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: pr.merged,
    mergeable: pr.mergeable_state === "dirty" ? false : true,
    mergeable_state: pr.mergeable_state,
    html_url: `https://github.com/sayuyuyuyu/slytxt-lab/pull/${pr.number}`,
    head: { ref: pr.headRef, sha: pr.headSha }
  });

  async function fetchStub(url, options = {}) {
    const method = options.method ?? "GET";
    const target = new URL(url);
    const path = target.pathname.replace("/repos/sayuyuyuyu/slytxt-lab", "");
    state.calls.push(`${method} ${path}`);
    const body = options.body ? JSON.parse(options.body) : {};

    if (path === "/git/ref/heads/main" && method === "GET") {
      return respond(200, { object: { sha: state.mainSha } });
    }
    if (path.startsWith("/git/ref/heads/") && method === "GET") {
      const branch = path.slice("/git/ref/heads/".length);
      return state.branches.has(branch)
        ? respond(200, { object: { sha: state.branches.get(branch) } })
        : respond(404, { message: "Not Found" });
    }
    if (path === "/git/refs" && method === "POST") {
      const branch = body.ref.replace("refs/heads/", "");
      state.branches.set(branch, body.sha);
      return respond(201, { ref: body.ref });
    }
    if (path.startsWith("/git/refs/heads/") && method === "DELETE") {
      const branch = path.slice("/git/refs/heads/".length);
      state.branches.delete(branch);
      return respond(204, null);
    }
    if (path.startsWith("/contents/") && method === "GET") {
      const file = decodeURIComponent(path.slice("/contents/".length));
      const ref = target.searchParams.get("ref");
      const found =
        ref === "main"
          ? state.mainFiles.has(file)
          : state.branchFiles.has(`${ref}:${file}`);
      const stored =
        ref === "main"
          ? state.mainFiles.get(file)
          : state.branchFiles.get(`${ref}:${file}`);
      if (!found && ref === "main") {
        // ディレクトリ指定は直下のエントリ一覧を返す（実 API の Contents 挙動）。
        const prefix = `${file}/`;
        const children = new Map();
        for (const key of state.mainFiles.keys()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const [name, ...deeper] = rest.split("/");
          if (!children.has(name)) {
            children.set(name, {
              name,
              path: `${prefix}${name}`,
              type: deeper.length ? "dir" : "file"
            });
          }
        }
        if (children.size > 0) return respond(200, [...children.values()]);
      }
      return found
        ? respond(200, { sha: `blob-${file}`, path: file, content: stored ?? "" })
        : respond(404, { message: "Not Found" });
    }
    if (path.startsWith("/contents/") && method === "PUT") {
      const file = decodeURIComponent(path.slice("/contents/".length));
      state.branchFiles.set(`${body.branch}:${file}`, body.content);
      return respond(201, { content: { sha: `blob-${file}` } });
    }
    if (path === "/pulls" && method === "POST") {
      const pr = {
        number: state.nextPr,
        title: body.title,
        headRef: body.head,
        headSha: state.branches.get(body.head) ?? "branch-sha",
        state: "open",
        merged: false,
        mergeable_state: "clean"
      };
      state.nextPr += 1;
      state.pulls.push(pr);
      return respond(201, prView(pr));
    }
    if (path === "/pulls" && method === "GET") {
      const head = target.searchParams.get("head")?.split(":")[1];
      const wanted = target.searchParams.get("state") ?? "open";
      const list = state.pulls
        .filter((pr) => pr.headRef === head)
        .filter((pr) => wanted === "all" || pr.state === wanted)
        .sort((a, b) => b.number - a.number)
        .map(prView);
      return respond(200, list);
    }
    const pullMatch = path.match(/^\/pulls\/(\d+)$/);
    if (pullMatch && method === "GET") {
      const pr = state.pulls.find((entry) => entry.number === Number(pullMatch[1]));
      return pr ? respond(200, prView(pr)) : respond(404, { message: "Not Found" });
    }
    const updateMatch = path.match(/^\/pulls\/(\d+)\/update-branch$/);
    if (updateMatch && method === "PUT") {
      if (state.updateBranchFails) {
        return respond(422, { message: "Cannot update branch" });
      }
      const pr = state.pulls.find((entry) => entry.number === Number(updateMatch[1]));
      state.updateCount += 1;
      pr.headSha = `updated-sha-${pr.number}-${state.updateCount}`;
      pr.mergeable_state = "clean";
      return respond(202, { message: "Updating branch" });
    }
    const mergeMatch = path.match(/^\/pulls\/(\d+)\/merge$/);
    if (mergeMatch && method === "PUT") {
      const pr = state.pulls.find((entry) => entry.number === Number(mergeMatch[1]));
      if (state.mergeSabotageBehindOnce) {
        state.mergeSabotageBehindOnce = false;
        pr.mergeable_state = "behind";
        return respond(405, { message: "Pull Request is not mergeable" });
      }
      if (pr.mergeable_state === "behind" || pr.mergeable_state === "dirty") {
        return respond(405, { message: "Pull Request is not mergeable" });
      }
      pr.merged = true;
      pr.state = "closed";
      state.mainSha = `main-after-${pr.number}`;
      for (const key of [...state.branchFiles.keys()]) {
        if (key.startsWith(`${pr.headRef}:`)) {
          state.mainFiles.set(key.slice(pr.headRef.length + 1), state.branchFiles.get(key));
          state.branchFiles.delete(key);
        }
      }
      return respond(200, { merged: true, sha: state.mainSha });
    }
    const runsMatch = path.match(/^\/commits\/([^/]+)\/check-runs$/);
    if (runsMatch && method === "GET") {
      const verdict = state.checks.get(runsMatch[1]);
      const runs = verdict
        ? [
            {
              name: "ci",
              status: verdict === "pending" ? "in_progress" : "completed",
              conclusion: verdict === "pending" ? null : verdict,
              started_at: "2026-11-04T00:00:00Z"
            }
          ]
        : [];
      return respond(200, { check_runs: runs });
    }
    const statusMatch = path.match(/^\/commits\/([^/]+)\/status$/);
    if (statusMatch && method === "GET") {
      return respond(200, { statuses: [] });
    }
    throw new Error(`fakeGitHub: 未対応の呼び出し ${method} ${path}`);
  }

  return { state, fetchStub };
}

/** fetch を差し替えて fn を実行し、終わったら元に戻す。 */
async function withGitHub(gh, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = gh.fetchStub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const testEnv = { GITHUB_TOKEN: "test-token" };

test("publish冪等: BEHIND はブランチ更新で回復し、次の確認でマージまで収束する", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "冪等テスト", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。" });

    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(posted.state, "waiting");
    assert.equal(gh.state.pulls.length, 1);
    const pr = gh.state.pulls[0];

    // media PR のマージで main が先行した状況（ci 成功済み・BEHIND）。
    gh.state.checks.set(pr.headSha, "success");
    pr.mergeable_state = "behind";
    const step1 = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step1.state, "waiting");
    assert.match(step1.note ?? "", /取り込み/);
    assert.equal(gh.state.updateCount, 1);
    assert.equal(gh.state.calls.filter((call) => call.includes("/merge")).length, 0);

    // 取り込み後の新しい head で ci が成功し直したらマージまで進む。
    gh.state.checks.set(pr.headSha, "success");
    const step2 = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step2.state, "merged");
    assert.equal(pr.merged, true);
    // 後片付けで下書きが消えている。
    await assert.rejects(() => store.readDraft(draft.id));
  });
});

test("publish冪等: マージ競合の瞬間だけ BEHIND になっても取り込みに切り替える", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "競合テスト", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。" });
    await publishPost({ env: testEnv, store, id: draft.id });
    const pr = gh.state.pulls[0];
    gh.state.checks.set(pr.headSha, "success");
    // 見た目は clean だが、マージを試みた時点で BEHIND が判明するケース。
    gh.state.mergeSabotageBehindOnce = true;
    const step = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step.state, "waiting");
    assert.equal(gh.state.updateCount, 1);
    assert.equal(pr.merged, false);
  });
});

test("publish冪等: ブランチ更新が conflict したら理由つきで失敗にする", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "更新失敗", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。" });
    await publishPost({ env: testEnv, store, id: draft.id });
    const pr = gh.state.pulls[0];
    gh.state.checks.set(pr.headSha, "success");
    pr.mergeable_state = "behind";
    gh.state.updateBranchFails = true;
    const step = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step.state, "failed");
    assert.match(step.message, /取り込みに失敗しました/);
    assert.match(step.message, /続きから進みます/);
  });
});

test("publish冪等: 既にマージ済みなら再マージせず成功として片付ける", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "マージ済み", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。" });
    await publishPost({ env: testEnv, store, id: draft.id });
    const pr = gh.state.pulls[0];
    // 外部でマージまで終わっていた（後片付け前に落ちた）状態を再現。
    pr.merged = true;
    pr.state = "closed";
    const mergesBefore = gh.state.calls.filter((call) => call.includes("/merge")).length;
    const step = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step.state, "merged");
    assert.equal(
      gh.state.calls.filter((call) => call.includes("/merge")).length,
      mergesBefore
    );
    await assert.rejects(() => store.readDraft(draft.id));

    // 公開の再実行でも、新しい PR を作らず成功に収束する。
    const draft2 = await store.createDraft({ title: "マージ済み2", category: "notes" });
    await store.writeDraft(draft2.id, { body: "本文です。" });
    await publishPost({ env: testEnv, store, id: draft2.id });
    const pr2 = gh.state.pulls[1];
    pr2.merged = true;
    pr2.state = "closed";
    const file2 = `src/content/notes/${draft2.id}.md`;
    gh.state.mainFiles.set(file2, "x");
    await store.writeDraft(draft2.id, { pr: "" });
    const again = await publishPost({ env: testEnv, store, id: draft2.id });
    assert.equal(again.state, "merged");
    assert.equal(gh.state.pulls.length, 2);
    await assert.rejects(() => store.readDraft(draft2.id));
  });
});

test("publish再編集: 公開済みと同一の下書きは収束し、本文を変えると更新 PR を作る", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "再編集テスト", category: "journal" });
    await store.writeDraft(draft.id, { body: "本文 v1 です。" });
    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(posted.state, "waiting");
    const pr1 = gh.state.pulls[0];
    gh.state.checks.set(pr1.headSha, "success");
    const mergedStep = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(mergedStep.state, "merged");
    await assert.rejects(() => store.readDraft(draft.id));
    const file = `src/content/journal/${draft.id}.md`;
    const publishedText = Buffer.from(gh.state.mainFiles.get(file), "base64").toString();
    assert.match(publishedText, /本文 v1 です。/);
    const { data, body } = parseFrontmatter(publishedText);

    // 公開済み記事を読み直した下書き（同じ id・公開時の中身のまま）を
    // 再現して再投稿すると、新しい PR は作らず成功に収束する。
    const same = await store.createDraft({ title: "再編集テスト", category: "journal" });
    assert.equal(same.id, draft.id);
    await store.writeDraft(same.id, {
      body,
      description: data.description,
      tags: data.tags ?? []
    });
    const converged = await publishPost({ env: testEnv, store, id: same.id });
    assert.equal(converged.state, "merged");
    assert.equal(gh.state.pulls.length, 1);
    await assert.rejects(() => store.readDraft(same.id));

    // 同じ読み直しから本文を変えて再投稿すると、再編集として更新 PR を
    // 作り、下書きは残る。マージまで進めると main の本文が v2 になる。
    const edited = await store.createDraft({ title: "再編集テスト", category: "journal" });
    assert.equal(edited.id, draft.id);
    await store.writeDraft(edited.id, {
      body,
      description: data.description,
      tags: data.tags ?? []
    });
    await store.writeDraft(edited.id, { body: "本文 v2 です。" });
    const reposted = await publishPost({ env: testEnv, store, id: edited.id });
    assert.equal(reposted.state, "waiting");
    assert.equal(gh.state.pulls.length, 2);
    assert.notEqual(reposted.prUrl, posted.prUrl);
    assert.equal((await store.readDraft(edited.id)).pr, reposted.prUrl);
    const pr2 = gh.state.pulls[1];
    gh.state.checks.set(pr2.headSha, "success");
    const step = await publishStatus({ env: testEnv, store, id: edited.id });
    assert.equal(step.state, "merged");
    const updatedText = Buffer.from(gh.state.mainFiles.get(file), "base64").toString();
    assert.match(updatedText, /本文 v2 です。/);
    // 公開日は元の記事の日付を引き継ぐ。
    assert.equal(parseFrontmatter(updatedText).data.published, data.published);
    await assert.rejects(() => store.readDraft(edited.id));
  });
});

const b64 = (text) => Buffer.from(text).toString("base64");

test("published: 一覧は frontmatter と下書きの有無を返し、下書きフラグ付きを除く", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    gh.state.mainFiles.set(
      "src/content/journal/2026-01-02-first.md",
      b64("---\ntitle: 最初の記事\ndescription: 説明です\npublished: 2026-01-02\ntags: [日記]\n---\n\n本文その1\n")
    );
    gh.state.mainFiles.set(
      "src/content/notes/2026-01-03-memo.md",
      b64('---\ntitle: ""\ndescription: メモの説明\npublished: 2026-01-03\n---\n\nメモ本文\n')
    );
    gh.state.mainFiles.set(
      "src/content/notes/2026-01-04-hidden.md",
      b64("---\ntitle: 非公開下書き\ndescription: x\npublished: 2026-01-04\ndraft: true\n---\n\n下書き本文\n")
    );
    const store = createDraftStore(memoryKv());
    await store.importDraft(
      "2026-01-02-first",
      { title: "最初の記事", category: "journal" },
      "編集中の本文"
    );
    const articles = await listPublished({ env: testEnv, store });
    assert.equal(articles.length, 2);
    // 新しい公開日のものから並ぶ。
    assert.deepEqual(
      articles.map((article) => article.slug),
      ["2026-01-03-memo", "2026-01-02-first"]
    );
    assert.equal(articles[0].title, "");
    assert.equal(articles[0].hasDraft, false);
    assert.equal(articles[0].draftId, null);
    assert.equal(articles[0].url, "https://slytxt.dev/notes/2026-01-03-memo/");
    assert.equal(articles[1].title, "最初の記事");
    assert.equal(articles[1].published, "2026-01-02");
    assert.equal(articles[1].hasDraft, true);
    assert.equal(articles[1].draftId, "2026-01-02-first");
    assert.equal(
      articles[1].url,
      "https://slytxt.dev/articles/journal/2026-01-02-first/"
    );
  });
});

test("published: 開くと記事が下書きとして取り込まれ、公開日が保持される", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    gh.state.mainFiles.set(
      "src/content/journal/2026-02-03-import-me.md",
      b64(
        '---\ntitle: 取り込み対象\ndescription: 説明文です\npublished: 2026-02-03\ntags: [タグ1, タグ2]\ncover: "https://media.slytxt.dev/0123456789abcdef0123456789abcdef.jpg"\n---\n\n取り込む本文です。\n'
      )
    );
    const kv = memoryKv();
    const store = createDraftStore(kv);
    const { draft, created } = await openPublished({
      env: testEnv,
      store,
      category: "journal",
      slug: "2026-02-03-import-me"
    });
    assert.equal(created, true);
    assert.equal(draft.id, "2026-02-03-import-me");
    assert.equal(draft.title, "取り込み対象");
    assert.equal(draft.description, "説明文です");
    assert.deepEqual(draft.tags, ["タグ1", "タグ2"]);
    assert.equal(
      draft.cover,
      "https://media.slytxt.dev/0123456789abcdef0123456789abcdef.jpg"
    );
    assert.match(draft.body, /取り込む本文です。/);
    // 公開日は下書きの frontmatter に extras として残る。
    assert.match(kv.map.get("draft:2026-02-03-import-me"), /published: 2026-02-03/);
    // 下書き一覧にも載る。
    assert.deepEqual(
      (await store.listDrafts()).map((entry) => entry.id),
      ["2026-02-03-import-me"]
    );
  });
});

test("published: 対応する下書きがあれば作り直さずそれを開く", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    gh.state.mainFiles.set(
      "src/content/journal/2026-02-03-import-me.md",
      b64("---\ntitle: 取り込み対象\ndescription: 説明\npublished: 2026-02-03\n---\n\n公開時の本文\n")
    );
    const store = createDraftStore(memoryKv());
    const first = await openPublished({
      env: testEnv,
      store,
      category: "journal",
      slug: "2026-02-03-import-me"
    });
    assert.equal(first.created, true);
    await store.writeDraft(first.draft.id, { body: "編集中の本文 v2" });
    const second = await openPublished({
      env: testEnv,
      store,
      category: "journal",
      slug: "2026-02-03-import-me"
    });
    assert.equal(second.created, false);
    assert.equal(second.draft.id, first.draft.id);
    assert.match(second.draft.body, /編集中の本文 v2/);
    assert.equal((await store.listDrafts()).length, 1);
  });
});

test("published: 取り込んだ下書きを編集して再投稿すると更新 PR で公開日を引き継ぐ", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const file = "src/content/journal/2026-02-03-import-me.md";
    gh.state.mainFiles.set(
      file,
      b64("---\ntitle: 取り込み対象\ndescription: 説明文です\npublished: 2026-02-03\ntags: [タグ1]\n---\n\n公開時の本文 v1\n")
    );
    const store = createDraftStore(memoryKv());
    // この記事には writer のブランチ PR 履歴が無い（手でコミットされた想定）。
    // それでも再編集として更新 PR が作られること。
    const { draft } = await openPublished({
      env: testEnv,
      store,
      category: "journal",
      slug: "2026-02-03-import-me"
    });
    await store.writeDraft(draft.id, { body: "書き換えた本文 v2" });
    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(posted.state, "waiting");
    assert.equal(gh.state.pulls.length, 1);
    const pr = gh.state.pulls[0];
    gh.state.checks.set(pr.headSha, "success");
    const step = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step.state, "merged");
    const text = Buffer.from(gh.state.mainFiles.get(file), "base64").toString();
    assert.match(text, /書き換えた本文 v2/);
    assert.equal(parseFrontmatter(text).data.published, "2026-02-03");
    await assert.rejects(() => store.readDraft(draft.id));
  });
});

test("published: Worker の /api/published と開く導線が往復する", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    gh.state.mainFiles.set(
      "src/content/journal/2026-02-03-import-me.md",
      b64("---\ntitle: 取り込み対象\ndescription: 説明\npublished: 2026-02-03\n---\n\n公開時の本文\n")
    );
    const env = { GITHUB_TOKEN: "test-token", DRAFTS: memoryKv() };
    const listRes = await writerWorker.fetch(
      new Request("https://write.slytxt.dev/api/published"),
      env
    );
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.articles.length, 1);
    assert.equal(list.articles[0].hasDraft, false);
    assert.equal(
      list.articles[0].url,
      "https://slytxt.dev/articles/journal/2026-02-03-import-me/"
    );

    const openInit = {
      method: "POST",
      headers: { "x-slytxt-client": "1" }
    };
    const openRes = await writerWorker.fetch(
      new Request("https://write.slytxt.dev/api/published/journal/2026-02-03-import-me", openInit),
      env
    );
    assert.equal(openRes.status, 201);
    const opened = await openRes.json();
    assert.equal(opened.created, true);
    assert.equal(opened.draft.id, "2026-02-03-import-me");

    const againRes = await writerWorker.fetch(
      new Request("https://write.slytxt.dev/api/published/journal/2026-02-03-import-me", openInit),
      env
    );
    assert.equal(againRes.status, 200);
    assert.equal((await againRes.json()).created, false);
  });
});

test("publish冪等: 下書きに PR が残っていなくてもブランチから引き継ぐ", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "引き継ぎ", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。" });
    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    // PR 作成直後に Worker が落ちて URL を保存できなかった状態を再現。
    await store.writeDraft(draft.id, { pr: "" });
    const step = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(step.state, "waiting");
    assert.equal(step.prUrl, posted.prUrl);
    assert.equal((await store.readDraft(draft.id)).pr, posted.prUrl);
  });
});

test("publish冪等: 閉じられた PR は再実行で作り直し、ci 失敗は同じ PR で回し直す", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "再実行", category: "notes" });
    await store.writeDraft(draft.id, { body: "下書き v1" });
    await publishPost({ env: testEnv, store, id: draft.id });
    const pr1 = gh.state.pulls[0];
    pr1.state = "closed";
    const closed = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(closed.state, "failed");
    assert.match(closed.message, /投稿し直します/);

    // 再実行すると新しい PR が1つだけ増える。
    const reposted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(reposted.state, "waiting");
    assert.equal(gh.state.pulls.length, 2);
    const pr2 = gh.state.pulls[1];

    // ci 失敗 → failed。再投稿は同じ PR のファイルを更新するだけ。
    gh.state.checks.set(pr2.headSha, "failure");
    const failed = await publishStatus({ env: testEnv, store, id: draft.id });
    assert.equal(failed.state, "failed");
    assert.match(failed.message, /同じ PR で CI を回し直します/);
    await store.writeDraft(draft.id, { body: "下書き v2" });
    const fixed = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(fixed.state, "waiting");
    assert.equal(fixed.prUrl, reposted.prUrl);
    assert.equal(gh.state.pulls.length, 2);
  });
});

const PNG_BYTES = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  )
);

function mediaRequest(bytes) {
  return {
    async formData() {
      const form = new FormData();
      form.append("file", new File([bytes], "test.png", { type: "image/png" }));
      return form;
    }
  };
}

/**
 * R2 バケットの最小インターフェースをメモリ上で再現する
 * （get / head / put / delete）。値は { bytes, contentType } で持つ。
 */
function memoryR2() {
  const map = new Map();
  const view = (entry) => ({
    body: entry.bytes,
    size: entry.bytes.length,
    httpEtag: '"test-etag"',
    httpMetadata: { contentType: entry.contentType },
    async arrayBuffer() {
      return entry.bytes.buffer.slice(
        entry.bytes.byteOffset,
        entry.bytes.byteOffset + entry.bytes.byteLength
      );
    }
  });
  return {
    map,
    async get(key) {
      const entry = map.get(key);
      return entry ? view(entry) : null;
    },
    async head(key) {
      const entry = map.get(key);
      return entry ? view(entry) : null;
    },
    async put(key, bytes, options = {}) {
      map.set(key, {
        bytes: new Uint8Array(bytes),
        contentType: options.httpMetadata?.contentType ?? ""
      });
    },
    async delete(key) {
      map.delete(key);
    }
  };
}

test("media: アップロードは R2 の下書き側へ即時に保存され、再試行で増えない", async () => {
  const media = memoryR2();
  const env = { MEDIA: media };

  const first = await uploadMedia(mediaRequest(PNG_BYTES), env);
  assert.equal(first.state, "stored");
  assert.equal(first.published, false);
  assert.match(first.key, /^[0-9a-f]{32}\.png$/);
  assert.equal(first.url, `/media/${first.key}`);
  assert.equal(first.publicUrl, `https://media.slytxt.dev/${first.key}`);
  // 下書き側にだけあり、公開側には無い。
  assert.ok(media.map.has(`draft/${first.key}`));
  assert.equal(media.map.has(`pub/${first.key}`), false);

  // 再試行（同じバイト列）は同じキーに収束し、オブジェクトは増えない。
  const retry = await uploadMedia(mediaRequest(PNG_BYTES), env);
  assert.equal(retry.key, first.key);
  assert.equal(media.map.size, 1);

  // 違う画像は違うキーになる。
  const otherBytes = new Uint8Array(PNG_BYTES);
  otherBytes[20] ^= 0xff;
  const other = await uploadMedia(mediaRequest(otherBytes), env);
  assert.notEqual(other.key, first.key);
  assert.equal(media.map.size, 2);

  // 状態確認: 未公開は stored、ストレージに無いキーは 404。
  const status = await mediaStatus(env, first.key);
  assert.equal(status.state, "stored");
  await assert.rejects(() => mediaStatus(env, "not-a-key.png"));
  await assert.rejects(() => mediaStatus(env, `${"0".repeat(32)}.png`));
});

test("media: 公開で pub/ へ移り、配信と状態が公開側に切り替わる", async () => {
  const media = memoryR2();
  const env = { MEDIA: media };
  const posted = await uploadMedia(mediaRequest(PNG_BYTES), env);

  // 下書き段階の配信は writer 側（serveDraftMedia）で返る。
  const served = await serveDraftMedia(env, posted.key);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");

  await publishMedia(env, [posted.key]);
  assert.equal(media.map.has(`draft/${posted.key}`), false);
  assert.ok(media.map.has(`pub/${posted.key}`));

  // 公開は冪等。もう一度呼んでも変わらない。
  await publishMedia(env, [posted.key]);
  assert.ok(media.map.has(`pub/${posted.key}`));

  const status = await mediaStatus(env, posted.key);
  assert.equal(status.state, "merged");
  assert.equal(status.published, true);

  // 公開後の再アップロードも成功として収束し、下書き側へは戻らない。
  const again = await uploadMedia(mediaRequest(PNG_BYTES), env);
  assert.equal(again.published, true);
  assert.equal(media.map.has(`draft/${posted.key}`), false);

  // ストレージに無い画像の公開は、壊れた画像を出さないよう失敗する。
  await assert.rejects(() => publishMedia(env, [`${"1".repeat(32)}.png`]));
});

test("media: 移行前の UUID キーでも状態を確認できる", async () => {
  const media = memoryR2();
  const env = { MEDIA: media };
  const uuid = "12345678-1234-1234-1234-123456789012";
  await media.put(`pub/${uuid}.png`, PNG_BYTES, {
    httpMetadata: { contentType: "image/png" }
  });
  const status = await mediaStatus(env, `${uuid}.png`);
  assert.equal(status.state, "merged");
});

test("publish: 本文とカバーの画像は公開側へ移り、URL が media.slytxt.dev になる", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const media = memoryR2();
    const env = { GITHUB_TOKEN: "test-token", MEDIA: media };
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "画像つき", category: "journal" });

    const cover = await uploadMedia(mediaRequest(PNG_BYTES), env);
    const otherBytes = new Uint8Array(PNG_BYTES);
    otherBytes[20] ^= 0xff;
    const inline = await uploadMedia(mediaRequest(otherBytes), env);

    await store.writeDraft(draft.id, {
      cover: cover.url,
      body: `本文です。\n\n![画像](${inline.url})\n`
    });
    const posted = await publishPost({ env, store, id: draft.id });
    assert.equal(posted.state, "waiting");

    // 公開ファイルの中では公開 URL に付け替わっている。
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    assert.ok(content.includes(`https://media.slytxt.dev/${inline.key}`), content);
    assert.ok(content.includes(`https://media.slytxt.dev/${cover.key}`), content);
    assert.equal(content.includes("/media/"), false);

    // R2 側はどちらも公開側へ移っている。
    assert.ok(media.map.has(`pub/${inline.key}`));
    assert.ok(media.map.has(`pub/${cover.key}`));
  });
});

test("drafts: 説明文（description）が往復し、空にすると消える", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const draft = await store.createDraft({ title: "説明文確認" });

  await store.writeDraft(draft.id, { description: "手で決めた説明文。" });
  const loaded = await store.readDraft(draft.id);
  assert.equal(loaded.description, "手で決めた説明文。");
  assert.match(kv.map.get(`draft:${draft.id}`), /description:/);

  await store.writeDraft(draft.id, { description: "" });
  assert.equal((await store.readDraft(draft.id)).description, "");
  assert.doesNotMatch(kv.map.get(`draft:${draft.id}`), /description:/);
});

test("summary: キーが無ければ生成しない", async () => {
  assert.equal(summaryConfig({}), null);
  const summary = await generateSummary({}, { title: "t", body: "本文です。" }, async () => {
    throw new Error("呼ばれないはず");
  });
  assert.equal(summary, "");
});

test("summary: 応答を整えて返し、既定のエンドポイントとモデルで送る", async () => {
  const seen = [];
  const stub = async (url, options) => {
    seen.push({ url, options });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "「要約の文です。」" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const summary = await generateSummary(
    { OPENCODE_GO_API_KEY: "key" },
    { title: "タイトル", body: "本文の内容です。" },
    stub
  );
  assert.equal(summary, "要約の文です。");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://opencode.ai/inference/go/openai/v1/chat/completions");
  assert.equal(seen[0].options.headers.authorization, "Bearer key");
  const payload = JSON.parse(seen[0].options.body);
  assert.equal(payload.model, "glm-5.3-flash");
});

test("summary: 失敗したら空文字（フォールバック前提）", async () => {
  const ng = async () => new Response("err", { status: 500 });
  assert.equal(
    await generateSummary({ OPENCODE_GO_API_KEY: "key" }, { title: "t", body: "本文。" }, ng),
    ""
  );
  const boom = async () => {
    throw new Error("network");
  };
  assert.equal(
    await generateSummary({ OPENCODE_GO_API_KEY: "key" }, { title: "t", body: "本文。" }, boom),
    ""
  );
});

test("publish: 下書きの説明文があればそのまま使う（AI は呼ばない）", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "説明文テスト", category: "notes" });
    await store.writeDraft(draft.id, {
      body: "本文です。",
      description: "本人が決めた説明文。"
    });
    const posted = await publishPost({
      env: { GITHUB_TOKEN: "test-token", OPENCODE_GO_API_KEY: "go-key" },
      store,
      id: draft.id
    });
    assert.equal(posted.state, "waiting");
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    assert.ok(content.includes("本人が決めた説明文。"), content);
  });
});

test("publish: 説明文が無ければ AI 要約を使い、下書きに書き戻す", async () => {
  const gh = fakeGitHub();
  const fetchImpl = async (url, options) => {
    if (String(url).includes("opencode.ai")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "AI の要約文です。" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return gh.fetchStub(url, options);
  };
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "AI 要約テスト", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。AI に要約してもらいます。" });
    const posted = await publishPost({
      env: { GITHUB_TOKEN: "test-token", OPENCODE_GO_API_KEY: "go-key" },
      store,
      id: draft.id
    });
    assert.equal(posted.state, "waiting");
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    assert.ok(content.includes("AI の要約文です。"), content);
    assert.equal((await store.readDraft(draft.id)).description, "AI の要約文です。");
  } finally {
    globalThis.fetch = original;
  }
});

test("publish: AI 要約が失敗したら抜粋で公開が完結する", async () => {
  const gh = fakeGitHub();
  const fetchImpl = async (url, options) => {
    if (String(url).includes("opencode.ai")) return new Response("err", { status: 500 });
    return gh.fetchStub(url, options);
  };
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "フォールバック", category: "notes" });
    await store.writeDraft(draft.id, { body: "抜粋になる本文です。よろしくお願いします。" });
    const posted = await publishPost({
      env: { GITHUB_TOKEN: "test-token", OPENCODE_GO_API_KEY: "go-key" },
      store,
      id: draft.id
    });
    assert.equal(posted.state, "waiting");
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    assert.ok(content.includes("抜粋になる本文です。"), content);
  } finally {
    globalThis.fetch = original;
  }
});

test("publish: notes はタイトルが無ければ title を空で書き、本文の書き出しで代用しない", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ category: "notes" });
    await store.writeDraft(draft.id, { body: "最初の行がこれです。\n続きの文。" });
    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(posted.state, "waiting");
    assert.equal(posted.title, "");
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    // サイト側スキーマが title キーを必須とするため、空でも明示して書く。
    assert.match(content, /^title: ""$/m);
    assert.doesNotMatch(content, /^title: 最初の行がこれです。/m);
  });
});

test("publish: notes でもタイトルが付いていればそのまま書く", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ title: "メモの題", category: "notes" });
    await store.writeDraft(draft.id, { body: "本文です。" });
    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(posted.title, "メモの題");
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    assert.match(content, /^title: メモの題$/m);
  });
});

test("publish: 記事はタイトルが無ければ本文の書き出しをタイトルにする（従来どおり）", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const store = createDraftStore(memoryKv());
    const draft = await store.createDraft({ category: "journal" });
    await store.writeDraft(draft.id, { body: "書き出しが題になる。\n続きの文。" });
    const posted = await publishPost({ env: testEnv, store, id: draft.id });
    assert.equal(posted.title, "書き出しが題になる。");
    const content = Buffer.from([...gh.state.branchFiles.values()][0], "base64").toString("utf8");
    assert.match(content, /^title: 書き出しが題になる。$/m);
  });
});

test("drafts: 保留中インデックスが完全なら list を使わず pr 付きだけを返す", async () => {
  const kv = memoryKv();
  let listCalls = 0;
  const baseList = kv.list;
  kv.list = async (options) => {
    listCalls += 1;
    return baseList(options);
  };
  const store = createDraftStore(kv);

  const plain = await store.createDraft({ title: "下書きのまま" });
  const pending = await store.createDraft({ title: "公開待ち" });
  await store.writeDraft(pending.id, {
    body: "公開待ちの本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/1"
  });
  assert.ok(plain.id);

  // 初回はインデックス再構築で list を使うが、完全なインデックスが残る。
  const first = await store.listPendingDrafts();
  assert.deepEqual(
    first.map((draft) => draft.id),
    [pending.id]
  );
  const callsAfterRebuild = listCalls;
  assert.ok(callsAfterRebuild >= 1);

  // 2回目以降は get だけで返り、list は増えない（Cron の毎分実行の前提）。
  const second = await store.listPendingDrafts();
  assert.deepEqual(
    second.map((draft) => draft.id),
    [pending.id]
  );
  assert.equal(listCalls, callsAfterRebuild);
});

test("drafts: 保留中インデックスは pr の解除と削除に追随する", async () => {
  const store = createDraftStore(memoryKv());

  const draft = await store.createDraft({ title: "公開待ち" });
  await store.writeDraft(draft.id, {
    body: "本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/2"
  });
  assert.equal((await store.listPendingDrafts()).length, 1);

  // pr が外れたら保留中からも外れる。
  await store.writeDraft(draft.id, { pr: "" });
  assert.deepEqual(await store.listPendingDrafts(), []);

  // 削除されたら保留中からも外れる。
  await store.writeDraft(draft.id, {
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/3"
  });
  assert.equal((await store.listPendingDrafts()).length, 1);
  await store.deleteDraft(draft.id);
  assert.deepEqual(await store.listPendingDrafts(), []);
});

test("drafts: 保留中インデックスの同期失敗でも writeDraft は成功する", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const draft = await store.createDraft({ title: "公開待ち" });
  const basePut = kv.put;
  kv.put = async (key, value) => {
    if (key === "pending-publishes") throw new Error("KV put failed");
    return basePut(key, value);
  };

  await store.writeDraft(draft.id, {
    body: "本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/9"
  });
  assert.equal((await store.readDraft(draft.id)).body.trim(), "本文。");
});

test("drafts: 保留中インデックスの同期失敗でも deleteDraft は成功する", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const draft = await store.createDraft({ title: "消える下書き" });
  await store.writeDraft(draft.id, {
    body: "本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/10"
  });
  const basePut = kv.put;
  kv.put = async (key, value) => {
    if (key === "pending-publishes") throw new Error("KV put failed");
    return basePut(key, value);
  };

  assert.equal(await store.deleteDraft(draft.id), true);
  assert.equal(kv.map.has(`draft:${draft.id}`), false);
});

test("drafts: 保留中インデックスの更新失敗後は再構築で欠落を補う", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);

  const first = await store.createDraft({ title: "1件目の公開待ち" });
  await store.writeDraft(first.id, {
    body: "1件目の本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/11"
  });
  // 完全な保留中インデックスを残しておく。
  assert.equal((await store.listPendingDrafts()).length, 1);
  assert.equal(JSON.parse(kv.map.get("pending-publishes")).complete, true);

  const second = await store.createDraft({ title: "2件目の公開待ち" });
  // 保留中インデックスへの put だけを失敗させる。
  const basePut = kv.put;
  kv.put = async (key, value) => {
    if (key === "pending-publishes") throw new Error("KV put failed");
    return basePut(key, value);
  };
  await store.writeDraft(second.id, {
    body: "2件目の本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/12"
  });
  kv.put = basePut;

  const pending = await store.listPendingDrafts();
  assert.deepEqual(
    pending.map((draft) => draft.id).sort(),
    [first.id, second.id].sort()
  );
});

test("drafts: 下書き一覧インデックスの更新失敗後は再構築で欠落を補う", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);

  const first = await store.createDraft({ title: "1件目の下書き" });
  await store.writeDraft(first.id, { body: "1件目の本文。" });
  // 完全な下書き一覧インデックスを残しておく。
  assert.equal((await store.listDrafts()).length, 1);

  // 下書き一覧インデックスへの put だけを失敗させる。
  const basePut = kv.put;
  kv.put = async (key, value) => {
    if (key === "draft-index") throw new Error("KV put failed");
    return basePut(key, value);
  };
  const second = await store.createDraft({ title: "2件目の下書き" });
  kv.put = basePut;

  const drafts = await store.listDrafts();
  assert.deepEqual(
    drafts.map((draft) => draft.id).sort(),
    [first.id, second.id].sort()
  );
});

test("drafts: インデックスの無い既存データは初回アクセスで再構築される", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);

  const draft = await store.createDraft({ title: "移行前からある下書き" });
  await store.writeDraft(draft.id, {
    body: "本文。",
    pr: "https://github.com/sayuyuyuyu/slytxt-lab/pull/4"
  });

  // インデックス導入前に書かれた状態を再現する。
  kv.map.delete("pending-publishes");
  assert.equal(kv.map.has("pending-publishes"), false);

  const pending = await store.listPendingDrafts();
  assert.deepEqual(
    pending.map((entry) => entry.id),
    [draft.id]
  );
  const index = JSON.parse(kv.map.get("pending-publishes"));
  assert.equal(index.complete, true);
  assert.deepEqual(index.ids, [draft.id]);
});

test("drafts: 下書き一覧インデックスが完全なら list を使わずに一覧を返す", async () => {
  const kv = memoryKv();
  let listCalls = 0;
  const baseList = kv.list;
  kv.list = async (options) => {
    listCalls += 1;
    return baseList(options);
  };
  const store = createDraftStore(kv);
  const a = await store.createDraft({ title: "一覧の1件目" });
  const b = await store.createDraft({ title: "一覧の2件目" });
  await store.writeDraft(a.id, { body: "1件目の本文。" });
  assert.ok(b.id);
  const first = await store.listDrafts();
  assert.equal(first.length, 2);
  const callsAfterRebuild = listCalls;
  assert.ok(callsAfterRebuild >= 1);
  const second = await store.listDrafts();
  assert.equal(second.length, 2);
  assert.equal(listCalls, callsAfterRebuild);
  // list が上限で失敗する状況でも、インデックス経由なら一覧が返る。
  kv.list = async () => {
    throw new Error("KV list() limit exceeded for the day.");
  };
  const third = await store.listDrafts();
  assert.equal(third.length, 2);
});

test("drafts: 下書き一覧インデックスは作成と削除に追随する", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const draft = await store.createDraft({ title: "消える下書き" });
  assert.equal((await store.listDrafts()).length, 1);
  await store.deleteDraft(draft.id);
  assert.deepEqual(await store.listDrafts(), []);
  const index = JSON.parse(kv.map.get("draft-index"));
  assert.deepEqual(index.ids, []);
});

test("drafts: 下書き一覧インデックスの無い既存データは初回アクセスで再構築される", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const draft = await store.createDraft({ title: "移行前からある下書き" });
  await store.writeDraft(draft.id, { body: "本文。" });
  kv.map.delete("draft-index");
  assert.equal(kv.map.has("draft-index"), false);
  const listed = await store.listDrafts();
  assert.deepEqual(listed.map((entry) => entry.id), [draft.id]);
  const index = JSON.parse(kv.map.get("draft-index"));
  assert.equal(index.complete, true);
  assert.deepEqual(index.ids, [draft.id]);
});

test("writer media: invalid percent-encoding returns 404 without touching R2", async () => {
  const media = memoryR2();
  let r2Calls = 0;
  const countingMedia = {
    map: media.map,
    async get(key) { r2Calls += 1; return media.get(key); },
    async head(key) { r2Calls += 1; return media.head(key); },
    async put(key, bytes, options) { r2Calls += 1; return media.put(key, bytes, options); },
    async delete(key) { r2Calls += 1; return media.delete(key); }
  };
  const env = { MEDIA: countingMedia, DRAFTS: memoryKv() };
  for (const path of ["/media/%E0%A4%A", "/media/%zz.jpg", "/media/%"]) {
    const res = await writerWorker.fetch(new Request(`https://write.slytxt.dev${path}`), env);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), "not found", path);
  }
  assert.equal(r2Calls, 0);
});

/* ---- driver（Cron 見届け） ---- */

/** put のオプション（TTL など）も記録する KV。結果レコードの検証用。 */
function recordingKv() {
  const kv = memoryKv();
  const puts = [];
  const basePut = kv.put.bind(kv);
  kv.put = async (key, value, options) => {
    puts.push({ key, options });
    return basePut(key, value);
  };
  return { kv, puts };
}

/** pr 付きの下書きを作る（見届け対象）。 */
async function seedPendingDraft(store, title, pr) {
  const draft = await store.createDraft({ title, category: "journal" });
  return store.writeDraft(draft.id, { pr, body: "本文。" });
}

test("driver: pr のある下書きだけを駆動し、merged の結果を TTL 7日で KV に残す", async () => {
  const { kv, puts } = recordingKv();
  const store = createDraftStore(kv);
  const pending = await seedPendingDraft(
    store,
    "driver merged target",
    "https://github.com/sayuyuyuyu/slytxt-lab/pull/901"
  );
  await store.createDraft({ title: "driver no pr draft" });

  const calls = [];
  await drivePendingPublishes(
    { DRAFTS: kv },
    {
      publishStatus: async ({ id }) => {
        calls.push(id);
        return {
          state: "merged",
          title: "公開された記事",
          url: "https://slytxt.dev/articles/journal/driver-merged-target/",
          prUrl: "https://github.com/sayuyuyuyu/slytxt-lab/pull/901",
          message: ""
        };
      }
    }
  );

  assert.deepEqual(calls, [pending.id]);
  const raw = kv.map.get(`publish-result:${pending.id}`);
  assert.ok(raw, "結果レコードが残る");
  const record = JSON.parse(raw);
  assert.equal(record.id, pending.id);
  assert.equal(record.state, "merged");
  assert.equal(record.title, "公開された記事");
  assert.equal(record.url, "https://slytxt.dev/articles/journal/driver-merged-target/");
  assert.equal(record.prUrl, "https://github.com/sayuyuyuyu/slytxt-lab/pull/901");
  const resultPut = puts.find((entry) => entry.key === `publish-result:${pending.id}`);
  assert.equal(resultPut.options?.expirationTtl, 7 * 24 * 60 * 60);
});

test("driver: merged / failed 以外（waiting）では結果を残さない", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  await seedPendingDraft(
    store,
    "driver waiting target",
    "https://github.com/sayuyuyuyu/slytxt-lab/pull/902"
  );

  await drivePendingPublishes(
    { DRAFTS: kv },
    { publishStatus: async () => ({ state: "waiting" }) }
  );

  assert.deepEqual(await listPublishResults({ DRAFTS: kv }), []);
});

test("driver: 個別の失敗でも次を続け、failed は結果に残す", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const failing = await seedPendingDraft(
    store,
    "driver failing target",
    "https://github.com/sayuyuyuyu/slytxt-lab/pull/903"
  );
  const failed = await seedPendingDraft(
    store,
    "driver failed target",
    "https://github.com/sayuyuyuyu/slytxt-lab/pull/904"
  );

  const calls = [];
  await drivePendingPublishes(
    { DRAFTS: kv },
    {
      publishStatus: async ({ id }) => {
        calls.push(id);
        if (id === failing.id) throw new Error("一時的な失敗");
        return { state: "failed", message: "CI が失敗しました" };
      }
    }
  );

  assert.deepEqual([...calls].sort(), [failing.id, failed.id].sort());
  const results = await listPublishResults({ DRAFTS: kv });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, failed.id);
  assert.equal(results[0].state, "failed");
  assert.equal(results[0].message, "CI が失敗しました");
});

test("driver: 1回の tick で駆動するのは上限 10 件まで", async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  for (let i = 1; i <= 12; i += 1) {
    await seedPendingDraft(
      store,
      `driver cap target ${String(i).padStart(2, "0")}`,
      `https://github.com/sayuyuyuyu/slytxt-lab/pull/${910 + i}`
    );
  }

  let calls = 0;
  await drivePendingPublishes(
    { DRAFTS: kv },
    {
      publishStatus: async () => {
        calls += 1;
        return { state: "waiting" };
      }
    }
  );

  assert.equal(calls, 10);
});

test("driver: listPublishResults は壊れたレコードを落として新しい順に返す", async () => {
  const kv = memoryKv();
  kv.map.set(
    "publish-result:old",
    JSON.stringify({ id: "old", state: "merged", at: "2026-11-01T00:00:00.000Z" })
  );
  kv.map.set(
    "publish-result:new",
    JSON.stringify({ id: "new", state: "failed", at: "2026-11-03T00:00:00.000Z" })
  );
  kv.map.set("publish-result:broken", "{oops");
  kv.map.set("draft:unrelated", "---\ntitle: x\n---\n\n本文\n");

  const results = await listPublishResults({ DRAFTS: kv });
  assert.deepEqual(
    results.map((result) => result.id),
    ["new", "old"]
  );
});

test("driver: scheduled ハンドラは見届けを waitUntil に渡して最後まで待てる", async () => {
  let captured = null;
  const ctx = {
    waitUntil(promise) {
      captured = promise;
    }
  };
  await writerWorker.scheduled({}, { DRAFTS: memoryKv() }, ctx);
  assert.ok(captured instanceof Promise, "waitUntil に Promise が渡る");
  await captured;
});
