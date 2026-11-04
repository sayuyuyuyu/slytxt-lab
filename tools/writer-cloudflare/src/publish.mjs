/**
 * ドラフトを PR 作成まで一度に通す。
 *
 * - 投稿は GitHub REST API で行う（git / pnpm / gh の spawn はしない）。
 * - ローカル check は持たず、PR の CI を門番にする（設計書 2.5）。
 * - CI 待ちと merge は publishStatus 側に分けた。投稿リクエストは
 *   PR 作成までで返り、UI が GET /api/publish/:id/status を叩いて
 *   merge と後片付けを完了させる（設計書 2.4）。
 * - CI 失敗後に本文を直して再投稿すると、既存ブランチのファイルを
 *   更新して同じ PR で CI を回し直す。
 * - 冪等性: 投稿 PR の同一性は「下書き ID から決まるブランチ名」で担保する。
 *   再実行・再試行はまずブランチから PR の実状態を引き、既存があれば
 *   続きから進める（新規作成は既存が無い場合だけ）。公開済みだった場合は
 *   成功として収束させる。詳細は publishStatus 側のコメントを参照。
 */
import { stringifyFrontmatter } from "./frontmatter.mjs";
import { plainText } from "./markdown.mjs";
import { today } from "./date.mjs";
import { GitHubError, createGitHubClient } from "./github.mjs";

export class PublishError extends Error {}

const SITE_ORIGIN = "https://slytxt.dev";

/** サイト側の公開パス（src/lib/content.ts の ARTICLE_BASE と対応）。 */
const PUBLIC_BASE = {
  tech: "articles/tech",
  journal: "articles/journal",
  notes: "notes"
};

/** 投稿が公開される URL。想定外のカテゴリなら空文字を返す。 */
export function publicUrl(category, slug) {
  const base = PUBLIC_BASE[category];
  return base ? `${SITE_ORIGIN}/${base}/${slug}/` : "";
}

