import assert from "node:assert/strict";
import test from "node:test";
import {
  readFeed,
  readSnapshot,
  postUrl,
  shouldRefresh,
  AUTHORS_KEY,
} from "../src/lib/bookmarks/feed.ts";
import { lastJstBoundary, formatJst, formatRfc822 } from "../src/lib/bookmarks/format.ts";
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
        author: { id: "u1", username: "alice", name: "Alice & Bob" },
      },
    ],
  };

  const html = renderHtml(snapshot, RENDER_OPTIONS);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('<a href="https://example.com?a=1&amp;b=2"'));
  assert.ok(html.includes("Alice &amp; Bob"));
  assert.ok(html.includes('name="robots" content="noindex"'));

  const rss = renderRss(snapshot, RENDER_OPTIONS);
  assert.ok(rss.includes("<dc:creator>Alice &amp; Bob @alice</dc:creator>"));
  assert.ok(rss.includes("<link>https://x.com/alice/status/1</link>"));
  assert.ok(rss.includes("Fri, 25 Sep 2026 08:00:00 +0900"));

  const json = JSON.parse(renderJson(snapshot));
  assert.equal(json.items[0].author.username, "alice");
  assert.equal(json.error, null);
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
        author: { id: "u1", username: "alice", name: "Alice" },
      },
    ],
  };
  const code = renderEmbed(snapshot, RENDER_OPTIONS);

  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("https://x.com/alice/status/1"));
  assert.ok(code.includes("x-bookmarks"));
  assert.ok(code.includes("2026-09-25 08:00"));
});

test("unconnected embed still produces runnable JS", () => {
  const code = renderEmbed(null, RENDER_OPTIONS);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.includes("まだXと接続していません"));
});
