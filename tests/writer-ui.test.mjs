import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  isEmptyPayload,
  payloadOf,
  resolveCoverForSave,
  resolveLocalRestore,
  samePayload
} from "../tools/writer-cloudflare/src/draft-merge.mjs";

const serverDraft = {
  id: "2026-11-24",
  category: "tech",
  title: "題名",
  tags: [],
  cover: "/media/cover.jpg",
  description: "",
  body: "本文",
  updated: "2026-11-24T10:00:00Z"
};

test("draft-merge: payloadOf は collect() と同じ形にする", () => {
  assert.deepEqual(payloadOf(serverDraft), {
    category: "tech",
    title: "題名",
    tags: [],
    cover: "/media/cover.jpg",
    description: "",
    body: "本文"
  });
  // 「無題」は空タイトルとして扱う（collect() の入力と同じ）。
  assert.equal(payloadOf({ ...serverDraft, title: "無題" }).title, "");
});

test("draft-merge: 空の payload はすべての項目が空のときだけ", () => {
  assert.equal(
    isEmptyPayload({ category: "misc", title: "", tags: [], cover: "", description: "", body: "" }),
    true
  );
  assert.equal(isEmptyPayload({ body: " " , tags: [] }), true);
  assert.equal(isEmptyPayload({ body: "本文" }), false);
  assert.equal(isEmptyPayload({ tags: ["tag"] }), false);
  assert.equal(isEmptyPayload(null), true);
});

test("draft-merge: 端末コピーが無ければサーバーを使う", () => {
  assert.deepEqual(resolveLocalRestore({ serverDraft, local: null }), {
    useLocal: false,
    removeLocal: false,
    backupLocal: false
  });
});

test("draft-merge: サーバーと同じ内容の端末コピーは片付ける", () => {
  const local = {
    payload: payloadOf(serverDraft),
    base: serverDraft.updated,
    savedAt: "2026-11-24T11:00:00Z"
  };
  assert.deepEqual(resolveLocalRestore({ serverDraft, local }), {
    useLocal: false,
    removeLocal: true,
    backupLocal: false
  });
});

test("draft-merge: 空の端末コピーは、中身のある下書きを上書きしない", () => {
  const local = {
    payload: { category: "misc", title: "", tags: [], cover: "", description: "", body: "" },
    base: serverDraft.updated,
    savedAt: "2026-11-24T11:00:00Z"
  };
  assert.deepEqual(resolveLocalRestore({ serverDraft, local }), {
    useLocal: false,
    removeLocal: true,
    backupLocal: false
  });
});

test("draft-merge: 分岐元が同じ端末コピーは新しいので使う", () => {
  const local = {
    payload: { ...payloadOf(serverDraft), body: "端末で足した本文" },
    base: serverDraft.updated,
    savedAt: "2026-11-24T11:00:00Z"
  };
  assert.deepEqual(resolveLocalRestore({ serverDraft, local }), {
    useLocal: true,
    removeLocal: false,
    backupLocal: false
  });
});

test("draft-merge: サーバーが進んでいたら退避してサーバーを使う", () => {
  const local = {
    payload: { ...payloadOf(serverDraft), body: "古い端末の本文" },
    base: "2026-11-20T10:00:00Z",
    savedAt: "2026-11-21T10:00:00Z"
  };
  assert.deepEqual(resolveLocalRestore({ serverDraft, local }), {
    useLocal: false,
    removeLocal: true,
    backupLocal: true
  });
});

test("draft-merge: 保存で送る cover は、外していない空を残さない", () => {
  assert.equal(resolveCoverForSave({ cover: "/media/new.jpg", coverRemoved: false, knownCover: "" }), "/media/new.jpg");
  // 読み込み直しでクライアントだけ空になった場合。
  assert.equal(resolveCoverForSave({ cover: "", coverRemoved: false, knownCover: "/media/old.jpg" }), "/media/old.jpg");
  // 外す操作をしたときは空を送る。
  assert.equal(resolveCoverForSave({ cover: "", coverRemoved: true, knownCover: "/media/old.jpg" }), "");
  assert.equal(resolveCoverForSave({ cover: "", coverRemoved: false, knownCover: "" }), "");
});

test("draft-merge: samePayload はキー順に依存する", () => {
  assert.equal(samePayload({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
  assert.equal(samePayload({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
});

/* ---- theme-color（#888） ---- */

test("writer-ui: theme-color はサイトのパレット（--c-navy-900 / --c-white-100）に一致する", async () => {
  const palette = new Map(
    [...(await readFile(new URL("../src/styles/global.css", import.meta.url), "utf8")).matchAll(
      /--c-([\w-]+)\s*:\s*(#[0-9a-f]{6});/gi,
    )].map((match) => [match[1], match[2].toLowerCase()]),
  );
  const dark = palette.get("navy-900");
  const light = palette.get("white-100");
  assert.ok(dark && light);

  const html = await readFile(
    new URL("../tools/writer-cloudflare/ui/index.html", import.meta.url),
    "utf8",
  );
  const app = await readFile(
    new URL("../tools/writer-cloudflare/ui/app.js", import.meta.url),
    "utf8",
  );

  // <meta name="theme-color"> の初期値と、テーマ切替の2か所（HTML の初期化・app.js）。
  assert.ok(html.includes(`<meta name="theme-color" content="${dark}" />`));
  assert.ok(html.includes(`"${light}" : "${dark}"`));
  assert.ok(app.includes(`"${light}" : "${dark}"`));
});

test("writer-ui: tools/ の writer に旧パレットの theme-color が残らない", async () => {
  // public/ は prepare-assets が ui/ から作る生成物なので対象外。
  for (const file of ["ui/index.html", "ui/app.js"]) {
    const source = await readFile(
      new URL(`../tools/writer-cloudflare/${file}`, import.meta.url),
      "utf8",
    );
    for (const old of ["#05070f", "#eef3fb"]) {
      assert.ok(!source.toLowerCase().includes(old), `${file} に ${old} が残っている`);
    }
  }
});
