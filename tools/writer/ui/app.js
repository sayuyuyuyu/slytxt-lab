import { renderMarkdown } from "/markdown.mjs";

const $ = (selector) => document.querySelector(selector);

const els = {
  app: $(".app"),
  drafts: $("#drafts"),
  draftCount: $("#draftCount"),
  search: $("#search"),
  title: $("#title"),
  category: $("#category"),
  status: $("#status"),
  tags: $("#tags"),
  saved: $("#saved"),
  body: $("#body"),
  count: $("#count"),
  preview: $("#preview"),
  expand: $("#expand"),
  publish: $("#publish"),
  remove: $("#remove"),
  new: $("#new"),
  theme: $("#theme"),
  task: $("#task"),
  taskTitle: $("#taskTitle"),
  taskLog: $("#taskLog"),
  taskClose: $("#taskClose"),
  toast: $("#toast")
};

const state = {
  meta: null,
  drafts: [],
  current: null,
  busy: false
};

let saveTimer = null;
let previewTimer = null;
let toastTimer = null;

/* ---- utilities ---- */

function toast(message, kind = "info") {
  els.toast.textContent = message;
  els.toast.className = kind === "error" ? "toast toast--error" : "toast";
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, kind === "error" ? 6000 : 3000);
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
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `リクエストに失敗しました (${response.status})`);
  return payload;
}

/* ---- task drawer ---- */

function openTask(title) {
  els.taskTitle.textContent = title;
  els.taskLog.textContent = "";
  els.task.hidden = false;
}

function logLine(message) {
  els.taskLog.textContent += `${message}\n`;
  els.taskLog.scrollTop = els.taskLog.scrollHeight;
}

function closeTask() {
  els.task.hidden = true;
}

async function streamTask(path, title) {
  openTask(title);
  const response = await fetch(path, { method: "POST" });
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
        if (message.type === "log") logLine(message.message);
        else if (message.type === "done") result = message.result;
        else if (message.type === "error") failure = message.message;
      }
      index = buffer.indexOf("\n");
    }
  }

  if (failure) throw new Error(failure);
  return result;
}

/* ---- list ---- */

function renderList() {
  const filter = els.search.value.trim().toLowerCase();
  const items = state.drafts.filter((draft) => {
    if (!filter) return true;
    return (
      draft.title.toLowerCase().includes(filter) ||
      draft.tags.join(" ").toLowerCase().includes(filter) ||
      draft.excerpt.toLowerCase().includes(filter)
    );
  });

  els.drafts.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "drafts__empty";
    empty.textContent = state.drafts.length === 0 ? "まだ何もありません。「新規」から始めます。" : "見つかりません。";
    els.drafts.append(empty);
  }

  for (const draft of items) {
    const item = document.createElement("li");
    item.className = "drafts__item";
    item.dataset.id = draft.id;
    if (state.current?.id === draft.id) item.setAttribute("aria-current", "true");

    const title = document.createElement("span");
    title.className = "drafts__title";
    title.textContent = draft.title;

    const meta = document.createElement("span");
    meta.className = "drafts__meta";

    const pill = document.createElement("span");
    pill.className = `pill pill--${draft.status}`;
    pill.textContent = state.meta?.statusLabels?.[draft.status] ?? draft.status;
    meta.append(pill);

    const where = document.createElement("span");
    where.textContent = state.meta?.categoryLabels?.[draft.category] ?? draft.category;
    meta.append(where);

    const when = document.createElement("span");
    when.textContent = `${draft.chars}字・${relativeTime(draft.updated)}`;
    meta.append(when);

    item.append(title, meta);
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

/* ---- editor ---- */

function fillSelect(select, values, labels) {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labels[value] ?? value;
    select.append(option);
  }
}

function renderPreview() {
  const html = renderMarkdown(els.body.value);
  els.preview.innerHTML = html || "";
  if (!html.trim()) {
    els.preview.innerHTML = '<p class="preview__empty">本文がまだありません。</p>';
  }
}

function updateCount() {
  const text = els.body.value;
  const chars = text.length;
  const lines = text ? text.split("\n").length : 0;
  els.count.textContent = `${chars}字・${lines}行`;
}

