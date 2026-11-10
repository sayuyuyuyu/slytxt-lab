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

  // 選択中の下書きは、操作対象のボタン側に aria-current が付き、
  // li 側のハイライトも追随している。
  await expect(page.locator('.drafts__select[aria-current=\"true\"]')).toHaveCount(1);
  await expect(page.locator(".drafts__item[aria-current]")).toHaveCount(0);
  const itemShadow = await page
    .locator(".drafts__item")
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(itemShadow).not.toBe("none");

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

  // 編集画面の見出しはヘッダーの「執筆」が h1。
  expect(await page.locator("#barLabel").evaluate((el) => el.tagName)).toBe("H1");

  // プレビュー: 見出しと Spotify プレイヤーが描画される。
  await page.locator("#previewOpen").click();
  await expect(page.locator("#previewBody h2")).toHaveText("見出しテスト");
  await expect(
    page.locator('#previewBody iframe[src*="open.spotify.com/embed/track/"]')
  ).toHaveCount(1);
  // プレビュー中は記事タイトルが唯一の h1 で、ヘッダー側は span に下がっている。
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("#previewTitle")).toHaveText("E2E テスト記事");
  expect(await page.locator("#barLabel").evaluate((el) => el.tagName)).toBe("SPAN");
  await page.locator("#previewClose").click();
  // 閉じたらヘッダーの「執筆」が h1 に戻る。
  expect(await page.locator("#barLabel").evaluate((el) => el.tagName)).toBe("H1");

  // 公開パネル（実際の公開はしない）: タイトルとカテゴリの表示確認まで。
  await page.locator("#publishOpen").click();
  await expect(page.locator("#publishPanel")).toBeVisible();
  await expect(page.locator("#publishTitleRow")).toBeVisible();
  await expect(page.locator("#publishTitle")).toHaveText("E2E テスト記事");
  await expect(page.locator("#publishCategory")).toHaveText("Journal");
});

test("writer: 公開済み記事の行からX投稿リンクを開ける", async ({ page }) => {
  const article = {
    category: "journal",
    slug: "2026-01-02-x-share",
    url: "https://slytxt.dev/articles/journal/2026-01-02-x-share/",
    title: "X 投稿のテスト",
    published: "2026-01-02",
    excerpt: "公開済み記事の説明です。",
    hasDraft: false,
    draftId: null
  };
  await page.route("**/api/published", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ articles: [article] })
    });
  });
  await page.goto(`${WRITER_URL}/`);
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });

  const share = page.locator(".drafts--published .drafts__share");
  await expect(share).toHaveText("Xに投稿");
  await expect(share).toHaveAttribute(
    "href",
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(article.url)}`
  );
  await expect(share).toHaveAttribute("target", "_blank");
  await expect(share).toHaveAttribute("rel", "noopener");
});

test("writer: 公開済み一覧はタイトル無し・埋め込みのみの記事を（無題）と表示する", async ({
  page
}) => {
  const emptyDraft = {
    id: "empty-draft",
    title: "無題",
    category: "notes",
    tags: [],
    updated: "2026-01-04T00:00:00Z",
    pr: "",
    excerpt: "",
    chars: 0
  };
  const article = {
    category: "notes",
    slug: "2026-01-04-embed-only",
    url: "https://slytxt.dev/notes/2026-01-04-embed-only/",
    title: "",
    published: "2026-01-04",
    excerpt: "",
    hasDraft: false,
    draftId: null
  };
  await page.route("**/api/drafts/*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        draft: { ...emptyDraft, body: "", description: "", cover: "", created: emptyDraft.updated, slug: "" }
      })
    });
  });
  await page.route("**/api/drafts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ drafts: [emptyDraft] })
    });
  });
  await page.route("**/api/published", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ articles: [article] })
    });
  });

  await page.goto(`${WRITER_URL}/`);
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });

  // 下書き側は従来どおり、空の下書きを「新しい下書き」と表示する。
  await expect(page.locator(".drafts__select", { hasText: "新しい下書き" })).toHaveCount(1);
  // 公開済み側は、タイトルが無く本文が埋め込みだけの記事を「（無題）」と表示する。
  await expect(page.locator(".drafts--published .drafts__title")).toHaveText("（無題）");
});

test("writer: 公開完了の表示にX投稿リンクが出る", async ({ page }) => {
  const articleUrl = "https://slytxt.dev/articles/journal/2026-01-03-x-share-done/";
  await page.route("**/api/published", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ articles: [] })
    });
  });
  await page.route(/\/api\/publish\/[^/]+$/, async (route) => {
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({
        type: "done",
        result: {
          file: "src/content/journal/2026-01-03-x-share-done.md",
          url: articleUrl,
          title: "公開後の X 投稿",
          state: "merged",
          merged: true
        }
      })}\n`
    });
  });

  await page.goto(`${WRITER_URL}/`);
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });
  await page.locator("#new").click();
  await expect(page.locator("#category")).toHaveValue("notes");
  await page.locator("#category").selectOption("journal");
  await page.locator("#title").fill("公開後の X 投稿");
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("公開後の投稿本文です。");
  await expectSaved(page);

  await page.locator("#publishOpen").click();
  await page.locator("#publishConfirm").click();

  const share = page.locator("#taskResult .x-share");
  await expect(share).toHaveText("Xに投稿");
  await expect(share).toHaveAttribute(
    "href",
    `https://twitter.com/intent/tweet?text=${encodeURIComponent("公開後の X 投稿")}&url=${encodeURIComponent(articleUrl)}`
  );
  await expect(share).toHaveAttribute("target", "_blank");
  await expect(share).toHaveAttribute("rel", "noopener");
});

