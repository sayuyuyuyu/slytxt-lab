import { plainText, renderMarkdown } from "/markdown.mjs";

const $ = (selector) => document.querySelector(selector);

const els = {
  app: $(".app"),
  editorPane: $(".pane--editor"),
  save: $("#save"),
  saveText: $("#saveText"),
  drafts: $("#drafts"),
  draftCount: $("#draftCount"),
  search: $("#search"),
  filter: $(".filter"),
  newArticle: $("#newArticle"),
  newNote: $("#newNote"),
  newArticleInline: $("#newArticleInline"),
  newNoteInline: $("#newNoteInline"),
  emptyArticle: $("#emptyArticle"),
  emptyNote: $("#emptyNote"),
  title: $("#title"),
  category: $("#category"),
  status: $("#status"),
  tagList: $("#tagList"),
  tagInput: $("#tagInput"),
  tagOptions: $("#tagOptions"),
  prLink: $("#prLink"),
  body: $("#body"),
  count: $("#count"),
  expand: $("#expand"),
  publish: $("#publish"),
  remove: $("#remove"),
  revert: $("#revert"),
  duplicate: $("#duplicate"),
  menu: $("#menu"),
  previewCategory: $("#previewCategory"),
  previewTitle: $("#previewTitle"),
  previewDate: $("#previewDate"),
  previewTags: $("#previewTags"),
  previewBody: $("#previewBody"),
  task: $("#task"),
  taskTitle: $("#taskTitle"),
  taskElapsed: $("#taskElapsed"),
  taskToggle: $("#taskToggle"),
  taskClose: $("#taskClose"),
  taskLog: $("#taskLog"),
  taskResult: $("#taskResult"),
  theme: $("#theme"),
  toast: $("#toast")
};

const state = {
  meta: null,
  drafts: [],
  current: null,
  tags: [],
  filter: "all",
  query: "",
  busy: false
};

const save = { status: "idle", pending: null, timer: null, retryTimer: null, attempt: 0 };

let previewTimer = null;
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

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(date);
}

/** 退避ファイルの 2026-09-17T04-13-13-423Z を Date に戻す。 */
function historyDate(stamp) {
  const iso = String(stamp).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
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
    status: draft.status,
    tags: draft.tags,
    updated: draft.updated,
    chars: draft.body.length,
    excerpt: plainText(draft.body).slice(0, 120),
    pr: draft.pr
  };
  state.drafts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  renderList();
}

/* ---- 一覧 ---- */

function renderList() {
  const query = state.query.trim().toLowerCase();
  const items = state.drafts.filter((draft) => {
    if (state.filter !== "all" && draft.status !== state.filter) return false;
    if (!query) return true;
    return (
      displayTitle(draft).toLowerCase().includes(query) ||
      draft.tags.join(" ").toLowerCase().includes(query) ||
      draft.excerpt.toLowerCase().includes(query)
    );
  });

  els.drafts.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "drafts__empty";
    empty.textContent =
      state.drafts.length === 0
        ? "まだありません。"
        : "見つかりません。";
    els.drafts.append(empty);
  }

  for (const draft of items) {
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

    item.append(meta);
    item.addEventListener("click", () => selectDraft(draft.id));
    els.drafts.append(item);
  }

  els.draftCount.textContent = `${state.drafts.length}件`;
}

async function loadDrafts() {
  const payload = await api("/api/drafts");
  state.drafts = payload.drafts;
  renderTagOptions();
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
  els.editorPane.dataset.empty = empty ? "true" : "false";
}

