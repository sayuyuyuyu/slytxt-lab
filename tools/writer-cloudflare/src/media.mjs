/*
 * 画像メディアのアップロード。GitHub リポジトリの public/media/ へ
 * Contents API で main に直接コミットし、サイト側の公開 URL を返す。
 *
 * 以前は R2 バケットに保存していたが、2026-11-04 の方針変更で GitHub 保存に
 * 切り替えた（バケットと binding は撤去済み）。コミットが Cloudflare Pages の
 * デプロイを起こすため、返した URL が実際に開けるようになるまで数十秒〜
 * 1分程度かかる。詳細は README の「画像メディア（GitHub）」を参照。
 * GITHUB_TOKEN が未設定の環境では 501 で明示的に失敗させる
 * （壊れた URL を本文に残さないため）。
 */
import { GitHubError, createGitHubClient } from "./github.mjs";

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

const SITE_ORIGIN = "https://slytxt.dev";
const MEDIA_DIR = "public/media";

export async function uploadMedia(request, env) {
  if (!env.GITHUB_TOKEN) {
    throw new MediaError(
      "GitHub トークン（GITHUB_TOKEN）が未設定のため、画像を保存できません。",
      501
    );
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

  const name = `${crypto.randomUUID()}.${ext}`;
  const path = `${MEDIA_DIR}/${name}`;
  const gh = createGitHubClient(env);
  try {
    await gh.putBinaryContent({
      path,
      bytes: new Uint8Array(await file.arrayBuffer()),
      message: `media: 画像を追加 ${path}`,
      branch: "main"
    });
  } catch (error) {
    if (error instanceof GitHubError) {
      throw new MediaError(`画像の保存に失敗しました: ${error.message}`, 502);
    }
    throw error;
  }
  return { url: `${SITE_ORIGIN}/media/${name}`, key: path };
}
