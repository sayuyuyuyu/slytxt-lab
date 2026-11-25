#!/usr/bin/env node
/**
 * feed の投稿画面（PWA）が使うアイコンを、サイト本体の public/ から取り込む。
 *
 * feed の public/ はリポジトリで追跡している（Worker が
 * そのまま配信するため）。サイト本体のアイコンを差し替えたら、これを実行して
 * 差分をコミットする。tests/feed-assets.test.mjs が一致を見張っている。
 */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, "..");
const repoRoot = path.resolve(toolRoot, "../..");

export const ICONS = ["favicon.svg", "favicon.ico", "apple-touch-icon.png"];

for (const name of ICONS) {
  await copyFile(path.join(repoRoot, "public", name), path.join(toolRoot, "public", name));
  console.log(`public/${name} をサイト本体から取り込みました`);
}