function renderTags() {
  els.tagList.replaceChildren();
  for (const tag of state.tags) {
    const li = document.createElement("li");
    li.className = "tag";

    const label = document.createElement("span");
    label.textContent = tag;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${tag} を外す`);
    remove.addEventListener("click", () => {
      state.tags = state.tags.filter((item) => item !== tag);
      renderTags();
      onInput();
    });

    li.append(label, remove);
    els.tagList.append(li);
  }
}

function renderTagOptions() {
  const known = new Set();
  for (const draft of state.drafts) for (const tag of draft.tags) known.add(tag);
  els.tagOptions.replaceChildren();
  for (const tag of [...known].sort((a, b) => a.localeCompare(b, "ja"))) {
    const option = document.createElement("option");
    option.value = tag;
    els.tagOptions.append(option);
  }
}

function commitTag(raw) {
  const tag = String(raw).trim().replace(/^#/, "").replace(/[,、]$/, "");
  if (!tag) return;
  if (!state.tags.includes(tag)) {
    state.tags.push(tag);
    renderTags();
    onInput();
  }
  els.tagInput.value = "";
}

function updateCount() {
  const text = els.body.value;
  const chars = text.length;
  const lines = text ? text.split("\n").length : 0;
  els.count.textContent = `${chars}字・${lines}行`;
}

function renderPreview() {
  const body = els.body.value;
  const title = els.title.value.trim() || (state.current ? displayTitle(state.current) : "タイトル未設定");
  const category = state.meta?.categoryLabels?.[els.category.value] ?? "";

  els.previewCategory.textContent = category;
  els.previewTitle.textContent = title;
  els.previewDate.textContent = state.current
    ? `下書き・最終更新 ${formatDate(state.current.updated)}`
    : "";

  els.previewTags.replaceChildren();
  for (const tag of state.tags) {
    const li = document.createElement("li");
    li.textContent = `#${tag}`;
    els.previewTags.append(li);
  }

  if (!body.trim()) {
    els.previewBody.innerHTML = '<p class="preview__empty">本文がまだありません。</p>';
    return;
  }
  els.previewBody.innerHTML = renderMarkdown(body);
}

function applyDraft(draft) {
  state.current = draft;
  state.tags = [...draft.tags];
  els.title.value = draft.title === "無題" ? "" : draft.title;
  els.category.value = draft.category;
  els.status.value = draft.status;
  els.body.value = draft.body;
  els.tagInput.value = "";
  renderTags();
  showEmpty(false);

  if (draft.pr) {
    els.prLink.href = draft.pr;
    els.prLink.textContent = "PR を開く";
    els.prLink.hidden = false;
  } else {
    els.prLink.hidden = true;
  }

  const note = draft.category === "notes";
  els.expand.hidden = note;
  els.publish.textContent = note
    ? (draft.pr ? "再公開" : "誤字を直して公開")
    : (draft.pr ? "PRを更新" : "PRを作る");

  // 別のメモの保存が失敗したまま残っているときは、その状態を消さない。
  if (!save.pending || save.pending.id === draft.id) {
    save.pending = null;
    setSaveStatus("idle");
  }
  updateCount();
  renderPreview();
  renderList();
}

function clearEditor() {
  state.current = null;
  state.tags = [];
  els.title.value = "";
  els.body.value = "";
  els.tagInput.value = "";
  renderTags();
  renderPreview();
  showEmpty(true);
  renderList();
}

async function selectDraft(id) {
  if (state.current?.id !== id) await flushSave().catch(() => {});
  try {
    const { draft } = await api(`/api/drafts/${encodeURIComponent(id)}`);
    applyDraft(draft);
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
    tags: state.tags,
    body: els.body.value
  };
}

function onInput() {
  updateCount();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 160);
  scheduleSave();
}

/* ---- 書式 ---- */

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
  els.expand.disabled = busy || !state.current;
  els.publish.disabled = busy || !state.current;
}

