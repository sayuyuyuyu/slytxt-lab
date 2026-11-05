import { formatJst, formatJstWithWeekday, formatRfc822 } from "./format.ts";
import type { BookmarkItem, BookmarkMedia, BookmarkSnapshot } from "./types.ts";
import { escapeXml } from "../xml.ts";
import { site } from "../site.ts";
import { escapeHtml } from "../html.ts";

export { escapeXml, escapeHtml };

export type RenderOptions = {
  siteName: string;
  siteUrl: string;
  pageUrl: string;
  rssUrl: string;
  jsonUrl: string;
  /** 保持する上限件数。 */
  count: number;
  /** 一覧で最初に表示する件数。未指定なら全件表示。 */
  initialCount?: number;
  /** 埋め込みに載せる件数。未指定なら count まで。 */
  embedCount?: number;
};

/**
 * 本文は変えずに、URL・@メンション・#ハッシュタグだけリンクにする。
 * URL を最初に拾うことで、URL の中にある # や @ を誤って拾わない。
 */
const TOKEN_PATTERN =
  /(https?:\/\/[^\s]+)|(?<![\w@])@([A-Za-z0-9_]{1,15})|(?<![\w&])#([\p{L}\p{N}_]+)/gu;

function renderText(text: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    result += escapeHtml(text.slice(lastIndex, index));
    const [whole, url, mention, hashtag] = match;
    if (url) {
      result += `<a href="${escapeHtml(url)}" rel="noreferrer noopener">${escapeHtml(url)}</a>`;
    } else if (mention) {
      result += `<a href="https://x.com/${escapeHtml(mention)}" rel="noreferrer noopener" target="_blank">@${escapeHtml(mention)}</a>`;
    } else if (hashtag) {
      result += `<a href="https://x.com/hashtag/${escapeHtml(hashtag)}" rel="noreferrer noopener" target="_blank">#${escapeHtml(hashtag)}</a>`;
    }
    lastIndex = index + whole.length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function firstLine(text: string, limit = 80): string {
  const line = text.split("\n").find((value) => value.trim() !== "") ?? text;
  const trimmed = line.trim();
  const chars = Array.from(trimmed);
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : trimmed;
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
      errorKind: snapshot?.errorKind ?? null,
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
    `    <description>${escapeXml(`Xで保存した投稿のうち、新しい順に最大${options.count}件。`)}</description>`,
    `    <language>${site.lang}</language>`,
    `    <lastBuildDate>${formatRfc822(snapshot?.updatedAt ?? new Date(0).toISOString())}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(options.rssUrl)}" rel="self" type="application/rss+xml"/>`
  ];
  if (entries) lines.push(entries);
  lines.push("  </channel>", "</rss>", "");

  return lines.join("\n");
}

function avatarHtml(item: BookmarkItem): string {
  const fallback = `<span class="card__avatar card__avatar--fallback" aria-hidden="true">${escapeHtml(initialOf(item.author.name))}</span>`;
  if (!item.author.avatar) return fallback;
  // 画像が消えていたら、壊れたアイコンではなく頭文字に切り替える。
  const hiddenFallback = `<span class="card__avatar card__avatar--fallback" aria-hidden="true" hidden>${escapeHtml(initialOf(item.author.name))}</span>`;
  return `<img class="card__avatar" src="${escapeHtml(item.author.avatar)}" alt="" width="40" height="40" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false">${hiddenFallback}`;
}


/** メディアの alt。X 側の代替テキストが無ければ本文の1行目で補う。 */
function mediaAlt(item: BookmarkItem, media: BookmarkMedia): string {
  return media.alt?.trim() ? media.alt : firstLine(item.text);
}

