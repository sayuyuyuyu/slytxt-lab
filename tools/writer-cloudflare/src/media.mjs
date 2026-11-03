/*
 * 画像メディアのアップロード。GitHub リポジトリの public/media/ に保存し、
 * サイト側の公開 URL を返す。
 *
 * main は ruleset で「PR 経由＋ ci 成功」が必須のため、Contents API で
 * 直接コミットできない。そのため投稿フロー（publish.mjs）と同じ形にする:
 * POST /api/media がブランチ media/<uuid> にファイルを置いて PR を作り、
 * GET /api/media/:key/status が CI の成功を見て squash merge する。
 * UI は status をポーリングして merge 完了後に URL を本文へ挿入する。
 * merge 後、Cloudflare Pages のデプロイが伝わって初めて URL が開ける
 * （merge から数十秒程度）。詳細は README の「画像メディア（GitHub）」。
 *
 * 以前は R2 バケットに保存していたが、2026-11-04 の方針変更で GitHub 保存に
 * 切り替えた（バケットと binding は撤去済み）。
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
const KEY_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|gif|webp)$/;

function asMediaError(error) {
  if (error instanceof MediaError) return error;
  if (error instanceof GitHubError) {
    return new MediaError(`画像の保存に失敗しました: ${error.message}`, 502);
  }
  return error;
}

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

  const uuid = crypto.randomUUID();
  const name = `${uuid}.${ext}`;
  const path = `${MEDIA_DIR}/${name}`;
  const branch = `media/${uuid}`;
  const url = `${SITE_ORIGIN}/media/${name}`;

  const gh = createGitHubClient(env);
  try {
    const mainSha = await gh.getMainSha();
    await gh.createBranch(branch, mainSha);
    await gh.putBinaryContent({
      path,
      bytes: new Uint8Array(await file.arrayBuffer()),
      message: `media: 画像を追加 ${path}`,
      branch
    });
    const pr = await gh.createPull({
      title: `media: 画像を追加 ${path}`,
      head: branch,
      base: "main",
      body: "執筆ツール（write.slytxt.dev）から画像をアップロード。"
    });
    return { url, key: name, path, prUrl: pr.html_url, state: "waiting" };
  } catch (error) {
    throw asMediaError(error);
  }
}

/**
 * 画像 PR の状態を見て、済んでいれば片付ける（publishStatus と同じ役割）。
 * - ci が成功: その場で squash merge してブランチを消し、state "merged"
 *   （Cloudflare Pages の結果は待たない。投稿フローと同じ本人決定）
 * - ci 失敗 / conflict / PR が閉じられた: state "failed"
 * - それ以外: state "waiting"
 * key は POST の返却したファイル名（<uuid>.<ext>）。
 */
export async function mediaStatus(env, key) {
  const match = KEY_PATTERN.exec(String(key ?? ""));
  if (!match) {
    throw new MediaError("画像のキーが不正です。", 404);
  }
  const [, uuid, ext] = match;
  const name = `${uuid}.${ext}`;
  const path = `${MEDIA_DIR}/${name}`;
  const branch = `media/${uuid}`;
  const base = { url: `${SITE_ORIGIN}/media/${name}`, key: name };

  if (!env.GITHUB_TOKEN) {
    throw new MediaError(
      "GitHub トークン（GITHUB_TOKEN）が未設定のため、画像の状態を確認できません。",
      501
    );
  }

  const gh = createGitHubClient(env);
  try {
    const open = await gh.findOpenPull(branch);
    if (!open) {
      // PR が open でない。merge 済みならファイルが main にある。
      const onMain = await gh.getContent(path, "main");
      if (onMain) return { ...base, state: "merged" };
      return {
        ...base,
        state: "failed",
        message: "画像の PR が見つかりませんでした"
      };
    }

    const pr = await gh.getPull(open.number);
    const prUrl = pr.html_url ?? open.html_url;
    const withPr = { ...base, prUrl };

    if (pr.merged) {
      await gh.deleteBranch(branch).catch(() => false);
      return { ...withPr, state: "merged" };
    }
    if (pr.state === "closed") {
      return {
        ...withPr,
        state: "failed",
        message: "画像の PR が merge されずに閉じられました"
      };
    }
    if (pr.mergeable === false && pr.mergeable_state === "dirty") {
      return {
        ...withPr,
        state: "failed",
        message: `画像の PR が conflict しています: ${prUrl}`
      };
    }

    const checks = await gh.getChecks(pr.head.sha);
    if (checks.state === "failure") {
      return {
        ...withPr,
        state: "failed",
        message: `${checks.message ?? "CI が失敗しました"}: ${prUrl}`
      };
    }
    if (checks.state === "pending") {
      return { ...withPr, state: "waiting" };
    }

    try {
      await gh.mergePull(pr.number, pr.title);
    } catch (error) {
      const after = await gh.getPull(pr.number).catch(() => null);
      if (!after?.merged) {
        // main が先に進んでいると ruleset が merge を止めることがある。
        // その場合は main を取り込み直して CI を回し直し、次回の確認に委ねる。
        if (
          pr.mergeable_state === "behind" ||
          /modified|behind/i.test(error?.message ?? "")
        ) {
          await gh.updateBranch(pr.number).catch(() => false);
          return { ...withPr, state: "waiting" };
        }
        throw error;
      }
    }
    await gh.deleteBranch(branch).catch(() => false);
    return { ...withPr, state: "merged" };
  } catch (error) {
    throw asMediaError(error);
  }
}
