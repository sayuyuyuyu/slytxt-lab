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

const STYLE = `
:root{--bg:#fdfcf8;--surface:#f4f0e8;--text:#292721;--text-muted:#706a60;--border:#d9d3c7;--accent:#a43d29}
@media (prefers-color-scheme:dark){:root{--bg:#1d1b18;--surface:#292621;--text:#f2eee5;--text-muted:#b8b0a1;--border:#4b453c;--accent:#ee947d}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.9 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
a{color:var(--accent)}
.wrap{max-width:760px;margin:0 auto;padding:48px 20px 80px}
.eyebrow{margin:0;color:var(--text-muted);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase}
h1{margin:8px 0 0;font:500 1.9rem/1.4 Georgia,"Hiragino Mincho ProN",serif}
.lead{margin:16px 0 0;color:var(--text-muted);font-size:.92rem}
.links{display:flex;flex-wrap:wrap;gap:16px;margin:20px 0 0;font-size:.85rem}
.notice{margin:24px 0 0;border:1px solid var(--border);border-radius:6px;background:var(--surface);padding:14px 16px;font-size:.85rem;color:var(--text-muted)}
.items{list-style:none;margin:32px 0 0;padding:0}
.item{border-top:1px solid var(--border);padding:22px 0}
.item__meta{margin:0;color:var(--text-muted);font-size:.8rem}
.item__meta .name{color:var(--text)}
.item__text{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem}
.item__link{margin:10px 0 0;font-size:.8rem}
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
    body = `<ol class="items">${items
      .map(
        (item) => `<li class="item">
<p class="item__meta"><span class="name">${escapeHtml(item.author.name)}</span>${item.author.username ? ` <span class="handle">@${escapeHtml(item.author.username)}</span>` : ""} <time datetime="${escapeHtml(item.createdAt)}">${formatJst(item.createdAt)}</time></p>
<p class="item__text">${renderText(item.text)}</p>
<p class="item__link"><a href="${escapeHtml(item.url)}" rel="noreferrer noopener">Xで開く</a></p>
</li>`
      )
      .join("\n")}</ol>`;
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
.head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--xb-border,#d9d3c7);padding:0 0 10px}
.title{font-weight:600}
.meta{display:flex;gap:12px;color:var(--xb-muted,#706a60);font-size:.78rem}
a{color:var(--xb-accent,#a43d29)}
.items{list-style:none;margin:0;padding:0}
.item{border-bottom:1px solid var(--xb-border,#d9d3c7);padding:16px 0}
.item-meta{display:flex;flex-wrap:wrap;gap:8px;margin:0;color:var(--xb-muted,#706a60);font-size:.78rem}
.item-meta .name{font-weight:600;color:var(--xb-text,#292721)}
.item-text{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.item-link{margin:8px 0 0;font-size:.78rem}
.notice,.empty{margin:14px 0 0;color:var(--xb-muted,#706a60);font-size:.85rem}
`;

/** `<script src=".../embed.js">` で一覧をその場に描く。データは取得済みのものを埋め込むので追加の通信も CORS も要らない。 */
export function renderEmbed(snapshot: BookmarkSnapshot | null, options: RenderOptions): string {
  const items = (snapshot?.items ?? []).map((item) => ({
    text: item.text,
    url: item.url,
    name: item.author.name,
    username: item.author.username,
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
    var list = el("ol", "items");
    DATA.items.forEach(function (item) {
      var li = el("li", "item");
      var line = el("p", "item-meta");
      line.appendChild(el("span", "name", item.name));
      if (item.username) line.appendChild(el("span", "handle", "@" + item.username));
      var time = el("time", null, item.displayAt);
      time.dateTime = item.createdAt;
      line.appendChild(time);
      li.appendChild(line);

      var body = el("p", "item-text");
      body.appendChild(linked(item.text));
      li.appendChild(body);

      var linkLine = el("p", "item-link");
      var open = el("a", null, "Xで開く");
      open.href = item.url;
      open.rel = "noreferrer noopener";
      open.target = "_blank";
      linkLine.appendChild(open);
      li.appendChild(linkLine);

      list.appendChild(li);
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
