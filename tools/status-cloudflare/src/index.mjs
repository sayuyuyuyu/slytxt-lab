/**
 * 健康状態スナップショットの受け口。
 *
 * About ページの「いまの状態」表示（isfine のような生存・健康状態の公開）のために、
 * 最新スナップショット JSON を1件だけ KV に保持して公開する。
 *
 * - POST /api/status: Authorization: Bearer <STATUS_POST_TOKEN>（Worker secret）が
 *   一致したときだけ、リクエストボディの JSON をそのまま保存する。
 * - GET /api/status: 保存済み JSON を公開返却する（無ければ 404）。
 *
 * 更新元はモカ側のスクリプト（~/workspace/tools/slytxt-status-update.py）で、
 * Apple Health（health-cli）の集計結果を定期的に POST する想定。
 */
const KEY = "latest";
const MAX_BODY_BYTES = 16_384;
const ALLOWED_ORIGIN = "https://slytxt.dev";

/** 秘密文字列の照合。長さと内容の両方を見て、早期 return を避ける（bookmarks 側 matchesSecret と同じ形）。 */
function matchesSecret(candidate, expected) {
  if (!expected) return false;
  if (!candidate) return false;
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      ...extraHeaders
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/status") return json({ error: "not_found" }, 404);

    if (request.method === "GET") {
      const raw = await env.STATUS_DATA.get(KEY);
      if (!raw) return json({ error: "no_data" }, 404);
      return new Response(raw, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": ALLOWED_ORIGIN
        }
      });
    }

    if (request.method === "POST") {
      if (!env.STATUS_POST_TOKEN) return json({ error: "not_configured" }, 500);
      const auth = request.headers.get("authorization") ?? "";
      if (!matchesSecret(auth, `Bearer ${env.STATUS_POST_TOKEN}`)) {
        return json({ error: "unauthorized" }, 401);
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return json({ error: "too_large" }, 413);
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return json({ error: "invalid_json" }, 400);
      }
      await env.STATUS_DATA.put(KEY, JSON.stringify(parsed));
      return json({ ok: true });
    }

    return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
  }
};
