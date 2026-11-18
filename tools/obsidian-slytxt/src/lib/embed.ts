/**
 * 埋め込み URL の入力支援。サイト側（src/lib/remark-embed.mjs）と同じ規則で、
 * URL だけの段落が公開側で埋め込みになる。ここでは URL の種別判定と、
 * 段落として独立させる挿入形だけを扱う（保存形式は URL のまま）。
 */

export type EmbedKind = "youtube" | "spotify" | "x" | "link";

export type EmbedInfo = { type: EmbedKind; url: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com") return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
  return match?.[1] ?? null;
}

function isSpotify(url: URL): boolean {
  if (url.hostname !== "open.spotify.com") return false;
  return /^\/(?:intl-[A-Za-z]{2}(?:-[A-Za-z]{2})?\/)?(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{10,}/.test(
    url.pathname
  );
}

function isXPost(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") return false;
  return /^\/[A-Za-z0-9_]+\/status\/\d+/.test(url.pathname);
}

/** URL を埋め込み種別に分ける。URL でなければ null。 */
export function classifyEmbedUrl(raw: string): EmbedInfo | null {
  const url = String(raw ?? "").trim();
  if (!/^https?:\/\/\S+$/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (youtubeId(parsed)) return { type: "youtube", url };
  if (isSpotify(parsed)) return { type: "spotify", url };
  if (isXPost(parsed)) return { type: "x", url };
  return { type: "link", url };
}

/** 種別の表示名（挿入後の通知に出す）。 */
export function embedLabel(info: EmbedInfo): string {
  switch (info.type) {
    case "youtube":
      return "YouTube の埋め込み";
    case "spotify":
      return "Spotify の埋め込み";
    case "x":
      return "X の埋め込み";
    case "link":
      return "リンクカード";
  }
}

/** カーソル位置に段落として独立させて挿入する形。前後の空行を確保する。 */
export function embedInsertion(url: string): string {
  return `\n\n${url}\n\n`;
}
