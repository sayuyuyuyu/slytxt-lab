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

/** ファイル選択を再現する（input へ File を渡して change を発火させる）。 */
async function injectCoverFile(page, kind) {
  await page.evaluate(async (kind) => {
    let file;
    if (kind === "oversize") {
      file = new File([new Uint8Array(21 * 1024 * 1024)], "big.png", {
        type: "image/png"
      });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#3a6ea5";
      ctx.fillRect(0, 0, 1600, 1000);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      file = new File([blob], "cover.png", { type: "image/png" });
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#coverFile");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, kind);
}

test("writer: 見出し画像の切り取り→反映→外す→付け直しと、大きすぎる画像の拒否", async ({
  page
}) => {
  // 本番の media フロー（PR 作成→CI→マージ→Pages 伝播）はローカルで
  // 再現できないため、POST /api/media は「マージ済み」で返し、最終 URL の
  // 実体もその場で返す。検証するのはカバーまわりの UI 挙動。
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.route("**/api/media", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://slytxt.dev/media/e2e-cover.png",
          key: "e2e-cover.png",
          state: "merged",
          prUrl: ""
        })
      });
    } else {
      await route.continue();
    }
  });
  await page.route("https://slytxt.dev/media/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: png });
  });

  await page.goto(`${WRITER_URL}/`);
  // 起動時の下書き読み込み・選択が終わる前に操作すると、初期化側の
  // 下書き選択と競合して別下書きを編集してしまう。初期化の最終ステップで
  // テーマ切替ボタンが表示されるので、それを待ってから操作する。
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });
  await page.locator("#new").click();
  await expect(page.locator("#category")).toHaveValue("notes");
  await page.locator("#category").selectOption("journal");
  await page.locator("#title").fill("カバー確認用");
  await expectSaved(page);

  // 大きすぎる画像（20MB 超）: 切り取りは開かず、その場で断る。
  await injectCoverFile(page, "oversize");
  await expect(page.locator("#cropDialog")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("20MB");
  await expect(page.locator("#coverSet")).toBeVisible();

  // 通常の画像: 切り取りダイアログが出る。キャンセルでは何も変わらない。
  await injectCoverFile(page, "image");
  await expect(page.locator("#cropDialog")).toBeVisible();
  await expect(page.locator("#cropImage")).toBeVisible();
  await page.locator("#cropCancel").click();
  await expect(page.locator("#cropDialog")).toBeHidden();
  await expect(page.locator("#coverBox")).toBeHidden();
  await expect(page.locator("#coverSet")).toBeVisible();

  // 決定するとカバーが付き、blob から最終 URL へ切り替わる。
  await injectCoverFile(page, "image");
  await expect(page.locator("#cropDialog")).toBeVisible();
  await page.locator("#cropOk").click();
  await expect(page.locator("#cropDialog")).toBeHidden();
  await expect(page.locator("#coverBox")).toBeVisible();
  await expect(page.locator("#coverPreview")).toHaveAttribute(
    "src",
    "https://slytxt.dev/media/e2e-cover.png"
  );

  // プレビューにも反映される。
  await page.locator("#previewOpen").click();
  await expect(page.locator("#previewCover")).toBeVisible();
  await page.locator("#previewClose").click();

  // 外すとカバー UI が初期状態に戻り、タイトルは通常表示のまま。
  await page.locator("#coverRemove").click();
  await expect(page.locator("#coverBox")).toBeHidden();
  await expect(page.locator("#coverSet")).toBeVisible();
  await expect(page.locator("#title")).toBeVisible();

  // 付け直し→外すの往復でも壊れない（2026-11-05 のバグ報告の回帰確認）。
  await injectCoverFile(page, "image");
  await expect(page.locator("#cropDialog")).toBeVisible();
  await page.locator("#cropOk").click();
  await expect(page.locator("#coverBox")).toBeVisible();
  await expect(page.locator("#coverPreview")).toHaveAttribute(
    "src",
    "https://slytxt.dev/media/e2e-cover.png"
  );
  await page.locator("#coverRemove").click();
  await expect(page.locator("#coverBox")).toBeHidden();
  await expect(page.locator("#coverSet")).toBeVisible();
  await expect(page.locator("#title")).toBeVisible();
});

