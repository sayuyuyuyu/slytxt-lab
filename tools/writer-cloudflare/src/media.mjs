/*
 * 画像メディアのアップロード。R2 バケット（env.MEDIA）に保存し、
 * 公開 URL（env.MEDIA_PUBLIC_BASE_URL 配下）を返す。
 *
 * 2026-11-04 に R2 を有効化し、バケットと binding を設定済み。
 * 未設定の環境では 501 で明示的に失敗させる
 * （blob: URL のような壊れた URL を本文に残さないため）。
 * 設定の手順は README の「画像メディア（R2）」を参照。
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

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadMedia(request, env) {
  if (!env.MEDIA) {
    throw new MediaError(
      "画像ストレージ（R2）が未設定です。README の「画像メディア（R2）」の手順で有効化してください。",
      501
    );
  }
  const base = String(env.MEDIA_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    throw new MediaError("画像の公開 URL（MEDIA_PUBLIC_BASE_URL）が未設定です。", 501);
  }

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

  const key = `media/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type }
  });
  return { url: `${base}/${key}`, key };
}
