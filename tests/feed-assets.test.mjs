import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = ["favicon.svg", "favicon.ico", "apple-touch-icon.png"];

/**
 * feed の投稿画面はアイコンを自前の public/ から配信する（writer と違い
 * public/ が追跡対象）。サイト本体のアイコンとずれると、ホーム画面に追加
 * したときだけ古い意匠が残るため、一致を機械的に見張る。
 */
test("feed: 投稿画面のアイコンはサイト本体と一致する", async () => {
  for (const name of ICONS) {
    const [site, feed] = await Promise.all([
      readFile(path.join(root, "public", name)),
      readFile(path.join(root, "tools/feed-cloudflare/public", name))
    ]);
    assert.ok(
      site.equals(feed),
      `${name} がサイト本体と違います。tools/feed-cloudflare/scripts/prepare-assets.mjs を実行してください。`
    );
  }
});
