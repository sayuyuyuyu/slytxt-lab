/**
 * デプロイ用の静的ファイル（public/）を用意する。
 *
 * - index.html / style.css / app.js はこのディレクトリの ui/ を正として
 *   コピーする（note 風レイアウトと投稿後の status ポーリングは
 *   Cloudflare 版だけの差分として ui/ 側に持つ）。
 * - editor.js / editor.css は ui/editor.js（Milkdown Crepe）を esbuild で
 *   バンドルして作る。このディレクトリで `pnpm install` 済みであることが前提。
 * - markdown.mjs は src/markdown.mjs をコピーする（ブラウザ側のプレビュー用）。
 * - favicon.svg / favicon.ico / apple-touch-icon.png はサイト本体の public/ から
 *   コピーし、本体と同じ意匠のアイコンを writer でも出す。
 * - theme.css はサイト本体の src/styles/global.css から :root の変数ブロック
 *   だけを抜いて静的に作る。global.css の変数を変えたら、再実行と再デプロイが要る。
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractThemeCss } from "./theme-css.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, "..");
const repoRoot = path.resolve(toolRoot, "../..");
const publicDir = path.join(toolRoot, "public");

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

await copyFile(path.join(toolRoot, "ui", "index.html"), path.join(publicDir, "index.html"));
await copyFile(path.join(toolRoot, "ui", "style.css"), path.join(publicDir, "style.css"));
await copyFile(path.join(toolRoot, "ui", "app.js"), path.join(publicDir, "app.js"));
await copyFile(path.join(toolRoot, "src", "markdown.mjs"), path.join(publicDir, "markdown.mjs"));
await copyFile(path.join(repoRoot, "public", "favicon.svg"), path.join(publicDir, "favicon.svg"));
await copyFile(path.join(repoRoot, "public", "favicon.ico"), path.join(publicDir, "favicon.ico"));
await copyFile(
  path.join(repoRoot, "public", "apple-touch-icon.png"),
  path.join(publicDir, "apple-touch-icon.png")
);

let build;
try {
  ({ build } = await import("esbuild"));
} catch {
  throw new Error(
    "esbuild が見つかりません。tools/writer-cloudflare で pnpm install を実行してください。"
  );
}
await build({
  entryPoints: [path.join(toolRoot, "ui", "editor.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  outfile: path.join(publicDir, "editor.js"),
  // KaTeX 等のフォント参照が CSS に残った場合に備え、フォントはファイルとして出す。
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
  logLevel: "info"
});

const globalCss = await readFile(path.join(repoRoot, "src", "styles", "global.css"), "utf8");
const themeCss = extractThemeCss(globalCss);
await writeFile(path.join(publicDir, "theme.css"), `${themeCss}\n`, "utf8");

console.log(`public/ を用意しました: ${publicDir}`);
