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
 *
 * 冪等性: 画像の同一性は内容の SHA-256 ハッシュで決める。同じ画像は
 * 同じファイル名・同じブランチ・同じ PR に収束するため、再試行や
 * 重複アップロードで PR が増えたり、失敗した古い PR が残ったりしない。
 * 公開フロー（publish.mjs）と同じく、状態確認は GitHub 側の実状態から
 * 現在フェーズを判定し、次に必要な操作だけを行う。
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
/**
 * キー（ファイル名）の形。現行は内容ハッシュ32桁、移行前は UUID。
 * どちらも「media/<先頭部分>」がブランチ名になる点は同じ。
 */
const KEY_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\.(jpg|png|gif|webp)$/;

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

  const bytes = new Uint8Array(await file.arrayBuffer());
  // 同一性は内容ハッシュで決める（再試行・重複アップロードの収束先）。
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const name = `${hash}.${ext}`;
  const path = `${MEDIA_DIR}/${name}`;
  const branch = `media/${hash}`;
  const url = `${SITE_ORIGIN}/media/${name}`;
  const base = { url, key: name, path, prUrl: "" };

  const gh = createGitHubClient(env);
  try {
    // 既に main に入っていればそれが最終状態。再アップロードも成功で返す。
    if (await gh.getContent(path, "main")) {
      return { ...base, state: "merged" };
    }
    const history = await gh.findPulls(branch);
    const open = history.find((entry) => entry.state === "open") ?? null;
    if (open) {
      // 同じ画像の PR が進行中。再試行はそれを引き継ぐ（新しい PR は作らない）。
      return { ...base, prUrl: open.html_url, state: "waiting" };
    }
    const latest = history[0] ?? null;
    if (latest && latest.state === "closed") {
      const detail = await gh.getPull(latest.number).catch(() => null);
      if (detail?.merged) {
        // merge 済みなら成功として収束させる。
        return { ...base, prUrl: latest.html_url, state: "merged" };
      }
      // merge されず閉じられた PR のブランチは作り直す。
      await gh.deleteBranch(branch).catch(() => false);
    }
    if (await gh.getBranch(branch)) {
      // PR の無い残りブランチ（PR 作成前に落ちた等）。中身は内容ハッシュで
      // 同一のはずなので、ファイルが無ければ置いてから PR だけ作る。
      const onBranch = await gh.getContent(path, branch);
      if (!onBranch) {
        await gh.putBinaryContent({
          path,
          bytes,
          message: `media: 画像を追加 ${path}`,
          branch
        });
      }
    } else {
      const mainSha = await gh.getMainSha();
      await gh.createBranch(branch, mainSha);
      await gh.putBinaryContent({
        path,
        bytes,
        message: `media: 画像を追加 ${path}`,
        branch
      });
    }
    const pr = await gh.createPull({
      title: `media: 画像を追加 ${path}`,
      head: branch,
      base: "main",
      body: "執筆ツール（write.slytxt.dev）から画像をアップロード。"
    });
    return { ...base, prUrl: pr.html_url, state: "waiting" };
  } catch (error) {
    throw asMediaError(error);
  }
}

/**
 * 画像 PR の状態を見て、済んでいれば片付ける（publishStatus と同じ役割）。
 * 公開フローと同じく、実状態から現在フェーズを判定する冪等な確認:
 * - merged: ブランチを消して state "merged"（再マージは試みない）
 * - ci が成功: その場で squash merge してブランチを消す
 *   （Cloudflare Pages の結果は待たない。投稿フローと同じ本人決定）
 * - ci 成功で BEHIND: update-branch で main を取り込んで state "waiting"
 * - ci 失敗 / conflict / PR が閉じられた: state "failed"
 * - それ以外: state "waiting"
 * key は POST の返却したファイル名（<内容ハッシュ>.<ext>、移行前の
 * <uuid>.<ext> も受け付ける）。
 */
