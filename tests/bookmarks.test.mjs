import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyError,
  readFeed,
  readSnapshot,
  postUrl,
  shouldRefresh,
  AUTHORS_KEY,
} from "../src/lib/bookmarks/feed.ts";
import { createXClient, XApiError, TOKEN_KEY } from "../src/lib/bookmarks/x.ts";
import {
  lastJstBoundary,
  formatJst,
  formatJstWithWeekday,
  formatRfc822,
} from "../src/lib/bookmarks/format.ts";
import { matchesSecret } from "../src/lib/bookmarks/secret.ts";
import { renderEmbed, renderHtml, renderJson, renderRss } from "../src/lib/bookmarks/render.ts";

function memoryStore() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function fakeX({ posts = [], authors = [], fail = false } = {}) {
  const authorCalls = [];
  return {
    authorCalls,
    async accessToken() {
      return "token";
    },
    async bookmarks() {
      if (fail) throw new Error("X API が 500 を返しました。");
      return posts;
    },
    async authors(ids) {
      authorCalls.push([...ids]);
      return authors.filter((author) => ids.includes(author.id));
    },
  };
}

const RENDER_OPTIONS = {
  siteName: "slytxt.lab",
  siteUrl: "https://slytxt.dev/",
  pageUrl: "https://slytxt.dev/bm/secret/",
  rssUrl: "https://slytxt.dev/bm/secret/rss.xml",
  jsonUrl: "https://slytxt.dev/bm/secret/bookmarks.json",
  count: 15,
};

test("JST boundary is the most recent 9:00 JST, rolling back before it", () => {
  assert.equal(
    lastJstBoundary(new Date("2026-09-25T00:00:00Z"), 9).toISOString(),
    "2026-09-25T00:00:00.000Z",
  );
  assert.equal(
    lastJstBoundary(new Date("2026-09-25T08:59:59Z"), 9).toISOString(),
    "2026-09-25T00:00:00.000Z",
  );
  assert.equal(
    lastJstBoundary(new Date("2026-09-24T23:00:00Z"), 9).toISOString(),
    "2026-09-24T00:00:00.000Z",
  );
});

test("JST formatting avoids Intl locale data", () => {
  assert.equal(formatJst("2026-09-25T00:00:00Z"), "2026-09-25 09:00");
  assert.equal(formatRfc822("2026-09-24T23:00:00Z"), "Fri, 25 Sep 2026 08:00:00 +0900");
});

test("refresh policy waits for the boundary and the retry window", () => {
  const boundary = new Date("2026-09-25T00:00:00Z");
  const policy = { retryMinutes: 10 };
  const snapshot = {
    updatedAt: "2026-09-24T00:00:00.000Z",
    attemptedAt: "2026-09-24T00:00:00.000Z",
    items: [],
  };

  assert.equal(shouldRefresh(null, new Date("2026-09-25T01:00:00Z"), boundary, policy), true);
  assert.equal(
    shouldRefresh(snapshot, new Date("2026-09-25T01:00:00Z"), boundary, policy),
    true,
  );

  const attempted = { ...snapshot, attemptedAt: "2026-09-24T23:55:00.000Z" };
  assert.equal(
    shouldRefresh(attempted, new Date("2026-09-25T00:04:00Z"), boundary, policy),
    false,
  );
  assert.equal(
    shouldRefresh(attempted, new Date("2026-09-25T00:11:00Z"), boundary, policy),
    true,
  );

  // 同じ日に成功済みなら、次は境界をまたぐまで取り直さない。
  const done = { ...snapshot, attemptedAt: "2026-09-25T01:00:00.000Z" };
  assert.equal(shouldRefresh(done, new Date("2026-09-25T05:00:00Z"), boundary, policy), false);

  // 失敗していれば、同じ日でも retryMinutes 後に取り直す。
  const failed = { ...done, error: "X API が 500 を返しました。" };
  assert.equal(
    shouldRefresh(failed, new Date("2026-09-25T01:05:00Z"), boundary, policy),
    false,
  );
  assert.equal(
    shouldRefresh(failed, new Date("2026-09-25T01:11:00Z"), boundary, policy),
    true,
  );
});

