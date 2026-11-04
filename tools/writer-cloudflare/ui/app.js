import {
  loneEmbedUrls,
  plainText,
  renderPreviewMarkdown,
  textLength,
  truncateText
} from "/markdown.mjs";

/*
 * Cloudflare 版の UI 本体。index.html / style.css もこのディレクトリ
 * （ui/）に持ち、prepare-assets が public/ へコピーする。
 * 旧ローカル版から引き継いだうえでの、この版の特徴:
 * - 投稿フロー: PR 作成までで応答が返り、CI の完了と merge は
 *   /api/publish/:id/status のポーリングで見届ける。
 * - レイアウトを note に寄せた（編集画面のヘッダー、公開確認パネル、
 *   一覧と編集の「…」メニュー、狭い画面では一覧⇔編集の画面遷移）。
 */

const $ = (selector) => document.querySelector(selector);

const els = {
  editorPane: $(".pane--editor"),
  editor: $("#editor"),
  empty: $("#empty"),
  save: $("#save"),
  saveText: $("#saveText"),
  saveRetry: $("#saveRetry"),
  drafts: $("#drafts"),
  draftCount: $("#draftCount"),
  newButton: $("#new"),
  themeToggle: $("#themeToggle"),
  themeToggleIcon: $("#themeToggleIcon"),
  emptyNew: $("#emptyNew"),
  category: $("#category"),
  coverSet: $("#coverSet"),
  coverBox: $("#coverBox"),
  coverPreview: $("#coverPreview"),
  coverStatus: $("#coverStatus"),
  coverChange: $("#coverChange"),
  coverRemove: $("#coverRemove"),
  coverFile: $("#coverFile"),
  titleInput: $("#title"),
  body: $("#body"),
  editorRoot: $("#editorRoot"),
  count: $("#count"),
  uploadStatus: $("#uploadStatus"),
  uploadStatusText: $("#uploadStatusText"),
  uploadRetry: $("#uploadRetry"),
  back: $("#back"),
  editorMenu: $("#editorMenu"),
  preview: $("#preview"),
  previewOpen: $("#previewOpen"),
  previewClose: $("#previewClose"),
  previewScroll: $("#previewScroll"),
  previewArticle: $("#previewArticle"),
  previewCategory: $("#previewCategory"),
  previewTitle: $("#previewTitle"),
  previewLead: $("#previewLead"),
  previewCover: $("#previewCover"),
  previewBody: $("#previewBody"),
  previewEmbedWarning: $("#previewEmbedWarning"),
  previewTags: $("#previewTags"),
  publishOpen: $("#publishOpen"),
  publishPanel: $("#publishPanel"),
  publishTitle: $("#publishTitle"),
  publishCategory: $("#publishCategory"),
  categoryNote: $("#categoryNote"),
  publishDescription: $("#publishDescription"),
  publishDescriptionNote: $("#publishDescriptionNote"),
  tags: $("#tags"),
  tagInput: $("#tagInput"),
  tagCandidates: $("#tagCandidates"),
  publishFile: $("#publishFile"),
  publishCancel: $("#publishCancel"),
  publishConfirm: $("#publishConfirm"),
  confirmDialog: $("#confirmDialog"),
  confirmTitle: $("#confirmTitle"),
  confirmMessage: $("#confirmMessage"),
  confirmCancel: $("#confirmCancel"),
  confirmOk: $("#confirmOk"),
  menu: $("#menu"),
  task: $("#task"),
  taskTitle: $("#taskTitle"),
  taskElapsed: $("#taskElapsed"),
  taskToggle: $("#taskToggle"),
  taskClose: $("#taskClose"),
  taskLog: $("#taskLog"),
  taskResult: $("#taskResult"),
  toast: $("#toast")
};

const state = {
  meta: null,
  drafts: [],
  current: null,
  busy: false,
  tags: [],
  cover: ""
};

const save = { status: "idle", pending: null, timer: null, retryTimer: null, attempt: 0 };

let toastTimer = null;
let clock = null;

const SAVE_LABEL = {
  idle: "保存済み",
  dirty: "未保存",
  saving: "保存中…",
  error: "保存できません"
};

/* ---- テーマ（本体サイトと同じ localStorage の theme を使う） ---- */

function syncThemeToggle() {
  const light = document.documentElement.classList.contains("light");
  const label = light ? "ダークテーマに切り替える" : "ライトテーマに切り替える";
  els.themeToggleIcon.textContent = light ? "☼" : "☾";
  els.themeToggle.setAttribute("aria-label", label);
  els.themeToggle.setAttribute("title", label);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", light ? "#eef3fb" : "#05070f");
}

function toggleTheme() {
  const nextTheme = document.documentElement.classList.contains("light") ? "dark" : "light";
  document.documentElement.classList.toggle("light", nextTheme === "light");
  try {
    localStorage.setItem("theme", nextTheme);
  } catch {
    // 保存できなくても、この画面での切り替えは有効にする。
  }
  syncThemeToggle();
}

/* ---- 小さな道具 ---- */

