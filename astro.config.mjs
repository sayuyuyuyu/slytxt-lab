import { satteri } from "@astrojs/markdown-satteri";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { embedMdastPlugin } from "./src/lib/remark-embed.mjs";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://slytxt.dev",
  markdown: {
    // URL だけの段落を埋め込み（YouTube / X / OGP カード）に変える。
    processor: satteri({
      mdastPlugins: [embedMdastPlugin]
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