test("secret comparison rejects missing, short, and wrong values", () => {
  assert.equal(matchesSecret("abc", "abc"), true);
  assert.equal(matchesSecret("abd", "abc"), false);
  assert.equal(matchesSecret("ab", "abc"), false);
  assert.equal(matchesSecret(undefined, "abc"), false);
  assert.equal(matchesSecret("abc", undefined), false);
});

test("reading the feed builds items and reuses the author cache", async () => {
  const store = memoryStore();
  const x = fakeX({
    posts: [
      {
        id: "1",
        text: "便利な記事 https://example.com",
        createdAt: "2026-09-24T23:00:00Z",
        authorId: "u1",
      },
    ],
    authors: [{ id: "u1", username: "alice", name: "Alice" }],
  });

  const first = await readFeed({
    store,
    x,
    now: new Date("2026-09-25T01:00:00Z"),
    boundary: new Date("2026-09-25T00:00:00Z"),
    count: 15,
    policy: { retryMinutes: 10 },
  });

  assert.equal(first.refreshed, true);
  assert.equal(first.snapshot.items.length, 1);
  assert.equal(first.snapshot.items[0].url, "https://x.com/alice/status/1");
  assert.equal(x.authorCalls.length, 1);

  const second = await readFeed({
    store,
    x,
    now: new Date("2026-09-26T01:00:00Z"),
    boundary: new Date("2026-09-26T00:00:00Z"),
    count: 15,
    policy: { retryMinutes: 10 },
  });

  assert.equal(second.refreshed, true);
  assert.equal(x.authorCalls.length, 1, "cached authors are not requested again");
  assert.ok((await store.get(AUTHORS_KEY)).includes("alice"));
});

test("a failed refresh keeps the previous items and records the reason", async () => {
  const store = memoryStore();
  const posts = [
    { id: "1", text: "keep me", createdAt: "2026-09-24T23:00:00Z", authorId: "u1" },
  ];
  const authors = [{ id: "u1", username: "alice", name: "Alice" }];

  await readFeed({
    store,
    x: fakeX({ posts, authors }),
    now: new Date("2026-09-25T01:00:00Z"),
    boundary: new Date("2026-09-25T00:00:00Z"),
    count: 15,
    policy: { retryMinutes: 10 },
  });

  const failed = await readFeed({
    store,
    x: fakeX({ posts, authors, fail: true }),
    now: new Date("2026-09-26T01:00:00Z"),
    boundary: new Date("2026-09-26T00:00:00Z"),
    count: 15,
    policy: { retryMinutes: 10 },
  });

  assert.equal(failed.snapshot.error, "X API が 500 を返しました。");
  assert.equal(failed.snapshot.items.length, 1);
  assert.equal(failed.snapshot.updatedAt, "2026-09-25T01:00:00.000Z");
  assert.equal((await readSnapshot(store)).items[0].text, "keep me");
});

test("postUrl falls back when the handle is unknown", () => {
  assert.equal(
    postUrl({ id: "u1", username: "alice", name: "Alice" }, "9"),
    "https://x.com/alice/status/9",
  );
  assert.equal(
    postUrl({ id: "u1", username: "", name: "不明なアカウント" }, "9"),
    "https://x.com/i/status/9",
  );
});

test("rendering escapes markup, linkifies bare URLs, and hides the page", () => {
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "<script>alert(1)</script> https://example.com?a=1&b=2",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: { id: "u1", username: "alice", name: "Alice & Bob", avatar: "https://pbs.twimg.com/a.jpg" },
      },
    ],
  };

  const html = renderHtml(snapshot, RENDER_OPTIONS);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('<a href="https://example.com?a=1&amp;b=2"'));
  assert.ok(html.includes("Alice &amp; Bob"));
  assert.ok(html.includes('name="robots" content="noindex"'));
  assert.ok(html.includes('<li class="card" data-author="alice">'));
  assert.ok(html.includes('<img class="card__avatar" src="https://pbs.twimg.com/a.jpg"'));
  assert.ok(html.includes('<p class="card__text">'));

  const rss = renderRss(snapshot, RENDER_OPTIONS);
  assert.ok(rss.includes("<dc:creator>Alice &amp; Bob @alice</dc:creator>"));
  assert.ok(rss.includes("<link>https://x.com/alice/status/1</link>"));
  assert.ok(rss.includes("Fri, 25 Sep 2026 08:00:00 +0900"));

  const json = JSON.parse(renderJson(snapshot));
  assert.equal(json.items[0].author.username, "alice");
  assert.equal(json.error, null);
});

