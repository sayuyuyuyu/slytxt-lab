/*
 * 画像メディアの保存先は Cloudflare R2（非公開バケット slytxt-writer-media）。
 *
 * 公開・非公開の境界:
 * - アップロードした画像はバケットの `draft/` プレフィックスに置く。
 *   下書き段階では公開されず、エディタのプレビューは writer 自身が
 *   GET /media/:key で配信する（write.slytxt.dev は Cloudflare Access の
 *   裏にあるため、未認証では取得できない）。
 * - 投稿の公開時（publish.mjs）に、本文とカバーが参照する画像だけを
 *   `pub/` プレフィックスへ移し、公開側の URL
 *   （https://media.slytxt.dev/<ファイル名>）に付け替える。配信専用
 *   Worker（tools/media-cloudflare）は `pub/` のものだけを返すため、
 *   下書きだけの画像は推測可能な URL でも取得できない。
 * - 下書きの markdown とカバーには writer 相対 URL（/media/<ファイル名>）
 *   が入る。公開時にだけ絶対 URL へ付け替えるので、下書き側の参照は
 *   公開ドメインを向かない。
 *
 * キー（ファイル名）は従来どおり内容の SHA-256 ハッシュ先頭32桁＋拡張子。
 * 同じ画像は同じキーに収束するため、再試行や重複アップロードで
 * オブジェクトが増えない（冪等）。移行前の UUID キーの画像も、移行時に
 * R2 へ入れてあるため同じ規則で扱える。
 *
 * 旧方式（2026-11-04〜11-05）は GitHub の public/media/ にブランチ＋PR で
 * 入れていたが、公開リポジトリに原画が残る点と GitHub のコンテンツ
 * 規約の制約から、2026-11-05 の本人依頼で R2 へ戻した。
 * R2 バインディング（MEDIA）が未設定の環境では 501 で明示的に失敗させる
 * （壊れた URL を本文に残さないため）。
 */
export class MediaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"]
]);
const EXT_CONTENT_TYPES = new Map([...TYPES].map(([type, ext]) => [ext, type]));

const MAX_BYTES = 10 * 1024 * 1024;

/** 公開側メディアの配信オリジン（tools/media-cloudflare の Worker）。 */
export const MEDIA_ORIGIN = "https://media.slytxt.dev";

const DRAFT_PREFIX = "draft/";
const PUBLIC_PREFIX = "pub/";

/**
 * キー（ファイル名）の形。現行は内容ハッシュ32桁、移行前は UUID。
 */
const KEY_BODY =
  "(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\\.(?:jpg|png|gif|webp)";
const KEY_PATTERN = new RegExp(`^${KEY_BODY}$`);

/**
 * 本文・カバーに現れるメディア参照の形:
 * - writer 相対: /media/<キー>
 * - 旧公開 URL: https://slytxt.dev/media/<キー>
 * - 新公開 URL: https://media.slytxt.dev/<キー>
 */
const MEDIA_REF_PATTERN = new RegExp(
  `(?:https://(?:[a-z0-9-]+\\.)*slytxt\\.dev)?/media/(${KEY_BODY})` +
    `|https://media\\.slytxt\\.dev/(${KEY_BODY})`,
  "g"
);

function bucket(env) {
  if (!env?.MEDIA) {
    throw new MediaError(
      "画像ストレージ（R2 バインディング MEDIA）が未設定のため、画像を保存できません。",
      501
    );
  }
  return env.MEDIA;
}

/** 公開側の URL（公開済み記事が参照する形）。 */
export function publicMediaUrl(key) {
  return `${MEDIA_ORIGIN}/${key}`;
}

/** 下書き側の URL（writer が Access の裏で配信する相対パス）。 */
export function draftMediaUrl(key) {
  return `/media/${key}`;
}

