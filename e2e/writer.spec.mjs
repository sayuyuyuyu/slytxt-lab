import { expect, test } from "@playwright/test";

const WRITER_URL = "http://127.0.0.1:8787";
const SITE_URL = "http://127.0.0.1:4321";
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

/** computed style と要素幅をまとめて取る（比較は px の端数を許容する）。 */
async function measure(locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontFamily: cs.fontFamily,
      fontSize: Number.parseFloat(cs.fontSize),
      lineHeight: Number.parseFloat(cs.lineHeight),
      width: el.getBoundingClientRect().width
    };
  });
}

function expectClose(actual, expected, label) {
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(1);
}

test("writer: 編集画面のスタイルが公開記事ページと一致する", async ({ page }) => {
  // 公開側フィクスチャ記事（start-site.mjs の e2e-embed）の値を取る。
  const sitePage = await page.context().newPage();
  await sitePage.goto(`${SITE_URL}/articles/journal/e2e-embed/`);
  const sitePara = await measure(
    sitePage.locator(".article-body > p", { hasText: "スタイル比較" })
  );
  const siteH2 = await measure(sitePage.locator(".article-body h2"));
  const siteTitle = await measure(sitePage.locator(".page-title"));
  await sitePage.close();

  // writer 側で同じ内容を書く（段落→見出し→Spotify URL の貼り付け）。
  await page.goto(`${WRITER_URL}/`);
  await page.locator("#new").click();
  await page.locator("#category").selectOption("journal");
  await page.locator("#title").fill("E2E 埋め込み確認");
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("これはスタイル比較用の段落です。");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## 埋め込みテスト");
  await page.keyboard.press("Enter");
  await page.evaluate((url) => navigator.clipboard.writeText(url), SPOTIFY_URL);
  await page.keyboard.press("ControlOrMeta+v");

  // 埋め込みは種別カードではなく実プレイヤー（iframe）で描画され、
  // 元の URL 段落は隠れる。
  await expect(
    page.locator('#editorRoot iframe[src*="open.spotify.com/embed/track/"]')
  ).toHaveCount(1);
  await expect(page.locator("#editorRoot .embed-source")).toHaveCount(1);

  const editorPara = await measure(
    page.locator("#editorRoot .ProseMirror > p", { hasText: "スタイル比較" })
  );
  const editorH2 = await measure(page.locator("#editorRoot .ProseMirror h2"));
  const editorTitle = await measure(page.locator("#title"));

  // 本文段落: フォント・サイズ・行間・カラム幅が公開側と一致する。
  expect(editorPara.fontFamily).toBe(sitePara.fontFamily);
  expectClose(editorPara.fontSize, sitePara.fontSize, "段落のフォントサイズ");
  expectClose(editorPara.lineHeight, sitePara.lineHeight, "段落の行間");
  expectClose(editorPara.width, sitePara.width, "段落の幅（本文カラム）");

  // 見出し h2 も同じ。
  expect(editorH2.fontFamily).toBe(siteH2.fontFamily);
  expectClose(editorH2.fontSize, siteH2.fontSize, "h2 のフォントサイズ");
  expectClose(editorH2.lineHeight, siteH2.lineHeight, "h2 の行間");
  expectClose(editorH2.width, siteH2.width, "h2 の幅");

  // タイトル欄は公開側の .page-title と同じタイポグラフィ。
  expect(editorTitle.fontFamily).toBe(siteTitle.fontFamily);
  expectClose(editorTitle.fontSize, siteTitle.fontSize, "タイトルのフォントサイズ");
  expectClose(editorTitle.lineHeight, siteTitle.lineHeight, "タイトルの行間");
});