test("RSS omits lastBuildDate when there is no snapshot yet", () => {
  const rss = renderRss(null, RENDER_OPTIONS);
  assert.ok(!rss.includes("lastBuildDate"));
  assert.ok(!rss.includes("1970"));

  const withSnapshot = renderRss(listSnapshot(1), RENDER_OPTIONS);
  assert.ok(
    withSnapshot.includes("<lastBuildDate>Fri, 25 Sep 2026 09:00:00 +0900</lastBuildDate>"),
  );
});

test("RSS title truncation counts code points and does not split an emoji", () => {
  const emoji = "\u{1F600}";
  const text = "a".repeat(79) + emoji + "bcdef";
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text,
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: { id: "u1", username: "alice", name: "Alice" },
      },
    ],
  };
  const rss = renderRss(snapshot, RENDER_OPTIONS);
  const expectedTitle = "a".repeat(79) + emoji + "\u2026";
  assert.ok(rss.includes(`<title>${expectedTitle}</title>`));
});

test("an author without an avatar falls back to an initial", () => {
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "hello",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: { id: "u1", username: "alice", name: "Alice" },
      },
    ],
  };
  const html = renderHtml(snapshot, RENDER_OPTIONS);
  assert.ok(html.includes('class="card__avatar card__avatar--fallback"'));
  assert.ok(html.includes('aria-hidden="true">A<'));

  const code = renderEmbed(snapshot, RENDER_OPTIONS);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("card__avatar--fallback"));
});

test("embed avatar initial is taken by code point, not code unit", () => {
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "hello",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: { id: "u1", username: "alice", name: "😀Alice" },
      },
    ],
  };
  const code = renderEmbed(snapshot, RENDER_OPTIONS);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(!code.includes("charAt(0)"));
  assert.ok(code.includes("[...item.name.trim()][0]"));
  // 先頭がサロゲートペアの絵文字でも、頭文字は丸ごと1文字になる。
  assert.equal([..."😀Alice".trim()][0], "😀");
});

test("bookmark list page wraps its content in a main landmark", () => {
  const html = renderHtml(null, RENDER_OPTIONS);
  assert.ok(html.includes('<main id="main-content" class="wrap" tabindex="-1">'));
  assert.ok(!html.includes('<div class="wrap">'));
  assert.ok(html.indexOf('<main id="main-content" class="wrap" tabindex="-1">') < html.indexOf('<div class="page-head">'));
  assert.ok(html.indexOf("</main>") > html.indexOf("まだXと接続していません"));
});

test("bookmark list page has a skip link to main content like the site", () => {
  const html = renderHtml(null, RENDER_OPTIONS);
  assert.ok(html.includes('<a class="skip-link" href="#main-content">Skip to content</a>'));
  assert.ok(html.indexOf('class="skip-link"') < html.indexOf('data-theme-toggle'));
  assert.ok(html.indexOf('class="skip-link"') < html.indexOf('<main id="main-content"'));
  assert.ok(html.includes('.skip-link{'));
  assert.ok(html.includes('.wrap:focus{outline:none}'));
});

test("bookmark list page carries the same favicon links as the site", () => {
  const html = renderHtml(null, RENDER_OPTIONS);
  assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'));
  assert.ok(html.includes('<link rel="icon" href="/favicon.ico" sizes="any">'));
  assert.ok(html.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'));
});

test("bookmark list page advertises its RSS feed for autodiscovery", () => {
  const html = renderHtml(null, RENDER_OPTIONS);
  assert.ok(
    html.includes(
      '<link rel="alternate" type="application/rss+xml" title="slytxt.lab" href="https://slytxt.dev/bm/secret/rss.xml">',
    ),
  );
});

test("rendering an unconnected feed says so instead of failing", () => {
  const html = renderHtml(null, RENDER_OPTIONS);
  assert.ok(html.includes("まだXと接続していません"));
  assert.equal(JSON.parse(renderJson(null)).items.length, 0);
});

test("embed script is valid JS and carries the feed data", () => {
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "</script> と https://example.com?a=1&b=2",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: { id: "u1", username: "alice", name: "Alice", avatar: "https://pbs.twimg.com/a.jpg" },
      },
    ],
  };
  const code = renderEmbed(snapshot, RENDER_OPTIONS);

  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("https://x.com/alice/status/1"));
  assert.ok(code.includes("https://pbs.twimg.com/a.jpg"));
  assert.ok(code.includes("x-bookmarks"));
  assert.ok(code.includes("2026-09-25 08:00"));
});