/** 投稿の画像・動画をカード内に並べる。一般的な埋め込みと同じく、本文の下に置く。 */
function mediaHtml(item: BookmarkItem): string {
  const media = item.media ?? [];
  if (media.length === 0) return "";
  const cells: string[] = [];
  for (const entry of media.slice(0, 4)) {
    const alt = escapeHtml(mediaAlt(item, entry));
    const dims =
      entry.width && entry.height ? ` width="${entry.width}" height="${entry.height}"` : "";
    if (entry.kind === "photo" && entry.image) {
      cells.push(
        `<img class="card__media-item" src="${escapeHtml(entry.image)}" alt="${alt}"${dims} loading="lazy" decoding="async">`
      );
    } else if (entry.videoUrl) {
      const poster = entry.image ? ` poster="${escapeHtml(entry.image)}"` : "";
      if (entry.kind === "gif") {
        cells.push(
          `<video class="card__media-item" src="${escapeHtml(entry.videoUrl)}"${poster}${dims} autoplay muted loop playsinline preload="metadata" aria-label="${alt}"></video>`
        );
      } else {
        cells.push(
          `<video class="card__media-item" src="${escapeHtml(entry.videoUrl)}"${poster}${dims} controls playsinline preload="none" aria-label="${alt}"></video>`
        );
      }
    } else if (entry.image) {
      // 再生できる mp4 が無い動画は、プレビュー画像から投稿本体へ誘導する。
      cells.push(
        `<a class="card__media-link" href="${escapeHtml(item.url)}" rel="noreferrer noopener" target="_blank"><img class="card__media-item" src="${escapeHtml(entry.image)}" alt="${alt}"${dims} loading="lazy" decoding="async"></a>`
      );
    }
  }
  if (cells.length === 0) return "";
  return `<div class="card__media card__media--${cells.length}">${cells.join("")}</div>`;
}

function cardHtml(item: BookmarkItem, hidden = false): string {
  const handle = item.author.username
    ? `<p class="card__handle">@${escapeHtml(item.author.username)}</p>`
    : "";
  return `<li class="card" data-author="${escapeHtml(item.author.username)}"${hidden ? " hidden" : ""}>
<div class="card__head">${avatarHtml(item)}<div class="card__who"><p class="card__name">${escapeHtml(item.author.name)}</p>${handle}</div><time class="card__time" datetime="${escapeHtml(item.createdAt)}">${formatJstWithWeekday(item.createdAt)}</time></div>
<p class="card__text">${renderText(item.text)}</p>
${mediaHtml(item)}<div class="card__foot"><a class="card__open" href="${escapeHtml(item.url)}" rel="noreferrer noopener" target="_blank">Xで開く</a></div>
</li>`;
}

function noticeHtml(snapshot: BookmarkSnapshot): string {
  if (!snapshot.error) return "";
  const asOf = `${formatJst(snapshot.updatedAt)} 時点の内容を表示しています`;
  if (snapshot.errorKind === "auth") {
    return `<p class="notice notice--auth">Xとの接続の有効期限が切れている可能性があります。${asOf}。復旧には再接続が必要です。</p>`;
  }
  return `<p class="notice">最新の取得に失敗しました。${asOf}。時間をおいて開き直すと直ることがあります。</p>`;
}

/** 絞り込みと「もっと見る」をまとめて扱うスクリプト。絞り込み中は件数制限を外して一致分をすべて出す。 */
function listScript(initial: number): string {
  return `<script>
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var keyword = document.querySelector("[data-filter-keyword]");
  var author = document.querySelector("[data-filter-author]");
  var count = document.querySelector("[data-filter-count]");
  var clear = document.querySelector("[data-filter-clear]");
  var noMatch = document.querySelector("[data-no-match]");
  var moreWrap = document.querySelector("[data-more-wrap]");
  var moreButton = document.querySelector("[data-more]");
  var initial = ${initial};
  var expanded = false;

  function apply() {
    var q = keyword ? keyword.value.trim().toLowerCase() : "";
    var a = author ? author.value : "";
    var filtering = q !== "" || a !== "";
    var matched = 0;
    cards.forEach(function (card, index) {
      var hit =
        (!a || card.getAttribute("data-author") === a) &&
        (!q || card.textContent.toLowerCase().indexOf(q) !== -1);
      if (hit) matched += 1;
      card.hidden = !(hit && (filtering || expanded || index < initial));
    });
    if (count) count.textContent = filtering ? matched + "件が条件に一致" : "";
    if (clear) clear.hidden = !filtering;
    if (noMatch) noMatch.hidden = !(filtering && matched === 0);
    if (moreWrap) moreWrap.hidden = filtering || expanded || cards.length <= initial;
  }

  if (keyword) keyword.addEventListener("input", apply);
  if (author) author.addEventListener("change", apply);
  if (clear) {
    clear.addEventListener("click", function () {
      keyword.value = "";
      author.value = "";
      apply();
    });
  }
  if (moreButton) {
    moreButton.addEventListener("click", function () {
      expanded = true;
      apply();
    });
  }
  apply();
})();
</script>`;
}

