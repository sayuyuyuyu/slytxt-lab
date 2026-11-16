import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_TYPES,
  MAX_IMAGES,
  feedMediaKey,
  feedPostId,
  firstUrl,
  isPublicHttpUrl,
  normalizeCompose,
  parseOgp
} from "../src/lib/feed/compose.ts";
import { handleFeedApi, writeAllowed } from "../src/lib/feed/api.ts";

/* ---- 組み立て・検証 ---- */

test("compose: ID は時刻順に並ぶ26文字", () => {
  const early = feedPostId(Date.parse("2026-11-16T09:00:00.000Z"), () => 0);
  const late = feedPostId(Date.parse("2026-11-16T10:00:00.000Z"), () => 0);
  assert.equal(early.length, 26);
  assert.match(early, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(early < late, "遅い時刻の ID が後に並ぶ");
});

test("compose: 画像キーは media Worker が配信できる形になる", () => {
  const key = feedMediaKey("image/jpeg", () => 0.5);
  assert.match(key, /^[0-9a-f]{32}\.jpg$/);
  assert.equal(feedMediaKey("image/webp", () => 0), `${"0".repeat(32)}.webp`);
  assert.equal(feedMediaKey("image/svg+xml"), null);
  assert.equal(feedMediaKey("text/plain"), null);
  assert.deepEqual(Object.keys(IMAGE_TYPES), ["image/jpeg", "image/png", "image/gif", "image/webp"]);
});

test("compose: 本文から最初の URL を取る", () => {
  assert.equal(firstUrl("見てこれ https://example.com/a あとで"), "https://example.com/a");
  assert.equal(firstUrl("URL なし"), null);
  assert.equal(firstUrl("https://example.com/a）"), "https://example.com/a");
});

test("compose: ローカルや私有アドレスは取りに行かない", () => {
  for (const bad of [
    "http://localhost:8787/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.10/",
    "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://printer.local/",
    "ftp://example.com/"
  ]) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
  assert.equal(isPublicHttpUrl("https://example.com/"), true);
});

test("compose: OGP を読み、相対 URL を解決し、実体参照を戻す", () => {
  const html = `<html><head>
    <meta property="og:title" content="タイトル &amp; サブ" />
    <meta property="og:description" content="説明" />
    <meta property="og:image" content="/og.png" />
    <meta property="og:site_name" content="Example" />
  </head></html>`;
  assert.deepEqual(parseOgp(html, "https://example.com/post/1"), {
    url: "https://example.com/post/1",
    title: "タイトル & サブ",
    description: "説明",
    image: "https://example.com/og.png",
    site: "Example"
  });
});

test("compose: OGP が無ければ title / description で代替し、site はホスト名", () => {
  const html = `<html><head><title>ページ題名</title>
    <meta name="description" content="要約です" /></head></html>`;
  const link = parseOgp(html, "https://www.example.com/a");
  assert.equal(link.title, "ページ題名");
  assert.equal(link.description, "要約です");
  assert.equal(link.site, "example.com");
  assert.equal(link.image, undefined);
});

test("compose: 本文と画像の検証", () => {
  assert.deepEqual(normalizeCompose({ body: "  こんにちは  " }), {
    ok: true,
    body: "こんにちは",
    images: []
  });
  assert.equal(normalizeCompose({ body: "   " }).ok, false);
  assert.equal(normalizeCompose({ body: "あ".repeat(2001) }).ok, false);
  assert.equal(normalizeCompose({ body: "x", images: "no" }).ok, false);
  assert.equal(
    normalizeCompose({ body: "x", images: Array.from({ length: MAX_IMAGES + 1 }, () => ({})) }).ok,
    false
  );
  assert.equal(normalizeCompose({ body: "x", images: [{ key: "abc.jpg" }] }).ok, false);
  const ok = normalizeCompose({
    body: "x",
    images: [{ key: `${"a".repeat(32)}.png`, alt: "  説明  " }]
  });
  assert.deepEqual(ok, {
    ok: true,
    body: "x",
    images: [{ key: `${"a".repeat(32)}.png`, alt: "説明" }]
  });
  assert.equal(
    normalizeCompose({ body: "x", images: [{ key: `${"a".repeat(32)}.png`, alt: "あ".repeat(201) }] })
      .ok,
    false
  );
});

/* ---- Worker のハンドラ ---- */

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, params: [] };
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
          return { success: true };
        }
      };
      return statement;
    }
  };
}

function fakeMedia(existing = []) {
  const puts = [];
  const store = new Set(existing);
  return {
    puts,
    store,
    async put(key, _body, options) {
      puts.push({ key, contentType: options?.httpMetadata?.contentType });
      store.add(key);
    },
    async head(key) {
      return store.has(key) ? { key } : null;
    }
  };
}

const PNG_KEY = `${"a".repeat(32)}.png`;

function request(path, init = {}) {
  return new Request(`https://feed.slytxt.dev${path}`, init);
}

const writeHeaders = { "x-slytxt-client": "1", "content-type": "application/json" };

test("api: 書き込みは独自ヘッダと同一オリジンを要求する", () => {
  assert.equal(writeAllowed(request("/api/posts", { method: "POST" })), false);
  assert.equal(
    writeAllowed(request("/api/posts", { method: "POST", headers: { "x-slytxt-client": "1" } })),
    true
  );
  assert.equal(
    writeAllowed(
      request("/api/posts", {
        method: "POST",
        headers: { "x-slytxt-client": "1", origin: "https://evil.example", host: "feed.slytxt.dev" }
      })
    ),
    false
  );
});

