import assert from "node:assert/strict";
import test from "node:test";
import {
  createFeedPost,
  listFeedPosts,
  readFeedPage,
  rowToPost
} from "../src/lib/feed/store.ts";
import {
  FEED_END,
  FEED_START,
  formatTimestamp,
  injectFeed,
  renderFeedItems
} from "../src/lib/feed/render.ts";
import { escapeHtml } from "../src/lib/html.ts";
import { beforeFromRequest, feedHref, handleFeedPage, handleHomeFeed } from "../src/lib/feed/page.ts";

/** SQL とバインド値を記録し、用意した行を返すだけの D1 代用。 */
function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, params: [], run: null };
      const statement = {
        bind(...params) {
          call.params = params;
          return statement;
        },
        async all() {
          calls.push(call);
          return { results: rows };
        },
        async first() {
          calls.push(call);
          return rows[0] ?? null;
        },
        async run() {
          calls.push(call);
          call.run = true;
          return { success: true };
        }
      };
      return statement;
    }
  };
}

const row = (overrides = {}) => ({
  id: "01JC0000000000000000000001",
  body: "テスト投稿",
  created_at: "2026-11-16T10:00:00.000Z",
  images: "[]",
  link: null,
  ...overrides
});

test("feed: 行を表示用の型に変え、添付画像とリンクを読む", () => {
  const post = rowToPost(
    row({
      images: JSON.stringify([
        { key: "abc.jpg", alt: "写真の説明", width: 1280, height: 720 },
        { key: "def.png" }
      ]),
      link: JSON.stringify({
        url: "https://example.com/",
        title: "例",
        description: "説明",
        image: "https://example.com/og.png",
        site: "example.com",
        junk: "落とす"
      })
    })
  );
  assert.deepEqual(post.images, [
    { key: "abc.jpg", alt: "写真の説明", width: 1280, height: 720 },
    { key: "def.png", alt: "" }
  ]);
  assert.deepEqual(post.link, {
    url: "https://example.com/",
    title: "例",
    description: "説明",
    image: "https://example.com/og.png",
    site: "example.com"
  });
});

test("feed: 壊れた JSON は空として扱い、一覧を止めない", () => {
  const post = rowToPost(row({ images: "{oops", link: "[1,2,3]" }));
  assert.deepEqual(post.images, []);
  assert.equal(post.link, undefined);
});

test("feed: 一覧は before をカーソルに使い、limit+1 件を読む", async () => {
  const db = fakeDb([]);
  await listFeedPosts(db, { before: "2026-11-16T10:00:00.000Z", limit: 20 });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /deleted_at IS NULL/);
  assert.deepEqual(db.calls[0].params, ["2026-11-16T10:00:00.000Z", 21]);
});

test("feed: 読み込み件数が limit 以下なら次ページは無い", async () => {
  const db = fakeDb([row(), row({ id: "b", created_at: "2026-11-15T10:00:00.000Z" })]);
  const page = await readFeedPage(db, { limit: 2 });
  assert.equal(page.posts.length, 2);
  assert.equal(page.nextBefore, null);
});

test("feed: limit を超えたら最後の投稿時刻を次ページのカーソルにする", async () => {
  const db = fakeDb([
    row(),
    row({ id: "b", created_at: "2026-11-15T10:00:00.000Z" }),
    row({ id: "c", created_at: "2026-11-14T10:00:00.000Z" })
  ]);
  const page = await readFeedPage(db, { limit: 2 });
  assert.deepEqual(
    page.posts.map((post) => post.id),
    ["01JC0000000000000000000001", "b"]
  );
  assert.equal(page.nextBefore, "2026-11-15T10:00:00.000Z");
});

test("feed: データベースが未設定なら空のフィードを返す", async () => {
  const page = await readFeedPage(undefined, { limit: 20 });
  assert.deepEqual(page, { posts: [], nextBefore: null });
});

