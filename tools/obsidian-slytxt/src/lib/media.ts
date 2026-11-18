/**
 * カバー画像を media Worker（media.slytxt.dev）のアップロード口へ送る。
 *
 * 配信側のキー規則（UUID または 32 桁 hex + jpg/png/gif/webp）に合わせ、
 * キーはここで採番する。アップロードには media Worker 側の secret と
 * 対になるトークンが要る（プラグイン設定で持つ）。画像を Git に入れない
 * ための経路で、公開 URL は https://media.slytxt.dev/<キー> になる。
 */

export const MEDIA_BASE_URL = "https://media.slytxt.dev";
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp"
};

export class MediaError extends Error {}

/** requestUrl 相当（二進数ボディ用）。 */
export type MediaRequest = (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}) => Promise<{ status: number; json: unknown; text?: string }>;

/** MIME からキー（<uuid>.<ext>）を作る。対応しない形式は MediaError。 */
export function coverKey(mime: string, uuid: string): string {
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw new MediaError(`対応していない画像形式です: ${mime || "不明"}（jpg / png / gif / webp のみ）`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new MediaError("キーの採番に失敗しました。");
  }
  return `${uuid}.${ext}`;
}

/** アップロード前の大きさチェック。 */
export function assertCoverSize(byteLength: number): void {
  if (byteLength === 0) throw new MediaError("画像が空です。");
  if (byteLength > MAX_COVER_BYTES) {
    throw new MediaError("画像が 8MB を超えています。");
  }
}

/** 画像をアップロードし、公開 URL を返す。 */
export async function uploadCover(
  request: MediaRequest,
  token: string,
  bytes: ArrayBuffer,
  mime: string,
  uuid: string
): Promise<string> {
  if (!token) {
    throw new MediaError("設定でアップロード用トークンを登録してください。");
  }
  assertCoverSize(bytes.byteLength);
  const key = coverKey(mime, uuid);
  const response = await request({
    url: `${MEDIA_BASE_URL}/${key}`,
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": mime
    },
    body: bytes
  });
  if (response.status !== 201) {
    if (response.status === 401) {
      throw new MediaError("アップロード用トークンが違うようです。設定を確認してください。");
    }
    const payload = response.json as { error?: string } | null;
    throw new MediaError(payload?.error ?? `アップロードに失敗しました (HTTP ${response.status})`);
  }
  const payload = response.json as { url?: string } | null;
  return payload?.url ?? `${MEDIA_BASE_URL}/${key}`;
}
