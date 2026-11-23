/**
 * 短文フィードの公開ページ（/feed/）。
 *
 * 見た目は Astro がビルドした /feed/index.html をそのまま使い、投稿一覧だけを
 * D1 から読んで差し込む。Astro の出力は静的で、D1 はビルド時に読めないため、
 * 一覧の部分だけ Pages Functions が後から埋める。
 *
 * ページ送りは ?before=<ISO 8601> のカーソル方式。JS が無くても
 * 「もっと見る」のリンクで辿れる。
 */
import { FEED_PAGE_SIZE, HOME_FEED_SIZE, type FeedEnv } from "./types.ts";
import { readFeedPage } from "./store.ts";
import { FEED_END, FEED_START, injectFeed, renderFeedItems } from "./render.ts";

export type PagesContext<Env> = {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
};

export type PagesFunction<Env> = (context: PagesContext<Env>) => Response | Promise<Response>;

const SHELL_PATH = "/feed/index.html";
const HOME_SHELL_PATH = "/index.html";

/** ?before= の値。ISO 8601（UTC）だけを受け付ける。 */
const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function html(body: string, status = 200, cache = "public, max-age=60"): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cache
    }
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function beforeFromRequest(request: Request): { before: string | null } | { error: string } {
  const raw = new URL(request.url).searchParams.get("before");
  if (raw === null) return { before: null };
  if (!CURSOR.test(raw)) return { error: "before は ISO 8601（例 2026-11-16T10:00:00.000Z）で指定してください。" };
  return { before: raw };
}

export function feedHref(before: string): string {
  return `/feed/?before=${encodeURIComponent(before)}`;
}

/** ビルド済みの外枠を ASSETS から読む。無ければ理由を返す。 */
async function readShell(
  context: PagesContext<FeedEnv>,
  shellPath: string,
  label: string
): Promise<{ shell: string } | { error: Response }> {
  if (!context.env.ASSETS) {
    return { error: text(`${label}の外枠を読めません（ASSETS 未設定）。`, 500) };
  }
  // ASSETS.fetch は絶対 URL しか受け付けない（相対パスを渡すと Invalid URL）。
  const shellResponse = await context.env.ASSETS.fetch(new URL(shellPath, context.request.url));
  if (!shellResponse.ok) {
    return { error: text(`${label}の外枠が見つかりません（${shellPath}）。`, 500) };
  }
  return { shell: await shellResponse.text() };
}

function missingMarkers(label: string): Response {
  return text(`${label}の外枠に差し込み位置（${FEED_START} … ${FEED_END}）がありません。`, 500);
}

export async function handleFeedPage(context: PagesContext<FeedEnv>): Promise<Response> {
  const cursor = beforeFromRequest(context.request);
  if ("error" in cursor) return text(cursor.error, 400);

  let feed;
  try {
    feed = await readFeedPage(context.env.FEED, {
      before: cursor.before,
      limit: FEED_PAGE_SIZE
    });
  } catch (error) {
    // テーブル未作成やバインディング違いは設定の誤り。空の一覧に見せかけず、
    // 何が起きたか分かる形で返す（キャッシュもしない）。
    console.error("feed: D1 の読み取りに失敗しました", error);
    const detail = error instanceof Error ? error.message : String(error);
    return text(`フィードのデータベースを読めませんでした: ${detail}`, 503);
  }
  const { posts, nextBefore } = feed;

  const result = await readShell(context, SHELL_PATH, "フィード");
  if ("error" in result) return result.error;
  const page = injectFeed(
    result.shell,
    renderFeedItems(posts, { nextHref: nextBefore ? feedHref(nextBefore) : null })
  );
  if (page === null) return missingMarkers("フィード");
  return html(page);
}

/**
 * トップページの最新フィード。記事一覧は静的のまま、フィードの枠だけを
 * D1 から差し込む。/feed/ と違い、D1 が読めなくてもトップ全体は返し、
 * フィードの枠にだけ状態を出す。
 */
export async function handleHomeFeed(context: PagesContext<FeedEnv>): Promise<Response> {
  let items: string;
  try {
    const { posts } = await readFeedPage(context.env.FEED, { limit: HOME_FEED_SIZE });
    items = renderFeedItems(posts);
  } catch (error) {
    console.error("feed: トップページの D1 読み取りに失敗しました", error);
    items = `<p class="feed-empty">フィードを読み込めませんでした。</p>`;
  }

  const result = await readShell(context, HOME_SHELL_PATH, "トップページ");
  if ("error" in result) return result.error;
  const page = injectFeed(result.shell, items);
  if (page === null) return missingMarkers("トップページ");
  return html(page);
}