const THEME_SCRIPT = `<script>
(function () {
  var toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var light = document.documentElement.classList.toggle("light");
      try {
        localStorage.setItem("theme", light ? "light" : "dark");
      } catch (e) {}
    });
  }
  window.addEventListener("storage", function (event) {
    if (event.key === "theme") {
      document.documentElement.classList.toggle("light", event.newValue === "light");
    }
  });
})();
</script>`;

/*
 * サイト本体（src/styles/global.css）のパレットと組み立てに合わせたスタイル。
 * 単独 HTML 配信のため Astro コンポーネントは使えず、CSS 変数と見た目をここに写している。
 * 背景のグリッドやスキャンライン等の装飾は、このページでは省く。
 */
const STYLE = `
:root{color-scheme:dark;--bg:#05070f;--bg-soft:#080c18;--surface:#0b1220;--surface-2:#101a2e;--text:#d9e6f7;--text-muted:#7d8bab;--border:#1b2942;--border-strong:#2f4a72;--accent:#4cc9f0;--on-accent:#04121c;--accent-strong:#9be7ff;--accent-3:#c08bff;--accent-5:#5cf2b4;--accent-warn:#ffd166;--accent-red:#ff6b81;--font:"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","YuGothic",sans-serif;--font-mono:ui-monospace,"SFMono-Regular","SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
:root.light{color-scheme:light;--bg:#eef3fb;--bg-soft:#e7eef8;--surface:#e2eaf6;--surface-2:#d6e2f2;--text:#0b1220;--text-muted:#4a5972;--border:#c3d0e4;--border-strong:#9db0cd;--accent:#0b63c4;--on-accent:#ffffff;--accent-strong:#084a96;--accent-3:#7a3fd1;--accent-5:#0a6b4a;--accent-warn:#9a6a00;--accent-red:#c02b3f}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.8 var(--font);text-rendering:optimizeLegibility;overflow-wrap:anywhere}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
button,input,select{font:inherit}
.site-header{position:sticky;top:0;z-index:50;background:var(--bg)}
.site-header__inner{width:min(100% - 48px,1040px);margin-inline:auto;min-height:65px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border)}
.brand{display:inline-flex;align-items:center;gap:10px;min-width:0;font-family:var(--font-mono);font-size:.98rem;font-weight:700;letter-spacing:.02em;text-decoration:none;color:var(--text)}
.brand__mark{color:var(--accent-5);font-size:1rem}
.brand__cursor{display:inline-block;width:8px;height:1.05rem;background:var(--accent)}
.theme-toggle{width:44px;flex:0 0 44px;min-height:44px;padding:0;border:1px solid var(--border);border-radius:2px;background:transparent;color:var(--text);cursor:pointer;font-size:1.1rem;line-height:1}
.theme-toggle:hover{background:var(--surface);border-color:var(--accent);color:var(--accent-strong)}
.wrap{width:min(100% - 48px,1040px);margin-inline:auto;padding:0 0 64px}
.page-head{padding:48px 0 0}
.eyebrow{margin:0 0 12px;color:var(--accent);font-family:var(--font-mono);font-size:.72rem;letter-spacing:.08em;font-weight:500}
.eyebrow::before{content:"❯ ";color:var(--accent-5)}
h1{margin:0;font-size:clamp(1.8rem,4vw,2.4rem);font-weight:500;line-height:1.4}
.page-count{margin:14px 0 0;color:var(--text-muted);font-family:var(--font-mono);font-size:.78rem}
.notice{margin:24px 0 0;border:1px solid var(--border);border-left:3px solid var(--accent);background:var(--surface);padding:12px 16px;font-size:.88rem}
.notice--auth{border-left-color:var(--accent-warn)}
.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:28px 0 0}
.tools__search{flex:1 1 220px;min-height:44px;background:var(--surface);border:1px solid var(--border);border-radius:2px;color:var(--text);padding:10px 12px;font-size:.9rem}
.tools__author{min-height:44px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:2px;color:var(--text);padding:10px 12px;font-size:.9rem}
.tools__count{color:var(--text-muted);font-family:var(--font-mono);font-size:.78rem}
.tools__clear{min-height:44px;padding:0 14px;border:1px solid var(--border);border-radius:2px;background:transparent;color:var(--text);font-size:.85rem;cursor:pointer}
.tools__clear:hover{background:var(--surface);border-color:var(--accent);color:var(--accent-strong)}
.cards{list-style:none;margin:16px 0 0;padding:0}
.card{margin:0;border-top:1px solid var(--border);padding:22px 2px 18px}
.card__head{display:flex;align-items:center;gap:10px}
.card__avatar{width:40px;height:40px;border-radius:50%;flex:none;object-fit:cover}
.card__avatar--fallback{display:inline-flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--text);font-weight:700;font-size:.95rem}
.card__who{min-width:0}
.card__name{margin:0;font-weight:700;font-size:.92rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card__handle{margin:0;color:var(--text-muted);font-size:.78rem;line-height:1.35}
.card__time{margin-left:auto;color:var(--text-muted);font-family:var(--font-mono);font-size:.74rem;white-space:nowrap;align-self:flex-start}
.card__text{margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem;line-height:1.85}
.card__foot{display:flex;justify-content:flex-end;margin:10px 0 0}
.card__open{font-size:.8rem}
.card__media{display:grid;gap:6px;margin:12px 0 0;grid-template-columns:minmax(0,1fr)}
.card__media--2,.card__media--3,.card__media--4{grid-template-columns:repeat(2,minmax(0,1fr))}
.card__media-item{display:block;width:100%;height:auto;min-width:0;object-fit:cover;border:1px solid var(--border);border-radius:4px;background:var(--surface)}
.card__media--1 .card__media-item{max-height:480px}
.card__media--2 .card__media-item,.card__media--3 .card__media-item,.card__media--4 .card__media-item{aspect-ratio:16/10}
.card__media--3 .card__media-item:first-child{grid-row:span 2;aspect-ratio:auto;height:100%}
.card__media-link{display:block}
.empty{margin:16px 0 0;border-top:1px solid var(--border);padding:28px 2px;color:var(--text-muted);font-size:.92rem}
.no-match{margin:16px 0 0;border-top:1px solid var(--border);padding:28px 2px;color:var(--text-muted);font-size:.92rem}
.more{margin:28px 0 0;text-align:center}
.more__button{min-height:44px;padding:10px 28px;border:1px solid var(--border);border-radius:2px;background:transparent;color:var(--text);font-size:.88rem;cursor:pointer}
.more__button:hover{background:var(--surface);border-color:var(--accent);color:var(--accent-strong)}
.site-footer{border-top:1px solid var(--border);margin-top:8px;padding-block:22px 30px;font-family:var(--font-mono);font-size:.76rem;color:var(--text-muted)}
.site-footer__inner{width:min(100% - 48px,1040px);margin-inline:auto;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.site-footer__status{display:inline-flex;align-items:center;gap:8px}
.site-footer__dot{width:8px;height:8px;border-radius:50%;background:var(--accent-5)}
.footer-links{display:flex;flex-wrap:wrap;gap:8px 24px}
.footer-links a{display:inline-flex;align-items:center;min-height:36px;text-decoration:none;color:var(--text-muted)}
.footer-links a::before{content:"$ ";color:var(--accent-5)}
.footer-links a:hover{color:var(--accent-strong)}
@media (max-width:640px){.site-header__inner,.wrap,.site-footer__inner{width:min(100% - 32px,1040px)}.tools__search{flex-basis:100%}}
@media print{:root,:root.light{color-scheme:light;--bg:#ffffff;--bg-soft:#ffffff;--surface:#ffffff;--surface-2:#ffffff;--text:#111111;--text-muted:#444444;--border:#cccccc;--border-strong:#999999;--accent:#0b63c4;--accent-strong:#084a96;--accent-3:#7a3fd1;--accent-5:#0a6b4a;--accent-warn:#9a6a00;--accent-red:#c02b3f}body{background:#ffffff}.site-header,.site-footer,.tools,.more{display:none!important}}
`;

