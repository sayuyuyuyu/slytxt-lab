/**
 * 投稿画面。Cloudflare Access の裏でだけ動く前提。
 * - 画像は先に /api/media へ上げ、返った key を本文と一緒に /api/posts へ送る。
 * - alt は画像ごとに入力させる（公開側でそのまま alt になる）。
 */

const MAX_IMAGES = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const els = {
  form: document.querySelector("#composer"),
  body: document.querySelector("#body"),
  count: document.querySelector("#count"),
  file: document.querySelector("#file"),
  attachments: document.querySelector("#attachments"),
  submit: document.querySelector("#submit"),
  status: document.querySelector("#status"),
  recent: document.querySelector("#recent")
};

/** 添付中の画像。{ id, file, previewUrl, key, alt, state, message } */
let attachments = [];
let nextAttachmentId = 1;

const ICON_X =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';
const ICON_TRASH =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

/** 投稿できる状態かどうかを送信ボタンの有効・無効だけで表す。 */
function updateSubmit() {
  const blocked = attachments.some((item) => item.state !== "done");
  els.submit.disabled = els.body.value.trim() === "" || blocked;
}

function setStatus(message, state = "info") {
  els.status.textContent = message;
  els.status.dataset.state = state;
}

function updateCount() {
  els.count.textContent = `${[...els.body.value].length} / 2000`;
}

function renderAttachments() {
  els.attachments.replaceChildren(
    ...attachments.map((item) => {
      const li = document.createElement("li");
      li.className = "attachment";
      // 状態は見た目で表す: アップロード中はサムネイルが脈動し、
      // 失敗したら枠が赤くなる。済んだら何も出ない。
      li.dataset.state = item.state;

      const img = document.createElement("img");
      img.src = item.previewUrl;
      img.alt = "";
      li.append(img);

      const right = document.createElement("div");

      const altInput = document.createElement("input");
      altInput.type = "text";
      altInput.value = item.alt;
      altInput.maxLength = 200;
      altInput.placeholder = "alt";
      altInput.setAttribute("aria-label", "画像の説明（alt）");
      altInput.addEventListener("input", () => {
        item.alt = altInput.value;
      });
      right.append(altInput);

      if (item.state === "error") {
        const state = document.createElement("span");
        state.className = "attachment__state";
        state.textContent = item.message ?? "アップロードに失敗しました";
        right.append(state);
      }
      li.append(right);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button attachment__remove";
      remove.innerHTML = ICON_X;
      remove.setAttribute("aria-label", "画像を外す");
      remove.title = "画像を外す";
      remove.addEventListener("click", () => {
        URL.revokeObjectURL(item.previewUrl);
        attachments = attachments.filter((entry) => entry !== item);
        renderAttachments();
      });
      li.append(remove);

      return li;
    })
  );
  updateSubmit();
}

async function uploadOne(item) {
  item.state = "uploading";
  renderAttachments();
  try {
    const response = await fetch("/api/media", {
      method: "POST",
      headers: { "x-slytxt-client": "1", "content-type": item.file.type },
      body: item.file
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `アップロードに失敗しました (${response.status})`);
    item.key = payload.key;
    item.state = "done";
  } catch (error) {
    item.state = "error";
    item.message = error.message;
  }
  renderAttachments();
}

els.file.addEventListener("change", () => {
  const files = [...(els.file.files ?? [])];
  els.file.value = "";
  for (const file of files) {
    if (attachments.length >= MAX_IMAGES) {
      setStatus(`画像は${MAX_IMAGES}枚までです。`, "error");
      break;
    }
    if (!TYPES.includes(file.type)) {
      setStatus(`${file.name} は画像として扱えません（JPEG / PNG / GIF / WebP）。`, "error");
      continue;
    }
    if (file.size > MAX_BYTES) {
      setStatus(`${file.name} は8MBを超えています。`, "error");
      continue;
    }
    const item = {
      id: nextAttachmentId++,
      file,
      previewUrl: URL.createObjectURL(file),
      key: null,
      alt: "",
      state: "ready",
      message: null
    };
    attachments.push(item);
    void uploadOne(item);
  }
  renderAttachments();
});

els.body.addEventListener("input", () => {
  updateCount();
  updateSubmit();
});

async function loadRecent() {
  try {
    const response = await fetch("/api/posts");
    if (!response.ok) throw new Error(String(response.status));
    const { posts } = await response.json();
    els.recent.replaceChildren(
      ...posts.slice(0, 10).map((post) => {
        const li = document.createElement("li");
        li.className = "recent__item";
        const time = document.createElement("time");
        time.className = "recent__time";
        time.dateTime = post.createdAt;
        time.textContent = new Date(post.createdAt).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo"
        });
        const body = document.createElement("p");
        body.className = "recent__body";
        body.textContent = post.body;
        li.append(time, body);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button recent__remove";
        remove.innerHTML = ICON_TRASH;
        remove.setAttribute("aria-label", "削除");
        remove.title = "削除";
        remove.addEventListener("click", () => void removePost(post, remove));
        li.append(remove);
        return li;
      })
    );
    if (posts.length === 0) {
      const li = document.createElement("li");
      li.className = "recent__item";
      li.textContent = "まだ投稿がありません。";
      els.recent.append(li);
    }
  } catch {
    els.recent.replaceChildren();
  }
}

/** 論理削除。画像の実体は R2 に残るので、必要なら手で消す（README 参照）。 */
async function removePost(post, button) {
  if (!confirm("この投稿を削除しますか？（公開一覧から外れます）")) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(post.id)}`, {
      method: "DELETE",
      headers: { "x-slytxt-client": "1" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `削除に失敗しました (${response.status})`);
    setStatus("削除しました。");
    void loadRecent();
  } catch (error) {
    button.disabled = false;
    setStatus(error.message, "error");
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (attachments.some((item) => item.state === "uploading")) {
    setStatus("画像のアップロードが終わるのを待ってください。", "error");
    return;
  }
  if (attachments.some((item) => item.state !== "done")) {
    setStatus("アップロードできていない画像があります。外してから投稿してください。", "error");
    return;
  }
  const body = els.body.value.trim();
  if (!body) {
    setStatus("本文が空です。", "error");
    els.body.focus();
    return;
  }
  const missingAlt = attachments.filter((item) => item.alt.trim() === "");
  if (missingAlt.length > 0) {
    setStatus("画像には説明（alt）を入れてください。", "error");
    return;
  }

  els.submit.disabled = true;
  setStatus("投稿しています…");
  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "x-slytxt-client": "1", "content-type": "application/json" },
      body: JSON.stringify({
        body,
        images: attachments.map((item) => ({ key: item.key, alt: item.alt.trim() }))
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `投稿に失敗しました (${response.status})`);
    for (const item of attachments) URL.revokeObjectURL(item.previewUrl);
    attachments = [];
    els.body.value = "";
    renderAttachments();
    updateCount();
    setStatus("投稿しました。");
    void loadRecent();
    els.body.focus();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    updateSubmit();
  }
});

updateCount();
renderAttachments();
void loadRecent();
