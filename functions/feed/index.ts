import { handleFeedPage } from "../../src/lib/feed/page.ts";
import type { PagesFunction } from "../../src/lib/feed/page.ts";
import type { FeedEnv } from "../../src/lib/feed/types.ts";

/**
 * /feed/ の公開一覧。Astro がビルドした /feed/index.html を雛形にし、
 * 投稿一覧だけを D1 から読んで差し込む（src/lib/feed/page.ts）。
 */
export const onRequest: PagesFunction<FeedEnv> = (context) => handleFeedPage(context);