function toast(message, kind = "info") {
  const isError = kind === "error";
  els.toast.setAttribute("role", isError ? "alert" : "status");
  els.toast.setAttribute("aria-live", isError ? "assertive" : "polite");
  els.toast.textContent = message;
  els.toast.className = isError ? "toast toast--error" : "toast";
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, kind === "error" ? 7000 : 3500);
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minute = 60_000;
  if (diff < minute) return "たった今";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}分前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))}時間前`;
  if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", "x-slytxt-client": "1" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `リクエストに失敗しました (${response.status})`);
  return payload;
}

/** タイトルが空のメモは、本文の書き出しを名前として見せる。 */
function displayTitle(draft) {
  if (draft.title && draft.title !== "無題") return draft.title;
  const first = String(draft.excerpt ?? "").trim();
  if (!first) return "新しいメモ";
  return Array.from(first).length > 32 ? `${truncateText(first, 32)}…` : first;
}

/** 本文を持つ下書き（編集中の1件）の表示名。本文の書き出しから作る。 */
function draftName(draft) {
  if (draft.title && draft.title !== "無題") return draft.title;
  if (draft.body) {
    const firstLine = draft.body.split("\n").find((line) => line.trim()) ?? "";
    const text = plainText(firstLine).replace(/\s+/g, " ").trim();
    if (text) return Array.from(text).length > 32 ? `${truncateText(text, 32)}…` : text;
  }
  return displayTitle(draft);
}

/** 狭い画面用の一覧⇔編集の切り替え。広い画面では CSS が無視する。 */
function setView(view) {
  document.body.dataset.view = view;
}

/* ---- 保存 ---- */

function setSaveStatus(status) {
  save.status = status;
  els.save.dataset.state = status;
  els.saveText.textContent = SAVE_LABEL[status];
  if (status === "error") {
    els.save.setAttribute("role", "alert");
    els.save.setAttribute("aria-live", "assertive");
  } else {
    els.save.setAttribute("role", "status");
    els.save.setAttribute("aria-live", "polite");
  }
  if (els.saveRetry) els.saveRetry.hidden = status !== "error";
}

function scheduleSave() {
  clearTimeout(save.timer);
  setSaveStatus("dirty");
  save.timer = setTimeout(() => {
    flushSave().catch(() => {});
  }, 900);
}

async function flushSave({ keepalive = false } = {}) {
  if (!state.current) return;
  clearTimeout(save.timer);
  save.timer = null;

  // 画像の POST（最終 URL の確定）より先に保存すると、URL 未確定の画像が
  // 下書きから落ちてしまう。POST 自体は速いのでここだけ待つ。
  // PR のマージ完了までは待たない（保存は最終 URL で行い、反映は裏で進む）。
  if (editorBridge.handle?.whenPosted) {
    await editorBridge.handle.whenPosted().catch(() => {});
  }

  const id = state.current.id;
  const payload = collect();
  save.pending = { id, payload };
  setSaveStatus("saving");

  try {
    const { draft } = await api(`/api/drafts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      keepalive
    });
    save.pending = null;
    save.attempt = 0;
    clearTimeout(save.retryTimer);
    setSaveStatus("idle");
    if (state.current?.id === id) state.current = draft;
    patchListItem(id, draft);
  } catch (error) {
    setSaveStatus("error");
    scheduleRetry();
    throw error;
  }
}

