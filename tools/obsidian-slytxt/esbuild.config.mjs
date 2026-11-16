/**
 * Obsidian のプラグイン（main.js）をビルドする。
 * Obsidian 本体が提供する obsidian / electron / node 系はバンドルしない。
 *
 *   node esbuild.config.mjs          1回だけビルド
 *   node esbuild.config.mjs --watch  変更を監視
 */
import { context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  sourcemap: false
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("main.js を監視しています（Ctrl+C で終了）");
} else {
  const { build } = await import("esbuild");
  await build(options);
}