test("unconnected embed still produces runnable JS", () => {
  const code = renderEmbed(null, RENDER_OPTIONS);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("まだXと接続していません"));
});

test("X client follows pagination until the requested count", async () => {
  const store = memoryStore();
  await store.put(
    TOKEN_KEY,
    JSON.stringify({
      refreshToken: "r",
      accessToken: "a",
      expiresAt: Date.now() + 3600_000,
      userId: "me",
    }),
  );
  const seen = [];
  const pages = [
    {
      data: [
        { id: "1", text: "one", created_at: "2026-09-24T00:00:00Z", author_id: "u1" },
        { id: "2", text: "two", created_at: "2026-09-24T00:00:00Z", author_id: "u1" },
      ],
      meta: { next_token: "next-2" },
    },
    {
      data: [
        { id: "3", text: "three", created_at: "2026-09-24T00:00:00Z", author_id: "u2" },
        { id: "4", text: "four", created_at: "2026-09-24T00:00:00Z", author_id: "u2" },
      ],
      meta: {},
    },
  ];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return { ok: true, json: async () => pages[seen.length - 1], text: async () => "" };
  };
  const client = createXClient(store, {
    clientId: "client",
    fetch: fetchImpl,
    now: () => Date.now(),
  });

  const posts = await client.bookmarks(3);
  assert.deepEqual(
    posts.map((post) => post.id),
    ["1", "2", "3"],
  );
  assert.equal(seen.length, 2);
  assert.ok(seen[1].includes("pagination_token=next-2"));
});

test("error classification separates reauthorization from temporary failures", () => {
  assert.equal(classifyError(new XApiError(401, "", "unauthorized")), "auth");
  assert.equal(classifyError(new XApiError(400, "invalid_grant", "bad")), "auth");
  assert.equal(
    classifyError(new Error("トークンを更新できませんでした。Xでの再認可が必要かもしれません。")),
    "auth",
  );
  assert.equal(classifyError(new Error("まだXと接続していません。")), "auth");
  assert.equal(classifyError(new XApiError(500, "", "X API が 500 を返しました。")), "temporary");
  assert.equal(classifyError(new Error("network down")), "temporary");
});

test("a failed refresh records the error kind alongside the reason", async () => {
  const store = memoryStore();
  const failing = {
    async accessToken() {
      return "token";
    },
    async bookmarks() {
      throw new XApiError(401, "", "X API が 401 を返しました。");
    },
    async authors() {
      return [];
    },
  };
  const failed = await readFeed({
    store,
    x: failing,
    now: new Date("2026-09-25T01:00:00Z"),
    boundary: new Date("2026-09-25T00:00:00Z"),
    count: 100,
    policy: { retryMinutes: 10 },
  });
  assert.equal(failed.snapshot.errorKind, "auth");
  const json = JSON.parse(renderJson(failed.snapshot));
  assert.equal(json.errorKind, "auth");
  assert.equal(json.error, "X API が 401 を返しました。");
});

function listSnapshot(itemCount) {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: String(index + 1),
    text: `投稿 ${index + 1}`,
    createdAt: "2026-09-24T23:00:00Z",
    url: `https://x.com/alice/status/${index + 1}`,
    author: { id: "u1", username: "alice", name: "Alice" },
  }));
  return {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items,
  };
}

test("list page shows the first items and folds the rest behind a more button", () => {
  const options = { ...RENDER_OPTIONS, count: 100, initialCount: 2, embedCount: 15 };
  const html = renderHtml(listSnapshot(3), options);
  assert.equal((html.match(/<li class="card" data-author="alice">/g) ?? []).length, 2);
  assert.equal((html.match(/<li class="card" data-author="alice" hidden>/g) ?? []).length, 1);
  assert.ok(html.includes("もっと見る（あと1件）"));
});

