/**
 * デプロイ用の静的ファイル（public/）を用意する。
 *
 * - index.html / style.css / app.js はこのディレクトリの ui/ を正として
 *   コピーする（note 風レイアウトと投稿後の status ポーリングは
 *   Cloudflare 版だけの差分として ui/ 側に持つ）。
 * - markdown.mjs は tools/writer からコピーする。
 * - theme.css はローカル版 server.mjs の実行時抽出と同じ規則で、
 *   サイト本体の src/styles/global.css から :root の変数ブロックだけを
 *   抜いて静的に作る。global.css の変数を変えたら、再実行と再デプロイが要る。
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, "..");
const repoRoot = path.resolve(toolRoot, "../..");
const writerDir = path.join(repoRoot, "tools", "writer");
const publicDir = path.join(toolRoot, "public");

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

await copyFile(path.join(toolRoot, "ui", "index.html"), path.join(publicDir, "index.html"));
await copyFile(path.join(toolRoot, "ui", "style.css"), path.join(publicDir, "style.css"));
await copyFile(path.join(toolRoot, "ui", "app.js"), path.join(publicDir, "app.js"));
await copyFile(path.join(writerDir, "markdown.mjs"), path.join(publicDir, "markdown.mjs"));

const globalCss = await readFile(path.join(repoRoot, "src", "styles", "global.css"), "utf8");
const themeCss = [...globalCss.matchAll(/:root(?:\.light)?\s*\{[^}]*\}/g)]
  .map((match) => match[0])
  .join("\n");
await writeFile(path.join(publicDir, "theme.css"), `${themeCss}\n`, "utf8");

console.log(`public/ を用意しました: ${publicDir}`);
