import { formatJst, formatRfc822 } from "./format.ts";
import type { BookmarkItem, BookmarkSnapshot } from "./types.ts";

export type RenderOptions = {
  siteName: string;
  siteUrl: string;
  pageUrl: string;
  rssUrl: string;
  jsonUrl: string;
  count: number;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 本文は変えずに、裸の URL だけリンクにする。 */
function renderText(text: string): string {
  return text
    .split(/(https?:\/\/[^\s]+)/g)
    .map((part) =>
      /^https?:\/\//.test(part)
        ? `<a href="${escapeHtml(part)}" rel="noreferrer noopener">${escapeHtml(part)}</a>`
        : escapeHtml(part)
    )
    .join("");
}

function firstLine(text: string, limit = 80): string {
  const line = text.split("\n").find((value) => value.trim() !== "") ?? text;
  const trimmed = line.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

function authorLabel(item: BookmarkItem): string {
  const handle = item.author.username ? `@${item.author.username}` : "";
  return [item.author.name, handle].filter(Boolean).join(" ");
}

function initialOf(name: string): string {
  return [...name.trim()][0] ?? "?";
}

export function renderJson(snapshot: BookmarkSnapshot | null): string {
  return JSON.stringify(
    {
      updatedAt: snapshot?.updatedAt ?? null,
      attemptedAt: snapshot?.attemptedAt ?? null,
      error: snapshot?.error ?? null,
      items: snapshot?.items ?? []
    },
    null,
    2
  );
}

export function renderRss(snapshot: BookmarkSnapshot | null, options: RenderOptions): string {
  const items = snapshot?.items ?? [];
  const entries = items
    .map((item) =>
      [
        "    <item>",
        `      <title>${escapeXml(firstLine(item.text))}</title>`,
        `      <link>${escapeXml(item.url)}</link>`,
        `      <guid isPermaLink="false">x-${escapeXml(item.id)}</guid>`,
        `      <pubDate>${formatRfc822(item.createdAt)}</pubDate>`,
        `      <dc:creator>${escapeXml(authorLabel(item))}</dc:creator>`,
        `      <description>${escapeXml(item.text)}</description>`,
        "    </item>"
      ].join("\n")
    )
    .join("\n");

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${escapeXml(`${options.siteName} のXブックマーク`)}</title>`,
    `    <link>${escapeXml(options.pageUrl)}</link>`,
    `    <description>${escapeXml(`Xで保存した投稿のうち最新${options.count}件。`)}</description>`,
    "    <language>ja</language>",
    `    <lastBuildDate>${formatRfc822(snapshot?.updatedAt ?? new Date(0).toISOString())}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(options.rssUrl)}" rel="self" type="application/rss+xml"/>`
  ];
  if (entries) lines.push(entries);
  lines.push("  </channel>", "</rss>", "");

  return lines.join("\n");
}

function avatarHtml(item: BookmarkItem): string {
  if (item.author.avatar) {
    return `<img class="card__avatar" src="${escapeHtml(item.author.avatar)}" alt="" width="40" height="40" loading="lazy" decoding="async">`;
  }
  return `<span class="card__avatar card__avatar--fallback" aria-hidden="true">${escapeHtml(initialOf(item.author.name))}</span>`;
}

function cardHtml(item: BookmarkItem): string {
  const handle = item.author.username
    ? `<p class="card__handle">@${escapeHtml(item.author.username)}</p>`
    : "";
  return `<li class="card">
<div class="card__head">${avatarHtml(item)}<div class="card__who"><p class="card__name">${escapeHtml(item.author.name)}</p>${handle}</div><time class="card__time" datetime="${escapeHtml(item.createdAt)}">${formatJst(item.createdAt)}</time></div>
<p class="card__text">${renderText(item.text)}</p>
<div class="card__foot"><a class="card__open" href="${escapeHtml(item.url)}" rel="noreferrer noopener" target="_blank">Xで開く</a></div>
</li>`;
}

