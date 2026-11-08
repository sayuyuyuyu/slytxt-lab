/**
 * 執筆サーバーの Cloudflare Workers 版。
 *
 * 旧ローカル版サーバーのルーティングと書き込み防御を移植したもの。
 * 認証は Cloudflare Access（write.slytxt.dev は本人のメールアドレスのみ許可）が
 * 担うため、Worker 側にトークン認証は無い。入口はカスタムドメインのみで、
 * workers.dev は wrangler.toml で無効化してある。
 * 静的ファイルは Workers Static Assets（env.ASSETS）から配信する。
 * API のパスとレスポンス形式は旧ローカル版から変えていない。
 */
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DraftNotFound,
  createDraftStore
} from "./drafts-kv.mjs";
import { PublishError, deriveDescription, publishPost, publishStatus } from "./publish.mjs";
import { listPublished, openPublished } from "./published.mjs";
import { generateSummary } from "./summary.mjs";
import { MediaError, mediaStatus, serveDraftMedia, uploadMedia } from "./media.mjs";
import { drivePendingPublishes, listPublishResults } from "./driver.mjs";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 他のサイトから書き込みAPIを叩かせない。
 * 独自ヘッダ必須が本体。クロスオリジンの fetch はプリフライトが走り、
 * こちらは CORS ヘッダを返さないので本処理まで届かない。
 */
function stateChangingAllowed(request) {
  if (request.headers.get("x-slytxt-client") !== "1") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? "");
  } catch {
    return false;
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function readJsonBody(request, limit = 2_000_000) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) {
    throw new Error("リクエストが大きすぎます");
  }
  if (!text) return {};
  return JSON.parse(text);
}

/** NDJSON 形式で進捗を流す。 */
function streamTask(task) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (payload) =>
    writer.write(encoder.encode(`${JSON.stringify(payload)}\n`)).catch(() => {});
  (async () => {
    try {
      const result = await task(send);
      await send({ type: "done", result });
    } catch (error) {
      await send({ type: "error", message: error?.message ?? String(error) });
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function handleApi(request, env, url) {
  const store = createDraftStore(env.DRAFTS);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const [, resource, id, action] = segments;
  const method = request.method ?? "GET";

  if (resource === "meta" && method === "GET") {
    // タグ候補は既存の下書きが使っているタグの集合。
    // 公開済み記事のタグ一覧を Worker から辿る手段は無いためこれで代える。
    // 一覧が取れないとき（KV の list 上限など）でもカテゴリは返し、
    // タグ候補が無いだけで writer の起動を止めない（issue #584）。
    const drafts = await store.listDrafts().catch(() => []);
    const tags = [...new Set(drafts.flatMap((draft) => draft.tags))].sort();
    return json({
      categories: CATEGORIES,
      categoryLabels: CATEGORY_LABELS,
      draftsDir: "Cloudflare KV",
      tags
    });
  }

  if (resource === "drafts" && !id) {
    if (method === "GET") {
      return json({ drafts: await store.listDrafts() });
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      const draft = await store.createDraft({
        title: body.title ?? "",
        category: body.category ?? "notes"
      });
      return json({ draft }, 201);
    }
    return null;
  }

  if (resource === "drafts" && id && !action) {
    if (method === "GET") {
      return json({ draft: await store.readDraft(id) });
    }
    if (method === "PUT") {
      const body = await readJsonBody(request);
      const draft = await store.writeDraft(id, body);
      return json({ draft });
    }
    if (method === "DELETE") {
      const removed = await store.deleteDraft(id);
      return json({ removed }, removed ? 200 : 404);
    }
    return null;
  }

  // 公開済み記事の一覧（writer で開いて再編集するための導線）。
  if (resource === "published" && !id && method === "GET") {
    return json({ articles: await listPublished({ env, store }) });
  }

  // 公開済み記事を下書きとして開く。対応する下書きがあればそれを返し、
  // 無ければ記事を取り込んで下書きを作る。
  if (resource === "published" && id && action && method === "POST") {
    const { draft, created } = await openPublished({
      env,
      store,
      category: id,
      slug: action
    });
    return json({ draft, created }, created ? 201 : 200);
  }

  if (resource === "media" && !id) {
    if (method === "POST") {
      return json(await uploadMedia(request, env), 201);
    }
    return null;
  }

  if (resource === "media" && id && action === "status" && method === "GET") {
    return json(await mediaStatus(env, id));
  }

  // 公開パネル用の説明文候補。AI 要約が作れればそれを、無ければ抜粋を返す。
  // 候補はここでは保存しない（確定は通常の保存＝公開パネルの値で行う）。
  if (resource === "drafts" && id && action === "summary" && method === "POST") {
    const input = await readJsonBody(request).catch(() => ({}));
    const draft = await store.readDraft(id);
    const draftTitle =
      typeof input.title === "string" && input.title.trim() ? input.title : draft.title;
    const draftBody = typeof input.body === "string" && input.body.trim() ? input.body : draft.body;
    const summary = await generateSummary(env, { title: draftTitle, body: draftBody });
    if (summary) return json({ summary, source: "ai" });
    return json({ summary: deriveDescription(draftBody), source: "excerpt" });
  }

  if (resource === "publish" && id && action === "status" && method === "GET") {
    return json(await publishStatus({ env, store, id }));
  }

  // タブを閉じている間に完了した公開の結果（driver.mjs が KV に残す）。
  // UI が起動時に取得して知らせる。
  if (resource === "publish-results" && !id && method === "GET") {
    return json({ results: await listPublishResults(env) });
  }

  if (resource === "publish" && id && !action && method === "POST") {
    return streamTask(async (send) =>
      publishPost({
        env,
        store,
        id,
        onLog: (message) => send({ type: "log", message })
      })
    );
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (STATE_CHANGING.has(request.method ?? "") && !stateChangingAllowed(request)) {
      return json(
        { error: "別のオリジンからの書き込みは受け付けません。執筆画面から操作してください。" },
        403
      );
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        return (await handleApi(request, env, url)) ?? json({ error: "not found" }, 404);
      }
      // 下書き段階の画像の配信。ここは Cloudflare Access の裏なので、
      // 未認証では取得できない。公開済みの画像の配信は media.slytxt.dev
      // （tools/media-cloudflare）が担う。
      const mediaMatch = /^\/media\/(.+)$/.exec(url.pathname);
      if (mediaMatch && (request.method === "GET" || request.method === "HEAD")) {
        let mediaKey;
        try {
          mediaKey = decodeURIComponent(mediaMatch[1]);
        } catch {
          // Invalid percent-encoding is just another malformed key.
          return new Response("not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        const served = await serveDraftMedia(env, mediaKey);
        if (served) return served;
        return new Response("not found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    } catch (error) {
      const status =
        error instanceof DraftNotFound
          ? 404
          : error instanceof PublishError
            ? 400
            : error instanceof MediaError
              ? error.status
              : 500;
      return json({ error: error?.message ?? String(error) }, status);
    }
  },

  /**
   * Cron Triggers（wrangler.toml の [triggers]、毎分）: 保留中の投稿の
   * 見届けをサーバー側で進める。投稿後にタブを閉じても、CI 成功
   * 後の merge と後片付けがここで完了する（driver.mjs）。
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(drivePendingPublishes(env));
  }
};
