import { expect, test } from "@playwright/test";

const SITE_URL = "http://127.0.0.1:4321";

test("site: トップページにターミナルが出る", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  await expect(page.locator("[data-terminal]")).toBeVisible();
});

test("site: 記事ページで Spotify 埋め込みが描画される", async ({ page }) => {
  await page.goto(`${SITE_URL}/articles/journal/e2e-embed/`);
  await expect(page.getByRole("heading", { name: "埋め込みテスト" })).toBeVisible();
  await expect(
    page.locator(
      'iframe[src*="open.spotify.com/embed/track/5oCptG3RbPTbXKFpVjUgmw"]'
    )
  ).toHaveCount(1);
});
