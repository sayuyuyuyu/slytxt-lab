/**
 * WYSIWYG エディタ（ui/editor.js の createCrepe）の markdown 往復変換を
 * jsdom 上で確認する開発用チェック。本番の配信物には含まれない。
 *
 * 使い方: tools/writer-cloudflare で pnpm install 後、
 *         node scripts/check-editor.mjs
 * 終了コード 0 = 往復変換・差し替え・編集イベントが期待どおり。
 */
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, "..");

/* ---- テスト用バンドル（createCrepe と編集シミュレーション用の ctx） ---- */

const dir = await mkdtemp(path.join(os.tmpdir(), "slytxt-editor-check-"));
const bundlePath = path.join(dir, "bundle.mjs");
await build({
  stdin: {
    contents: [
      'export { createCrepe, imagesToEditor, imagesFromEditor } from "./ui/editor.js";',
      'export { editorViewCtx } from "@milkdown/kit/core";'
    ].join("\n"),
    resolveDir: toolRoot,
    loader: "js"
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: bundlePath,
  loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
  logLevel: "silent"
});

/* ---- jsdom のグローバルを先に置いてからバンドルを読む ---- */

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true
});
const { window } = dom;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ObserverStub;
window.IntersectionObserver = ObserverStub;
window.matchMedia =
  window.matchMedia ??
  ((query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));
window.scrollTo = window.scrollTo ?? (() => {});
window.HTMLElement.prototype.scrollIntoView = () => {};

const globals = [
  "document",
  "navigator",
  "HTMLElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "Text",
  "Comment",
  "DocumentFragment",
  "DOMParser",
  "XMLSerializer",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
  "CompositionEvent",
  "Selection",
  "Range",
  "File",
  "Blob",
  "FileReader",
  "SVGElement",
  "SVGSVGElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLImageElement",
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLParagraphElement",
  "CharacterData",
  "DocumentType",
  "ShadowRoot",
  "DOMRect",
  "DOMRectReadOnly",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
  "IntersectionObserver"
];
for (const name of globals) {
  if (window[name] === undefined) continue;
  try {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true
    });
  } catch {
    // Node 側の getter 専用グローバル（navigator 等）はそのまま使う。
  }
}
globalThis.window = window;
globalThis.document = window.document;
globalThis.self = window;
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.removeEventListener = window.removeEventListener.bind(window);
globalThis.dispatchEvent = window.dispatchEvent.bind(window);
if (window.getSelection) globalThis.getSelection = window.getSelection.bind(window);
globalThis.CSS = window.CSS ?? { escape: (value) => String(value), supports: () => false };
if (!window.document.fonts) {
  Object.defineProperty(window.document, "fonts", { value: { ready: Promise.resolve() } });
}

const { createCrepe, imagesToEditor, imagesFromEditor, editorViewCtx } = await import(
  pathToFileURL(bundlePath).href
);

/* ---- 確認 ---- */

function normalize(markdown) {
  // Milkdown の serializer の表記（箇条書きは *、区切り線は ***）は
  // 意味が同じなので、比較の前にこちら側へ寄せる。
  return String(markdown)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\* /gm, "- ")
    .replace(/^\*\*\*$/gm, "---")
    .trim();
}

const SAMPLE = [
  "# 見出し1",
  "",
  "## 見出し2",
  "",
  "本文に**太字**と[リンク](https://example.com)を含む。",
  "",
  "![代替テキスト](https://example.com/image.png)",
  "",
  "文中の画像 ![小さい画像](https://example.com/inline.png) もある。",
  "",
  "> 引用の文",
  "",
  "- 箇条書き1",
  "- 箇条書き2",
  "",
  "1. 番号つき1",
  "2. 番号つき2",
  "",
  "- [ ] 未完のタスク",
  "- [x] 済んだタスク",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "インラインの `code` もある。",
  "",
  "---",
  "",
  "最後の段落。"
].join("\n");

const failures = [];
function check(label, actual, expected) {
  if (normalize(actual) === normalize(expected)) {
    console.log(`ok: ${label}`);
  } else {
    failures.push(label);
    console.log(`NG: ${label}`);
    console.log("--- 期待 ---");
    console.log(normalize(expected));
    console.log("--- 実際 ---");
    console.log(normalize(actual));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastChange = null;
// app.js と同じ流れ: 読み込みは imagesToEditor を通し、保存時に imagesFromEditor で戻す。
const handle = await createCrepe(document.querySelector("#root"), {
  value: imagesToEditor(SAMPLE),
  onChange: (markdown) => {
    lastChange = markdown;
  },
  onUpload: async () => "https://example.com/uploaded.png"
});
await sleep(300);
check("初期読み込みの往復変換（alt の受け渡し込み）", imagesFromEditor(handle.getMarkdown()), SAMPLE);

// 編集のシミュレーション: 文書末尾に文字を挿入し、onChange が届くか見る。
lastChange = null;
handle.crepe.editor.action((ctx) => {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  view.dispatch(state.tr.insertText("追記", state.doc.content.size));
});
await sleep(300);
if (lastChange && lastChange.includes("追記") && handle.getMarkdown().includes("追記")) {
  console.log("ok: 編集で onChange が発火し markdown に反映される");
} else {
  failures.push("編集イベント");
  console.log("NG: 編集イベント");
  console.log("lastChange:", lastChange);
}

const NEXT = ["# 差し替え後", "", "本文はこれだけ。"].join("\n");
handle.setMarkdown(imagesToEditor(NEXT));
await sleep(300);
check("setMarkdown の往復変換", imagesFromEditor(handle.getMarkdown()), NEXT);

// 表は整形（セル幅の空白）が入りやすいので、要素の有無だけ緩く確認する。
handle.setMarkdown(["| 列1 | 列2 |", "| --- | --- |", "| 値1 | 値2 |"].join("\n"));
await sleep(300);
const tableOut = handle.getMarkdown();
if (tableOut.includes("列1") && tableOut.includes("値2") && tableOut.includes("|")) {
  console.log("ok: 表の往復（要素のみ確認）");
} else {
  failures.push("表の往復");
  console.log("NG: 表の往復");
  console.log(tableOut);
}

await handle.destroy();

if (failures.length > 0) {
  console.error(`失敗: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("すべての確認が通りました。");
