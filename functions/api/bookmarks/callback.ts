import { exchangeCode, fetchUserId, STATE_KEY } from "../../../src/lib/bookmarks/oauth.ts";
import { SNAPSHOT_KEY } from "../../../src/lib/bookmarks/feed.ts";
import { escapeHtml } from "../../../src/lib/bookmarks/render.ts";
import { TOKEN_KEY } from "../../../src/lib/bookmarks/x.ts";
import type { PagesEnv, PagesFunction } from "../../../src/lib/bookmarks/types.ts";

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#05070f">
<title>${escapeHtml(title)}</title>
<script>try{var isLight=localStorage.getItem("theme")==="light";document.documentElement.classList.toggle("light",isLight);document.querySelector('meta[name="theme-color"]').setAttribute("content",isLight?"#eef3fb":"#05070f")}catch(e){}</script>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#05070f;color:#d9e6f7;font:16px/1.9 "Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","YuGothic",sans-serif}
main{max-width:640px;margin:0 auto;padding:64px 20px}h1{font-size:1.4rem;font-weight:400;margin:0 0 16px}a{color:#4cc9f0}
p{margin:0 0 12px}
:root.light body{background:#eef3fb;color:#0b1220}
:root.light a{color:#0b63c4}
@media print{body{background:#ffffff;color:#0b1220}a{color:#0b63c4}}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } }
  );
}

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const clientId = context.env.X_CLIENT_ID;

  if (!clientId) return page("設定が足りません", "<p>X_CLIENT_ID が設定されていません。</p>", 500);
  if (!code || !state) {
    const reason = url.searchParams.get("error") ?? "認可コードがありません";
    return page("接続できませんでした", `<p>${escapeHtml(reason)}</p>`, 400);
  }

  const verifier = await context.env.BOOKMARKS.get(`${STATE_KEY}${state}`);
  if (!verifier) {
    return page("接続できませんでした", "<p>認可の有効期限が切れています。もう一度やり直してください。</p>", 400);
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
    return page("接続できませんでした", `<p>${escapeHtml(message)}</p>`, 400);
  }

  const target = context.env.BOOKMARKS_SECRET ? `/bm/${context.env.BOOKMARKS_SECRET}/` : "/";
  return page(
    "接続しました",
    `<p>ブックマークを取得できるようになりました。</p><p><a href="${escapeHtml(target)}">一覧を見る</a></p>`
  );
};
