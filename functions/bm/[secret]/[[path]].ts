import { handleFeed, type FeedFormat } from "../../../src/lib/bookmarks/page.ts";
import type { PagesEnv, PagesFunction } from "../../../src/lib/bookmarks/types.ts";

const FORMATS: Record<string, FeedFormat> = {
  "": "html",
  "rss.xml": "rss",
  "bookmarks.json": "json"
};

export const onRequest: PagesFunction<PagesEnv> = (context) => {
  const raw = context.params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // `[[path]]` は /bm/<secret>/ も拾う。空パスは一覧を返す。
  const format = FORMATS[segments.join("/")];
  if (!format) return new Response("Not Found", { status: 404 });

  return handleFeed(context, format);
};
