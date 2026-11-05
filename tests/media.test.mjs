import assert from "node:assert/strict";
import test from "node:test";
import worker from "../tools/media-cloudflare/src/index.mjs";

const HASH_KEY = "0123456789abcdef0123456789abcdef.jpg";
const UUID_KEY = "11111111-2222-4333-8444-555555555555.png";

function memoryR2(objects = {}) {
  const requested = [];
  const store = new Map(Object.entries(objects));
  return {
    requested,
    async get(key) {
      requested.push(key);
      const obj = store.get(key);
      if (!obj) return null;
      return { body: obj.body, size: obj.size, httpEtag: obj.httpEtag, httpMetadata: obj.httpMetadata };
    },
    async head(key) {
      requested.push(key);
      const obj = store.get(key);
      if (!obj) return null;
      return { size: obj.size, httpEtag: obj.httpEtag, httpMetadata: obj.httpMetadata };
    }
  };
}

function stored(body = "image-bytes", overrides = {}) {
  return { body, size: body.length, httpEtag: '"abc123"', httpMetadata: { contentType: "image/jpeg" }, ...overrides };
}

function envWith(objects) {
  return { MEDIA: memoryR2(objects) };
}

function req(path, options = {}) {
  return new Request(`https://media.slytxt.dev${path}`, options);
}

test("media: valid hash key is fetched with pub/ prefix and returns 200", async () => {
  const env = envWith({ [`pub/${HASH_KEY}`]: stored() });
  const res = await worker.fetch(req(`/${HASH_KEY}`), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "image-bytes");
  assert.deepEqual(env.MEDIA.requested, [`pub/${HASH_KEY}`]);
});

test("media: valid uuid key returns 200", async () => {
  const env = envWith({ [`pub/${UUID_KEY}`]: stored("png-bytes", { httpMetadata: { contentType: "image/png" } }) });
  const res = await worker.fetch(req(`/${UUID_KEY}`), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
});

test("media: draft/ objects are never served", async () => {
  const env = envWith({ [`draft/${HASH_KEY}`]: stored() });
  const res = await worker.fetch(req(`/${HASH_KEY}`), env);
  assert.equal(res.status, 404);
  assert.deepEqual(env.MEDIA.requested, [`pub/${HASH_KEY}`]);
});

test("media: malformed keys return 404 without touching R2", async () => {
  const env = envWith({ [`pub/${HASH_KEY}`]: stored() });
  for (const path of ["/", "/not-a-key.jpg", "/0123456789abcdef.jpg", `/${HASH_KEY}.bak`, "/0123456789abcdef0123456789abcdef.svg", "/0123456789ABCDEF0123456789ABCDEF.jpg", "/../draft/0123456789abcdef0123456789abcdef.jpg", "/pub/0123456789abcdef0123456789abcdef.jpg"]) {
    const res = await worker.fetch(req(path), env);
    assert.equal(res.status, 404, path);
  }
  assert.deepEqual(env.MEDIA.requested, []);
});

test("media: missing object returns 404", async () => {
  const env = envWith({});
  const res = await worker.fetch(req(`/${HASH_KEY}`), env);
  assert.equal(res.status, 404);
});

test("media: non GET/HEAD methods return 405", async () => {
  const env = envWith({ [`pub/${HASH_KEY}`]: stored() });
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await worker.fetch(req(`/${HASH_KEY}`, { method }), env);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  }
});

test("media: HEAD returns content-length without body", async () => {
  const env = envWith({ [`pub/${HASH_KEY}`]: stored("12345678") });
  const res = await worker.fetch(req(`/${HASH_KEY}`, { method: "HEAD" }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), "8");
  assert.equal(await res.text(), "");
  assert.deepEqual(env.MEDIA.requested, [`pub/${HASH_KEY}`]);
});

test("media: response carries long cache headers and etag", async () => {
  const env = envWith({ [`pub/${HASH_KEY}`]: stored() });
  const res = await worker.fetch(req(`/${HASH_KEY}`), env);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("etag"), '"abc123"');
  assert.equal(res.headers.get("content-type"), "image/jpeg");
});

test("media: content-type falls back to extension when metadata is missing", async () => {
  const env = envWith({ [`pub/${UUID_KEY}`]: stored("x", { httpMetadata: undefined, httpEtag: '"e1"' }) });
  const res = await worker.fetch(req(`/${UUID_KEY}`), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
});
