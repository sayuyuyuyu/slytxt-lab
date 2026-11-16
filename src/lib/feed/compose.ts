/**
 * 短文フィードの投稿を受け取るときの検証と組み立て。投稿用の Worker
 * （tools/feed-cloudflare）から使い、表示側（store.ts / render.ts）と
 * 同じ型を共有する。
 *
 * ここには DOM も Cloudflare の API も出さない。OGP の取得は URL を受け取って
 * HTML を返す関数を差し込む形にし、テストから固定の HTML を渡せるようにする。
 */
import type { FeedImage, FeedLink } from "./types.ts";

/** 本文の上限。短文レーンなので長文は記事側へ送る。 */
export const MAX_BODY_LENGTH = 2000;
/** 1投稿あたりの添付画像の上限。 */
export const MAX_IMAGES = 4;
/** 画像1枚あたりの上限（8MB）。 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 添付できる画像の種類と拡張子。media Worker が配信できる形式に合わせる。 */
export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp"
};
/** media Worker（tools/media-cloudflare）が受け付けるキーの形。 */
export const MEDIA_KEY = /^[0-9a-f]{32}\.(?:jpg|png|gif|webp)$/;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 時刻で並ぶ 26 文字の ID（ULID と同じ構成: 先頭10文字が時刻、後ろ16文字が乱数）。 */
export function feedPostId(now: number, random: () => number = Math.random): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  let tail = "";
  for (let index = 0; index < 16; index += 1) {
    tail += CROCKFORD[Math.floor(random() * 32)];
  }
  return time + tail;
}

/** 添付画像のキー。内容は問わず、media Worker が配信できる形に揃える。 */
export function feedMediaKey(
  contentType: string,
  random: () => number = Math.random
): string | null {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return null;
  let hex = "";
  for (let index = 0; index < 32; index += 1) {
    hex += Math.floor(random() * 16).toString(16);
  }
  return `${hex}.${ext}`;
}

/** 本文の最初の URL。リンクカードを作る対象。 */
export function firstUrl(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s<>"'）)】]+/);
  return match ? match[0] : null;
}

/**
 * 外部へ取りに行ってよい URL か。ループバック・私有アドレス・
 * ローカルホスト名は弾く（投稿者が自分なので実害は薄いが、踏み台にしない）。
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function metaContent(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta\\b[^>]*\\b(?:property|name)=["']${key}["'][^>]*\\bcontent=["']([^"']*)["']`, "i"),
    new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b(?:property|name)=["']${key}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = decodeEntities(match[1]).trim();
      if (value) return value;
    }
  }
  return undefined;
}

function resolveUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw, base).href;
  } catch {
    return undefined;
  }
}

/**
 * OGP の meta からリンクカードの材料を作る。og:* が無ければ <title> と
 * description で代替し、それも無ければ URL だけのカードにする。
 */
export function parseOgp(html: string, pageUrl: string): FeedLink {
  const title =
    metaContent(html, "og:title") ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim()
      : undefined);
  const description =
    metaContent(html, "og:description") ?? metaContent(html, "description");
  const image = resolveUrl(metaContent(html, "og:image"), pageUrl);
  const site = metaContent(html, "og:site_name");
  let host;
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    host = undefined;
  }
  return {
    url: pageUrl,
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(description ? { description: description.slice(0, 300) } : {}),
    ...(image ? { image } : {}),
    ...(site || host ? { site: (site ?? host)?.slice(0, 100) } : {})
  };
}

export type ComposeInput = {
  body?: unknown;
  images?: unknown;
};

export type ComposeResult =
  | { ok: true; body: string; images: FeedImage[] }
  | { ok: false; error: string };

/** 投稿内容の検証。alt は空でも許すが、キーの形と枚数は縛る。 */
export function normalizeCompose(input: ComposeInput): ComposeResult {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, error: "本文が空です。" };
  if ([...body].length > MAX_BODY_LENGTH) {
    return { ok: false, error: `本文は${MAX_BODY_LENGTH}文字までです。` };
  }
  const rawImages = input.images === undefined ? [] : input.images;
  if (!Array.isArray(rawImages)) return { ok: false, error: "images は配列で送ってください。" };
  if (rawImages.length > MAX_IMAGES) {
    return { ok: false, error: `画像は${MAX_IMAGES}枚までです。` };
  }
  const images: FeedImage[] = [];
  for (const item of rawImages) {
    const key = item && typeof item === "object" ? (item as FeedImage).key : undefined;
    if (typeof key !== "string" || !MEDIA_KEY.test(key)) {
      return { ok: false, error: "画像のキーが不正です。アップロードからやり直してください。" };
    }
    const alt = item && typeof (item as FeedImage).alt === "string" ? (item as FeedImage).alt.trim() : "";
    if ([...alt].length > 200) return { ok: false, error: "alt は200文字までです。" };
    images.push({ key, alt });
  }
  return { ok: true, body, images };
}
