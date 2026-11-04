import assert from "node:assert/strict";
import test from "node:test";
import { createDraftStore, normalizeDraft } from "../tools/writer-cloudflare/src/drafts-kv.mjs";
import { parseFrontmatter, stringifyFrontmatter } from "../tools/writer-cloudflare/src/frontmatter.mjs";
import { plainText, renderMarkdown, truncateText } from "../tools/writer-cloudflare/src/markdown.mjs";
import {
  deriveDescription,
  normalizeSlug,
  publicUrl,
  publishPost,
  publishStatus
} from "../tools/writer-cloudflare/src/publish.mjs";
import { mediaStatus, uploadMedia } from "../tools/writer-cloudflare/src/media.mjs";
import { cleanSummary, generateSummary, summaryConfig } from "../tools/writer-cloudflare/src/summary.mjs";

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
      return found
        ? respond(200, { sha: `blob-${file}`, path: file })
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
    const posted2 = await publishPost({ env: testEnv, store, id: draft2.id });
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

test("media冪等: 同じ画像の再試行・重複アップロードで PR が増えない", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const first = await uploadMedia(mediaRequest(PNG_BYTES), testEnv);
    assert.equal(first.state, "waiting");
    assert.match(first.key, /^[0-9a-f]{32}\.png$/);
    assert.equal(gh.state.pulls.length, 1);

    // 再試行（同じバイト列）は同じキー・同じ PR を返す。
    const retry = await uploadMedia(mediaRequest(PNG_BYTES), testEnv);
    assert.equal(retry.key, first.key);
    assert.equal(retry.prUrl, first.prUrl);
    assert.equal(retry.state, "waiting");
    assert.equal(gh.state.pulls.length, 1);

    // ci 成功でマージまで進む。
    const pr = gh.state.pulls[0];
    gh.state.checks.set(pr.headSha, "success");
    const status = await mediaStatus(testEnv, first.key);
    assert.equal(status.state, "merged");

    // マージ後の再アップロードも成功として即座に収束する。
    const again = await uploadMedia(mediaRequest(PNG_BYTES), testEnv);
    assert.equal(again.state, "merged");
    assert.equal(again.key, first.key);
    assert.equal(gh.state.pulls.length, 1);

    // 違う画像は違うキー・別の PR になる。
    const otherBytes = new Uint8Array(PNG_BYTES);
    otherBytes[20] ^= 0xff;
    const other = await uploadMedia(mediaRequest(otherBytes), testEnv);
    assert.notEqual(other.key, first.key);
    assert.equal(other.state, "waiting");
    assert.equal(gh.state.pulls.length, 2);
  });
});

test("media冪等: BEHIND の media PR もブランチ更新で回復する", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const posted = await uploadMedia(mediaRequest(PNG_BYTES), testEnv);
    const pr = gh.state.pulls[0];
    gh.state.checks.set(pr.headSha, "success");
    pr.mergeable_state = "behind";
    const step1 = await mediaStatus(testEnv, posted.key);
    assert.equal(step1.state, "waiting");
    assert.equal(gh.state.updateCount, 1);
    gh.state.checks.set(pr.headSha, "success");
    const step2 = await mediaStatus(testEnv, posted.key);
    assert.equal(step2.state, "merged");
    assert.equal(pr.merged, true);
  });
});

test("media冪等: 移行前の UUID キーでも状態を確認できる", async () => {
  const gh = fakeGitHub();
  await withGitHub(gh, async () => {
    const uuid = "12345678-1234-1234-1234-123456789012";
    gh.state.mainFiles.set(`public/media/${uuid}.png`, "x");
    // PR は無いが main にファイルがあるので merged として収束する。
    const status = await mediaStatus(testEnv, `${uuid}.png`);
    assert.equal(status.state, "merged");
    await assert.rejects(() => mediaStatus(testEnv, "not-a-key.png"));
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
