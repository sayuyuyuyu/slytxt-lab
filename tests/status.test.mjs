import assert from "node:assert/strict";
import test from "node:test";
import worker from "../tools/status-cloudflare/src/index.mjs";

function memoryKv() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    }
  };
}

function envWith(token = "test-token") {
  return { STATUS_DATA: memoryKv(), STATUS_POST_TOKEN: token };
}

function req(path, options = {}) {
  return new Request(`https://status.slytxt.dev${path}`, options);
}

function postReq(body, token) {
  const headers = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = token;
  return req("/api/status", { method: "POST", headers, body });
}

test("status: token not config returns 500", async () => {
  const env = { STATUS_DATA: memoryKv() };
  const res = await worker.fetch(postReq(JSON.stringify({ status: "ok" }), "Bearer x"), env);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "not_configured" });
});

test("status: missing auth returns 401", async () => {
  const res = await worker.fetch(postReq(JSON.stringify({ status: "ok" })), envWith());
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unauthorized" });
});

test("status: wrong auth returns 401", async () => {
  const res = await worker.fetch(postReq(JSON.stringify({ status: "ok" }), "Bearer wrong"), envWith());
  assert.equal(res.status, 401);
});

test("status: invalid JSON returns 400", async () => {
  const res = await worker.fetch(postReq("not json", "Bearer test-token"), envWith());
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_json" });
});

test("status: non-object JSON returns 400", async () => {
  for (const body of ["[]", '"text"', "42", "null"]) {
    const res = await worker.fetch(postReq(body, "Bearer test-token"), envWith());
    assert.equal(res.status, 400, body);
  }
});

test("status: oversized body returns 413", async () => {
  const body = JSON.stringify({ status: "x".repeat(20000) });
  const res = await worker.fetch(postReq(body, "Bearer test-token"), envWith());
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "too_large" });
});

test("status: POST then GET returns saved value", async () => {
  const env = envWith();
  const payload = { status: "genki", heart_rate_bpm: 72, steps_today: 1234 };
  const postRes = await worker.fetch(postReq(JSON.stringify(payload), "Bearer test-token"), env);
  assert.equal(postRes.status, 200);
  assert.deepEqual(await postRes.json(), { ok: true });
  const getRes = await worker.fetch(req("/api/status"), env);
  assert.equal(getRes.status, 200);
  assert.deepEqual(await getRes.json(), payload);
});

test("status: GET with no data returns 404", async () => {
  const res = await worker.fetch(req("/api/status"), envWith());
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "no_data" });
});

test("status: unknown path returns 404", async () => {
  const res = await worker.fetch(req("/api/other"), envWith());
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
});

test("status: unsupported method returns 405", async () => {
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const res = await worker.fetch(req("/api/status", { method }), envWith());
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, POST");
  }
});