export async function mediaStatus(env, key) {
  const match = KEY_PATTERN.exec(String(key ?? ""));
  if (!match) {
    throw new MediaError("画像のキーが不正です。", 404);
  }
  const [, idPart, ext] = match;
  const name = `${idPart}.${ext}`;
  const path = `${MEDIA_DIR}/${name}`;
  const branch = `media/${idPart}`;
  const base = { url: `${SITE_ORIGIN}/media/${name}`, key: name, prUrl: "" };

  if (!env.GITHUB_TOKEN) {
    throw new MediaError(
      "GitHub トークン（GITHUB_TOKEN）が未設定のため、画像の状態を確認できません。",
      501
    );
  }

  const gh = createGitHubClient(env);
  try {
    const history = await gh.findPulls(branch);
    const candidate = history[0] ?? null;
    if (!candidate) {
      // PR が無い。merge 済みならファイルが main にあるはず。
      const onMain = await gh.getContent(path, "main");
      if (onMain) return { ...base, state: "merged" };
      return {
        ...base,
        state: "failed",
        message: "画像の PR が見つかりませんでした。再アップロードすると続きから進みます。"
      };
    }

    const pr = await gh.getPull(candidate.number);
    const prUrl = pr.html_url ?? candidate.html_url;
    const withPr = { ...base, prUrl };

    if (pr.merged) {
      await gh.deleteBranch(branch).catch(() => false);
      return { ...withPr, state: "merged" };
    }
    if (pr.state === "closed") {
      return {
        ...withPr,
        state: "failed",
        message:
          "画像の PR が merge されずに閉じられました。再アップロードすると、新しい PR で続きから進みます。"
      };
    }
    if (pr.mergeable === false && pr.mergeable_state === "dirty") {
      return {
        ...withPr,
        state: "failed",
        message: `画像の PR が main と conflict しています。PR で解消してから再アップロードしてください: ${prUrl}`
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

    // ci 成功。残っている作業はマージだけ。
    // mergeable が未確定（"unknown"）な間は publish 側と同様に1回取り直し、
    // それでも確定しなければ待ちにする（publish.mjs 側のコメント参照）。
    let settled = pr;
    if (settled.mergeable == null) {
      const refetched = await gh.getPull(pr.number).catch(() => null);
      if (refetched) settled = refetched;
    }
    if (settled.mergeable == null) {
      return { ...withPr, state: "waiting" };
    }
    if (settled.mergeable_state === "behind") {
      return takeInMain(gh, settled, withPr);
    }
    try {
      await gh.mergePull(pr.number, pr.title);
    } catch (error) {
      // マージ時点で状態が変わっていることがある。実状態を取り直して判断する。
      const after = await gh.getPull(pr.number).catch(() => null);
      if (after?.merged) {
        await gh.deleteBranch(branch).catch(() => false);
        return { ...withPr, state: "merged" };
      }
      if (after && after.mergeable_state === "behind") {
        return takeInMain(gh, after, withPr);
      }
      if (after && after.mergeable == null) {
        return { ...withPr, state: "waiting" };
      }
      if (after && after.mergeable === false && after.mergeable_state === "dirty") {
        return {
          ...withPr,
          state: "failed",
          message: `画像の PR が main と conflict しています。PR で解消してから再アップロードしてください: ${prUrl}`
        };
      }
      return {
        ...withPr,
        state: "failed",
        message: `画像の PR を merge できませんでした${error?.message ? `: ${error.message}` : ""}。再アップロードすると続きから進みます: ${prUrl}`
      };
    }
    await gh.deleteBranch(branch).catch(() => false);
    return { ...withPr, state: "merged" };
  } catch (error) {
    throw asMediaError(error);
  }
}

/** BEHIND の回復（media 版）。取り込めたら CI の再実行待ちとして返す。 */
async function takeInMain(gh, pr, withPr) {
  const result = await gh.updateBranch(pr.number);
  if (result.ok) {
    return {
      ...withPr,
      state: "waiting",
      note: "main の更新を取り込みました。CI の再実行を待っています…"
    };
  }
  const after = await gh.getPull(pr.number).catch(() => null);
  if (after && after.mergeable === false && after.mergeable_state === "dirty") {
    return {
      ...withPr,
      state: "failed",
      message: `main の取り込みで conflict しました。PR で解消してから再アップロードしてください: ${withPr.prUrl}`
    };
  }
  return {
    ...withPr,
    state: "failed",
    message: `main の取り込みに失敗しました${result.message ? `: ${result.message}` : ""}。再アップロードすると続きから進みます: ${withPr.prUrl}`
  };
}