export function renderHtml(snapshot: BookmarkSnapshot | null, options: RenderOptions): string {
  const items = snapshot?.items ?? [];
  const title = `${options.siteName} のXブックマーク`;
  const year = new Date().getFullYear();

  let body: string;
  let tools = "";
  let script = "";
  if (!snapshot) {
    body = `<p class="empty">まだXと接続していません。</p>`;
  } else if (items.length === 0) {
    body = `<p class="empty">ブックマークがまだありません。</p>`;
  } else {
    const initial = Math.min(options.initialCount ?? items.length, items.length);
    const cards = items.map((item, index) => cardHtml(item, index >= initial)).join("\n");
    const authors = [
      ...new Map(
        items
          .filter((item) => item.author.username)
          .map((item) => [item.author.username, item.author] as const)
      ).values()
    ];
    const authorOptions = authors
      .map(
        (author) =>
          `<option value="${escapeHtml(author.username)}">${escapeHtml(author.name)}（@${escapeHtml(author.username)}）</option>`
      )
      .join("");
    tools = `<div class="tools">
<input class="tools__search" type="search" data-filter-keyword placeholder="キーワードで絞り込み" aria-label="キーワードで絞り込み">
<select class="tools__author" data-filter-author aria-label="投稿者で絞り込み"><option value="">すべての投稿者</option>${authorOptions}</select>
<span class="tools__count" data-filter-count aria-live="polite"></span>
<button type="button" class="tools__clear" data-filter-clear hidden>絞り込みを解除</button>
</div>`;
    const more =
      items.length > initial
        ? `\n<p class="more" data-more-wrap><button type="button" class="more__button" data-more>もっと見る（あと${items.length - initial}件）</button></p>`
        : "";
    body = `<ol class="cards">${cards}</ol>\n<p class="no-match" data-no-match hidden>条件に合う投稿がありません。</p>${more}`;
    script = listScript(initial);
  }

  const notice = snapshot ? noticeHtml(snapshot) : "";
  const countLine = snapshot
    ? `<p class="page-count">${items.length}件の投稿 ・ 更新 ${formatJstWithWeekday(snapshot.updatedAt)}</p>`
    : "";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<script>try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.add("light")}catch(e){}</script>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(options.siteName)}" href="${escapeHtml(options.rssUrl)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
<noscript><style>.card[hidden]{display:block!important}.tools,.more{display:none!important}</style></noscript>
</head>
<body>
<header class="site-header">
<div class="site-header__inner">
<a class="brand" href="${escapeHtml(options.siteUrl)}" aria-label="${escapeHtml(options.siteName)} トップ"><span class="brand__mark" aria-hidden="true">❯</span><span class="brand__name">${escapeHtml(options.siteName)}</span><span class="brand__cursor" aria-hidden="true"></span></a>
<button class="theme-toggle" type="button" aria-label="テーマを切り替える" data-theme-toggle><span aria-hidden="true">◐</span></button>
</div>
</header>
<main class="wrap">
<div class="page-head">
<p class="eyebrow">Bookmarks</p>
<h1>Xのブックマーク</h1>
${countLine}
</div>
${notice}
${tools}
${body}
</main>
<footer class="site-footer">
<div class="site-footer__inner">
<span class="site-footer__status"><span class="site-footer__dot" aria-hidden="true"></span>&copy; ${year} ${escapeHtml(options.siteName)}</span>
<nav class="footer-links" aria-label="フィード"><a href="${escapeHtml(options.rssUrl)}">RSS</a><a href="${escapeHtml(options.jsonUrl)}">JSON</a></nav>
</div>
</footer>
${THEME_SCRIPT}
${script}
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
.card__media{display:grid;gap:6px;margin:12px 0 0;grid-template-columns:minmax(0,1fr)}
.card__media--2,.card__media--3,.card__media--4{grid-template-columns:repeat(2,minmax(0,1fr))}
.card__media-item{display:block;width:100%;height:auto;min-width:0;object-fit:cover;border:1px solid var(--xb-border,#e2dcd0);border-radius:10px}
.card__media--1 .card__media-item{max-height:420px}
.card__media--2 .card__media-item,.card__media--3 .card__media-item,.card__media--4 .card__media-item{aspect-ratio:16/10}
.card__media--3 .card__media-item:first-child{grid-row:span 2;aspect-ratio:auto;height:100%}
.card__media-link{display:block}
.notice,.empty{margin:14px 0 0;color:var(--xb-muted,#706a60);font-size:.85rem}
`;

/** `<script src=".../embed.js">` で一覧をカードで描く。データは取得済みのものを埋め込むので追加の通信も CORS も要らない。 */
export function renderEmbed(snapshot: BookmarkSnapshot | null, options: RenderOptions): string {
  const items = (snapshot?.items ?? []).slice(0, options.embedCount ?? options.count).map((item) => ({
    text: item.text,
    url: item.url,
    name: item.author.name,
    username: item.author.username,
    avatar: item.author.avatar ?? null,
    media: item.media ?? [],
    textFirstLine: firstLine(item.text),
    createdAt: item.createdAt,
    displayAt: formatJst(item.createdAt)
  }));

  const data = JSON.stringify({
    siteName: options.siteName,
    siteUrl: options.siteUrl,
    rssUrl: options.rssUrl,
    updatedAt: snapshot ? formatJst(snapshot.updatedAt) : null,
    error: snapshot?.error ?? null,
    errorKind: snapshot?.errorKind ?? null,
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

  function anchor(href, label) {
    var a = el("a", null, label);
    a.href = href;
    a.rel = "noreferrer noopener";
    a.target = "_blank";
    return a;
  }

  // URL・@メンション・#ハッシュタグだけをリンクにする。本文は textContent で組み立てる。
  function linked(value) {
    var wrap = document.createDocumentFragment();
    var pattern = /(https?:\\/\\/[^\\s]+)|@([A-Za-z0-9_]{1,15})|#([\\p{L}\\p{N}_]+)/gu;
    var text = String(value);
    var last = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var before = match.index === 0 ? "" : text.charAt(match.index - 1);
      if (!match[1] && /[\\w@&]/.test(before)) continue;
      if (match.index > last) wrap.appendChild(document.createTextNode(text.slice(last, match.index)));
      if (match[1]) {
        wrap.appendChild(anchor(match[1], match[1]));
      } else if (match[2]) {
        wrap.appendChild(anchor("https://x.com/" + match[2], "@" + match[2]));
      } else {
        wrap.appendChild(anchor("https://x.com/hashtag/" + match[3], "#" + match[3]));
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
    return wrap;
  }

  function avatar(item) {
    function fallback() {
      var node = el(
        "span",
        "card__avatar card__avatar--fallback",
        item.name ? ([...item.name.trim()][0] || "?") : "?"
      );
      node.setAttribute("aria-hidden", "true");
      return node;
    }
    if (item.avatar) {
      var img = el("img", "card__avatar");
      img.src = item.avatar;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 40;
      img.height = 40;
      // 画像が消えていたら、壊れたアイコンではなく頭文字に切り替える。
      img.onerror = function () {
        img.replaceWith(fallback());
      };
      return img;
    }
    return fallback();
  }

  function mediaNode(item) {
    var list = (item.media || []).slice(0, 4);
    if (!list.length) return null;
    var wrap = el("div", "card__media");

    function sized(node, m) {
      if (m.width) node.width = m.width;
      if (m.height) node.height = m.height;
      return node;
    }

    list.forEach(function (m) {
      var alt = m.alt || item.textFirstLine || "";
      if (m.kind === "photo" && m.image) {
        var img = sized(el("img", "card__media-item"), m);
        img.src = m.image;
        img.alt = alt;
        img.loading = "lazy";
        img.decoding = "async";
        wrap.appendChild(img);
      } else if (m.videoUrl) {
        var video = sized(el("video", "card__media-item"), m);
        video.src = m.videoUrl;
        if (m.image) video.poster = m.image;
        video.setAttribute("playsinline", "");
        video.setAttribute("aria-label", alt);
        if (m.kind === "gif") {
          video.autoplay = true;
          video.muted = true;
          video.loop = true;
          video.preload = "metadata";
        } else {
          video.controls = true;
          video.preload = "none";
        }
        wrap.appendChild(video);
      } else if (m.image) {
        var link = el("a", "card__media-link");
        link.href = item.url;
        link.rel = "noreferrer noopener";
        link.target = "_blank";
        var thumb = sized(el("img", "card__media-item"), m);
        thumb.src = m.image;
        thumb.alt = alt;
        thumb.loading = "lazy";
        thumb.decoding = "async";
        link.appendChild(thumb);
        wrap.appendChild(link);
      }
    });
    if (!wrap.childNodes.length) return null;
    wrap.className = "card__media card__media--" + wrap.childNodes.length;
    return wrap;
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

    var media = mediaNode(item);
    if (media) li.appendChild(media);

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
    var noticeText =
      DATA.errorKind === "auth"
        ? "Xとの接続の有効期限が切れている可能性があります（" + (DATA.updatedAt || "") + " 時点の内容）"
        : "最新の取得に失敗しました（" + (DATA.updatedAt || "") + " 時点の内容）";
    mount.appendChild(el("p", "notice", noticeText));
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
