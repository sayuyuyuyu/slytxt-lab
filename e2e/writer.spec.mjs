import { expect, test } from "@playwright/test";

const WRITER_URL = "http://127.0.0.1:8787";
const SPOTIFY_URL = "https://open.spotify.com/track/5oCptG3RbPTbXKFpVjUgmw";

/** 自動保存が完了するまで待つ（保存状態は #save の data-state で見る）。 */
async function expectSaved(page) {
  await expect
    .poll(() => page.locator("#save").getAttribute("data-state"), { timeout: 15_000 })
    .toBe("idle");
  await expect(page.locator("#saveText")).toHaveText("保存済み");
}

test("writer: 作成→編集→自動保存→カテゴリ切替→タイトル→プレビュー→公開パネル", async ({
  page
}) => {
  await page.goto(`${WRITER_URL}/`);
  await page.locator("#new").click();

  // 新規の下書きは notes。notes ではタイトル欄を出さない。
  await expect(page.locator("#category")).toHaveValue("notes");
  await expect(page.locator("#title")).toBeHidden();

  // 本文を書く。見出しはキー入力、Spotify の URL は貼り付け
  // （貼ると <URL> の autolink 形式で入り、記事では埋め込みになる）。
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("## 見出しテスト");
  await page.keyboard.press("Enter");
  await page.evaluate((url) => navigator.clipboard.writeText(url), SPOTIFY_URL);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("#body")).toHaveValue(/open\.spotify\.com\/track\//);
  await expectSaved(page);

  // notes のまま開く公開パネル: タイトル行は出ず、カテゴリは表示のみ。
  await page.locator("#publishOpen").click();
  await expect(page.locator("#publishPanel")).toBeVisible();
  await expect(page.locator("#publishTitleRow")).toBeHidden();
  await expect(page.locator("#publishCategory")).toHaveText("Notes");
  await page.locator("#publishCancel").click();
  await expect(page.locator("#publishPanel")).toBeHidden();

  // journal に切り替えるとタイトル欄が出て、付けて保存できる。
  await page.locator("#category").selectOption("journal");
  await expect(page.locator("#title")).toBeVisible();
  await page.locator("#title").fill("E2E テスト記事");
  await expectSaved(page);

  // プレビュー: 見出しと Spotify プレイヤーが描画される。
  await page.locator("#previewOpen").click();
  await expect(page.locator("#previewBody h2")).toHaveText("見出しテスト");
  await expect(
    page.locator('#previewBody iframe[src*="open.spotify.com/embed/track/"]')
  ).toHaveCount(1);
  await page.locator("#previewClose").click();

  // 公開パネル（実際の公開はしない）: タイトルとカテゴリの表示確認まで。
  await page.locator("#publishOpen").click();
  await expect(page.locator("#publishPanel")).toBeVisible();
  await expect(page.locator("#publishTitleRow")).toBeVisible();
  await expect(page.locator("#publishTitle")).toHaveText("E2E テスト記事");
  await expect(page.locator("#publishCategory")).toHaveText("Journal");
});
