/**
 * 「URL だけの段落」を埋め込みに変える Sätteri mdast プラグイン。
 * （Astro 7 の標準 Markdown 処理系は Sätteri。astro.config.mjs で
 *   processor: satteri({ mdastPlugins: [embedMdastPlugin] }) として渡す。）
 *
 * note と同じく、URL を段落に単独で置くと公開側で埋め込み表示になる。
 * 保存形式は markdown の URL のままなので、他のツールでも本文が壊れない。
 * 変換するのは段落の中身が URL 1つだけのときだけ。本文中の通常リンクや、
 * リンク文字が URL と違うリンクは触らない。
 *
 * - YouTube: youtube-nocookie の iframe
 * - X (Twitter): 公式埋め込み（blockquote + widgets.js）
 * - それ以外の URL: ビルド時に OGP を取得してリンクカードにする。
 *   取得できない場合はホスト名だけのカードに落とす（ビルドは止めない）。
 */

import { escapeHtml } from "./html.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

function youtubeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com") return null;
  if (parsed.pathname === "/watch") {
    const id = parsed.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  const match = parsed.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : null;
}

function xPost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") return null;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  return match ? { user: match[1], id: match[2] } : null;
}

/** URL を埋め込み種別に分ける。埋め込み対象でない（URL でない）場合は null。 */
export function classifyEmbedUrl(raw) {
  const url = String(raw ?? "").trim();
  if (!/^https?:\/\/\S+$/.test(url)) return null;
  const video = youtubeId(url);
  if (video) return { type: "youtube", id: video, url };
  const post = xPost(url);
  if (post) return { type: "x", ...post, url };
  return { type: "link", url };
}

export function youtubeEmbedHtml(id) {
  return `<div class="embed embed--youtube"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(id)}" title="YouTube video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

export function xEmbedHtml({ url }) {
  const safe = escapeHtml(url);
  return `<div class="embed embed--x"><blockquote class="twitter-tweet" data-dnt="true"><a href="${safe}">${safe}</a></blockquote><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></div>`;
}

export function linkCardHtml({ url, ogp }) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // URL として読めない場合はそのまま出す（到達しないはず）。
  }
  const title = ogp?.title?.trim() || url;
  const description = ogp?.description?.trim()
    ? `<span class="link-card__desc">${escapeHtml(ogp.description.trim())}</span>`
    : "";
  const image = ogp?.image
    ? `<img class="link-card__image" src="${escapeHtml(ogp.image)}" alt="" loading="lazy">`
    : "";
  return `<a class="link-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${image}<span class="link-card__body"><span class="link-card__title">${escapeHtml(title)}</span>${description}<span class="link-card__host">${escapeHtml(host)}</span></span></a>`;
}

/* ---- OGP の取得（ビルド時） ---- */

const ogpCache = new Map();

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function metaContent(html, keys) {
  const tags = html.match(/<meta\s[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key =
      tag.match(/(?:property|name)\s*=\s*"([^"]+)"/i)?.[1] ??
      tag.match(/(?:property|name)\s*=\s*'([^']+)'/i)?.[1];
    if (!key || !keys.includes(key.toLowerCase())) continue;
    const content =
      tag.match(/content\s*=\s*"([^"]*)"/i)?.[1] ??
      tag.match(/content\s*=\s*'([^']*)'/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return "";
}

/** ページの OGP を取る。取れない・HTML でない場合は null（呼び出し側で素のカードにする）。 */
export async function fetchOgp(url) {
  if (ogpCache.has(url)) return ogpCache.get(url);
  const promise = (async () => {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; slytxt-lab/1.0; +https://slytxt.dev)",
          accept: "text/html,application/xhtml+xml"
        }
      });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) return null;
      const html = (await response.text()).slice(0, 200_000);
      const title =
        metaContent(html, ["og:title", "twitter:title"]) ||
        decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
      if (!title) return null;
      const description = metaContent(html, [
        "og:description",
        "twitter:description",
        "description"
      ]);
      let image = metaContent(html, ["og:image", "twitter:image"]);
      if (image) {
        try {
          image = new URL(image, response.url || url).href;
        } catch {
          image = "";
        }
      }
      return { title, description, image };
    } catch {
      return null;
    }
  })();
  ogpCache.set(url, promise);
  return promise;
}

/* ---- mdast の走査 ---- */

/** 段落の中身が URL 1つだけなら、その URL を返す。 */
function paragraphUrl(node) {
  if (node?.type !== "paragraph" || !Array.isArray(node.children)) return null;
  if (node.children.length !== 1) return null;
  const child = node.children[0];
  if (child.type === "link") {
    const only = child.children?.length === 1 ? child.children[0] : null;
    if (only?.type === "text" && only.value.trim() === child.url) return child.url;
    return null;
  }
  if (child.type === "text") {
    const value = child.value.trim();
    return /^https?:\/\/\S+$/.test(value) ? value : null;
  }
  return null;
}

/**
 * URL から埋め込み HTML を作る。埋め込み対象でなければ null。
 * テスト用に fetchOgpFn で OGP 取得を差し替えられる。
 */
export async function embedHtmlForUrl(url, fetchOgpFn = fetchOgp) {
  const classified = classifyEmbedUrl(url);
  if (!classified) return null;
  if (classified.type === "youtube") return youtubeEmbedHtml(classified.id);
  if (classified.type === "x") return xEmbedHtml(classified);
  return linkCardHtml({ url: classified.url, ogp: await fetchOgpFn(classified.url) });
}

/**
 * Sätteri の mdast プラグイン。paragraph visitor で URL だけの段落を
 * 埋め込み HTML の html ノードへ置き換える（ctx.replaceNode）。
 */
export const embedMdastPlugin = {
  name: "slytxt-embed",
  async paragraph(node, ctx) {
    const url = paragraphUrl(node);
    if (!url) return;
    const html = await embedHtmlForUrl(url);
    if (html) ctx.replaceNode(node, { type: "html", value: html });
  }
};
