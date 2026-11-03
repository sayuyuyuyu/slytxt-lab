import { plainText } from "/markdown.mjs";

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
  drafts: $("#drafts"),
  draftCount: $("#draftCount"),
  newButton: $("#new"),
  emptyNew: $("#emptyNew"),
  category: $("#category"),
  body: $("#body"),
  editorRoot: $("#editorRoot"),
  count: $("#count"),
  back: $("#back"),
  editorMenu: $("#editorMenu"),
  publishOpen: $("#publishOpen"),
  publishPanel: $("#publishPanel"),
  publishTitle: $("#publishTitle"),
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
  busy: false
};

const save = { status: "idle", pending: null, timer: null, retryTimer: null, attempt: 0 };

let toastTimer = null;
let clock = null;

const SAVE_LABEL = {
  idle: "保存済み",
  dirty: "未保存",
  saving: "保存中…",
  error: "保存できません・再試行"
};

/* ---- 小さな道具 ---- */

function toast(message, kind = "info") {
  els.toast.textContent = message;
  els.toast.className = kind === "error" ? "toast toast--error" : "toast";
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
  return first.length > 32 ? `${first.slice(0, 32)}…` : first;
}

/** 本文を持つ下書き（編集中の1件）の表示名。本文の書き出しから作る。 */
function draftName(draft) {
  if (draft.title && draft.title !== "無題") return draft.title;
  if (draft.body) {
    const firstLine = draft.body.split("\n").find((line) => line.trim()) ?? "";
    const text = plainText(firstLine).replace(/\s+/g, " ").trim();
    if (text) return text.length > 32 ? `${text.slice(0, 32)}…` : text;
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
  els.save.setAttribute("aria-live", "polite");
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
    chars: draft.body.length,
    excerpt: plainText(draft.body).slice(0, 120)
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

    const title = document.createElement("span");
    title.className = "drafts__title";
    title.textContent = displayTitle(draft);
    item.append(title);

    const excerpt = String(draft.excerpt ?? "").trim();
    if (draft.title !== "無題" && excerpt) {
      const text = document.createElement("span");
      text.className = "drafts__excerpt";
      text.textContent = excerpt.slice(0, 90);
      item.append(text);
    }

    const meta = document.createElement("span");
    meta.className = "drafts__meta";

    const where = document.createElement("span");
    where.textContent = state.meta?.categoryLabels?.[draft.category] ?? draft.category;
    meta.append(where);

    const when = document.createElement("span");
    when.textContent = `${draft.chars}字・${relativeTime(draft.updated)}`;
    meta.append(when);

    item.append(meta);

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "drafts__menu";
    menuButton.textContent = "…";
    menuButton.setAttribute("aria-label", `${displayTitle(draft)} の操作`);
    menuButton.setAttribute("aria-haspopup", "menu");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(menuButton, [
        { label: "開く", onSelect: () => selectDraft(draft.id) },
        { label: "削除", danger: true, onSelect: () => removeDraft(draft.id) }
      ]);
    });
    item.append(menuButton);

    item.addEventListener("click", () => selectDraft(draft.id));
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
  const chars = text.length;
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

async function uploadMedia(file) {
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
  return payload.url;
}

