import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as feedRequest } from "../functions/bm/[secret]/[[path]].ts";
import { onRequest as connectRequest } from "../functions/api/bookmarks/connect.ts";
import { onRequest as callbackRequest } from "../functions/api/bookmarks/callback.ts";
import { STATE_KEY } from "../src/lib/bookmarks/oauth.ts";

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

function context({ url, params = {}, env }) {
  return {
    request: new Request(url),
    params,
    env,
    next: async () => new Response("next", { status: 200 }),
    waitUntil: () => {},
  };
}

const SECRET = "test-secret-value";

function feedEnv(extra = {}) {
  return { BOOKMARKS: memoryStore(), BOOKMARKS_SECRET: SECRET, ...extra };
}

test("feed rejects a wrong secret for every format", async () => {
  for (const path of [[], ["rss.xml"], ["bookmarks.json"], ["embed.js"]]) {
    const response = await feedRequest(
      context({
        url: "https://slytxt.dev/bm/wrong/",
        params: { secret: "wrong", path },
        env: feedEnv(),
      }),
    );
    assert.equal(response.status, 404, `path=${path.join("/")}`);
  }
});

test("feed returns 404 for unknown paths under the secret", async () => {
  const response = await feedRequest(
    context({
      url: `https://slytxt.dev/bm/${SECRET}/nope.txt`,
      params: { secret: SECRET, path: ["nope.txt"] },
      env: feedEnv(),
    }),
  );
  assert.equal(response.status, 404);
});

test("feed serves all formats when X is not configured yet", async () => {
  const html = await feedRequest(
    context({
      url: `https://slytxt.dev/bm/${SECRET}/`,
      params: { secret: SECRET, path: [] },
      env: feedEnv(),
    }),
  );
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /text\/html/);
  assert.match(await html.text(), /まだXと接続していません/);

  const json = await feedRequest(
    context({
      url: `https://slytxt.dev/bm/${SECRET}/bookmarks.json`,
      params: { secret: SECRET, path: ["bookmarks.json"] },
      env: feedEnv(),
    }),
  );
  assert.equal(json.status, 200);
  const body = JSON.parse(await json.text());
  assert.deepEqual(body.items, []);
  assert.equal(body.errorKind, null);

  const rss = await feedRequest(
    context({
      url: `https://slytxt.dev/bm/${SECRET}/rss.xml`,
      params: { secret: SECRET, path: ["rss.xml"] },
      env: feedEnv(),
    }),
  );
  assert.equal(rss.status, 200);
  assert.match(rss.headers.get("content-type"), /application\/rss\+xml/);

  const embed = await feedRequest(
    context({
      url: `https://slytxt.dev/bm/${SECRET}/embed.js`,
      params: { secret: SECRET, path: ["embed.js"] },
      env: feedEnv(),
    }),
  );
  assert.equal(embed.status, 200);
  assert.match(embed.headers.get("content-type"), /text\/javascript/);
  assert.match(embed.headers.get("x-robots-tag"), /noindex/);
});

test("connect hides itself without the admin token", async () => {
  const env = {
    BOOKMARKS: memoryStore(),
    BOOKMARKS_ADMIN_TOKEN: "admin-token",
    X_CLIENT_ID: "client-id",
  };
  const noKey = await connectRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/connect", env }),
  );
  assert.equal(noKey.status, 404);

  const wrongKey = await connectRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/connect?key=nope", env }),
  );
  assert.equal(wrongKey.status, 404);
});

test("connect reports a missing X client id after the admin check", async () => {
  const env = { BOOKMARKS: memoryStore(), BOOKMARKS_ADMIN_TOKEN: "admin-token" };
  const response = await connectRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/connect?key=admin-token", env }),
  );
  assert.equal(response.status, 500);
});

test("connect redirects to the X authorize page and stores the state", async () => {
  const store = memoryStore();
  const env = {
    BOOKMARKS: store,
    BOOKMARKS_ADMIN_TOKEN: "admin-token",
    X_CLIENT_ID: "client-id",
  };
  const response = await connectRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/connect?key=admin-token", env }),
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://x.com/i/oauth2/authorize");
  assert.match(location.searchParams.get("scope"), /bookmark\.read/);
  const state = location.searchParams.get("state");
  assert.ok(state);
  // KV のキー形式は変えない（connect と callback が共有定義を参照する）。
  assert.equal(STATE_KEY, "oauth:");
  assert.ok(await store.get(`${STATE_KEY}${state}`), "PKCE verifier is stored under the state");
});

test("callback answers 400 without a code", async () => {
  const env = { BOOKMARKS: memoryStore(), X_CLIENT_ID: "client-id" };
  const response = await callbackRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/callback", env }),
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /接続できませんでした/);
});

test("callback surfaces the error X returned", async () => {
  const env = { BOOKMARKS: memoryStore(), X_CLIENT_ID: "client-id" };
  const response = await callbackRequest(
    context({
      url: "https://slytxt.dev/api/bookmarks/callback?error=access_denied",
      env,
    }),
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /access_denied/);
});

test("callback rejects an expired or unknown state", async () => {
  const env = { BOOKMARKS: memoryStore(), X_CLIENT_ID: "client-id" };
  const response = await callbackRequest(
    context({
      url: "https://slytxt.dev/api/bookmarks/callback?code=abc&state=unknown",
      env,
    }),
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /有効期限が切れています/);
});

test("callback page follows the stored site theme instead of the OS setting", async () => {
  const env = { BOOKMARKS: memoryStore() };
  const response = await callbackRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/callback?code=abc&state=x", env }),
  );
  const html = await response.text();
  // theme-color starts dark and the init script follows localStorage, like the list page.
  assert.ok(html.includes('<meta name="theme-color" content="#05070f">'));
  assert.ok(html.includes('localStorage.getItem("theme")==="light"'));
  assert.ok(html.includes('classList.toggle("light",isLight)'));
  // Light colors apply only under :root.light, never from the OS setting.
  assert.ok(html.includes(":root.light body{background:#eef3fb;color:#0b1220}"));
  assert.ok(html.includes(":root.light a{color:#0b63c4}"));
  assert.ok(!html.includes("prefers-color-scheme"));
  // Print rules stay after the light rules so print colors win in both themes.
  assert.ok(html.indexOf(":root.light a") < html.indexOf("@media print"));
});

test("callback answers 500 when the X client id is missing", async () => {
  const env = { BOOKMARKS: memoryStore() };
  const response = await callbackRequest(
    context({ url: "https://slytxt.dev/api/bookmarks/callback?code=abc&state=x", env }),
  );
  assert.equal(response.status, 500);
});
