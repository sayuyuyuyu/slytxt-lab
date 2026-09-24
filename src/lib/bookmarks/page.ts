import { readFeed } from "./feed.ts";
import { lastJstBoundary } from "./format.ts";
import { renderHtml, renderJson, renderRss } from "./render.ts";
import { matchesSecret } from "./secret.ts";
import { site } from "../site.ts";
import type { BookmarkSnapshot, KeyValueStore, PagesContext, PagesEnv } from "./types.ts";
import { createXClient } from "./x.ts";

/** 表示する件数。ここを増やすと取得と削除確認の対象が増える。 */
export const FEED_COUNT = 15;
export const REFRESH_HOUR = 9;

export type FeedFormat = "html" | "rss" | "json";

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
    count: FEED_COUNT
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
      fetch,
      now: () => Date.now()
    }),
    now,
    boundary: lastJstBoundary(now, REFRESH_HOUR),
    count: FEED_COUNT,
    policy: { retryMinutes: 10 }
  });

  return render(format, snapshot, origin, secret as string);
}