test("list page noscript style only unhides folded cards", () => {
  const options = { ...RENDER_OPTIONS, count: 100, initialCount: 2, embedCount: 15 };
  const html = renderHtml(listSnapshot(3), options);
  const noscript = html.match(/<noscript><style>([^<]*)<\/style><\/noscript>/)?.[1] ?? "";
  // Only folded cards are unhidden: a bare [hidden] rule would also reveal
  // the no-match note and the hidden avatar fallback.
  assert.ok(noscript.includes(".card[hidden]{display:block!important}"));
  assert.ok(!/(^|})\[hidden\]\{/.test(noscript));
});

test("list page notice wording depends on the error kind", () => {
  const base = listSnapshot(1);
  const authHtml = renderHtml(
    { ...base, error: "X API が 401 を返しました。", errorKind: "auth" },
    RENDER_OPTIONS,
  );
  assert.ok(authHtml.includes("再接続が必要です"));

  const tempHtml = renderHtml(
    { ...base, error: "X API が 500 を返しました。", errorKind: "temporary" },
    RENDER_OPTIONS,
  );
  assert.ok(tempHtml.includes("最新の取得に失敗しました"));
  assert.ok(!tempHtml.includes("再接続が必要です"));
});

test("embed output is capped by embedCount", () => {
  const options = { ...RENDER_OPTIONS, count: 100, embedCount: 2 };
  const code = renderEmbed(listSnapshot(3), options);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("投稿 2"));
  assert.ok(!code.includes("投稿 3"));
});

test("weekday formatting adds the Japanese weekday", () => {
  assert.equal(formatJstWithWeekday("2026-09-25T00:00:00Z"), "2026-09-25（金）09:00");
});

test("mentions and hashtags are linkified, URLs are left whole", () => {
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "@alice さんの #Astro 紹介 https://example.com/path#frag と #日本語タグ",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/bob/status/1",
        author: { id: "u2", username: "bob", name: "Bob" },
      },
    ],
  };
  const html = renderHtml(snapshot, RENDER_OPTIONS);
  assert.ok(html.includes('<a href="https://x.com/alice"'));
  assert.ok(html.includes('<a href="https://x.com/hashtag/Astro"'));
  assert.ok(html.includes('<a href="https://x.com/hashtag/日本語タグ"'));
  // URL の中の # はハッシュタグとして拾わない。
  assert.ok(html.includes('<a href="https://example.com/path#frag"'));
  assert.ok(!html.includes("hashtag/frag"));
  // メールアドレス風の @ は拾わない。
  const mail = renderHtml(
    {
      ...snapshot,
      items: [{ ...snapshot.items[0], text: "連絡は mail@example.com まで" }],
    },
    RENDER_OPTIONS,
  );
  assert.ok(!mail.includes("https://x.com/example"));
});

test("an avatar image carries an initial fallback for load failures", () => {
  const snapshot = {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "hello",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: {
          id: "u1",
          username: "alice",
          name: "Alice",
          avatar: "https://pbs.twimg.com/a.jpg",
        },
      },
    ],
  };
  const html = renderHtml(snapshot, RENDER_OPTIONS);
  assert.ok(html.includes("onerror="));
  assert.ok(html.includes('card__avatar--fallback" aria-hidden="true" hidden>A<'));

  const code = renderEmbed(snapshot, RENDER_OPTIONS);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("img.onerror"));
});

test("list page has keyword and author filters plus a site-like frame", () => {
  const html = renderHtml(listSnapshot(3), {
    ...RENDER_OPTIONS,
    count: 100,
    initialCount: 30,
  });
  assert.ok(html.includes("data-filter-keyword"));
  assert.ok(html.includes("data-filter-author"));
  assert.ok(html.includes('<option value="alice">Alice（@alice）</option>'));
  assert.ok(html.includes("絞り込みを解除"));
  assert.ok(html.includes('class="site-header"'));
  assert.ok(html.includes('class="site-footer"'));
  assert.ok(html.includes("data-theme-toggle"));
  // テーマはサイト本体と同じ localStorage キーで初期化する。
  assert.ok(html.includes('localStorage.getItem("theme")'));
});