test("api: ガードを通らない POST は 403", async () => {
  const response = await handleFeedApi({
    request: request("/api/posts", { method: "POST" }),
    env: { FEED: fakeDb(), MEDIA: fakeMedia() }
  });
  assert.equal(response.status, 403);
});

test("api: 画像は R2 の pub/ に置き、キーと URL を返す", async () => {
  const media = fakeMedia();
  const response = await handleFeedApi({
    request: request("/api/media", {
      method: "POST",
      headers: { "x-slytxt-client": "1", "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3])
    }),
    env: { FEED: fakeDb(), MEDIA: media }
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.match(payload.key, /^[0-9a-f]{32}\.png$/);
  assert.equal(payload.url, `https://media.slytxt.dev/${payload.key}`);
  assert.equal(media.puts.length, 1);
  assert.equal(media.puts[0].key, `pub/${payload.key}`);
  assert.equal(media.puts[0].contentType, "image/png");
});

test("api: 画像の種類違いと空・大きすぎは受け付けない", async () => {
  const media = fakeMedia();
  const unsupported = await handleFeedApi({
    request: request("/api/media", {
      method: "POST",
      headers: { "x-slytxt-client": "1", "content-type": "image/svg+xml" },
      body: new Uint8Array([1])
    }),
    env: { FEED: fakeDb(), MEDIA: media }
  });
  assert.equal(unsupported.status, 415);

  const empty = await handleFeedApi({
    request: request("/api/media", {
      method: "POST",
      headers: { "x-slytxt-client": "1", "content-type": "image/png" },
      body: new Uint8Array()
    }),
    env: { FEED: fakeDb(), MEDIA: media }
  });
  assert.equal(empty.status, 400);
  assert.equal(media.puts.length, 0);
});

test("api: 投稿は本文と画像を保存し、リンクカードを作る", async () => {
  const db = fakeDb();
  const media = fakeMedia([`pub/${PNG_KEY}`]);
  const fetched = [];
  const response = await handleFeedApi({
    request: request("/api/posts", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        body: "リンクです https://example.com/post",
        images: [{ key: PNG_KEY, alt: "写真の説明" }]
      })
    }),
    env: {
      FEED: db,
      MEDIA: media,
      FETCH: async (url) => {
        fetched.push(String(url));
        return new Response(
          `<html><head><meta property="og:title" content="例の記事" /><meta property="og:site_name" content="Example" /></head></html>`,
          { status: 200 }
        );
      }
    }
  });
  assert.equal(response.status, 201);
  assert.deepEqual(fetched, ["https://example.com/post"]);
  const { post } = await response.json();
  assert.equal(post.body, "リンクです https://example.com/post");
  assert.deepEqual(post.images, [{ key: PNG_KEY, alt: "写真の説明" }]);
  assert.equal(post.link.title, "例の記事");
  assert.equal(post.link.site, "Example");
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO feed_posts/);
  assert.equal(db.calls[0].params[1], "リンクです https://example.com/post");
});

test("api: リンク先が取れなくても投稿は成功し、カードを付けない", async () => {
  const db = fakeDb();
  const response = await handleFeedApi({
    request: request("/api/posts", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({ body: "https://example.com/down" })
    }),
    env: {
      FEED: db,
      MEDIA: fakeMedia(),
      FETCH: async () => {
        throw new Error("network down");
      }
    }
  });
  assert.equal(response.status, 201);
  const { post } = await response.json();
  assert.equal(post.link, undefined);
});

test("api: 未アップロードの画像キーでは投稿しない", async () => {
  const db = fakeDb();
  const response = await handleFeedApi({
    request: request("/api/posts", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({ body: "x", images: [{ key: PNG_KEY, alt: "" }] })
    }),
    env: { FEED: db, MEDIA: fakeMedia() }
  });
  assert.equal(response.status, 400);
  assert.equal(db.calls.length, 0);
});

test("api: 本文が空・長すぎる投稿は 400", async () => {
  for (const body of ["", "あ".repeat(2001)]) {
    const response = await handleFeedApi({
      request: request("/api/posts", {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ body })
      }),
      env: { FEED: fakeDb(), MEDIA: fakeMedia() }
    });
    assert.equal(response.status, 400, body.slice(0, 4));
  }
});

test("api: 一覧は before を検証して返す", async () => {
  const db = fakeDb([
    {
      id: "01JC0000000000000000000001",
      body: "投稿",
      created_at: "2026-11-16T10:00:00.000Z",
      images: "[]",
      link: null
    }
  ]);
  const ok = await handleFeedApi({ request: request("/api/posts"), env: { FEED: db } });
  assert.equal(ok.status, 200);
  const payload = await ok.json();
  assert.equal(payload.posts.length, 1);
  assert.equal(payload.posts[0].body, "投稿");

  const bad = await handleFeedApi({
    request: request("/api/posts?before=yesterday"),
    env: { FEED: db }
  });
  assert.equal(bad.status, 400);
});

test("api: 未知のパスは 404", async () => {
  const response = await handleFeedApi({ request: request("/api/unknown"), env: {} });
  assert.equal(response.status, 404);
});