function applyDraftToEditor(draft) {
  state.current = draft;
  els.title.value = draft.title === "無題" ? "" : draft.title;
  els.category.value = draft.category;
  els.status.value = draft.status;
  els.tags.value = draft.tags.join(", ");
  els.body.value = draft.body;
  els.saved.textContent = draft.pr ? "PR作成済み" : "";
  els.publish.disabled = false;
  els.expand.disabled = false;
  els.remove.disabled = false;
  updateCount();
  renderPreview();
  renderList();
}

function clearEditor() {
  state.current = null;
  els.title.value = "";
  els.tags.value = "";
  els.body.value = "";
  els.saved.textContent = "";
  els.publish.disabled = true;
  els.expand.disabled = true;
  els.remove.disabled = true;
  updateCount();
  renderPreview();
  renderList();
}

async function selectDraft(id) {
  await flushSave();
  try {
    const { draft } = await api(`/api/drafts/${encodeURIComponent(id)}`);
    applyDraftToEditor(draft);
    if (window.matchMedia("(max-width: 1000px)").matches) setView("editor");
  } catch (error) {
    toast(error.message, "error");
  }
}

function collect() {
  return {
    title: els.title.value.trim() || "無題",
    category: els.category.value,
    status: els.status.value,
    tags: els.tags.value
      .split(/[,、]/)
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean),
    body: els.body.value
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  els.saved.textContent = "編集中…";
  saveTimer = setTimeout(() => {
    save().catch(() => {});
  }, 900);
}

