import { readFeed } from "./feed.ts";
import { lastJstBoundary } from "./format.ts";
import { renderEmbed, renderHtml, renderJson, renderRss } from "./render.ts";
import { matchesSecret } from "./secret.ts";
import { site } from "../site.ts";
import type { BookmarkSnapshot, KeyValueStore, PagesContext, PagesEnv } from "./types.ts";
import { createXClient } from "./x.ts";

/**
 * スナップショットに保持する上限。X API のブックマーク取得は1リクエスト最大100件のため、
 * 100件なら通常は1リクエストで収まる。取得は1日1回の更新時だけで、100件でも KV の1値に収まる。
 */
export const FETCH_COUNT = 100;
/** 一覧で最初に表示する件数。残りは「もっと見る」で広げる。 */
export const INITIAL_COUNT = 30;
/** 埋め込みに載せる件数。埋め込み先の表示を圧迫しない範囲に抑える。 */
export const EMBED_COUNT = 15;
export const REFRESH_HOUR = 9;

export type FeedFormat = "html" | "rss" | "json" | "js";

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function render(format: FeedFormat, snapshot: BookmarkSnapshot | null, origin: string, secret: string): Response {
  const base = `${origin}/bm/${secret}`;
  const options = {
    siteName: site.name,
    siteUrl: `${origin}/`,
    pageUrl: `${base}/`,
    rssUrl: `${base}/rss.xml`,
    jsonUrl: `${base}/bookmarks.json`,
    count: FETCH_COUNT,
    initialCount: INITIAL_COUNT,
    embedCount: EMBED_COUNT
  };

  if (format === "rss") {
    return new Response(renderRss(snapshot, options), {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex"
      }
    });
  }

  if (format === "json") {
    return new Response(renderJson(snapshot), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex"
      }
    });
  }

  if (format === "js") {
    return new Response(renderEmbed(snapshot, options), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex"
      }
    });
  }

  return new Response(renderHtml(snapshot, options), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex"
    }
  });
}

/** 推測不能な URL の下で、一覧・RSS・JSON を返す。 */
export async function handleFeed(
  context: PagesContext<PagesEnv>,
  format: FeedFormat
): Promise<Response> {
  const secret = context.env.BOOKMARKS_SECRET;
  const param = context.params.secret;
  const candidate = Array.isArray(param) ? param[0] : param;
  if (!matchesSecret(candidate, secret)) return notFound();

  const origin = new URL(context.request.url).origin;
  const now = new Date();

  if (!context.env.X_CLIENT_ID) {
    return render(format, null, origin, secret as string);
  }

  const { snapshot } = await readFeed({
    store: context.env.BOOKMARKS as KeyValueStore,
    x: createXClient(context.env.BOOKMARKS as KeyValueStore, {
      clientId: context.env.X_CLIENT_ID,
      clientSecret: context.env.X_CLIENT_SECRET,
      // Workers では fetch を裸で渡すと this がずれて Illegal invocation になる。
      fetch: fetch.bind(globalThis),
      now: () => Date.now()
    }),
    now,
    boundary: lastJstBoundary(now, REFRESH_HOUR),
    count: FETCH_COUNT,
    policy: { retryMinutes: 10 }
  });

  return render(format, snapshot, origin, secret as string);
}