const STYLE = `
:root{--bg:#fdfcf8;--surface:#f4f0e8;--card:#ffffff;--text:#292721;--text-muted:#706a60;--border:#e2dcd0;--accent:#a43d29}
@media (prefers-color-scheme:dark){:root{--bg:#1d1b18;--surface:#292621;--card:#292621;--text:#f2eee5;--text-muted:#b8b0a1;--border:#413b33;--accent:#ee947d}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.9 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
a{color:var(--accent)}
.wrap{max-width:680px;margin:0 auto;padding:48px 20px 80px}
.eyebrow{margin:0;color:var(--text-muted);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase}
h1{margin:8px 0 0;font:500 1.9rem/1.4 Georgia,"Hiragino Mincho ProN",serif}
.lead{margin:16px 0 0;color:var(--text-muted);font-size:.92rem}
.links{display:flex;flex-wrap:wrap;gap:16px;margin:20px 0 0;font-size:.85rem}
.notice{margin:24px 0 0;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:14px 16px;font-size:.85rem;color:var(--text-muted)}
.cards{list-style:none;margin:28px 0 0;padding:0;display:grid;gap:14px}
.card{margin:0;border:1px solid var(--border);border-radius:14px;background:var(--card);padding:16px 16px 12px}
.card__head{display:flex;align-items:center;gap:10px}
.card__avatar{width:40px;height:40px;border-radius:50%;flex:none;object-fit:cover}
.card__avatar--fallback{display:inline-flex;align-items:center;justify-content:center;background:var(--surface);color:var(--text);font-weight:600;font-size:.95rem}
.card__who{min-width:0}
.card__name{margin:0;font-weight:600;font-size:.92rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card__handle{margin:0;color:var(--text-muted);font-size:.78rem;line-height:1.35}
.card__time{margin-left:auto;color:var(--text-muted);font-size:.74rem;white-space:nowrap;align-self:flex-start}
.card__text{margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem;line-height:1.85}
.card__foot{display:flex;justify-content:flex-end;margin:10px 0 0}
.card__open{font-size:.8rem}
.empty{margin:32px 0 0;color:var(--text-muted);font-size:.9rem}
`;