test("feed: 投稿は images と link を JSON にして保存する", async () => {
  const db = fakeDb();
  await createFeedPost(db, {
    id: "01JC0000000000000000000001",
    body: "本文",
    createdAt: "2026-11-16T10:00:00.000Z",
    images: [{ key: "abc.jpg", alt: "説明" }],
    link: { url: "https://example.com/" }
  });
  assert.match(db.calls[0].sql, /INSERT INTO feed_posts/);
  assert.deepEqual(db.calls[0].params, [
    "01JC0000000000000000000001",
    "本文",
    "2026-11-16T10:00:00.000Z",
    JSON.stringify([{ key: "abc.jpg", alt: "説明" }]),
    JSON.stringify({ url: "https://example.com/" })
  ]);
});

test("feed: 本文と alt をエスケープし、URL はリンクにする", () => {
  const html = renderFeedItems([
    {
      id: "1",
      body: '<script>alert(1)</script> https://example.com/a?b=1&c=2',
      createdAt: "2026-11-16T10:00:00.000Z",
      images: [{ key: "a.jpg", alt: '"quoted" <alt>' }]
    }
  ]);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('href="https://example.com/a?b=1&amp;c=2"'));
  assert.ok(html.includes('alt="&quot;quoted&quot; &lt;alt&gt;"'));
  assert.ok(html.includes('src="https://media.slytxt.dev/a.jpg"'));
  assert.ok(html.includes('loading="lazy"'));
});

