/**
 * 短文フィードの投稿 API。投稿用の Worker（tools/feed-cloudflare）が呼ぶ。
 *
 *   GET  /api/posts?before=<ISO 8601>  直近の投稿
 *   POST /api/posts                    投稿を1件作る（リンクカードはここで取得）
 *   POST /api/media                    画像を1枚アップロードする
 *
 * 書き込みは writer と同じ作法で、独自ヘッダ x-slytxt-client と同一オリジン
 * だけを許可する（Cloudflare Access が入口を守る前提の二重の防御）。
 */
import { createFeedPost, deleteFeedPost, readFeedPage } from "./store.ts";
import {
  IMAGE_TYPES,
  MAX_BODY_LENGTH,
  MEDIA_KEY,
  feedMediaKey,
  feedPostId,
  firstUrl,
  isPublicHttpUrl,
  normalizeCompose,
  parseOgp
} from "./compose.ts";
import { FEED_PAGE_SIZE, type FeedDatabase, type FeedEnv, type FeedPost } from "./types.ts";

/** 画像1枚の上限（8MB）。 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** OGP を読む HTML の上限。巨大なページを丸ごと読まない。 */
const MAX_HTML_BYTES = 300 * 1024;
/** リンク先の取得は5秒で諦める。投稿を待たせすぎない。 */
const OGP_TIMEOUT_MS = 5000;

/** R2 のうち使う部分だけ。 */
export type MediaBucket = {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  head(key: string): Promise<unknown>;
};

export type FeedApiEnv = FeedEnv & {
  MEDIA?: MediaBucket;
  /** テストから差し替えるための fetch。 */
  FETCH?: typeof fetch;
};

export type FeedApiContext = {
  request: Request;
  env: FeedApiEnv;
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

/** writer（tools/writer-cloudflare/src/index.mjs）と同じ書き込み防御。 */
export function writeAllowed(request: Request): boolean {
  if (request.headers.get("x-slytxt-client") !== "1") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? "");
  } catch {
    return false;
  }
}

const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function readJson(request: Request, limit = 100_000): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) throw new Error("リクエストが大きすぎます");
  if (!text) return {};
  return JSON.parse(text);
}

/** 画像1枚を受け取り、media Worker が配信できるキーで R2 の pub/ へ置く。 */
async function uploadMedia(request: Request, env: FeedApiEnv): Promise<Response> {
  if (!env.MEDIA) return error("画像の保存先（R2）が未設定です。", 500);
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const key = feedMediaKey(contentType);
  if (!key) {
    return error(`画像は ${Object.keys(IMAGE_TYPES).join(" / ")} のいずれかにしてください。`, 415);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return error("画像が空です。", 400);
  if (body.byteLength > MAX_IMAGE_BYTES) {
    return error(`画像は${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MBまでです。`, 413);
  }
  await env.MEDIA.put(`pub/${key}`, body, { httpMetadata: { contentType } });
  return json({ key, url: `https://media.slytxt.dev/${key}` }, 201);
}

/** リンク先の OGP を読む。取れなければカードを付けない（投稿自体は成功させる）。 */
async function fetchLink(env: FeedApiEnv, url: string): Promise<FeedPost["link"]> {
  if (!isPublicHttpUrl(url)) return undefined;
  const doFetch = env.FETCH ?? fetch;
  try {
    const response = await doFetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(OGP_TIMEOUT_MS),
      headers: { "user-agent": "slytxt-feed/1.0 (+https://slytxt.dev/)" }
    });
    if (!response.ok) return { url };
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return parseOgp(html, response.url || url);
  } catch {
    return undefined;
  }
}

/** 画像が実際に R2 にあるか（アップロード前のキーを保存しない）。 */
async function mediaExists(env: FeedApiEnv, keys: string[]): Promise<boolean> {
  if (keys.length === 0) return true;
  if (!env.MEDIA) return false;
  for (const key of keys) {
    if (!(await env.MEDIA.head(`pub/${key}`))) return false;
  }
  return true;
}

async function createPost(request: Request, env: FeedApiEnv): Promise<Response> {
  if (!env.FEED) return error("フィードのデータベース（D1）が未設定です。", 500);
  let payload;
  try {
    payload = await readJson(request);
  } catch (parseError) {
    return error(parseError instanceof Error ? parseError.message : "JSON を読めません", 400);
  }
  const composed = normalizeCompose(payload as { body?: unknown; images?: unknown });
  if (!composed.ok) return error(composed.error, 400);

  if (!(await mediaExists(env, composed.images.map((image) => image.key)))) {
    return error("添付した画像が見つかりません。アップロードからやり直してください。", 400);
  }

  const url = firstUrl(composed.body);
  const link = url ? await fetchLink(env, url) : undefined;
  const post: FeedPost = {
    id: feedPostId(Date.now()),
    body: composed.body,
    createdAt: new Date().toISOString(),
    images: composed.images,
    ...(link ? { link } : {})
  };
  await createFeedPost(env.FEED as FeedDatabase, post);
  return json({ post }, 201);
}

async function listPosts(request: Request, env: FeedApiEnv): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("before");
  if (raw !== null && !CURSOR.test(raw)) {
    return error("before は ISO 8601 で指定してください。", 400);
  }
  const { posts, nextBefore } = await readFeedPage(env.FEED, {
    before: raw,
    limit: FEED_PAGE_SIZE
  });
  return json({ posts, nextBefore });
}

const POST_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

async function deletePost(env: FeedApiEnv, id: string): Promise<Response> {
  if (!env.FEED) return error("フィードのデータベース（D1）が未設定です。", 500);
  if (!POST_ID.test(id)) return error("投稿 ID が不正です。", 400);
  const removed = await deleteFeedPost(env.FEED, id, new Date().toISOString());
  if (!removed) return error("投稿が見つかりません。", 404);
  return json({ id, deleted: true });
}

export async function handleFeedApi({ request, env }: FeedApiContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method ?? "GET";

  if (STATE_CHANGING.has(method) && !writeAllowed(request)) {
    return error("別のオリジンからの書き込みは受け付けません。", 403);
  }

  const post = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (post && method === "DELETE") return deletePost(env, post[1]);

  if (pathname === "/api/posts" && method === "GET") return listPosts(request, env);
  if (pathname === "/api/posts" && method === "POST") return createPost(request, env);
  if (pathname === "/api/media" && method === "POST") return uploadMedia(request, env);
  return error("not found", 404);
}

export { MAX_BODY_LENGTH, MEDIA_KEY };
