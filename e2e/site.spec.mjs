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

test("site: メニューが開閉でき、リンクで遷移できる（iOS のフォーカス喪失でも閉じる）", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const button = page.locator("[data-menu-button]");
  const menu = page.locator("[data-menu]");

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  // iOS Safari ではトグルのタップでフォーカスがボタンへ移らず、メニュー内の
  // リンクから relatedTarget=null でフォーカスが外れる。その後に click が
  // ボタンへ届くため、この順序でも「閉じる」が成立することを担保する
  // （以前は focusout で先に閉じてから click が開き直し、反応しなくなった）。
  await page.evaluate(() => {
    document.activeElement?.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null })
    );
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const firstLink = menu.locator("a").first();
  const href = await firstLink.getAttribute("href");
  await firstLink.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
});

test("site: メニューは Esc で閉じてボタンへフォーカスが戻る", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const button = page.locator("[data-menu-button]");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
});