async function runExpand() {
  if (!state.current || state.busy) return;
  await flushSave().catch(() => {});
  const before = els.body.value;
  setBusy(true);
  try {
    const result = await streamTask(`/api/expand/${encodeURIComponent(state.current.id)}`, "AIで下書きを作成中");
    finishTask();
    if (result?.draft) {
      const typed = els.body.value !== before && els.body.value.trim() !== "";
      if (!typed || window.confirm("AIの結果で本文を置き換えます。実行中に書いた内容は失われます。")) {
        applyDraft(result.draft);
        showResult([{ label: "下書きに反映しました。元のメモは drafts/.history に残っています。" }]);
      } else {
        showResult([{ label: "反映しませんでした。AIの結果は drafts/.history にあります。" }]);
      }
    }
    await loadDrafts();
    toast("下書きにしました。");
  } catch (error) {
    finishTask();
    appendLog(`失敗: ${error.message}`);
    showResult([{ label: "失敗しました。ログを確認してください。" }]);
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
  const note = state.current.category === "notes";
  if (!note && !window.confirm("Pull Request を作ります。")) return;

  await flushSave().catch(() => {});
  setBusy(true);
  const id = encodeURIComponent(state.current.id);
  try {
    if (note) {
      const result = await streamTask(`/api/note/${id}`, "誤字を直して公開");
      finishTask();
      showResult([
        { label: result.file },
        { href: result.prUrl, label: "PR" }
      ]);
      toast("公開しました。");
    } else {
      const updating = Boolean(state.current.pr);
      const result = await streamTask(`/api/publish/${id}`, updating ? "PR を更新" : "PR を作成");
      finishTask();
      if (result?.updated === false && result?.prUrl) {
        showResult([
          { label: "変更はありません。" },
          { href: result.prUrl, label: "PR" }
        ]);
      } else {
        showResult([
          { label: `${result.file} / ${result.branch}` },
          { href: result.prUrl, label: "PR" }
        ]);
        toast(updating ? "PR を更新しました。" : "PR を作成しました。");
      }
    }
    const { draft } = await api(`/api/drafts/${id}`);
    applyDraft(draft);
    await loadDrafts();
  } catch (error) {
    finishTask();
    appendLog(`失敗: ${error.message}`);
    showResult([{ label: "失敗しました。" }]);
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function createDraft({ title = "", category, body = "" } = {}) {
  await flushSave().catch(() => {});
  const { draft } = await api("/api/drafts", {
    method: "POST",
    body: JSON.stringify({ title, category: category ?? els.category.value ?? "tech" })
  });
  const saved = body ? (await api(`/api/drafts/${encodeURIComponent(draft.id)}`, {
    method: "PUT",
    body: JSON.stringify({ body })
  })).draft : draft;

  state.drafts.unshift({
    ...saved,
    chars: saved.body.length,
    excerpt: plainText(saved.body).slice(0, 120)
  });
  applyDraft(saved);
  await loadDrafts();
  els.menu.open = false;
  if (window.matchMedia("(max-width: 1000px)").matches) setView("editor");
  els.body.focus();
  return saved;
}

function newDraft(category) {
  createDraft({ category }).catch((error) => toast(error.message, "error"));
}

async function revertCurrent() {
  if (!state.current) return;
  els.menu.open = false;
  try {
    const { history } = await api(`/api/drafts/${encodeURIComponent(state.current.id)}/history`);
    const latest = history[0];
    if (!latest) {
      toast("戻せる版がまだありません。");
      return;
    }
    const when = historyDate(latest.stamp);
    const label = when ? when.toLocaleString("ja-JP") : latest.stamp;
    if (!window.confirm(`${label} の状態に戻します。いまの内容は履歴に残ります。`)) return;

    const { draft } = await api(`/api/drafts/${encodeURIComponent(state.current.id)}/restore`, {
      method: "POST",
      body: JSON.stringify({ file: latest.file })
    });
    applyDraft(draft);
    await loadDrafts();
    toast("戻しました。");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function duplicateCurrent() {
  if (!state.current) return;
  const copy = collect();
  await createDraft({
    title: copy.title === "無題" ? "無題" : `${copy.title} のコピー`,
    category: copy.category,
    body: copy.body
  });
  toast("複製しました。");
}

async function removeCurrent() {
  if (!state.current || state.busy) return;
  els.menu.open = false;
  if (!window.confirm(`「${displayTitle(state.current)}」を削除します。元に戻せません。`)) return;
  try {
    await api(`/api/drafts/${encodeURIComponent(state.current.id)}`, { method: "DELETE" });
    state.drafts = state.drafts.filter((draft) => draft.id !== state.current.id);
    clearEditor();
    if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
    await loadDrafts();
    toast("削除しました。");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---- 表示の切り替え ---- */

function setView(view) {
  els.app.dataset.view = view;
  for (const button of document.querySelectorAll(".bar__views button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === view));
  }
}

function toggleTheme() {
  const light = !document.documentElement.classList.contains("light");
  document.documentElement.classList.toggle("light", light);
  try {
    localStorage.setItem("theme", light ? "light" : "dark");
  } catch {}
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
  fillSelect(els.status, state.meta.statuses, state.meta.statusLabels);

  await loadDrafts();
  if (state.drafts.length > 0) await selectDraft(state.drafts[0].id);
  else clearEditor();

  els.body.addEventListener("input", onInput);
  els.title.addEventListener("input", onInput);
  els.category.addEventListener("change", onInput);
  els.status.addEventListener("change", onInput);
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderList();
  });

  els.filter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    for (const item of els.filter.querySelectorAll("button")) {
      item.setAttribute("aria-pressed", String(item === button));
    }
    renderList();
  });

  els.tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === "、") {
      event.preventDefault();
      commitTag(els.tagInput.value);
    } else if (event.key === "Backspace" && els.tagInput.value === "" && state.tags.length > 0) {
      state.tags.pop();
      renderTags();
      onInput();
    }
  });
  els.tagInput.addEventListener("change", () => commitTag(els.tagInput.value));
  els.tagInput.addEventListener("blur", () => commitTag(els.tagInput.value));

  for (const button of document.querySelectorAll(".editor__tools button[data-insert]")) {
    button.addEventListener("click", () => INSERTERS[button.dataset.insert]?.());
  }

  els.newArticle.addEventListener("click", () => newDraft("tech"));
  els.newNote.addEventListener("click", () => newDraft("notes"));
  els.newArticleInline.addEventListener("click", () => newDraft("tech"));
  els.newNoteInline.addEventListener("click", () => newDraft("notes"));
  els.emptyArticle.addEventListener("click", () => newDraft("tech"));
  els.emptyNote.addEventListener("click", () => newDraft("notes"));
  els.expand.addEventListener("click", runExpand);
  els.publish.addEventListener("click", runPublish);
  els.remove.addEventListener("click", removeCurrent);
  els.revert.addEventListener("click", revertCurrent);
  els.duplicate.addEventListener("click", duplicateCurrent);
  els.theme.addEventListener("click", toggleTheme);
  els.taskClose.addEventListener("click", closeTask);
  els.taskToggle.addEventListener("click", () => {
    const open = els.task.dataset.log === "open";
    els.task.dataset.log = open ? "closed" : "open";
    els.taskToggle.textContent = open ? "⌄" : "⌃";
  });
  els.save.addEventListener("click", () => {
    if (save.status === "error") flushSave().catch(() => {});
  });

  for (const button of document.querySelectorAll(".bar__views button")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }

  els.title.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.body.focus();
    }
  });

  els.body.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      els.body.setRangeText("  ", els.body.selectionStart, els.body.selectionEnd, "end");
      onInput();
    }
  });

  document.addEventListener("click", (event) => {
    if (els.menu.open && !els.menu.contains(event.target)) els.menu.open = false;
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave()
        .then(() => toast("保存しました。"))
        .catch((error) => toast(error.message, "error"));
    }
    if (event.key === "Escape") {
      if (!els.task.hidden) closeTask();
      else if (els.menu.open) els.menu.open = false;
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