test("feed: リンクカードは URL と各項目をエスケープして出す", () => {
  const html = renderFeedItems([
    {
      id: "1",
      body: "リンク",
      createdAt: "2026-11-16T10:00:00.000Z",
      images: [],
      link: { url: "https://example.com/?a=1&b=2", title: "<title>", site: "example.com" }
    }
  ]);
  assert.ok(html.includes('class="feed-card"'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
  assert.ok(html.includes("&lt;title&gt;"));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("feed: 0件なら空状態、次ページがあれば「もっと見る」を出す", () => {
  assert.match(renderFeedItems([]), /まだ投稿がありません/);
  const html = renderFeedItems(
    [{ id: "1", body: "x", createdAt: "2026-11-16T10:00:00.000Z", images: [] }],
    { nextHref: "/feed/?before=2026-11-16T10%3A00%3A00.000Z" }
  );
  assert.ok(html.includes('class="feed-more button"'));
  assert.ok(html.includes("もっと見る"));
  assert.ok(!renderFeedItems([], {}).includes("feed-more"));
});

test("feed: 目印の間に一覧を差し込む。目印が無ければ null", () => {
  const shell = `<div>${FEED_START}fallback${FEED_END}</div>`;
  assert.equal(injectFeed(shell, "<p>x</p>"), `<div>${FEED_START}<p>x</p>${FEED_END}</div>`);
  assert.equal(injectFeed("<div>fallback</div>", "<p>x</p>"), null);
});

test("feed: 時刻は JST で表示し、壊れた値はそのまま出す", () => {
  assert.deepEqual(formatTimestamp("2026-11-16T10:00:00.000Z"), {
    label: "2026/11/16 19:00",
    datetime: "2026-11-16T10:00:00.000Z"
  });
  assert.deepEqual(formatTimestamp("not-a-date"), {
    label: "not-a-date",
    datetime: "not-a-date"
  });
});

test("feed: before は ISO 8601 だけを受け付け、URL を組み立てる", () => {
  const ok = beforeFromRequest(
    new Request("https://slytxt.dev/feed/?before=2026-11-16T10:00:00.000Z")
  );
  assert.deepEqual(ok, { before: "2026-11-16T10:00:00.000Z" });
  assert.deepEqual(beforeFromRequest(new Request("https://slytxt.dev/feed/")), {
    before: null
  });
  const bad = beforeFromRequest(new Request("https://slytxt.dev/feed/?before=yesterday"));
  assert.ok("error" in bad);
  assert.equal(feedHref("2026-11-16T10:00:00.000Z"), "/feed/?before=2026-11-16T10%3A00%3A00.000Z");
});

/** Pages Functions の context 代用。ASSETS は雛形の HTML を返す。 */
function fakeContext({
  db,
  shell,
  url = "https://slytxt.dev/feed/",
  shellPath = "/feed/index.html"
}) {
  return {
    request: new Request(url),
    env: {
      FEED: db,
      ASSETS: {
        async fetch(input) {
          if (!shell) return new Response("not found", { status: 404 });
          // ASSETS には絶対 URL を渡す約束（相対パスは Pages 側で Invalid URL になる）。
          assert.equal(new URL(String(input)).pathname, shellPath);
          return new Response(shell, { status: 200 });
        }
      }
    },
    next: async () => new Response("next"),
    waitUntil: () => {}
  };
}

test("feed: ページは雛形に一覧を差し込んで返す", async () => {
  const db = fakeDb([row({ body: "こんにちは" })]);
  const shell = `<main>${FEED_START}fallback${FEED_END}</main>`;
  const response = await handleFeedPage(fakeContext({ db, shell }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=60/);
  const body = await response.text();
  assert.ok(body.includes("こんにちは"));
  assert.ok(!body.includes("fallback"));
});

test("feed: 外枠が無い・目印が無いときは理由つきで失敗する", async () => {
  const missingShell = await handleFeedPage(fakeContext({ db: fakeDb([]), shell: null }));
  assert.equal(missingShell.status, 500);
  assert.match(await missingShell.text(), /外枠が見つかりません/);

  const noMarkers = await handleFeedPage(
    fakeContext({ db: fakeDb([]), shell: "<main>no markers</main>" })
  );
  assert.equal(noMarkers.status, 500);
  assert.match(await noMarkers.text(), /差し込み位置/);

  const noAssets = await handleFeedPage({
    request: new Request("https://slytxt.dev/feed/"),
    env: {},
    next: async () => new Response("next"),
    waitUntil: () => {}
  });
  assert.equal(noAssets.status, 500);
  assert.match(await noAssets.text(), /ASSETS/);
});

test("feed: D1 が読めないときは空に見せかけず 503 を返す", async () => {
  const broken = {
    prepare() {
      throw new Error("D1_ERROR: no such table: feed_posts");
    }
  };
  const response = await handleFeedPage(
    fakeContext({ db: broken, shell: `${FEED_START}${FEED_END}` })
  );
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /読めませんでした/);
  assert.match(body, /no such table/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("feed: 不正な before は 400 を返す", async () => {
  const response = await handleFeedPage(
    fakeContext({
      db: fakeDb([]),
      shell: "",
      url: "https://slytxt.dev/feed/?before=yesterday"
    })
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /ISO 8601/);
});

test("feed: トップページは最新3件だけを差し込み、続きは All posts に譲る", async () => {
  const rows = [
    row({ id: "p1", body: "いちばん新しい投稿" }),
    row({ id: "p2", body: "2番目の投稿" }),
    row({ id: "p3", body: "3番目の投稿" }),
    row({ id: "p4", body: "4番目の投稿" })
  ];
  const shell = `<main>${FEED_START}fallback${FEED_END}</main>`;
  const response = await handleHomeFeed(
    fakeContext({ db: fakeDb(rows), shell, url: "https://slytxt.dev/", shellPath: "/index.html" })
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(body.includes("いちばん新しい投稿"));
  assert.ok(body.includes("3番目の投稿"));
  assert.ok(!body.includes("4番目の投稿"));
  assert.ok(!body.includes("fallback"));
  assert.ok(!body.includes("feed-more"));
});

test("feed: トップページは D1 が読めなくても全体を返し、枠にだけ状態を出す", async () => {
  const broken = {
    prepare() {
      throw new Error("D1_ERROR: no such table: feed_posts");
    }
  };
  const response = await handleHomeFeed(
    fakeContext({
      db: broken,
      shell: `<main>${FEED_START}fallback${FEED_END}</main>`,
      url: "https://slytxt.dev/",
      shellPath: "/index.html"
    })
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /フィードを読み込めませんでした/);
  assert.ok(!body.includes("fallback"));
});

test("feed: トップページの目印が無ければ 500 を返す", async () => {
  const response = await handleHomeFeed(
    fakeContext({
      db: fakeDb([]),
      shell: "<main>no markers</main>",
      url: "https://slytxt.dev/",
      shellPath: "/index.html"
    })
  );
  assert.equal(response.status, 500);
  assert.match(await response.text(), /トップページの外枠に差し込み位置/);
});

test("escapeHtml は5文字を実体参照にする", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});
