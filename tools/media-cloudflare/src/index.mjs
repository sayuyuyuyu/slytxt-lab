/**
 * 公開メディアの配信専用 Worker（media.slytxt.dev）。
 *
 * 執筆ツール（tools/writer-cloudflare）が Cloudflare R2 バケット
 * slytxt-writer-media の `pub/` プレフィックスへ移した画像だけを返す。
 * 下書き段階の画像（`draft/`）はこの Worker からは一切見えず、
 * writer（write.slytxt.dev、Cloudflare Access の裏）経由でのみ表示できる。
 * バケット自体は非公開で、公開境界はこの Worker のプレフィックス判定が担う。
 */
const PUBLIC_PREFIX = "pub/";

const KEY_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\.(jpg|png|gif|webp)$/;

const CONTENT_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"]
]);

function notFound() {
  return new Response("not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" }
      });
    }
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!KEY_PATTERN.test(name)) return notFound();

    const object =
      request.method === "HEAD"
        ? await env.MEDIA.head(`${PUBLIC_PREFIX}${name}`)
        : await env.MEDIA.get(`${PUBLIC_PREFIX}${name}`);
    if (!object) return notFound();

    const ext = name.split(".").pop();
    const headers = {
      "content-type":
        object.httpMetadata?.contentType ?? CONTENT_TYPES.get(ext) ?? "application/octet-stream",
      // 公開 URL は内容ハッシュで一意。長期キャッシュでよい。
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag
    };
    if (request.method === "HEAD") {
      return new Response(null, { headers: { ...headers, "content-length": String(object.size) } });
    }
    return new Response(object.body, { headers });
  }
};
