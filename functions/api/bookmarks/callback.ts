import { exchangeCode, fetchUserId, STATE_KEY } from "../../../src/lib/bookmarks/oauth.ts";
import { SNAPSHOT_KEY } from "../../../src/lib/bookmarks/feed.ts";
import { escapeHtml } from "../../../src/lib/bookmarks/render.ts";
import { oauthResultPage } from "../../../src/lib/bookmarks/oauth-page.ts";
import { TOKEN_KEY } from "../../../src/lib/bookmarks/x.ts";
import type { PagesEnv, PagesFunction } from "../../../src/lib/bookmarks/types.ts";

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const clientId = context.env.X_CLIENT_ID;

  if (!clientId) return oauthResultPage("設定が足りません", "<p>X_CLIENT_ID が設定されていません。</p>", 500);
  if (!code || !state) {
    const reason = url.searchParams.get("error") ?? "認可コードがありません";
    return oauthResultPage("接続できませんでした", `<p>${escapeHtml(reason)}</p>`, 400);
  }

  const verifier = await context.env.BOOKMARKS.get(`${STATE_KEY}${state}`);
  if (!verifier) {
    return oauthResultPage("接続できませんでした", "<p>認可の有効期限が切れています。もう一度やり直してください。</p>", 400);
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
    return oauthResultPage("接続できませんでした", `<p>${escapeHtml(message)}</p>`, 400);
  }

  const target = context.env.BOOKMARKS_SECRET ? `/bm/${context.env.BOOKMARKS_SECRET}/` : "/";
  return oauthResultPage(
    "接続しました",
    `<p>ブックマークを取得できるようになりました。</p><p><a href="${escapeHtml(target)}">一覧を見る</a></p>`
  );
};