test("writer: タイトル欄が空の tech / journal 記事は公開完了時のX投稿文に補ったタイトルが入る", async ({
  page
}) => {
  const articleUrl = "https://slytxt.dev/articles/journal/2026-01-05-x-share-derived/";
  await page.route("**/api/published", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ articles: [] })
    });
  });
  await page.route(/\/api\/publish\/[^/]+$/, async (route) => {
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({
        type: "done",
        result: {
          file: "src/content/journal/2026-01-05-x-share-derived.md",
          url: articleUrl,
          title: "本文から補ったタイトル",
          state: "merged",
          merged: true
        }
      })}\n`
    });
  });

  await page.goto(`${WRITER_URL}/`);
  await expect(page.locator("#themeToggle")).toBeVisible({ timeout: 15_000 });
  await page.locator("#new").click();
  await expect(page.locator("#category")).toHaveValue("notes");
  await page.locator("#category").selectOption("journal");
  await expect(page.locator("#title")).toHaveValue("");
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("本文から補ったタイトル");
  await page.keyboard.press("Enter");
  await page.keyboard.type("タイトル欄を空にした投稿本文です。");
  await expectSaved(page);

  await page.locator("#publishOpen").click();
  await page.locator("#publishConfirm").click();

  const share = page.locator("#taskResult .x-share");
  await expect(share).toHaveText("Xに投稿");
  await expect(share).toHaveAttribute(
    "href",
    `https://twitter.com/intent/tweet?text=${encodeURIComponent("本文から補ったタイトル")}&url=${encodeURIComponent(articleUrl)}`
  );
  await expect(share).toHaveAttribute("target", "_blank");
  await expect(share).toHaveAttribute("rel", "noopener");
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
  // media フロー（R2 保存）はモックし、POST /api/media は writer 相対 URL
  // を返し、その URL の実体もその場で返す。検証するのはカバーまわりの UI 挙動。
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.route("**/api/media", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          url: "/media/e2e-cover.png",
          key: "e2e-cover.png",
          state: "stored"
        })
      });
    } else {
      await route.continue();
    }
  });
  await page.route(/\/media\/e2e-cover\.png/, async (route) => {
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
    "/media/e2e-cover.png"
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
    "/media/e2e-cover.png"
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

/** localStorage の下書きコピー（slytxt.draft:<id>）を読む。 */
async function readLocalCopy(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("slytxt.draft:"));
    if (!key) return null;
    return { key, entry: JSON.parse(localStorage.getItem(key)) };
  });
}

test("writer: 保存は端末へ即時、サーバー同期は間引きと同一内容の再送なし", async ({
  page
}) => {
  let puts = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/drafts/")) puts += 1;
  });
  await page.goto(`${WRITER_URL}/`);
  await page.locator("#new").click();
  // 新規の下書きが編集画面へ適用されるまで待つ（適用時の初期化で
  // 先行入力が消える競合を避ける）。
  await expect(page.locator("#body")).toHaveValue("");
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("即時保存テスト");

  // (a) 入力直後、サーバー同期を待たずに localStorage へ書かれている。
  // base（分岐元のサーバー版）と savedAt も一緒に持っている。
  await expect
    .poll(
      async () => {
        const local = await readLocalCopy(page);
        return local?.entry?.payload?.body ?? "";
      },
      { timeout: 5_000 }
    )
    .toContain("即時保存テスト");
  const local = await readLocalCopy(page);
  expect(local.entry.base).toBeTruthy();
  expect(local.entry.savedAt).toBeTruthy();
  await expect(page.locator("#saveText")).toHaveText("端末に保存済み");

  // 同期が済むとローカルコピーは片付き、表示は「保存済み」になる。
  await expectSaved(page);
  await expect.poll(async () => (await readLocalCopy(page)) === null).toBe(true);
  const putsAfterFirstSync = puts;
  expect(putsAfterFirstSync).toBeGreaterThanOrEqual(1);

  // (c) 内容が変わっていないのに保存し直しても、PUT は再送されない。
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(1500);
  expect(puts).toBe(putsAfterFirstSync);

  // (d) 打っては止める入力を繰り返しても、PUT は間引かれる
  // （従来の「止まるたびに全文化」なら 6 回送るところ）。
  const putsBeforeBurst = puts;
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.type(`追記${i}`);
    await page.waitForTimeout(1200);
  }
  await expectSaved(page);
  expect(puts - putsBeforeBurst).toBeLessThanOrEqual(3);
});