test("list page theme toggle mirrors the main site toggle", () => {
  const html = renderHtml(listSnapshot(1), RENDER_OPTIONS);
  // theme-color starts dark and follows the stored theme, like BaseLayout.
  assert.ok(html.includes('<meta name="theme-color" content="#05070f">'));
  assert.ok(html.includes('data-theme-icon'));
  assert.ok(html.includes('aria-label="Toggle theme"'));
  // THEME_SCRIPT swaps the icon and label for the current theme and
  // follows storage events, including a full clear (key === null).
  assert.ok(html.includes("Switch to light mode"));
  assert.ok(html.includes("Switch to dark mode"));
  assert.ok(html.includes("event.key !== \"theme\" && event.key !== null"));
});

test("X client maps media expansions onto posts", async () => {
  const store = memoryStore();
  await store.put(
    TOKEN_KEY,
    JSON.stringify({
      refreshToken: "r",
      accessToken: "a",
      expiresAt: Date.now() + 3600_000,
      userId: "me",
    }),
  );
  const payload = {
    data: [
      {
        id: "1",
        text: "写真つき",
        created_at: "2026-09-24T00:00:00Z",
        author_id: "u1",
        attachments: { media_keys: ["k-photo", "k-video", "k-gif", "k-missing"] },
      },
    ],
    includes: {
      media: [
        {
          media_key: "k-photo",
          type: "photo",
          url: "https://pbs.twimg.com/media/photo.jpg",
          width: 1200,
          height: 800,
          alt_text: "写真の説明",
        },
        {
          media_key: "k-video",
          type: "video",
          preview_image_url: "https://pbs.twimg.com/media/poster.jpg",
          width: 1280,
          height: 720,
          variants: [
            { content_type: "application/x-mpegURL", url: "https://video.twimg.com/pl.m3u8" },
            { content_type: "video/mp4", bit_rate: 832000, url: "https://video.twimg.com/low.mp4" },
            { content_type: "video/mp4", bit_rate: 2176000, url: "https://video.twimg.com/high.mp4" },
          ],
        },
        {
          media_key: "k-gif",
          type: "animated_gif",
          preview_image_url: "https://pbs.twimg.com/media/gif.jpg",
          variants: [
            { content_type: "video/mp4", bit_rate: 0, url: "https://video.twimg.com/gif.mp4" },
          ],
        },
      ],
    },
    meta: {},
  };
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return { ok: true, json: async () => payload, text: async () => "" };
  };
  const client = createXClient(store, {
    clientId: "client",
    fetch: fetchImpl,
    now: () => Date.now(),
  });

  const posts = await client.bookmarks(10);
  assert.equal(posts.length, 1);
  assert.ok(seen[0].includes("expansions=attachments.media_keys"));
  assert.deepEqual(posts[0].media, [
    {
      kind: "photo",
      image: "https://pbs.twimg.com/media/photo.jpg",
      width: 1200,
      height: 800,
      alt: "写真の説明",
    },
    {
      kind: "video",
      image: "https://pbs.twimg.com/media/poster.jpg",
      videoUrl: "https://video.twimg.com/high.mp4",
      width: 1280,
      height: 720,
      alt: undefined,
    },
    {
      kind: "gif",
      image: "https://pbs.twimg.com/media/gif.jpg",
      videoUrl: "https://video.twimg.com/gif.mp4",
      width: undefined,
      height: undefined,
      alt: undefined,
    },
  ]);
});

test("feed keeps media on snapshot items and omits it when empty", async () => {
  const store = memoryStore();
  const x = fakeX({
    posts: [
      {
        id: "1",
        text: "写真つき",
        createdAt: "2026-09-24T23:00:00Z",
        authorId: "u1",
        media: [{ kind: "photo", image: "https://pbs.twimg.com/media/photo.jpg" }],
      },
      {
        id: "2",
        text: "メディアなし",
        createdAt: "2026-09-24T22:00:00Z",
        authorId: "u1",
        media: [],
      },
    ],
    authors: [{ id: "u1", username: "alice", name: "Alice" }],
  });
  const { snapshot } = await readFeed({
    store,
    x,
    now: new Date("2026-09-25T01:00:00Z"),
    boundary: new Date("2026-09-25T00:00:00Z"),
    count: 15,
    policy: { retryMinutes: 10 },
  });
  assert.deepEqual(snapshot.items[0].media, [
    { kind: "photo", image: "https://pbs.twimg.com/media/photo.jpg" },
  ]);
  assert.equal("media" in snapshot.items[1], false);
});

