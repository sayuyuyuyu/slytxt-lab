import { plainText } from "/markdown.mjs";

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
  count: $("#count"),
  publish: $("#publish"),
  remove: $("#remove"),
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

function applyDraft(draft) {
  state.current = draft;
  els.category.value = draft.category;
  els.body.value = draft.body;
  showEmpty(false);

  // 別のメモの保存が失敗したまま残っているときは、その状態を消さない。
  if (!save.pending || save.pending.id === draft.id) {
    save.pending = null;
    setSaveStatus("idle");
  }
  updateCount();
  renderList();
}

function clearEditor() {
  state.current = null;
  els.body.value = "";
  showEmpty(true);
  renderList();
}

async function selectDraft(id) {
  if (state.current?.id !== id) await flushSave().catch(() => {});
  try {
    const { draft } = await api(`/api/drafts/${encodeURIComponent(id)}`);
    applyDraft(draft);
  } catch (error) {
    toast(error.message, "error");
  }
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

/* ---- 操作 ---- */

function setBusy(busy) {
  state.busy = busy;
  els.publish.disabled = busy || !state.current;
  els.remove.disabled = busy || !state.current;
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
    const result = await streamTask(`/api/publish/${id}`, "誤字を直して公開");
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
    await loadDrafts();
    els.body.focus();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function removeCurrent() {
  if (!state.current || state.busy) return;
  if (!window.confirm(`「${displayTitle(state.current)}」を削除します。元に戻せません。`)) return;
  try {
    await api(`/api/drafts/${encodeURIComponent(state.current.id)}`, { method: "DELETE" });
    state.drafts = state.drafts.filter((draft) => draft.id !== state.current.id);
    state.current = null;
    if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
    else clearEditor();
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

  await loadDrafts();
  if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
  else clearEditor();
  setBusy(false);

  els.body.addEventListener("input", onInput);
  els.category.addEventListener("change", onInput);
  els.newButton.addEventListener("click", newDraft);
  els.emptyNew.addEventListener("click", newDraft);
  els.publish.addEventListener("click", runPublish);
  els.remove.addEventListener("click", removeCurrent);
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
    if (event.key === "Escape" && !els.task.hidden) closeTask();
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
