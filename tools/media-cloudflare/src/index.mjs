/**
 * 公開メディアの配信 Worker（media.slytxt.dev）。
 *
 * 執筆ツール（tools/writer-cloudflare）が Cloudflare R2 バケット
 * slytxt-writer-media の `pub/` プレフィックスへ移した画像だけを返す。
 * 下書き段階の画像（`draft/`）はこの Worker からは一切見えず、
 * writer（write.slytxt.dev、Cloudflare Access の裏）経由でのみ表示できる。
 * バケット自体は非公開で、公開境界はこの Worker のプレフィックス判定が担う。
 *
 * 配信（GET / HEAD）のほかに、Obsidian プラグインからのカバー画像の
 * アップロード（PUT /<キー>）を受ける。secret の UPLOAD_TOKEN と対になる
 * Bearer トークンが必須で、キーの形・形式・大きさは配信側と同じ規則で縛る。
 * トークン未設定のときアップロードは無効（503）。
 */
const PUBLIC_PREFIX = "pub/";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

/** カバー画像のアップロード（PUT /<キー>）。成功時は公開 URL を返す。 */
async function handleUpload(request, env, name) {
  const token = env.UPLOAD_TOKEN;
  if (!token) return jsonError(503, "アップロードは有効になっていません。");
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${token}`) {
    return jsonError(401, "トークンが違います。");
  }
  const ext = name.split(".").pop();
  const expectedType = CONTENT_TYPES.get(ext);
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!expectedType || contentType !== expectedType) {
    return jsonError(415, "画像の形式がキーと一致しません。");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) return jsonError(413, "画像が 8MB を超えています。");
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return jsonError(400, "画像が空です。");
  if (body.byteLength > MAX_UPLOAD_BYTES) return jsonError(413, "画像が 8MB を超えています。");
  await env.MEDIA.put(`${PUBLIC_PREFIX}${name}`, body, {
    httpMetadata: { contentType: expectedType }
  });
  return new Response(JSON.stringify({ key: name, url: `https://media.slytxt.dev/${name}` }), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let name;
    try {
      name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    } catch {
      // Invalid percent-encoding is just another malformed key.
      return notFound();
    }
    if (request.method === "PUT") {
      if (!KEY_PATTERN.test(name)) return notFound();
      return handleUpload(request, env, name);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD, PUT" }
      });
    }
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
      // 公開 URL は内容ハッシュで一意なので、ブラウザには長く持たせてよい。
      // ただし R2 の pub/ を消しても CDN のエッジに残ると削除が反映されない
      // ため、エッジ側（s-maxage）の寿命だけ短くして数分で消えるようにする。
      "cache-control": "public, max-age=31536000, s-maxage=300, immutable",
      etag: object.httpEtag
    };
    if (request.method === "HEAD") {
      return new Response(null, { headers: { ...headers, "content-length": String(object.size) } });
    }
    return new Response(object.body, { headers });
  }
};