test("writer: サーバーへ送れなくても、リロードで端末コピーから復元される", async ({
  page
}) => {
  // (b) PUT だけを落とす。本文はサーバーへ届かない状態にする。
  await page.route("**/api/drafts/**", async (route) => {
    if (route.request().method() === "PUT") await route.abort();
    else await route.continue();
  });
  await page.goto(`${WRITER_URL}/`);
  await page.locator("#new").click();
  // 新規の下書きが編集画面へ適用されるまで待つ（適用時の初期化で
  // 先行入力が消える競合を避ける）。
  await expect(page.locator("#body")).toHaveValue("");
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("復元テスト本文");
  await expect
    .poll(
      async () => {
        const local = await readLocalCopy(page);
        return local?.entry?.payload?.body ?? "";
      },
      { timeout: 5_000 }
    )
    .toContain("復元テスト本文");

  await page.reload();
  // 開き直すと、空のサーバー版ではなく端末コピーから本文が戻る。
  await expect(page.locator("#body")).toHaveValue(/復元テスト本文/, { timeout: 15_000 });
});

test("writer: 他端末で進んだ下書きではサーバーが勝ち、端末コピーは退避される", async ({
  page,
  request
}) => {
  await page.goto(`${WRITER_URL}/`);
  await page.locator("#new").click();
  // 新規の下書きが編集画面へ適用されるまで待つ（適用時の初期化で
  // 先行入力が消える競合を避ける）。
  await expect(page.locator("#body")).toHaveValue("");
  const editor = page.locator('#editorRoot [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type("端末側の本文");
  // 保存済み表示だけで待ちを終えると、エディタから本文欄への反映や
  // サーバー同期がまだ済んでいないことがある。その状態で次の操作へ進むと、
  // リロード時の pagehide 保存が他端末側の更新を古い本文で上書きして
  // 競合の前提が崩れる。サーバーへ本文が届き、端末コピーが片付くまでを
  // 状態変化で待ってから進める。
  await expect(page.locator("#body")).toHaveValue(/端末側の本文/);
  await expect
    .poll(
      async () => {
        const list = await (await request.get(`${WRITER_URL}/api/drafts`)).json();
        if (!list.drafts[0]) return "";
        const { draft } = await (
          await request.get(`${WRITER_URL}/api/drafts/${list.drafts[0].id}`, {
            headers: { "x-slytxt-client": "1" }
          })
        ).json();
        return draft.body ?? "";
      },
      { timeout: 15_000 }
    )
    .toContain("端末側の本文");
  await expectSaved(page);
  await expect.poll(async () => (await readLocalCopy(page)) === null).toBe(true);

  const headers = { "x-slytxt-client": "1", "content-type": "application/json" };
  const list = await (await request.get(`${WRITER_URL}/api/drafts`)).json();
  const id = list.drafts[0].id;
  const { draft } = await (
    await request.get(`${WRITER_URL}/api/drafts/${id}`, { headers })
  ).json();

  // 端末側に「古い分岐」のコピーを仕込む（base も savedAt もサーバーより古い）。
  await page.evaluate(
    ({ id, draft }) => {
      const payload = {
        category: draft.category,
        title: draft.title === "無題" ? "" : draft.title,
        tags: draft.tags ?? [],
        cover: draft.cover ?? "",
        description: draft.description ?? "",
        body: "古い端末コピー"
      };
      localStorage.setItem(
        `slytxt.draft:${id}`,
        JSON.stringify({
          payload,
          base: "2000-01-01T00:00:00Z",
          savedAt: "2000-01-01T00:00:00Z"
        })
      );
    },
    { id, draft }
  );

  // サーバー側を他端末から進める。
  const put = await request.put(`${WRITER_URL}/api/drafts/${id}`, {
    headers,
    data: { ...draft, body: "サーバー側の新しい本文" }
  });
  expect(put.ok()).toBe(true);

  await page.reload();
  // サーバー側の本文が表示され、負けた端末コピーは退避キーに残る。
  await expect(page.locator("#body")).toHaveValue(/サーバー側の新しい本文/, {
    timeout: 15_000
  });
  const backup = await page.evaluate(
    (id) => localStorage.getItem(`slytxt.draft-backup:${id}`),
    id
  );
  expect(backup).toContain("古い端末コピー");
});
