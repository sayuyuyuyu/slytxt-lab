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

      const img = document.createElement("img");
      img.src = item.previewUrl;
      img.alt = "";
      li.append(img);

      const right = document.createElement("div");

      const altInput = document.createElement("input");
      altInput.type = "text";
      altInput.value = item.alt;
      altInput.maxLength = 200;
      altInput.placeholder = "画像の説明（alt）";
      altInput.setAttribute("aria-label", "画像の説明（alt）");
      altInput.addEventListener("input", () => {
        item.alt = altInput.value;
      });
      right.append(altInput);

      const state = document.createElement("span");
      state.className = "attachment__state";
      state.textContent =
        item.state === "uploading"
          ? "アップロード中…"
          : item.state === "error"
            ? (item.message ?? "アップロードに失敗しました")
            : "アップロード済み";
      right.append(state);
      li.append(right);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button";
      remove.textContent = "外す";
      remove.addEventListener("click", () => {
        URL.revokeObjectURL(item.previewUrl);
        attachments = attachments.filter((entry) => entry !== item);
        renderAttachments();
      });
      li.append(remove);

      return li;
    })
  );
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

els.body.addEventListener("input", updateCount);

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
    els.submit.disabled = false;
  }
});

updateCount();
renderAttachments();
void loadRecent();
