import { expect, test } from "@playwright/test";

const SITE_URL = "http://127.0.0.1:4321";

test("site: トップページに記事とフィードの見出しが出る", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  await expect(page.getByRole("heading", { name: "Articles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible();
});

test("site: 記事ページで Spotify 埋め込みが描画される", async ({ page }) => {
  await page.goto(`${SITE_URL}/articles/comic/e2e-embed/`);
  await expect(page.getByRole("heading", { name: "埋め込みテスト" })).toBeVisible();
  await expect(
    page.locator(
      'iframe[src*="open.spotify.com/embed/track/5oCptG3RbPTbXKFpVjUgmw"]'
    )
  ).toHaveCount(1);
});

test("site: メニューが開閉でき、リンクで遷移できる（iOS のフォーカス喪失でも閉じる）", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 900, "PC 幅はハンバーガーを使わない");
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
  test.skip((page.viewportSize()?.width ?? 0) >= 900, "PC 幅はハンバーガーを使わない");
  await page.goto(`${SITE_URL}/`);
  const button = page.locator("[data-menu-button]");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
});

test("site: PC 幅では主要ナビがヘッダーに並ぶ", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "モバイル幅はハンバーガー");
  await page.goto(`${SITE_URL}/`);
  const nav = page.locator('#site-menu nav[aria-label="Main"]');
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Articles" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Feed" })).toBeVisible();
  await expect(page.locator("[data-menu-button]")).toBeHidden();
});

test("site: 幅を変えてもナビの出し方が戻る", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "PC 幅でだけ確認する");
  await page.goto(`${SITE_URL}/`);
  const menu = page.locator("[data-menu]");
  const button = page.locator("[data-menu-button]");
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 500, height: 700 });
  await expect(button).toBeVisible();
  await expect(menu).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 700 });
  await expect(menu).toBeVisible();
  await expect(button).toBeHidden();
});

test("site: 幅をまたがない resize ではメニューの開閉状態が変わらない", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 900, "モバイル幅でだけ確認する");
  await page.goto(`${SITE_URL}/`);
  const button = page.locator("[data-menu-button]");
  const menu = page.locator("[data-menu]");

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  // iOS Safari はスクロールでアドレスバーが縮むたびに resize を出す。
  // 幅は 900px をまたいでいないので、開いたままにする。
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: size.height - 80 });
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  // resize イベント単体でも閉じない。
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
});

/** 遷移先のパス（日本語は URL では percent-encode される）。 */
async function expectPath(page, href) {
  const expected = new URL(href, SITE_URL).pathname;
  await expect.poll(() => new URL(page.url()).pathname).toBe(expected);
}

test("site: 記事一覧のカードは余白を押しても記事へ遷移する", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const card = page.locator(".entry-card").first();
  await expect(card).toBeVisible();
  const href = await card.locator(".entry-card__title a").getAttribute("href");

  // タイトルではなく、カードの左上の余白を押す（全体がリンクになっている）。
  const box = await card.boundingBox();
  await page.mouse.click(box.x + 6, box.y + 6);
  await expectPath(page, href);
});

test("site: カード内のタグはカードのリンクではなくタグへ遷移する", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const tag = page.locator(".entry-card .tag").first();
  await expect(tag).toBeVisible();
  const href = await tag.getAttribute("href");
  await tag.click();
  await expectPath(page, href);
});

test("site: skip-link は普段隠れていて、キーボードの Tab でだけ出る", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const skip = page.locator(".skip-link");
  const isOffscreen = async () => (await skip.boundingBox()).y + (await skip.boundingBox()).height <= 0;

  expect(await isOffscreen()).toBe(true);

  // ブラウザがリロード後にフォーカスを戻す場合を想定（キーボード操作ではない）。
  await page.evaluate(() => document.querySelector(".skip-link").focus());
  expect(await isOffscreen()).toBe(true);

  // キーボードで辿ったときは出て、本文へスキップできる。
  await page.goto(`${SITE_URL}/`);
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  expect(await isOffscreen()).toBe(false);
  await page.keyboard.press("Enter");
  await expect.poll(() => new URL(page.url()).hash).toBe("#main-content");
});

test("site: ヘッダーの検索はページ遷移なしで開き、Esc で閉じる", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const dialog = page.locator("[data-search-overlay]");
  await expect(dialog).toBeHidden();

  const open = page.locator("[data-search-open]").first();
  await open.click();
  await expect(dialog).toBeVisible();

  // 開いたら入力にフォーカスが移り、その場で結果が出る。
  const input = dialog.locator(".pagefind-ui__search-input");
  await expect(input).toBeFocused();
  await input.fill("スタイル比較");
  await expect(dialog.locator(".pagefind-ui__result").first()).toBeVisible();

  // Esc で閉じて、開いたボタンへフォーカスが戻る。
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("site: 検索ページは廃止されている", async ({ page }) => {
  const response = await page.goto(`${SITE_URL}/search/`);
  expect(response.status()).toBe(404);
});

test("site: 記事一覧のタグで絞り込め、URL に残る", async ({ page }) => {
  await page.goto(`${SITE_URL}/articles/`);
  const chips = page.locator("[data-tag-filter] [data-tag-chip]");
  await expect(chips.first()).toBeVisible();
  const cards = page.locator("[data-tag-entry]");
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);

  // 全部のカードには付いていないタグを選ぶ（絞り込みが効くことを見る）。
  const cardTags = await cards.evaluateAll((els) => els.map((el) => (el.dataset.tags ?? "").split(" ")));
  let index = -1;
  for (let i = 1; i < (await chips.count()); i += 1) {
    const slug = await chips.nth(i).getAttribute("data-tag-chip");
    const matches = cardTags.filter((tags) => tags.includes(slug)).length;
    if (matches > 0 && matches < total) {
      index = i;
      break;
    }
  }
  test.skip(index < 0, "この一覧には、一部のカードにだけ付くタグが無い");

  // タグを選ぶと、ページ遷移せずにカードが絞り込まれる。
  const chip = chips.nth(index);
  const tag = await chip.getAttribute("data-tag-chip");
  await chip.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBe(tag);
  const visible = page.locator("[data-tag-entry]:not([hidden])");
  const shown = await visible.count();
  expect(shown).toBeLessThan(total);
  for (const card of await visible.all()) {
    expect((await card.getAttribute("data-tags")).split(" ")).toContain(tag);
  }

  // 「すべて」で戻せる。
  await chips.first().click();
  await expect(page.locator("[data-tag-entry]:not([hidden])")).toHaveCount(total);
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBeNull();
});

test("site: カードのタグはタグ専用ページではなく絞り込んだ一覧へ行く", async ({ page }) => {
  await page.goto(`${SITE_URL}/`);
  const tag = page.locator(".entry-card .tag").first();
  const href = await tag.getAttribute("href");
  const url = new URL(href, SITE_URL);
  expect(url.pathname).toBe("/articles/");
  expect(url.searchParams.get("tag")).toBeTruthy();
  await tag.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBe(
    url.searchParams.get("tag"),
  );
});

test("site: タグ専用ページは廃止されている", async ({ page }) => {
  for (const path of ["/tags/", "/tags/漫画/"]) {
    const response = await page.goto(`${SITE_URL}${path}`);
    expect(response.status(), path).toBe(404);
  }
});

test("site: 404 の検索ボタンからも検索を開ける", async ({ page }) => {
  await page.goto(`${SITE_URL}/404.html`);
  const dialog = page.locator("[data-search-overlay]");
  await page.locator("[data-search-open]").last().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".pagefind-ui__search-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