async function save() {
  if (!state.current) return;
  clearTimeout(saveTimer);
  const id = state.current.id;
  const payload = collect();
  const { draft } = await api(`/api/drafts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  state.current = draft;
  els.saved.textContent = "保存しました";
  setTimeout(() => {
    if (els.saved.textContent === "保存しました") els.saved.textContent = "";
  }, 2000);
  const index = state.drafts.findIndex((item) => item.id === id);
  if (index !== -1) {
    state.drafts[index] = {
      ...state.drafts[index],
      title: draft.title,
      category: draft.category,
      status: draft.status,
      tags: draft.tags,
      updated: draft.updated,
      chars: draft.body.length,
      excerpt: draft.body.slice(0, 120)
    };
    state.drafts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  renderList();
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await save().catch(() => {});
  }
}

/* ---- markdown helpers ---- */

function surround(before, after = before, placeholder = "テキスト") {
  const { selectionStart: start, selectionEnd: end, value } = els.body;
  const selected = value.slice(start, end) || placeholder;
  els.body.setRangeText(`${before}${selected}${after}`, start, end, "end");
  if (start === end) {
    els.body.setSelectionRange(start + before.length, start + before.length + selected.length);
  }
  els.body.focus();
  onInput();
}

function prefixLines(prefix, placeholder = "項目") {
  const { selectionStart: start, selectionEnd: end, value } = els.body;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const block = value.slice(lineStart, end) || placeholder;
  const next = block
    .split("\n")
    .map((line, index) => (typeof prefix === "function" ? prefix(index) : prefix) + line)
    .join("\n");
  els.body.setRangeText(next, lineStart, end, "end");
  els.body.focus();
  onInput();
}

const INSERTERS = {
  h2: () => prefixLines("## ", "見出し"),
  h3: () => prefixLines("### ", "小見出し"),
  bold: () => surround("**", "**", "強調"),
  code: () => surround("`", "`", "code"),
  pre: () => surround("```\n", "\n```", "code"),
  link: () => surround("[", "](https://)", "リンク"),
  ul: () => prefixLines("- ", "項目"),
  ol: () => prefixLines((index) => `${index + 1}. `, "項目"),
  quote: () => prefixLines("> ", "引用"),
  table: () =>
    surround("| 項目 | 値 |\n| --- | --- |\n|  |  |\n", "", "| 項目 | 値 |\n| --- | --- |\n|  |  |\n")
};

function onInput() {
  updateCount();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 160);
  scheduleSave();
}

/* ---- task actions ---- */

function setBusy(busy) {
  state.busy = busy;
  els.expand.disabled = busy || !state.current;
  els.publish.disabled = busy || !state.current;
  els.remove.disabled = busy || !state.current;
  els.expand.textContent = busy ? "実行中…" : "AIで膨らます";
}

async function runExpand() {
  if (!state.current || state.busy) return;
  await flushSave();
  setBusy(true);
  try {
    const result = await streamTask(`/api/expand/${encodeURIComponent(state.current.id)}`, "AIで膨らませる");
    logLine("完了しました。内容を確認してください。");
    if (result?.draft) applyDraftToEditor(result.draft);
    await loadDrafts();
    toast("下書きに反映しました。元のメモは drafts/.history に残っています。");
  } catch (error) {
    logLine(`失敗: ${error.message}`);
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function runPublish() {
  if (!state.current || state.busy) return;
  if (!els.body.value.trim()) {
    toast("本文が空です。", "error");
    return;
  }
  if (!window.confirm(`${collect().title} を整形して Pull Request を出します。よろしいですか。`)) return;
  await flushSave();
  setBusy(true);
  try {
    const result = await streamTask(`/api/publish/${encodeURIComponent(state.current.id)}`, "整形してPR");
    logLine("");
    logLine(result?.prUrl ? `Pull Request: ${result.prUrl}` : `ブランチ: ${result?.branch}`);
    toast("Pull Request を作成しました。");
    await loadDrafts();
    if (state.current) {
      const { draft } = await api(`/api/drafts/${encodeURIComponent(state.current.id)}`);
      applyDraftToEditor(draft);
    }
  } catch (error) {
    logLine(`失敗: ${error.message}`);
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function removeCurrent() {
  if (!state.current || state.busy) return;
  if (!window.confirm(`「${state.current.title}」を削除します。元に戻せません。`)) return;
  try {
    await api(`/api/drafts/${encodeURIComponent(state.current.id)}`, { method: "DELETE" });
    clearEditor();
    await loadDrafts();
    toast("削除しました。");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function createNew() {
  await flushSave();
  try {
    const { draft } = await api("/api/drafts", {
      method: "POST",
      body: JSON.stringify({ title: "", category: els.category.value || "tech" })
    });
    state.drafts.unshift({ ...draft, chars: 0, excerpt: "" });
    applyDraftToEditor(draft);
    els.title.focus();
    if (window.matchMedia("(max-width: 1000px)").matches) setView("editor");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---- view / theme ---- */

function setView(view) {
  els.app.dataset.view = view;
  for (const button of document.querySelectorAll(".bar__views button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === view));
  }
}

function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
}

/* ---- boot ---- */

async function boot() {
  try {
    state.meta = await api("/api/meta");
  } catch (error) {
    toast(error.message, "error");
    return;
  }

  fillSelect(els.category, state.meta.categories, state.meta.categoryLabels);
  fillSelect(els.status, state.meta.statuses, state.meta.statusLabels);

  await loadDrafts();
  if (state.drafts.length > 0) {
    await selectDraft(state.drafts[0].id);
  } else {
    clearEditor();
  }

  els.body.addEventListener("input", onInput);
  els.title.addEventListener("input", onInput);
  els.tags.addEventListener("input", onInput);
  els.category.addEventListener("change", onInput);
  els.status.addEventListener("change", onInput);
  els.search.addEventListener("input", renderList);

  for (const button of document.querySelectorAll(".editor__tools button[data-insert]")) {
    button.addEventListener("click", () => INSERTERS[button.dataset.insert]?.());
  }

  els.new.addEventListener("click", createNew);
  els.expand.addEventListener("click", runExpand);
  els.publish.addEventListener("click", runPublish);
  els.remove.addEventListener("click", removeCurrent);
  els.theme.addEventListener("click", toggleTheme);
  els.taskClose.addEventListener("click", closeTask);

  for (const button of document.querySelectorAll(".bar__views button")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save()
        .then(() => els.body.focus())
        .catch((error) => toast(error.message, "error"));
    }
    if (event.key === "Escape" && !els.task.hidden) closeTask();
  });

  window.addEventListener("pagehide", () => {
    save().catch(() => {});
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save().catch(() => {});
  });
}

boot();
