import { handleHomeFeed } from "../src/lib/feed/page.ts";
import type { PagesFunction } from "../src/lib/feed/page.ts";
import type { FeedEnv } from "../src/lib/feed/types.ts";

/**
 * トップページ。記事と Projects は静的ビルドのまま、最新の短文フィードだけを
 * D1 から読んで差し込む（src/lib/feed/page.ts の handleHomeFeed）。
 */
export const onRequest: PagesFunction<FeedEnv> = (context) => handleHomeFeed(context);