/** テキスト中のメディア参照からキーを重複なしで取り出す。 */
export function extractMediaKeys(text) {
  const keys = [];
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(MEDIA_REF_PATTERN)) {
    const key = match[1] ?? match[2];
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** テキスト中のメディア参照をすべて公開側 URL に付け替える。 */
export function rewriteMediaUrls(text) {
  return String(text ?? "").replace(MEDIA_REF_PATTERN, (_all, rel, abs) =>
    publicMediaUrl(rel ?? abs)
  );
}

function parseKey(key) {
  const name = String(key ?? "");
  if (!KEY_PATTERN.test(name)) {
    throw new MediaError("画像のキーが不正です。", 404);
  }
  return name;
}

export async function uploadMedia(request, env) {
  const store = bucket(env);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    throw new MediaError("画像ファイル（file）が指定されていません。");
  }
  const ext = TYPES.get(file.type);
  if (!ext) {
    throw new MediaError("対応形式は jpeg / png / gif / webp です。");
  }
  if (file.size > MAX_BYTES) {
    throw new MediaError("画像は 10MB までです。", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // 同一性は内容ハッシュで決める（再試行・重複アップロードの収束先）。
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const name = `${hash}.${ext}`;

  const base = { url: draftMediaUrl(name), publicUrl: publicMediaUrl(name), key: name };
  // 既に保存済み（公開済み含む）ならそれが最終状態。再アップロードも成功で返す。
  if (await store.head(`${PUBLIC_PREFIX}${name}`)) {
    return { ...base, state: "stored", published: true };
  }
  if (!(await store.head(`${DRAFT_PREFIX}${name}`))) {
    await store.put(`${DRAFT_PREFIX}${name}`, bytes, {
      httpMetadata: { contentType: file.type }
    });
  }
  return { ...base, state: "stored", published: false };
}

/**
 * 画像の保存状態を返す（UI の互換用。アップロードは即時に完了するため、
 * 旧フローのような「反映待ち」は発生しない）。
 * - 公開済み: state "merged"（旧フローの完了状態と同語）
 * - 保存済み・未公開: state "stored"
 * - どちらにも無い: 404
 */
export async function mediaStatus(env, key) {
  const store = bucket(env);
  const name = parseKey(key);
  const base = { url: draftMediaUrl(name), publicUrl: publicMediaUrl(name), key: name };
  if (await store.head(`${PUBLIC_PREFIX}${name}`)) {
    return { ...base, state: "merged", published: true };
  }
  if (await store.head(`${DRAFT_PREFIX}${name}`)) {
    return { ...base, state: "stored", published: false };
  }
  throw new MediaError("画像が見つかりませんでした。", 404);
}

/**
 * writer が下書きプレビュー用に画像を配信する（GET /media/:key）。
 * write.slytxt.dev は Cloudflare Access の裏にあるため未認証では届かない。
 * 公開済み・下書きのどちらにあっても返す。無ければ null（呼び出し側で 404）。
 */
export async function serveDraftMedia(env, key) {
  const store = bucket(env);
  const name = parseKey(key);
  const object =
    (await store.get(`${PUBLIC_PREFIX}${name}`)) ??
    (await store.get(`${DRAFT_PREFIX}${name}`));
  if (!object) return null;
  const ext = name.split(".").pop();
  const contentType =
    object.httpMetadata?.contentType ?? EXT_CONTENT_TYPES.get(ext) ?? "application/octet-stream";
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
      etag: object.httpEtag
    }
  });
}

/**
 * 公開時に、参照されている画像を公開側（pub/）へ移す。冪等:
 * 既に公開側にあれば何もしない。下書き側にも公開側にも無いキーは
 * 公開すると壊れた画像になるため、理由を添えて失敗させる。
 */
export async function publishMedia(env, keys) {
  const store = bucket(env);
  for (const key of keys) {
    const name = parseKey(key);
    if (await store.head(`${PUBLIC_PREFIX}${name}`)) continue;
    const draft = await store.get(`${DRAFT_PREFIX}${name}`);
    if (!draft) {
      throw new MediaError(
        `本文が参照する画像 ${name} がストレージにありません。再アップロードしてから公開してください。`
      );
    }
    const ext = name.split(".").pop();
    await store.put(`${PUBLIC_PREFIX}${name}`, await draft.arrayBuffer(), {
      httpMetadata: {
        contentType: draft.httpMetadata?.contentType ?? EXT_CONTENT_TYPES.get(ext)
      }
    });
    await store.delete(`${DRAFT_PREFIX}${name}`);
  }
}