test("writer: 見出し画像の切り取り位置を矢印キーで動かせる", async ({ page }) => {
  await page.goto(`${WRITER_URL}/`);
  // 初期化の最終ステップ（テーマ切替の表示）を待ってから操作する。
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });
  await page.locator("#new").click();
  await expect(page.locator("#category")).toHaveValue("notes");
  await page.locator("#category").selectOption("journal");

  await injectCoverFile(page, "image");
  await expect(page.locator("#cropDialog")).toBeVisible();

  // 拡大してから測る（拡大率1では動かせる範囲が小さいため）。
  await page.locator("#cropZoom").evaluate((el) => {
    el.value = "2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const image = page.locator("#cropImage");
  const translate = async () => {
    const transform = await image.evaluate((el) => el.style.transform);
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(transform);
    return { x: Number(match[1]), y: Number(match[2]) };
  };
  const before = await translate();

  // ステージはフォーカスでき、矢印キーで画像がその方向へ 8px 動く。
  const stage = page.locator("#cropStage");
  await stage.focus();
  await expect(stage).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const afterDown = await translate();
  expect(afterDown.y).toBeCloseTo(before.y + 8, 1);
  expect(afterDown.x).toBeCloseTo(before.x, 1);

  // Shift 同時押しでは 32px 動く。
  await page.keyboard.press("Shift+ArrowUp");
  const afterShiftUp = await translate();
  expect(afterShiftUp.y).toBeCloseTo(afterDown.y - 32, 1);

  await page.locator("#cropCancel").click();
  await expect(page.locator("#cropDialog")).toBeHidden();
});

test("writer: 長いタイトルが折り返し、本文と重ならず、編集列がスクロールできる", async ({
  page
}) => {
  await page.goto(`${WRITER_URL}/`);
  // 初期化の最終ステップ（テーマ切替の表示）を待ってから操作する。
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });
  await page.locator("#new").click();
  await expect(page.locator("#category")).toHaveValue("notes");
  await page.locator("#category").selectOption("journal");

  // 長いタイトルは横スクロールにならず、折り返して高さが伸びる。
  const title = page.locator("#title");
  await title.fill("短い題");
  const shortBox = await title.boundingBox();
  await title.fill(
    "これは折り返しの確認用の長いタイトルです。幅に収まらず横スクロールになるのではなく、行が増えて高さが伸びることを確認します"
  );
  const longGeom = await title.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    height: el.getBoundingClientRect().height
  }));
  expect(longGeom.scrollWidth).toBeLessThanOrEqual(longGeom.clientWidth + 1);
  expect(longGeom.height).toBeGreaterThan(shortBox.height + 10);

  // 本文を書いてもタイトルと本文が重ならない。
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.type(`スクロール確認の段落 ${i + 1}`);
    await page.keyboard.press("Enter");
  }
  const boxes = await page.evaluate(() => {
    const t = document.querySelector("#title").getBoundingClientRect();
    const e = document.querySelector("#editorRoot").getBoundingClientRect();
    return { titleBottom: t.bottom, editorTop: e.top };
  });
  expect(boxes.titleBottom).toBeLessThanOrEqual(boxes.editorTop + 1);

  // 編集列（#editor）全体がスクロールし、バーは sticky で上部に残る。
  const pane = page.locator("#editor");
  const editorBox = await page.locator("#editorRoot").boundingBox();
  await page.mouse.move(
    editorBox.x + editorBox.width / 2,
    editorBox.y + Math.min(200, editorBox.height / 2)
  );
  await page.mouse.wheel(0, 900);
  await expect
    .poll(() => pane.evaluate((el) => el.scrollTop), { timeout: 10_000 })
    .toBeGreaterThan(50);
  const tops = await page.evaluate(() => ({
    barTop: document.querySelector(".editor__bar").getBoundingClientRect().top,
    paneTop: document.querySelector("#editor").getBoundingClientRect().top
  }));
  expect(Math.abs(tops.barTop - tops.paneTop)).toBeLessThanOrEqual(1);

  // 開き直してもタイトルが潰れない（モバイルでは一覧表示中に下書きが
  // 適用され、エディタが display:none の間に高さを測ってしまう経路の
  // 回帰確認）。リロードして一覧から開き直す。
  await page.reload();
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });
  // 先頭とは限らない（他のテストの下書きが残っている）ので、このテストの
  // 下書きをタイトルで特定して開き直す。
  await page
    .locator(".drafts__item", { hasText: "折り返しの確認用" })
    .locator(".drafts__select")
    .first()
    .click();
  await expect(title).toHaveValue(/折り返しの確認用/);
  await expect
    .poll(() => title.evaluate((el) => el.getBoundingClientRect().height), {
      timeout: 10_000
    })
    .toBeGreaterThan(shortBox.height + 10);
  const reopened = await title.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }));
  expect(reopened.scrollWidth).toBeLessThanOrEqual(reopened.clientWidth + 1);
});

test("writer: 閉じている間に完了した公開の結果が起動時に知らされる", async ({ page }) => {
  // サーバー側の見届け（Cron）が残した公開結果を、次回起動時に表示する。
  await page.route("**/api/publish-results", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: "2026-01-01-closed-tab",
            title: "閉じている間に公開された記事",
            state: "merged",
            url: "https://slytxt.dev/articles/journal/2026-01-01-closed-tab/",
            prUrl: "https://github.com/sayuyuyuyu/slytxt-lab/pull/999",
            message: "",
            at: "2026-01-01T00:00:00.000Z"
          }
        ]
      })
    });
  });
  await page.goto(`${WRITER_URL}/`);
  await expect(page.locator("#toast")).toContainText(
    "公開しました：閉じている間に公開された記事",
    { timeout: 15_000 }
  );
});
