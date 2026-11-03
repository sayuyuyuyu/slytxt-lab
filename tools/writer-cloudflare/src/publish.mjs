/**
 * ドラフトを PR 作成まで一度に通す（Cloudflare 版）。
 *
 * ローカル版 publish.mjs との違い:
 * - git / pnpm / gh の spawn を GitHub REST API に置き換えた。
 * - ローカル check は持たず、PR の CI を門番にする（設計書 2.5）。
 * - CI 待ちと merge は publishStatus 側に分けた。投稿リクエストは
 *   PR 作成までで返り、UI が GET /api/publish/:id/status を叩いて
 *   merge と後片付けを完了させる（設計書 2.4）。
 * - CI 失敗後に本文を直して再投稿すると、既存ブランチのファイルを
 *   更新して同じ PR で CI を回し直す。
 */
import { stringifyFrontmatter } from "../../writer/frontmatter.mjs";
import { plainText } from "../../writer/markdown.mjs";
import { today } from "../../writer/prompt.mjs";
import { GitHubError, createGitHubClient } from "./github.mjs";

export class PublishError extends Error {}

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
  return { slug, file: `src/content/${draft.category}/${slug}.md` };
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
  const tags = draft.tags.slice(0, 6);
  const published = today();
  const slug = normalizeSlug(draft.id, published.replace(/-/g, "")) || draft.id;
  const note = draft.category === "notes";
  const file = `src/content/${draft.category}/${slug}.md`;
  const branch = `${note ? "note" : "write"}/${slug}`;
  const content = stringifyFrontmatter({ title, description, published, tags }, body);
  const commitMessage = `${note ? "note" : "post"}: ${title}`;

  const gh = createGitHubClient(env);

  // 再投稿: 同じブランチの open PR が残っていたら、ファイルを更新して
  // 同じ PR で CI を回し直す。
  const existingPr = await gh.findOpenPull(branch);
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
    return { branch, file, prUrl: existingPr.html_url, slug, title, state: "waiting" };
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
    body: "執筆ツール（tools/writer）から投稿。"
  });
  onLog(`PR を作成しました: ${pr.html_url}`);
  onLog("CI の完了待ちです。このまま画面を開いておくと merge まで進みます。");

  await store.writeDraft(id, { pr: pr.html_url });
  return { branch, file, prUrl: pr.html_url, slug, title, state: "waiting" };
}

/**
 * PR の状態を見て、済んでいれば片付ける。
 * - merged: ブランチと下書きを消して state "merged"
 * - ci が成功: その場で squash merge して片付け、state "merged"
 *   （Cloudflare Pages の結果は待たない。2026-11-04 本人決定）
 * - ci 失敗 / conflict / PR が閉じられた: state "failed"
 * - それ以外: state "waiting"
 * 下書きに pr が無ければ state "idle"。
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
  const { slug, file } = publishTarget(draft);
  const base = { prUrl: draft.pr || "", file, slug, title: draft.title };

  if (!draft.pr) return { ...base, state: "idle" };

  const number = Number(draft.pr.match(/\/pull\/(\d+)/)?.[1]);
  if (!number) {
    return { ...base, state: "failed", message: "下書きに残っている PR の URL を読めませんでした" };
  }

  const gh = createGitHubClient(env);
  const pr = await gh.getPull(number);
  const prUrl = pr.html_url ?? draft.pr;
  const withPr = { ...base, prUrl, title: pr.title ?? base.title };

  const cleanup = async () => {
    await gh.deleteBranch(pr.head.ref).catch(() => false);
    await store.deleteDraft(id);
  };

  if (pr.merged) {
    await cleanup();
    return { ...withPr, state: "merged", merged: true };
  }
  if (pr.state === "closed") {
    return { ...withPr, state: "failed", message: "PR が merge されずに閉じられました" };
  }
  if (pr.mergeable === false && pr.mergeable_state === "dirty") {
    return { ...withPr, state: "failed", message: `PR が conflict しています: ${prUrl}` };
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

  await gh.mergePull(number, pr.title ?? base.title);
  await cleanup();
  return { ...withPr, state: "merged", merged: true };
}