async function setupEditor() {
  if (!window.SlytxtEditor?.mount) return;
  try {
    editorBridge.handle = await window.SlytxtEditor.mount(els.editorRoot, {
      value: "",
      onUpload: uploadMedia,
      onChange: (markdown) => {
        if (editorBridge.applying) {
          editorBridge.lastValue = markdown;
          return;
        }
        // 自分で差し替えた内容のエコー（直後の非同期通知）は無視する。
        if (markdown === editorBridge.lastValue) return;
        editorBridge.lastValue = markdown;
        // ブロック画像のキャプションは alt へ戻して保存する（editor.js 参照）。
        const text = editorBridge.convert ? editorBridge.convert.from(markdown) : markdown;
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
  state.current = draft;
  els.category.value = draft.category;
  els.body.value = draft.body;
  editorSet(draft.body);
  showEmpty(false);

  // 別のメモの保存が失敗したまま残っているときは、その状態を消さない。
  if (!save.pending || save.pending.id === draft.id) {
    save.pending = null;
    setSaveStatus("idle");
  }
  updateCount();
  renderList();
  setBusy(state.busy);
}

function clearEditor() {
  state.current = null;
  els.body.value = "";
  editorSet("");
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
    body: els.body.value
  };
}

function onInput() {
  updateCount();
  scheduleSave();
}

/* ---- 実行中のパネル ---- */

function openTask(title) {
  els.taskTitle.textContent = title;
  els.taskLog.textContent = "";
  els.taskResult.replaceChildren();
  els.taskResult.hidden = true;
  els.task.dataset.state = "running";
  els.task.dataset.log = "open";
  els.taskToggle.textContent = "⌃";
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

function showResult(parts) {
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
      span.className = "editor__count";
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
  while (Date.now() < deadline) {
    await sleep(5000);
    const status = await api(`/api/publish/${encodeURIComponent(id)}/status`);
    if (status.state === "merged") return status;
    if (status.state === "failed") {
      throw new Error(status.message ?? `CI が失敗しました: ${status.prUrl ?? ""}`);
    }
    last = status;
  }
  throw new Error(`CI が終わりませんでした。PR を確認してください: ${last?.prUrl ?? ""}`);
}

/* ---- メニューとダイアログ ---- */

let menuCleanup = null;

function closeMenu() {
  els.menu.hidden = true;
  els.menu.replaceChildren();
  if (menuCleanup) {
    menuCleanup();
    menuCleanup = null;
  }
}

function openMenu(anchor, items) {
  closeMenu();
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
    if (event.key === "Escape") closeMenu();
  };
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKey);
  menuCleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKey);
  };
}

let confirmResolve = null;

function confirmAction({ title, message, okLabel = "削除する" }) {
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
  if (confirmResolve) {
    confirmResolve(value);
    confirmResolve = null;
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
  els.publishTitle.textContent = draftName({ ...state.current, body: els.body.value });
  updatePublishFile();
  els.publishPanel.hidden = false;
  els.publishConfirm.focus();
}

function closePublishPanel() {
  els.publishPanel.hidden = true;
}

/* ---- 操作 ---- */

function setBusy(busy) {
  state.busy = busy;
  const disabled = busy || !state.current;
  els.publishOpen.disabled = disabled;
  els.editorMenu.disabled = disabled;
  els.publishConfirm.disabled = busy;
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
      { href: result.prUrl, label: "PR" }
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
    showResult([{ label: "失敗しました。" }]);
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
    focusBody();
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

  await setupEditor();
  await loadDrafts();
  if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
  else clearEditor();
  setBusy(false);
  // 狭い画面では一覧から始める（編集は下書きを選んだときに開く）。
  if (window.matchMedia("(max-width: 1000px)").matches) setView("list");

  els.body.addEventListener("input", onInput);
  els.category.addEventListener("change", () => {
    updatePublishFile();
    scheduleSave();
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
  els.publishCancel.addEventListener("click", closePublishPanel);
  els.publishPanel
    .querySelector(".dialog__backdrop")
    .addEventListener("click", closePublishPanel);
  els.publishConfirm.addEventListener("click", () => {
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
  });
  els.save.addEventListener("click", () => {
    if (save.status === "error") flushSave().catch(() => {});
  });

  els.body.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      els.body.setRangeText("  ", els.body.selectionStart, els.body.selectionEnd, "end");
      onInput();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave()
        .then(() => toast("保存しました。"))
        .catch((error) => toast(error.message, "error"));
    }
    if (event.key === "Escape") {
      if (!els.confirmDialog.hidden) settleConfirm(false);
      else if (!els.publishPanel.hidden) closePublishPanel();
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
