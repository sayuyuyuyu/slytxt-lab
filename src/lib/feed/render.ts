/**
 * 短文フィードの HTML 断片。ページの外枠（head・ヘッダー・フッター）は
 * Astro がビルドした /feed/index.html をそのまま使い、このファイルは
 * 投稿一覧の部分だけを組み立てる。
 *
 * 外枠との受け渡しは HTML コメントの目印で行う。
 *   <!--feed:start--> …ここを置き換える… <!--feed:end-->
 * 目印が消えたら差し込みが効かなくなるので、check-build でも存在を検証する。
 */
import type { FeedImage, FeedLink, FeedPost } from "./types.ts";

export const FEED_START = "<!--feed:start-->";
export const FEED_END = "<!--feed:end-->";

/** 画像の配信元。R2 の pub/ を tools/media-cloudflare が返す。 */
export const MEDIA_ORIGIN = "https://media.slytxt.dev";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_IN_TEXT = /(https?:\/\/[^\s<>"'）)】]+)/g;

/** 本文中の URL をリンクにする。リンクカードにする URL 自体も本文では残す。 */
function linkify(text: string): string {
  return escapeHtml(text).replace(URL_IN_TEXT, (url) => {
    return `<a href="${url}" rel="noopener noreferrer" target="_blank">${url}</a>`;
  });
}

/** 改行はそのまま尊重する（Markdown は使わない）。 */
function renderBody(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split("\n").map(linkify).join("<br />")}</p>`)
    .join("\n");
}

/**
 * 画像はカードの見た目に寄せる: 1枚目はカード上部のサムネイル、
 * 2枚目以降は下部の小さいサムネイル列にする。
 */
function renderImages(images: FeedImage[]): { thumb: string; thumbs: string } {
  if (images.length === 0) return { thumb: "", thumbs: "" };
  const img = (image: FeedImage, cls: string) =>
    `<figure class="${cls}"><img src="${MEDIA_ORIGIN}/${escapeHtml(
      image.key
    )}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async" /></figure>`;
  const thumb = img(images[0], "feed-item__thumb");
  const rest = images.slice(1);
  const thumbs =
    rest.length > 0
      ? `<div class="feed-item__thumbs">${rest.map((image) => img(image, "feed-item__figure")).join("")}</div>`
      : "";
  return { thumb, thumbs };
}

function renderLink(link: FeedLink | undefined): string {
  if (!link) return "";
  const parts = [
    link.image
      ? `<img class="feed-card__image" src="${escapeHtml(link.image)}" alt="" loading="lazy" decoding="async" />`
      : "",
    `<span class="feed-card__text">`,
    link.site ? `<span class="feed-card__site">${escapeHtml(link.site)}</span>` : "",
    link.title ? `<span class="feed-card__title">${escapeHtml(link.title)}</span>` : "",
    link.description
      ? `<span class="feed-card__description">${escapeHtml(link.description)}</span>`
      : "",
    `</span>`
  ].join("");
  return `<a class="feed-card" href="${escapeHtml(
    link.url
  )}" target="_blank" rel="noopener noreferrer">${parts}</a>`;
}

/** 投稿時刻を JST の「2026/11/16 19:30」表記にする。 */
export function formatTimestamp(iso: string): { label: string; datetime: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: iso, datetime: iso };
  const label = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
  return { label, datetime: date.toISOString() };
}

function renderPost(post: FeedPost): string {
  const { label, datetime } = formatTimestamp(post.createdAt);
  const { thumb, thumbs } = renderImages(post.images);
  return `<li class="feed-item"><article>
${thumb}
<div class="feed-item__body">
${renderBody(post.body)}
</div>
${thumbs}
${renderLink(post.link)}
<footer class="feed-item__foot"><time datetime="${escapeHtml(datetime)}">${escapeHtml(
    label
  )}</time></footer>
</article></li>`;
}

export type FeedItemsOptions = {
  /** 次のページの URL。null なら「もっと見る」を出さない。 */
  nextHref?: string | null;
};

/** 投稿一覧の HTML。0件のときは空状態を返す。 */
export function renderFeedItems(posts: FeedPost[], options: FeedItemsOptions = {}): string {
  if (posts.length === 0) {
    return `<p class="feed-empty">まだ投稿がありません。</p>`;
  }
  const more = options.nextHref
    ? `<a class="feed-more button" href="${escapeHtml(options.nextHref)}">もっと見る</a>`
    : "";
  return `<ol class="feed-list">${posts.map(renderPost).join("\n")}</ol>${more}`;
}

/**
 * ビルド済みの外枠に一覧を差し込む。目印が無ければ null を返し、
 * 呼び出し側が外枠の不備として扱えるようにする。
 */
export function injectFeed(shell: string, itemsHtml: string): string | null {
  const start = shell.indexOf(FEED_START);
  const end = shell.indexOf(FEED_END, start + FEED_START.length);
  if (start === -1 || end === -1) return null;
  return `${shell.slice(0, start + FEED_START.length)}${itemsHtml}${shell.slice(end)}`;
}
