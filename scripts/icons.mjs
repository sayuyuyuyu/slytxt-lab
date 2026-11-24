/**
 * favicon の一式（SVG / ICO / apple-touch-icon）を、`public/favicon.svg` から作る。
 *
 *   node scripts/icons.mjs
 *
 * - apple-touch-icon.png: 180×180 の PNG。
 * - favicon.ico: 16×16 と 32×32 の PNG を入れた ICO（現行ブラウザは PNG 入りを読む）。
 *
 * ICO / PNG は生成物としてリポジトリに入れる（配信ファイルなので）。SVG を
 * 直したらこのスクリプトを実行し、`tools/feed-cloudflare` 側は
 * `node tools/feed-cloudflare/scripts/prepare-assets.mjs` で取り込み直す。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const svg = await readFile(path.join(publicDir, "favicon.svg"), "utf8");

function render(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "transparent"
  });
  return resvg.render().asPng();
}

/** PNG を並べた ICO を作る（ICONDIR + ICONDIRENTRY + PNG データ）。 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const icon16 = render(16);
const icon32 = render(32);
const touch = render(180);

await writeFile(path.join(publicDir, "favicon.ico"), buildIco([
  { size: 16, data: icon16 },
  { size: 32, data: icon32 }
]));
await writeFile(path.join(publicDir, "apple-touch-icon.png"), touch);
console.log("favicon.ico と apple-touch-icon.png を作り直しました");
