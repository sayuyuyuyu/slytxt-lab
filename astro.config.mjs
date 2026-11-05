import { satteri } from "@astrojs/markdown-satteri";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { embedMdastPlugin } from "./src/lib/remark-embed.mjs";
import { figureHastPlugin, lazyImageHastPlugin } from "./src/lib/rehype-figure.mjs";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://slytxt.dev",
  markdown: {
    // URL だけの段落を埋め込み（YouTube / Spotify / X / リンクカード）に変える。
    processor: satteri({
      mdastPlugins: [embedMdastPlugin],
      // 画像の title（キャプション）を figure / figcaption で表示し、
      // 本文画像には遅延読み込みを付ける。
      hastPlugins: [figureHastPlugin, lazyImageHastPlugin]
    }),
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      },
      wrap: true
    }
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