function mediaSnapshot() {
  return {
    updatedAt: "2026-09-25T00:00:00Z",
    attemptedAt: "2026-09-25T00:00:00Z",
    items: [
      {
        id: "1",
        text: "写真の投稿です",
        createdAt: "2026-09-24T23:00:00Z",
        url: "https://x.com/alice/status/1",
        author: { id: "u1", username: "alice", name: "Alice" },
        media: [
          {
            kind: "photo",
            image: "https://pbs.twimg.com/media/photo.jpg",
            width: 1200,
            height: 800,
          },
        ],
      },
      {
        id: "2",
        text: "動画の投稿です",
        createdAt: "2026-09-24T22:00:00Z",
        url: "https://x.com/alice/status/2",
        author: { id: "u1", username: "alice", name: "Alice" },
        media: [
          {
            kind: "video",
            image: "https://pbs.twimg.com/media/poster.jpg",
            videoUrl: "https://video.twimg.com/movie.mp4",
            width: 1280,
            height: 720,
          },
          {
            kind: "gif",
            image: "https://pbs.twimg.com/media/gif.jpg",
            videoUrl: "https://video.twimg.com/gif.mp4",
          },
        ],
      },
      {
        id: "3",
        text: "mp4 が無い動画",
        createdAt: "2026-09-24T21:00:00Z",
        url: "https://x.com/alice/status/3",
        author: { id: "u1", username: "alice", name: "Alice" },
        media: [{ kind: "video", image: "https://pbs.twimg.com/media/still.jpg" }],
      },
    ],
  };
}

test("list page renders photos, videos, and gifs inside the card", () => {
  const html = renderHtml(mediaSnapshot(), RENDER_OPTIONS);
  // 写真は遅延読み込みの img で、alt は本文から補う。
  assert.ok(
    html.includes(
      '<img class="card__media-item" src="https://pbs.twimg.com/media/photo.jpg" alt="写真の投稿です" width="1200" height="800" loading="lazy" decoding="async">',
    ),
  );
  assert.ok(html.includes('<div class="card__media card__media--1">'));
  // 動画は poster 付きで、開くまで読み込まない。
  assert.ok(
    html.includes(
      '<video class="card__media-item" src="https://video.twimg.com/movie.mp4" poster="https://pbs.twimg.com/media/poster.jpg" width="1280" height="720" controls playsinline preload="none"',
    ),
  );
  // GIF は無音ループでそのまま流す。
  assert.ok(html.includes("autoplay muted loop playsinline preload=\"metadata\""));
  assert.ok(html.includes('<div class="card__media card__media--2">'));
  // mp4 が無い動画はプレビュー画像から投稿へ誘導する。
  assert.ok(
    html.includes(
      '<a class="card__media-link" href="https://x.com/alice/status/3" rel="noreferrer noopener" target="_blank"><img class="card__media-item" src="https://pbs.twimg.com/media/still.jpg"',
    ),
  );
});

test("list page no longer carries the explanatory lead paragraph", () => {
  const html = renderHtml(mediaSnapshot(), RENDER_OPTIONS);
  assert.ok(!html.includes('class="lead"'));
  assert.ok(!html.includes("1日1回、朝9時以降の最初のアクセスで取り直します"));
  // 件数表示のような UI 要素は残す。
  assert.ok(html.includes("件の投稿"));
});

test("embed carries media data and renders it in the card", () => {
  const code = renderEmbed(mediaSnapshot(), RENDER_OPTIONS);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("card__media"));
  assert.ok(code.includes("https://pbs.twimg.com/media/photo.jpg"));
  assert.ok(code.includes("https://video.twimg.com/movie.mp4"));
  assert.ok(code.includes("mediaNode"));
});
