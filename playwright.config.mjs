import { defineConfig, devices } from "@playwright/test";

/*
 * E2E はローカル完結（本番・Cloudflare Access には繋がない）。
 * サイト: 使い捨てフィクスチャをビルドして astro preview
 * CI の必須チェックには入れない。実行は `pnpm test:e2e`（e2e/README.md）。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } }
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        // ブラウザは Chromium に統一する（WebKit の追加ダウンロードを避ける）。
        browserName: "chromium"
      }
    }
  ],
  webServer: [
    {
      command: "node e2e/start-site.mjs",
      url: "http://127.0.0.1:4321",
      reuseExistingServer: false,
      timeout: 300_000
    }
  ]
});