export function renderHtml(snapshot: BookmarkSnapshot | null, options: RenderOptions): string {
  const items = snapshot?.items ?? [];
  const title = `${options.siteName} のXブックマーク`;

  let body: string;
  if (!snapshot) {
    body = `<p class="empty">まだXと接続していません。接続すると、ここに保存した投稿が並びます。</p>`;
  } else if (items.length === 0) {
    body = `<p class="empty">ブックマークがまだありません。</p>`;
  } else {
    body = `<ol class="cards">${items.map(cardHtml).join("\n")}</ol>`;
  }

  const notice = snapshot?.error
    ? `<p class="notice">最新の取得に失敗しました（${formatJst(snapshot.updatedAt)} 時点の内容）。</p>`
    : "";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<p class="eyebrow">bookmarks</p>
<h1>Xのブックマーク</h1>
<p class="lead">Xで保存した投稿のうち、最新${options.count}件。1日1回、朝9時以降の最初のアクセスで取り直します。</p>
<p class="links"><a href="${escapeHtml(options.siteUrl)}">${escapeHtml(options.siteName)}</a><a href="${escapeHtml(options.rssUrl)}">RSS</a><a href="${escapeHtml(options.jsonUrl)}">JSON</a>${snapshot ? `<span class="updated">更新 ${formatJst(snapshot.updatedAt)}</span>` : ""}</p>
</header>
${notice}
${body}
</div>
</body>
</html>
`;
}

/** 埋め込み先の CSS と干渉しないよう Shadow DOM に描くスタイル。 */
const EMBED_STYLE = `
:host{display:block;color:var(--xb-text,#292721);font:15px/1.8 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
@media (prefers-color-scheme:dark){:host{color:var(--xb-text,#f2eee5)}}
*,*::before,*::after{box-sizing:border-box}
a{color:var(--xb-accent,#a43d29)}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 14px}
.title{font-weight:600}
.meta{display:flex;gap:12px;color:var(--xb-muted,#706a60);font-size:.78rem}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.card{border:1px solid var(--xb-border,#e2dcd0);border-radius:14px;background:var(--xb-card,transparent);padding:16px 16px 12px}
.card__head{display:flex;align-items:center;gap:10px}
.card__avatar{width:40px;height:40px;border-radius:50%;flex:none;object-fit:cover}
.card__avatar--fallback{display:inline-flex;align-items:center;justify-content:center;background:var(--xb-surface,rgba(127,127,127,.14));color:var(--xb-text,#292721);font-weight:600;font-size:.95rem}
.card__who{min-width:0}
.card__name{margin:0;font-weight:600;font-size:.92rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card__handle{margin:0;color:var(--xb-muted,#706a60);font-size:.78rem;line-height:1.35}
.card__time{margin-left:auto;color:var(--xb-muted,#706a60);font-size:.74rem;white-space:nowrap;align-self:flex-start}
.card__text{margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem;line-height:1.85}
.card__foot{display:flex;justify-content:flex-end;margin:10px 0 0}
.card__open{font-size:.8rem}
.notice,.empty{margin:14px 0 0;color:var(--xb-muted,#706a60);font-size:.85rem}
`;

/** `<script src=".../embed.js">` で一覧をカードで描く。データは取得済みのものを埋め込むので追加の通信も CORS も要らない。 */
export function renderEmbed(snapshot: BookmarkSnapshot | null, options: RenderOptions): string {
  const items = (snapshot?.items ?? []).map((item) => ({
    text: item.text,
    url: item.url,
    name: item.author.name,
    username: item.author.username,
    avatar: item.author.avatar ?? null,
    createdAt: item.createdAt,
    displayAt: formatJst(item.createdAt)
  }));

  const data = JSON.stringify({
    siteName: options.siteName,
    siteUrl: options.siteUrl,
    rssUrl: options.rssUrl,
    updatedAt: snapshot ? formatJst(snapshot.updatedAt) : null,
    error: snapshot?.error ?? null,
    connected: snapshot !== null,
    count: options.count,
    items
  });

  return `(function () {
  var DATA = ${data};
  var script = document.currentScript;
  var root = document.createElement("div");
  root.className = "x-bookmarks";

  var mount = root.attachShadow ? root.attachShadow({ mode: "open" }) : root;
  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(EMBED_STYLE)};
  mount.appendChild(style);

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function linked(value) {
    var wrap = document.createDocumentFragment();
    var parts = String(value).split(/(https?:\\/\\/[^\\s]+)/g);
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (/^https?:\\/\\//.test(part)) {
        var a = el("a", null, part);
        a.href = part;
        a.rel = "noreferrer noopener";
        a.target = "_blank";
        wrap.appendChild(a);
      } else if (part) {
        wrap.appendChild(document.createTextNode(part));
      }
    }
    return wrap;
  }

  function avatar(item) {
    if (item.avatar) {
      var img = el("img", "card__avatar");
      img.src = item.avatar;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 40;
      img.height = 40;
      return img;
    }
    var fallback = el("span", "card__avatar card__avatar--fallback", item.name ? item.name.charAt(0) : "?");
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  }

  function card(item) {
    var li = el("li", "card");

    var head = el("div", "card__head");
    head.appendChild(avatar(item));
    var who = el("div", "card__who");
    who.appendChild(el("p", "card__name", item.name));
    if (item.username) who.appendChild(el("p", "card__handle", "@" + item.username));
    head.appendChild(who);
    var time = el("time", "card__time", item.displayAt);
    time.dateTime = item.createdAt;
    head.appendChild(time);
    li.appendChild(head);

    var body = el("p", "card__text");
    body.appendChild(linked(item.text));
    li.appendChild(body);

    var foot = el("div", "card__foot");
    var open = el("a", "card__open", "Xで開く");
    open.href = item.url;
    open.rel = "noreferrer noopener";
    open.target = "_blank";
    foot.appendChild(open);
    li.appendChild(foot);

    return li;
  }

  var head = el("div", "head");
  head.appendChild(el("span", "title", "Xのブックマーク"));
  var meta = el("span", "meta");
  if (DATA.updatedAt) meta.appendChild(document.createTextNode("更新 " + DATA.updatedAt));
  var rss = el("a", null, "RSS");
  rss.href = DATA.rssUrl;
  meta.appendChild(rss);
  head.appendChild(meta);
  mount.appendChild(head);

  if (DATA.error) {
    mount.appendChild(el("p", "notice", "最新の取得に失敗しました（" + (DATA.updatedAt || "") + " 時点の内容）"));
  }

  if (!DATA.items.length) {
    mount.appendChild(el("p", "empty", DATA.connected ? "ブックマークがまだありません。" : "まだXと接続していません。"));
  } else {
    var list = el("ol", "cards");
    DATA.items.forEach(function (item) {
      list.appendChild(card(item));
    });
    mount.appendChild(list);
  }

  var target = null;
  if (script && script.getAttribute("data-target")) {
    target = document.querySelector(script.getAttribute("data-target"));
  }
  if (!target) target = document.getElementById("x-bookmarks");
  if (target) {
    target.innerHTML = "";
    target.appendChild(root);
  } else if (script && script.parentNode) {
    script.parentNode.insertBefore(root, script);
  }
})();
`;
}
