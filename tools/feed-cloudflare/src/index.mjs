/**
 * 短文フィードの投稿 Worker（feed.slytxt.dev）。
 *
 * - 認証は Cloudflare Access（本人のメールアドレスのみ許可）に任せる。
 * - /api/* は作者の投稿 API（src/lib/feed/api.ts）。
 * - それ以外は静的ファイル（投稿画面の PWA）。
 */
import { handleFeedApi } from "../../../src/lib/feed/api.ts";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleFeedApi({ request, env });
    }
    if (!env.ASSETS) {
      return new Response("投稿画面が見つかりません（ASSETS 未設定）。", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