function scheduleRetry() {
  clearTimeout(save.retryTimer);
  const wait = Math.min(30_000, 4000 * 2 ** save.attempt);
  save.attempt += 1;
  save.retryTimer = setTimeout(() => {
    if (!save.pending) return;
    const { id, payload } = save.pending;
    // 別のメモに移っていても、失敗したほうへ書き戻す。
    api(`/api/drafts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    })
      .then(({ draft }) => {
        save.pending = null;
        save.attempt = 0;
        setSaveStatus("idle");
        patchListItem(id, draft);
      })
      .catch(() => scheduleRetry());
  }, wait);
}

function patchListItem(id, draft) {
  const index = state.drafts.findIndex((item) => item.id === id);
  if (index === -1) return;
  state.drafts[index] = {
    ...state.drafts[index],
    title: draft.title,
    category: draft.category,
    updated: draft.updated,
    chars: textLength(draft.body),
    excerpt: truncateText(plainText(draft.body), 120)
  };
  state.drafts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  renderList();
}

/* ---- 一覧 ---- */

function renderList() {
  els.drafts.replaceChildren();

  if (state.drafts.length === 0) {
    const empty = document.createElement("li");
    empty.className = "drafts__empty";
    empty.textContent = "まだありません。";
    els.drafts.append(empty);
  }

  for (const draft of state.drafts) {
    const item = document.createElement("li");
    item.className = "drafts__item";
    if (state.current?.id === draft.id) item.setAttribute("aria-current", "true");

    const select = document.createElement("button");
    select.type = "button";
    select.className = "drafts__select";

    const title = document.createElement("span");
    title.className = "drafts__title";
    title.textContent = displayTitle(draft);
    select.append(title);

    const excerpt = String(draft.excerpt ?? "").trim();
    if (draft.title !== "無題" && excerpt) {
      const text = document.createElement("span");
      text.className = "drafts__excerpt";
      text.textContent = truncateText(excerpt, 90);
      select.append(text);
    }

    const meta = document.createElement("span");
    meta.className = "drafts__meta";

    const where = document.createElement("span");
    where.textContent = state.meta?.categoryLabels?.[draft.category] ?? draft.category;
    meta.append(where);

    const when = document.createElement("span");
    when.textContent = `${draft.chars}字・${relativeTime(draft.updated)}`;
    meta.append(when);

    select.append(meta);
    select.addEventListener("click", () => selectDraft(draft.id));
    item.append(select);

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "drafts__menu";
    menuButton.textContent = "…";
    menuButton.setAttribute("aria-label", `${displayTitle(draft)} の操作`);
    menuButton.setAttribute("aria-haspopup", "menu");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(menuButton, [
        { label: "開く", onSelect: () => selectDraft(draft.id) },
        { label: "削除", danger: true, onSelect: () => removeDraft(draft.id) }
      ]);
    });
    item.append(menuButton);

    els.drafts.append(item);
  }

  els.draftCount.textContent = `${state.drafts.length}件`;
}

async function loadDrafts() {
  const payload = await api("/api/drafts");
  state.drafts = payload.drafts;
  renderList();
}

/* ---- エディタ ---- */

function fillSelect(select, values, labels) {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labels[value] ?? value;
    select.append(option);
  }
}

function showEmpty(empty) {
  els.editor.hidden = empty;
  els.empty.hidden = !empty;
}

function updateCount() {
  const text = els.body.value;
  // markdown ソースの長さではなく、本文の見た目の文字数を数える。
  const chars = textLength(text);
  const lines = text ? text.split("\n").length : 0;
  els.count.textContent = `${chars}字・${lines}行`;
}

/* ---- WYSIWYG エディタ（Milkdown Crepe） ---- */
/*
 * 本文の正は textarea に置き、エディタとは双方向に同期する。
 * - 下書きを開くとき: textarea の値をエディタへ差し替える（editorSet）。
 * - 編集したとき: エディタの markdown を textarea に書き戻してから、
 *   従来の onInput（文字数と自動保存）を通す。
 * エディタが読み込めない・初期化できない場合は textarea のまま使う
 * （フォールバック。editor.js が無い環境でもこの画面は動く）。
 */
const editorBridge = { handle: null, lastValue: "", applying: false, convert: null };

function editorSet(markdown) {
  if (!editorBridge.handle) return;
  editorBridge.applying = true;
  try {
    // ブロック画像の alt はキャプションへ移してから渡す（editor.js 参照）。
    const input = editorBridge.convert ? editorBridge.convert.to(markdown) : markdown;
    editorBridge.handle.setMarkdown(input);
    editorBridge.lastValue = editorBridge.handle.getMarkdown();
  } catch (error) {
    console.warn("エディタへの反映に失敗しました。", error);
  } finally {
    editorBridge.applying = false;
  }
}

async function uploadMedia(file, hooks = {}) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/media", {
    method: "POST",
    headers: { "x-slytxt-client": "1" },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `画像のアップロードに失敗しました (${response.status})`);
  }
  // POST が通った時点で最終 URL は確定している。以後の反映待ちは
  // hooks.onPosted 経由で呼び出し側（エディタの非同期アップロード）へ
  // 知らせ、書き手はローカルプレビューのまま書き続けられる。
  hooks.onPosted?.(payload.url);
  if (payload.state !== "waiting") return payload.url;
  // main へは PR 経由でしか入れられないため、CI と merge を見届けてから
  // URL を返す（投稿の pollPublishStatus と同じ形）。merge 後に Pages の
  // デプロイが伝わるまで、画像は一時的に表示されないことがある。
  const deadline = Date.now() + 5 * 60 * 1000;
  let last = payload;
  while (Date.now() < deadline) {
    await sleep(4000);
    const status = await api(`/api/media/${encodeURIComponent(payload.key)}/status`);
    if (status.state === "merged") return status.url ?? payload.url;
    if (status.state === "failed") {
      throw new Error(status.message ?? `画像の反映に失敗しました: ${status.prUrl ?? ""}`);
    }
    last = status;
  }
  throw new Error(
    `画像の反映が時間内に終わりませんでした。再試行すると、同じ PR で続きから進みます: ${last?.prUrl ?? ""}`
  );
}

let lastUploadDonePulse = 0;

/** 画像の非同期アップロードの進捗をエディタバーへ出す。 */
function renderUploadStatus({ active, failures, donePulse }) {
  if (!els.uploadStatus) return;
  if (failures.length) {
    els.uploadStatus.hidden = false;
    els.uploadStatus.dataset.state = "error";
    els.uploadStatus.setAttribute("role", "alert");
    els.uploadStatus.setAttribute("aria-live", "assertive");
    els.uploadStatusText.textContent = failures[0]
      ? "画像の反映に失敗しました: " + failures[0]
      : "画像の反映に失敗しました";
    els.uploadStatus.removeAttribute("title");
    els.uploadRetry.hidden = false;
  } else if (active > 0) {
    els.uploadStatus.hidden = false;
    els.uploadStatus.dataset.state = "busy";
    els.uploadStatus.setAttribute("role", "status");
    els.uploadStatus.setAttribute("aria-live", "polite");
    els.uploadStatusText.textContent = "画像を反映中…";
    els.uploadStatus.removeAttribute("title");
    els.uploadRetry.hidden = true;
  } else {
    els.uploadStatus.hidden = true;
    els.uploadRetry.hidden = true;
    if (donePulse > lastUploadDonePulse) toast("画像を反映しました");
  }
  lastUploadDonePulse = donePulse;
}

async function setupEditor() {
  if (!window.SlytxtEditor?.mount) return;
  try {
    editorBridge.handle = await window.SlytxtEditor.mount(els.editorRoot, {
      value: "",
      onUpload: uploadMedia,
      onUploadState: renderUploadStatus,
      onChange: (markdown) => {
        if (editorBridge.applying) {
          editorBridge.lastValue = markdown;
          return;
        }
        // 自分で差し替えた内容のエコー（直後の非同期通知）は無視する。
        if (markdown === editorBridge.lastValue) return;
        editorBridge.lastValue = markdown;
        // ブロック画像のキャプションは alt へ戻して保存する（editor.js 参照）。
        let text = editorBridge.convert ? editorBridge.convert.from(markdown) : markdown;
        // 画像のローカルプレビュー（blob URL）は最終 URL へ置き換えてから保存する。
        if (editorBridge.handle?.resolveImageUrls) {
          text = editorBridge.handle.resolveImageUrls(text);
        }
        if (text === els.body.value) return;
        els.body.value = text;
        onInput();
      }
    });
    editorBridge.convert = {
      to: window.SlytxtEditor.imagesToEditor,
      from: window.SlytxtEditor.imagesFromEditor
    };
    editorBridge.lastValue = "";
    els.editorRoot.hidden = false;
    els.body.hidden = true;
    document.body.dataset.editor = "wysiwyg";
  } catch (error) {
    console.warn("WYSIWYG エディタを初期化できませんでした。textarea で続けます。", error);
    editorBridge.handle = null;
  }
}

function focusBody() {
  if (editorBridge.handle) {
    els.editorRoot.querySelector("[contenteditable]")?.focus();
  } else {
    els.body.focus();
  }
}

function applyDraft(draft) {
  hidePreview();
  state.current = draft;
  els.category.value = draft.category;
  els.titleInput.value = draft.title && draft.title !== "無題" ? draft.title : "";
  els.body.value = draft.body;
  els.publishDescription.value = draft.description ?? "";
  state.tags = [...(draft.tags ?? [])];
  renderTags();
  state.cover = draft.cover ?? "";
  resetCoverDisplay();
  renderCover();
  editorSet(draft.body);
  showEmpty(false);

  // 別のメモの保存が失敗したまま残っているときは、その状態を消さない。
  if (!save.pending || save.pending.id === draft.id) {
    save.pending = null;
    setSaveStatus("idle");
  }
  updateCount();
  updateCategoryNote();
  renderList();
  setBusy(state.busy);
}

function clearEditor() {
  hidePreview();
  state.current = null;
  state.tags = [];
  renderTags();
  state.cover = "";
  resetCoverDisplay();
  renderCover();
  els.titleInput.value = "";
  els.body.value = "";
  els.publishDescription.value = "";
  editorSet("");
  els.categoryNote.hidden = true;
  showEmpty(true);
  renderList();
  setBusy(state.busy);
}

async function selectDraft(id) {
  if (state.current?.id !== id) await flushSave().catch(() => {});
  try {
    const { draft } = await api(`/api/drafts/${encodeURIComponent(id)}`);
    applyDraft(draft);
    setView("editor");
    // 前回の投稿が CI 待ちのまま残っていたら、結果を見届ける。
    if (draft.pr) resumePublishCheck(draft);
  } catch (error) {
    toast(error.message, "error");
  }
}

const resuming = new Set();

function resumePublishCheck(draft) {
  const id = draft.id;
  if (resuming.has(id)) return;
  resuming.add(id);
  (async () => {
    try {
      const status = await api(`/api/publish/${encodeURIComponent(id)}/status`);
      if (status.state === "merged") {
        toast("前回の投稿が公開されました。");
        if (state.current?.id === id) state.current = null;
        await loadDrafts();
        if (!state.current) {
          if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
          else clearEditor();
        }
      } else if (status.state === "failed") {
        openTask("前回の投稿");
        appendLog(status.message ?? "前回の投稿が失敗しました。");
        if (status.prUrl) showResult([{ href: status.prUrl, label: "PR" }]);
        finishTask();
      }
    } catch {
      // 見届けは補助的な処理なので、失敗しても編集は止めない。
    } finally {
      resuming.delete(id);
    }
  })();
}

function collect() {
  return {
    category: els.category.value,
    // 空ならサーバー側で「無題」として保持され、表示・公開時は従来どおり
    // 本文の書き出しから導出される。
    title: els.titleInput.value.trim(),
    tags: [...state.tags],
    cover: state.cover,
    description: els.publishDescription.value.trim(),
    body: els.body.value
  };
}

function onInput() {
  updateCount();
  updateCategoryNote();
  scheduleSave();
}

/*
 * notes では単独行の URL が埋め込みにならない（公開側もプレーンテキスト）。
 * 埋め込み対象の URL が本文にあるときだけ、カテゴリ欄の横に注意を出す。
 * 記事カテゴリでは出さない。プレビュー側にも同じ趣旨の注意を出す。
 */
const NOTE_EMBED_MESSAGE =
  "メモでは埋め込みできません。カテゴリを記事（Tech / Journal）に変えると、リンクがプレイヤーで表示されます。";

function updateCategoryNote() {
  const show =
    state.current !== null &&
    els.category.value === "notes" &&
    loneEmbedUrls(els.body.value).length > 0;
  els.categoryNote.hidden = !show;
  if (show) els.categoryNote.textContent = NOTE_EMBED_MESSAGE;
}

/* ---- プレビュー ----
 *
 * 公開後の記事ページに近い見た目で、現在の下書き（未保存分を含む）を
 * 確認する。開くたびに collect() の内容で描き直すので、編集中の本文・
 * タイトル・タグ・見出し画像・説明文がそのまま反映される。
 * notes は公開側がプレーンテキスト表示（NoteLayout）なので、そちらに合わせる。
 * 保存や autosave の挙動には触れない。
 */

let previewReturnFocus = null;
let xWidgetsPromise = null;

// X の公式ウィジェットを遅延で読み込み、埋め込みを実表示に変える。
// 読めなければ blockquote 内のリンク表示のままになる。
function loadXWidgets(root) {
  if (!root.querySelector(".embed--x")) return;
  if (window.twttr?.widgets) {
    window.twttr.widgets.load(root);
    return;
  }
  xWidgetsPromise ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  void xWidgetsPromise.then((ok) => {
    if (ok && !els.preview.hidden) window.twttr?.widgets?.load(els.previewBody);
  });
}

function openPreview() {
  if (!state.current || state.busy) return;
  const data = collect();
  const isNote = data.category === "notes";
  previewReturnFocus = rememberFocus();

  els.previewCategory.textContent =
    state.meta?.categoryLabels?.[data.category] ?? data.category;
  els.previewTitle.textContent = draftName({
    ...state.current,
    title: data.title || "無題",
    body: data.body
  });
  els.previewTitle.hidden = isNote;
  els.previewLead.textContent = data.description;
  els.previewLead.hidden = isNote || !data.description;

  const cover = coverDisplayUrl || data.cover;
  els.previewCover.hidden = !cover;
  if (cover) els.previewCover.src = cover;
  else els.previewCover.removeAttribute("src");

  // notes では埋め込み対象の URL があってもプレーンテキストのままになる。
  // 記事との差に気づけるよう、プレビューの先頭に注意を出す。
  const showEmbedWarning = isNote && loneEmbedUrls(data.body).length > 0;
  els.previewEmbedWarning.hidden = !showEmbedWarning;
  if (showEmbedWarning) els.previewEmbedWarning.textContent = NOTE_EMBED_MESSAGE;

  els.previewBody.replaceChildren();
  if (isNote) {
    const pre = document.createElement("pre");
    pre.className = "preview__notetext";
    pre.textContent = data.body.trim();
    els.previewBody.append(pre);
  } else {
    els.previewBody.innerHTML = renderPreviewMarkdown(data.body);
    loadXWidgets(els.previewBody);
  }

  els.previewTags.replaceChildren(
    ...data.tags.map((tag) => {
      const item = document.createElement("li");
      const chip = document.createElement("span");
      chip.className = "preview__tag";
      const hash = document.createElement("span");
      hash.className = "preview__tag-hash";
      hash.textContent = "#";
      chip.append(hash, tag);
      item.append(chip);
      return item;
    })
  );
  els.previewTags.hidden = data.tags.length === 0;
  // タグは記事では本文の前、Note では本文の後に出る（公開側の並び）。
  if (isNote) els.previewArticle.append(els.previewTags);
  else els.previewArticle.insertBefore(els.previewTags, els.previewBody);

  els.preview.hidden = false;
  els.previewOpen.setAttribute("aria-pressed", "true");
  els.previewScroll.scrollTop = 0;
  els.previewClose.focus();
}

// フォーカスを戻さずに閉じる（下書きの切り替え時など）。
// iframe の再生を止めるため、中身は捨てる。
function hidePreview() {
  if (els.preview.hidden) return;
  els.preview.hidden = true;
  els.previewBody.replaceChildren();
  els.previewOpen.setAttribute("aria-pressed", "false");
}

function closePreview() {
  if (els.preview.hidden) return;
  hidePreview();
  restoreFocus(previewReturnFocus ?? els.previewOpen);
  previewReturnFocus = null;
}

function togglePreview() {
  if (els.preview.hidden) openPreview();
  else closePreview();
}

/* ---- 実行中のパネル ---- */

function openTask(title) {
  els.taskTitle.textContent = title;
  els.taskLog.textContent = "";
  els.taskResult.replaceChildren();
  els.taskResult.hidden = true;
  els.taskResult.setAttribute("role", "status");
  els.taskResult.setAttribute("aria-live", "polite");
  els.task.dataset.state = "running";
  els.task.dataset.log = "open";
  els.taskToggle.textContent = "⌃";
  els.taskToggle.setAttribute("aria-expanded", "true");
  els.task.hidden = false;

  const started = Date.now();
  clearInterval(clock);
  els.taskElapsed.textContent = "0:00";
  clock = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    els.taskElapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }, 500);
}

function appendLog(message) {
  els.taskLog.textContent += `${message}\n`;
  els.taskLog.scrollTop = els.taskLog.scrollHeight;
}

function finishTask() {
  clearInterval(clock);
  els.task.dataset.state = "done";
}

function showResult(parts, isError = false) {
  els.taskResult.setAttribute("role", isError ? "alert" : "status");
  els.taskResult.setAttribute("aria-live", isError ? "assertive" : "polite");
  els.taskResult.replaceChildren();
  for (const part of parts) {
    if (part.href) {
      const link = document.createElement("a");
      link.className = "button button--primary";
      link.href = part.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = part.label;
      els.taskResult.append(link);
    } else {
      const span = document.createElement("span");
      span.className = "task__result-label";
      span.textContent = part.label;
      els.taskResult.append(span);
    }
  }
  els.taskResult.hidden = false;
}

function closeTask() {
  clearInterval(clock);
  els.task.hidden = true;
}

async function streamTask(path, title) {
  openTask(title);
  const response = await fetch(path, {
    method: "POST",
    headers: { "x-slytxt-client": "1" }
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `実行に失敗しました (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  let failure = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        const message = JSON.parse(line);
        if (message.type === "log") appendLog(message.message);
        else if (message.type === "done") result = message.result;
        else if (message.type === "error") failure = message.message;
      }
      index = buffer.indexOf("\n");
    }
  }

  if (failure) throw new Error(failure);
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 投稿後に CI の完了と merge を status エンドポイントで見届ける。 */
async function pollPublishStatus(id, initial) {
  const deadline = Date.now() + 13 * 60 * 1000;
  let last = initial;
  let lastNote = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    const status = await api(`/api/publish/${encodeURIComponent(id)}/status`);
    if (status.state === "merged") return status;
    if (status.state === "failed") {
      throw new Error(status.message ?? `CI が失敗しました: ${status.prUrl ?? ""}`);
    }
    // BEHIND 回復など、サーバー側で進展があったときだけログに残す。
    if (status.note && status.note !== lastNote) {
      appendLog(status.note);
      lastNote = status.note;
    }
    last = status;
  }
  throw new Error(
    `時間内に公開が完了しませんでした。もう一度「公開」を押すと、同じ PR で続きから進みます: ${last?.prUrl ?? ""}`
  );
}

/* ---- メニューとダイアログ ---- */

let menuCleanup = null;
let menuAnchor = null;

function closeMenu({ returnFocus = true } = {}) {
  const anchor = menuAnchor;
  menuAnchor = null;
  els.menu.hidden = true;
  els.menu.replaceChildren();
  if (menuCleanup) {
    menuCleanup();
    menuCleanup = null;
  }
  if (anchor) {
    anchor.setAttribute("aria-expanded", "false");
    if (returnFocus && document.contains(anchor)) anchor.focus();
  }
}

function openMenu(anchor, items) {
  closeMenu();
  menuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.danger ? "menu__item menu__item--danger" : "menu__item";
    button.textContent = item.label;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      closeMenu();
      item.onSelect();
    });
    els.menu.append(button);
  }
  els.menu.hidden = false;
  els.menu.querySelector("button")?.focus();

  const rect = anchor.getBoundingClientRect();
  const menuWidth = 180;
  els.menu.style.top = `${rect.bottom + 6}px`;
  els.menu.style.left = `${Math.max(
    8,
    Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)
  )}px`;

  const onPointerDown = (event) => {
    if (!els.menu.contains(event.target) && event.target !== anchor) closeMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      // 閉じて呼び出し元へフォーカスを戻し、Tab の移動はそこから続けさせる。
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...els.menu.querySelectorAll("button")];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Home") buttons[0].focus();
    else if (event.key === "End") buttons[buttons.length - 1].focus();
    else if (event.key === "ArrowDown")
      buttons[index < 0 ? 0 : (index + 1) % buttons.length].focus();
    else buttons[index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length].focus();
  };
  const onFocusOut = (event) => {
    if (els.menu.hidden) return;
    const next = event.relatedTarget;
    if (next && (els.menu.contains(next) || next === anchor)) return;
    closeMenu({ returnFocus: false });
  };
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKey);
  els.menu.addEventListener("focusout", onFocusOut);
  menuCleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKey);
    els.menu.removeEventListener("focusout", onFocusOut);
  };
}

