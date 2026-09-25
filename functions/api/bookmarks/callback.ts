import { exchangeCode, fetchUserId } from "../../../src/lib/bookmarks/oauth.ts";
import { SNAPSHOT_KEY } from "../../../src/lib/bookmarks/feed.ts";
import { escapeHtml } from "../../../src/lib/bookmarks/render.ts";
import { TOKEN_KEY } from "../../../src/lib/bookmarks/x.ts";
import type { PagesEnv, PagesFunction } from "../../../src/lib/bookmarks/types.ts";

const STATE_KEY = "oauth:";

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#fdfcf8;color:#292721;font:16px/1.9 system-ui,sans-serif}
@media (prefers-color-scheme:dark){body{background:#1d1b18;color:#f2eee5}a{color:#ee947d}}
main{max-width:640px;margin:0 auto;padding:64px 20px}h1{font-size:1.4rem;margin:0 0 16px}a{color:#a43d29}
p{margin:0 0 12px}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } }
  );
}

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const clientId = context.env.X_CLIENT_ID;

  if (!clientId) return page("設定が足りません", "<p>X_CLIENT_ID が設定されていません。</p>");
  if (!code || !state) {
    const reason = url.searchParams.get("error") ?? "認可コードがありません";
    return page("接続できませんでした", `<p>${escapeHtml(reason)}</p>`);
  }

  const verifier = await context.env.BOOKMARKS.get(`${STATE_KEY}${state}`);
  if (!verifier) {
    return page("接続できませんでした", "<p>認可の有効期限が切れています。もう一度やり直してください。</p>");
  }
  await context.env.BOOKMARKS.delete(`${STATE_KEY}${state}`);

  try {
    // Workers では fetch を裸で渡すと this がずれて Illegal invocation になる。
    const doFetch = fetch.bind(globalThis);
    const tokens = await exchangeCode({
      clientId,
      clientSecret: context.env.X_CLIENT_SECRET,
      code,
      redirectUri: new URL("/api/bookmarks/callback", url.origin).href,
      verifier,
      fetch: doFetch,
      now: () => Date.now()
    });
    tokens.userId = await fetchUserId(doFetch, tokens.accessToken);
    await context.env.BOOKMARKS.put(TOKEN_KEY, JSON.stringify(tokens));
    // 接続前に失敗した内容が残っていると次の朝まで更新されないので、消して取り直させる。
    await context.env.BOOKMARKS.delete(SNAPSHOT_KEY);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    return page("接続できませんでした", `<p>${escapeHtml(message)}</p>`);
  }

  const target = context.env.BOOKMARKS_SECRET ? `/bm/${context.env.BOOKMARKS_SECRET}/` : "/";
  return page(
    "接続しました",
    `<p>ブックマークを取得できるようになりました。</p><p><a href="${escapeHtml(target)}">一覧を見る</a></p>`
  );
};