/** 一覧に出す説明。エージェントに書かせず、本文の書き出しから最小限だけ作る。 */
export function deriveDescription(body, limit = 90) {
  const withoutHeadings = String(body ?? "").replace(/^\s{0,3}#{1,6}\s+.*$/gm, "");
  const text = plainText(withoutHeadings).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function normalizeSlug(raw, fallbackDate = today()) {
  const cleaned = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return cleaned || `post-${fallbackDate.replace(/-/g, "")}`;
}

/** タイトルが無いドラフトは、本文の書き出しをタイトルにする。 */
function deriveTitle(draft, body) {
  if (draft.title && draft.title !== "無題") return draft.title;
  const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
  const text = plainText(firstLine).replace(/\s+/g, " ").trim();
  return (text || "無題").slice(0, 40);
}

function publishTarget(draft) {
  const slug = normalizeSlug(draft.id) || draft.id;
  return {
    slug,
    file: `src/content/${draft.category}/${slug}.md`,
    url: publicUrl(draft.category, slug)
  };
}

function asPublishError(error) {
  if (error instanceof PublishError) return error;
  if (error instanceof GitHubError) {
    return new PublishError(error.message);
  }
  return error;
}

export async function publishPost({ env, store, id, onLog = () => {} }) {
  try {
    return await publishPostInner({ env, store, id, onLog });
  } catch (error) {
    throw asPublishError(error);
  }
}

async function publishPostInner({ env, store, id, onLog }) {
  if (!env.GITHUB_TOKEN) {
    throw new PublishError(
      "GITHUB_TOKEN が未設定です。wrangler secret put GITHUB_TOKEN で登録してください。"
    );
  }
  const draft = await store.readDraft(id);
  if (!draft.body.trim()) {
    throw new PublishError("本文が空です。何か書いてから流してください。");
  }

  // 誤字チェック pass は 2026-11-04 に廃止。本文をそのまま投稿する。
  const body = draft.body.trim();

  const title = deriveTitle(draft, body);
  const description = deriveDescription(body) || title;
  // タグの上限は note に合わせて10件（公開パネルの UI と揃える）。
  const tags = draft.tags.slice(0, 10);
  const published = today();
  const slug = normalizeSlug(draft.id, published.replace(/-/g, "")) || draft.id;
  const note = draft.category === "notes";
  const file = `src/content/${draft.category}/${slug}.md`;
  const branch = `${note ? "note" : "write"}/${slug}`;
  const content = stringifyFrontmatter(
    { title, description, published, tags, cover: draft.cover || undefined },
    body
  );
  const commitMessage = `${note ? "note" : "post"}: ${title}`;

  const gh = createGitHubClient(env);

  // この下書きの PR はブランチ名で一意に引ける。再実行時はまず実状態を
  // 確認し、既に公開まで終わっていたら成功として収束させる（前回の実行が
  // 後片付けの前に落ちていた場合）。
  const history = await gh.findPulls(branch);
  const latest = history[0] ?? null;
  if (latest && latest.state === "closed") {
    const detail = await gh.getPull(latest.number).catch(() => null);
    if (detail?.merged && (await gh.getContent(file, "main"))) {
      onLog("この下書きは既に公開されています。後片付けだけ行います。");
      await gh.deleteBranch(branch).catch(() => false);
      await store.deleteDraft(id);
      return {
        branch,
        file,
        prUrl: latest.html_url,
        url: publicUrl(draft.category, slug),
        slug,
        title,
        state: "merged",
        merged: true
      };
    }
    // merge 済みなのにファイルが main に無い（手で消された等）、または
    // merge されず閉じられた場合は、通常フローで作り直す（残ったブランチは
    // 下の処理で消してから作り直す）。
  }

  // 再投稿: 同じブランチの open PR が残っていたら、ファイルを更新して
  // 同じ PR で CI を回し直す。
  const existingPr = history.find((entry) => entry.state === "open") ?? null;
  if (existingPr) {
    onLog(`既存の PR を更新します: ${existingPr.html_url}`);
    const current = await gh.getContent(file, branch);
    await gh.putContent({
      path: file,
      content,
      message: commitMessage,
      branch,
      sha: current?.sha
    });
    onLog(`書き出しました: ${file}`);
    await store.writeDraft(id, { pr: existingPr.html_url });
    return {
      branch,
      file,
      prUrl: existingPr.html_url,
      url: publicUrl(draft.category, slug),
      slug,
      title,
      state: "waiting"
    };
  }

  if (await gh.getContent(file, "main")) {
    throw new PublishError(`${file} は既にあります。`);
  }

  const mainSha = await gh.getMainSha();
  if (await gh.getBranch(branch)) {
    // PR の無い残りブランチは作り直す。
    onLog(`残っていたブランチ ${branch} を消して作り直します`);
    await gh.deleteBranch(branch);
  }
  await gh.createBranch(branch, mainSha);
  onLog(`ブランチ ${branch} を作成しました`);

  await gh.putContent({ path: file, content, message: commitMessage, branch });
  onLog(`書き出しました: ${file}`);

  const pr = await gh.createPull({
    title,
    head: branch,
    base: "main",
    body: "執筆ツール（write.slytxt.dev）から投稿。"
  });
  onLog(`PR を作成しました: ${pr.html_url}`);
  onLog("CI の完了待ちです。このまま画面を開いておくと merge まで進みます。");

  await store.writeDraft(id, { pr: pr.html_url });
  return {
    branch,
    file,
    prUrl: pr.html_url,
    url: publicUrl(draft.category, slug),
    slug,
    title,
    state: "waiting"
  };
}

/**
 * 公開の現在フェーズを GitHub 側の実状態から判定し、次に必要な操作だけを行う。
 * 冪等化の中心: 下書きの PR はブランチ名で一意に引けるため、この確認が
 * どの状態から呼ばれても同じ結果に収束する（Worker のリクエストが落ちても、
 * 画面を再読み込みしても、公開を再実行してもよい）。
 * - PR が特定できない: state "idle"
 * - merged: ブランチと下書きを消して state "merged"（再マージは試みない）
 * - closed（未 merge）: state "failed"（再実行で新しい PR を作り直す）
 * - conflict（dirty）: state "failed"
 * - ci 失敗: state "failed"（再実行で同じ PR の CI を回し直す）
 * - ci 待ち: state "waiting"
 * - ci 成功で BEHIND: update-branch で main を取り込んで state "waiting"。
 *   取り込みは1回の確認につき1回だけ行い、新しい head での判定は次の
 *   ポーリングに委ねる（この関数の中でループはしない）
 * - ci 成功でマージ可能: その場で squash merge して片付け、state "merged"
 *   （Cloudflare Pages の結果は待たない。2026-11-04 本人決定）
 */
export async function publishStatus({ env, store, id }) {
  try {
    return await publishStatusInner({ env, store, id });
  } catch (error) {
    throw asPublishError(error);
  }
}

async function publishStatusInner({ env, store, id }) {
  const draft = await store.readDraft(id);
  const { slug, file, url } = publishTarget(draft);
  const branch = `${draft.category === "notes" ? "note" : "write"}/${slug}`;
  const base = { prUrl: draft.pr || "", file, slug, url, title: draft.title };

  const gh = createGitHubClient(env);

  // PR の特定: 下書きに残る URL が第一情報。無い・読めない場合はブランチから
  // 探して引き継ぐ（PR 作成直後に Worker が落ちて URL を保存できなかった
  // 場合でも、次回の確認で同じ PR に収束する）。
  let pr = null;
  const recorded = Number(draft.pr.match(/\/pull\/(\d+)/)?.[1]);
  if (draft.pr && recorded) {
    pr = await gh.getPull(recorded);
  } else {
    const history = await gh.findPulls(branch);
    const candidate = history[0] ?? null;
    if (candidate) {
      pr = await gh.getPull(candidate.number);
      await store.writeDraft(id, { pr: pr.html_url });
    }
  }
  if (!pr) return { ...base, state: "idle" };

  const prUrl = pr.html_url ?? draft.pr;
  const withPr = { ...base, prUrl, title: pr.title ?? base.title };

  const cleanup = async () => {
    await gh.deleteBranch(pr.head.ref).catch(() => false);
    await store.deleteDraft(id);
  };

  const conflicted = {
    ...withPr,
    state: "failed",
    message: `PR が main と conflict しています。PR で解消してから、再度「公開」を押してください: ${prUrl}`
  };

  if (pr.merged) {
    await cleanup();
    return { ...withPr, state: "merged", merged: true };
  }
  if (pr.state === "closed") {
    return {
      ...withPr,
      state: "failed",
      message:
        "PR が merge されずに閉じられました。再度「公開」を押すと、新しい PR を作って投稿し直します。"
    };
  }
  if (pr.mergeable === false && pr.mergeable_state === "dirty") {
    return conflicted;
  }

  const checks = await gh.getChecks(pr.head.sha);
  if (checks.state === "failure") {
    return {
      ...withPr,
      state: "failed",
      message: `${checks.message ?? "CI が失敗しました"}。本文を直して再度「公開」を押すと、同じ PR で CI を回し直します: ${prUrl}`
    };
  }
  if (checks.state === "pending") {
    return { ...withPr, state: "waiting" };
  }

  // ci 成功。残っている作業はマージだけ。
  if (pr.mergeable_state === "behind") {
    return takeInMain(gh, pr, withPr);
  }
  try {
    await gh.mergePull(pr.number, pr.title ?? base.title);
  } catch (error) {
    // マージを試みた時点で状態が変わっていることがある（main が進んで
    // BEHIND になった等）。実状態を取り直してから判断し直す。
    const after = await gh.getPull(pr.number).catch(() => null);
    if (after?.merged) {
      await cleanup();
      return { ...withPr, state: "merged", merged: true };
    }
    if (after && after.mergeable_state === "behind") {
      return takeInMain(gh, after, withPr);
    }
    if (after && after.mergeable === false && after.mergeable_state === "dirty") {
      return conflicted;
    }
    throw error;
  }
  await cleanup();
  return { ...withPr, state: "merged", merged: true };
}

/**
 * BEHIND の回復: main をブランチへ取り込み、CI の再実行待ちとして返す。
 * 取り込み自体が conflict した場合は、理由と次の手が分かる形で failed を返す。
 */
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
      message: `main の取り込みで conflict しました。PR で解消してから、再度「公開」を押してください: ${withPr.prUrl}`
    };
  }
  return {
    ...withPr,
    state: "failed",
    message: `main の取り込みに失敗しました${result.message ? `: ${result.message}` : ""}。再度「公開」を押すと続きから進みます: ${withPr.prUrl}`
  };
}
