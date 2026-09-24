import { handleFeed } from "../../../src/lib/bookmarks/page.ts";
import type { PagesEnv, PagesFunction } from "../../../src/lib/bookmarks/types.ts";

export const onRequest: PagesFunction<PagesEnv> = (context) => handleFeed(context, "html");
