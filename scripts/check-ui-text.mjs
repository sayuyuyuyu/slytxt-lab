/**
 * UI の文字を機械的に見張る。
 *
 * 決まり（AGENTS.md）: UI は見た目で示す。文字は、本人が書いたコンテンツ・
 * 見出し・カテゴリ・サイト名・操作に必要な最小限だけ。
 *
 *   node scripts/check-ui-text.mjs            検査
 *   node scripts/check-ui-text.mjs --write    現在の状態で許可リストを書き直す
 *
 * `ui-text-allowlist.json` に無い文字が UI に現れたら失敗する。文言を足すときは
 * 許可リストへ理由付きで追加する（レビューで必ず目に入る）。
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowPath = path.join(root, "ui-text-allowlist.json");
const write = process.argv.includes("--write");

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith(".astro")) files.push(full);
  }
  return files;
}

/** .astro から、画面に出る文字（テキストノード）を集める。 */
function visibleStrings(source) {
  let text = source.replace(/^---[\s\S]*?---/, "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // タグを除いた残りがテキストノード。式 {…} の中は除外する。
  const nodes = text.split(/<[^>]*>/).map((node) => node.replace(/\{[^}]*\}/g, " "));
  const found = new Set();
  for (const node of nodes) {
    const value = node.replace(/\s+/g, " ").trim();
    if (!value) continue;
    // 日本語、または UI に出る短い英字（見出し・ナビの名前）。
    if (JAPANESE.test(value) || /^[A-Za-z][A-Za-z0-9 .&/-]{1,24}$/.test(value)) found.add(value);
  }
  return found;
}

const files = await walk(path.join(root, "src"));
const found = new Map();
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const value of visibleStrings(source)) {
    if (!found.has(value)) found.set(value, path.relative(root, file));
  }
}

const current = [...found.keys()].sort();
const allow = write ? [] : JSON.parse(await readFile(allowPath, "utf8")).map((entry) => entry.text);

if (write) {
  const entries = current.map((text) => ({ text, why: "UI に必要（見出し・カテゴリ・ナビ・操作）" }));
  await writeFile(allowPath, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`ui-text-allowlist.json に ${entries.length} 件を書き出しました`);
  process.exit(0);
}

const allowed = new Set(allow);
const added = current.filter((text) => !allowed.has(text));
const removed = allow.filter((text) => !current.includes(text));

if (added.length || removed.length) {
  if (added.length) {
    console.error("UI に許可されていない文字があります:");
    for (const text of added) console.error(`  + ${JSON.stringify(text)} (${found.get(text)})`);
  }
  if (removed.length) {
    console.error("許可リストにあるのに UI から消えた文字があります（リストを更新してください）:");
    for (const text of removed) console.error(`  - ${JSON.stringify(text)}`);
  }
  console.error("\n文言を足すなら ui-text-allowlist.json に理由付きで追加してください。");
  process.exit(1);
}

console.log(`UI の文字 ${current.length} 件はすべて許可リストにあります`);