let confirmResolve = null;
let confirmReturnFocus = null;
let publishReturnFocus = null;
let publishTagsSnapshot = null;
let publishDescriptionSnapshot = null;
let publishSuggestionToken = 0;

// ダイアログ用: 開く前にフォーカスがあった要素へ戻し、開いている間は Tab を内側で循環させる。
function rememberFocus() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreFocus(target) {
  if (target && document.contains(target)) target.focus();
}

function trapTab(event, container) {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll("button, select, input, textarea, a[href], [tabindex]")].filter(
    (el) => !el.disabled && el.getAttribute("tabindex") !== "-1" && el.offsetParent !== null
  );
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", (event) => {
  if (!els.confirmDialog.hidden) trapTab(event, els.confirmDialog);
  else if (!els.publishPanel.hidden) trapTab(event, els.publishPanel);
});

function confirmAction({ title, message, okLabel = "削除する" }) {
  confirmReturnFocus = rememberFocus();
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOk.textContent = okLabel;
  els.confirmDialog.hidden = false;
  els.confirmOk.focus();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function settleConfirm(value) {
  els.confirmDialog.hidden = true;
  restoreFocus(confirmReturnFocus);
  confirmReturnFocus = null;
  if (confirmResolve) {
    confirmResolve(value);
    confirmResolve = null;
  }
}

/* ---- 見出し画像 ---- */
/*
 * note と同じく、見出し画像はタイトル欄の上で設定する。
 * 保存先は下書き frontmatter の cover（URL）。画像の保存自体は本文画像と
 * 同じ media フロー（PR 経由）で、POST が通った時点で最終 URL が確定する。
 * 反映完了まではローカルの blob プレビューで見せる。
 */
let coverDisplayUrl = "";
let coverUploading = false;

function renderCover() {
  const has = Boolean(state.cover || coverDisplayUrl);
  els.coverSet.hidden = has;
  els.coverBox.hidden = !has;
  if (has) els.coverPreview.src = coverDisplayUrl || state.cover;
  els.coverChange.disabled = coverUploading;
  els.coverRemove.disabled = coverUploading;
}

/** 見出し画像の反映状態を、本文画像（uploadStatus）と同じ形で読み上げ対象にする。 */
function setCoverStatus(message, state = "busy") {
  els.coverStatus.textContent = message;
  if (state === "error") {
    els.coverStatus.setAttribute("role", "alert");
    els.coverStatus.setAttribute("aria-live", "assertive");
  } else {
    els.coverStatus.setAttribute("role", "status");
    els.coverStatus.setAttribute("aria-live", "polite");
  }
}

function resetCoverDisplay() {
  if (coverDisplayUrl) URL.revokeObjectURL(coverDisplayUrl);
  coverDisplayUrl = "";
  setCoverStatus("");
}

async function setCoverFromFile(file) {
  if (!file || coverUploading) return;
  coverUploading = true;
  resetCoverDisplay();
  coverDisplayUrl = URL.createObjectURL(file);
  setCoverStatus("画像を反映中…");
  renderCover();
  try {
    const url = await uploadMedia(file, {
      onPosted: (posted) => {
        if (posted) {
          state.cover = posted;
          scheduleSave();
        }
      }
    });
    if (url) state.cover = url;
    resetCoverDisplay();
    renderCover();
    scheduleSave();
    toast("見出し画像を設定しました");
  } catch (error) {
    setCoverStatus(
      error.message
        ? "見出し画像の反映に失敗しました: " + error.message
        : "見出し画像の反映に失敗しました",
      "error"
    );
    toast(error.message, "error");
  } finally {
    coverUploading = false;
    renderCover();
  }
}

function removeCover() {
  state.cover = "";
  resetCoverDisplay();
  renderCover();
  scheduleSave();
}

/* ---- タグ編集（公開パネル） ---- */
/*
 * note の公開設定と同じく、タグは公開パネルで編集する。
 * 上限は note に合わせて10件・1件30文字。候補は /api/meta が返す
 * 既存の下書きのタグ集合を datalist で出す。
 */
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;

function normalizeTag(raw) {
  return String(raw ?? "").trim().replace(/^#+/, "").trim();
}

function renderTags() {
  els.tags.replaceChildren();
  for (const tag of state.tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    const label = document.createElement("span");
    label.textContent = tag;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag-chip__remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", tag + " を外す");
    remove.addEventListener("click", () => removeTag(tag));
    chip.append(label, remove);
    els.tags.append(chip);
  }
}

function addTag(raw) {
  const tag = normalizeTag(raw);
  if (!tag) return false;
  if (tag.length > MAX_TAG_LENGTH) {
    toast("タグは30文字までです。", "error");
    return false;
  }
  if (state.tags.includes(tag)) return false;
  if (state.tags.length >= MAX_TAGS) {
    toast("タグは10件までです。", "error");
    return false;
  }
  state.tags.push(tag);
  renderTags();
  scheduleSave();
  return true;
}

function removeTag(tag) {
  state.tags = state.tags.filter((item) => item !== tag);
  renderTags();
  scheduleSave();
}

/** 入力欄の内容をタグとして確定する（カンマ・読点区切りも受ける）。 */
function commitTagInput() {
  const value = els.tagInput.value;
  if (!value.trim()) return;
  for (const part of value.split(/[,、]/)) addTag(part);
  els.tagInput.value = "";
}

function fillTagCandidates() {
  els.tagCandidates.replaceChildren();
  for (const tag of state.meta?.tags ?? []) {
    const option = document.createElement("option");
    option.value = tag;
    els.tagCandidates.append(option);
  }
}

/* ---- 公開の確認パネル ---- */

/** 投稿先ファイルの表示用（サーバー側の slug 規則に合わせた見た目だけの計算）。 */
function publishSlug(raw) {
  const cleaned = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return cleaned || raw;
}

function updatePublishFile() {
  if (!state.current) return;
  els.publishFile.textContent = `投稿先: src/content/${els.category.value}/${publishSlug(
    state.current.id
  )}.md`;
}

function openPublishPanel() {
  if (!state.current || state.busy) return;
  if (!els.body.value.trim()) {
    toast("本文が空です。", "error");
    return;
  }
  els.publishTitle.textContent = draftName({
    ...state.current,
    title: els.titleInput.value.trim() || "無題",
    body: els.body.value
  });
  // カテゴリは編集画面の select が単一の状態で、ここでは表示だけする。
  els.publishCategory.textContent =
    state.meta?.categoryLabels?.[els.category.value] ?? els.category.value;
  publishTagsSnapshot = [...state.tags];
  publishDescriptionSnapshot = els.publishDescription.value;
  renderTags();
  updatePublishFile();
  publishReturnFocus = rememberFocus();
  els.publishPanel.hidden = false;
  els.publishConfirm.focus();
  if (!els.publishDescription.value.trim()) void fillDescriptionSuggestion();
}

function closePublishPanel({ restore = false } = {}) {
  publishSuggestionToken += 1;
  const wasHidden = els.publishPanel.hidden;
  els.publishPanel.hidden = true;
  // 戻すのはパネル内だけで変えられるタグと説明文だけ。
  // カテゴリは編集画面の select が単一の状態なので、ここでは触らない。
  if (restore) {
    let changed = false;
    if (
      publishTagsSnapshot !== null &&
      JSON.stringify(state.tags) !== JSON.stringify(publishTagsSnapshot)
    ) {
      state.tags = [...publishTagsSnapshot];
      renderTags();
      changed = true;
    }
    if (
      publishDescriptionSnapshot !== null &&
      els.publishDescription.value !== publishDescriptionSnapshot
    ) {
      els.publishDescription.value = publishDescriptionSnapshot;
      changed = true;
    }
    // 変更時に先行して保存済み／保存予定でも、戻した内容で保存し直す。
    if (changed) scheduleSave();
  }
  publishTagsSnapshot = null;
  publishDescriptionSnapshot = null;
  if (!wasHidden) {
    restoreFocus(publishReturnFocus);
    publishReturnFocus = null;
  }
}

/* ---- 操作 ---- */

function setBusy(busy) {
  state.busy = busy;
  const disabled = busy || !state.current;
  els.publishOpen.disabled = disabled;
  els.previewOpen.disabled = disabled;
  els.editorMenu.disabled = disabled;
  els.publishConfirm.disabled = busy;
}

/* 説明文候補の状態を、他の状態表示と同じ形で読み上げ対象にする。 */
function setPublishDescriptionNote(message, state = "busy") {
  els.publishDescriptionNote.textContent = message;
  if (state === "error") {
    els.publishDescriptionNote.setAttribute("role", "alert");
    els.publishDescriptionNote.setAttribute("aria-live", "assertive");
  } else {
    els.publishDescriptionNote.setAttribute("role", "status");
    els.publishDescriptionNote.setAttribute("aria-live", "polite");
  }
}

/** 説明文が空のとき、AI 要約（無ければ抜粋）の候補を入れる。本人が直せる前提の下書き。 */
async function fillDescriptionSuggestion() {
  const id = state.current?.id;
  if (!id) return;
  const token = ++publishSuggestionToken;
  setPublishDescriptionNote("説明文の候補を作っています…");
  try {
    const data = await api(`/api/drafts/${encodeURIComponent(id)}/summary`, {
      method: "POST",
      body: JSON.stringify({ title: els.titleInput.value.trim(), body: els.body.value })
    });
    if (token !== publishSuggestionToken || els.publishPanel.hidden) return;
    if (state.current?.id !== id) return;
    if (data.summary && !els.publishDescription.value.trim()) {
      els.publishDescription.value = data.summary;
    }
    setPublishDescriptionNote(
      data.source === "ai"
        ? "AI 要約の候補です。そのまま使っても、直しても大丈夫です。"
        : "本文の抜粋です。そのまま使っても、直しても大丈夫です。"
    );
  } catch {
    if (token !== publishSuggestionToken || els.publishPanel.hidden) return;
    setPublishDescriptionNote(
      "候補を作れませんでした。空欄のままなら、公開時に自動で作られます。",
      "error"
    );
  }
}

async function runPublish() {
  if (!state.current || state.busy) return;
  if (!els.body.value.trim()) {
    toast("本文が空です。", "error");
    return;
  }

  await flushSave().catch(() => {});
  setBusy(true);
  const id = encodeURIComponent(state.current.id);
  try {
    let result = await streamTask(`/api/publish/${id}`, "投稿");
    if (result?.state === "waiting") {
      appendLog("PR を作成しました。CI の完了を待っています…");
      result = await pollPublishStatus(state.current.id, result);
    }
    finishTask();
    showResult([
      { label: result.file },
      { href: result.prUrl, label: "PR" },
      ...(result.url
        ? [
            { href: result.url, label: "公開ページ" },
            { label: "公開ページはデプロイの反映まで数十秒かかることがあります" }
          ]
        : [])
    ]);
    toast("公開しました。");
    // 公開したドラフトはサーバー側で消えている。
    state.current = null;
    await loadDrafts();
    if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
    else clearEditor();
  } catch (error) {
    finishTask();
    appendLog(`失敗: ${error.message}`);
    showResult([{ label: "失敗しました。" }], true);
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function newDraft() {
  await flushSave().catch(() => {});
  try {
    const { draft } = await api("/api/drafts", {
      method: "POST",
      body: JSON.stringify({ category: "notes" })
    });
    state.drafts.unshift({
      ...draft,
      chars: 0,
      excerpt: ""
    });
    applyDraft(draft);
    setView("editor");
    await loadDrafts();
    els.titleInput.focus();
  } catch (error) {
    toast(error.message, "error");
  }
}

/** 一覧の「…」メニューと編集画面の「…」メニューの共通の削除処理。 */
async function removeDraft(id) {
  if (state.busy) return;
  const target =
    state.drafts.find((draft) => draft.id === id) ??
    (state.current?.id === id ? state.current : null);
  const ok = await confirmAction({
    title: "削除しますか",
    message: `「${target ? draftName(target) : "このメモ"}」を削除します。元に戻せません。`
  });
  if (!ok) return;
  try {
    await api(`/api/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
    const wasCurrent = state.current?.id === id;
    state.drafts = state.drafts.filter((draft) => draft.id !== id);
    if (wasCurrent) {
      state.current = null;
      if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
      else {
        clearEditor();
        setView("list");
      }
    } else {
      renderList();
    }
    await loadDrafts();
    toast("削除しました。");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---- 起動 ---- */

async function boot() {
  try {
    state.meta = await api("/api/meta");
  } catch (error) {
    toast(error.message, "error");
    return;
  }

  fillSelect(els.category, state.meta.categories, state.meta.categoryLabels);
  fillTagCandidates();

  await setupEditor();
  await loadDrafts();
  if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
  else clearEditor();
  setBusy(false);
  // 狭い画面では一覧から始める（編集は下書きを選んだときに開く）。
  if (window.matchMedia("(max-width: 1000px)").matches) setView("list");

  els.uploadRetry?.addEventListener("click", () => {
    editorBridge.handle?.retryFailedUploads?.();
  });
  els.body.addEventListener("input", onInput);
  els.titleInput.addEventListener("input", scheduleSave);
  els.titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusBody();
    }
  });
  els.category.addEventListener("change", () => {
    updatePublishFile();
    updateCategoryNote();
    scheduleSave();
  });
  syncThemeToggle();
  els.themeToggle.hidden = false;
  els.themeToggle.addEventListener("click", toggleTheme);
  window.addEventListener("storage", (event) => {
    if (event.key !== "theme" && event.key !== null) return;
    document.documentElement.classList.toggle("light", event.newValue === "light");
    syncThemeToggle();
  });
  els.newButton.addEventListener("click", newDraft);
  els.emptyNew.addEventListener("click", newDraft);
  els.back.addEventListener("click", () => setView("list"));
  els.editorMenu.addEventListener("click", () => {
    if (!state.current || state.busy) return;
    openMenu(els.editorMenu, [
      { label: "このメモを削除", danger: true, onSelect: () => removeDraft(state.current.id) }
    ]);
  });
  els.publishOpen.addEventListener("click", openPublishPanel);
  els.previewOpen.addEventListener("click", togglePreview);
  els.previewClose.addEventListener("click", closePreview);
  els.publishCancel.addEventListener("click", () => closePublishPanel({ restore: true }));
  els.publishPanel
    .querySelector(".dialog__backdrop")
    .addEventListener("click", () => closePublishPanel({ restore: true }));
  els.coverSet.addEventListener("click", () => els.coverFile.click());
  els.coverChange.addEventListener("click", () => els.coverFile.click());
  els.coverRemove.addEventListener("click", removeCover);
  els.coverFile.addEventListener("change", () => {
    const file = els.coverFile.files?.[0];
    els.coverFile.value = "";
    setCoverFromFile(file).catch(() => {});
  });
  els.tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === "、") {
      event.preventDefault();
      commitTagInput();
    } else if (event.key === "Backspace" && els.tagInput.value === "" && state.tags.length > 0) {
      removeTag(state.tags[state.tags.length - 1]);
    }
  });
  els.tagInput.addEventListener("change", commitTagInput);
  els.publishConfirm.addEventListener("click", () => {
    commitTagInput();
    closePublishPanel();
    runPublish();
  });
  els.confirmCancel.addEventListener("click", () => settleConfirm(false));
  els.confirmOk.addEventListener("click", () => settleConfirm(true));
  els.confirmDialog
    .querySelector(".dialog__backdrop")
    .addEventListener("click", () => settleConfirm(false));
  els.taskClose.addEventListener("click", closeTask);
  els.taskToggle.addEventListener("click", () => {
    const open = els.task.dataset.log === "open";
    els.task.dataset.log = open ? "closed" : "open";
    els.taskToggle.textContent = open ? "⌄" : "⌃";
    els.taskToggle.setAttribute("aria-expanded", open ? "false" : "true");
  });
  els.saveRetry?.addEventListener("click", () => {
    flushSave().catch(() => {});
  });

  // 本文 textarea では Tab / Shift+Tab を奪わない。WYSIWYG 側と同じく
  // フォーカス移動に渡し、キーボードだけで画面の操作を一巡できるようにする。

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave()
        .then(() => toast("保存しました。"))
        .catch((error) => toast(error.message, "error"));
    }
    if (event.key === "Escape") {
      if (!els.confirmDialog.hidden) settleConfirm(false);
      else if (!els.publishPanel.hidden) closePublishPanel({ restore: true });
      else if (!els.preview.hidden) closePreview();
      else if (!els.task.hidden) closeTask();
    }
  });

  window.addEventListener("online", () => {
    if (save.pending) flushSave().catch(() => {});
  });

  // 画面を閉じる・隠すときは keepalive を付ける。
  // 付けないとページ破棄でリクエストが中断され、直前の編集が消える。
  window.addEventListener("pagehide", () => {
    flushSave({ keepalive: true }).catch(() => {});
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushSave({ keepalive: true }).catch(() => {});
  });
}

boot();
