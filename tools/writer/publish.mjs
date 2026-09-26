/**
 * 下書きを整形して、ブランチ・コミット・push・Pull Request まで通す。
 * 直接 main へは push しない。作業ツリーが汚れているときは何もせず止まる。
 */
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentError, runAgent, stripCodeFence } from "./agent.mjs";
import { historyDir, readDraft, repoRoot, snapshotDraft, writeDraft } from "./drafts.mjs";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.mjs";
import { plainText } from "./markdown.mjs";
import { polishPrompt, today } from "./prompt.mjs";

export class PublishError extends Error {}

/** 一覧に出す説明。エージェントに書かせず、本文の書き出しから最小限だけ作る。 */
export function deriveDescription(body, limit = 90) {
  const text = plainText(String(body ?? "")).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function run(command, args, { cwd = repoRoot, onLog = () => {}, allowFailure = false, timeoutMs = 10 * 60 * 1000 } = {}) {
  onLog(`$ ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new PublishError(`${command} を実行できません: ${error.message}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) if (line.trim()) onLog(line.trim());
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new PublishError(`${command} を実行できません: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !allowFailure) {
        reject(
          new PublishError(
            `${command} ${args.join(" ")} が終了コード ${code} で失敗しました\n${(stderr || stdout).slice(-3000)}`
          )
        );
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
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

function requireField(data, key) {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PublishError(`エージェントの出力に ${key} がありません`);
  }
  return value.trim();
}

async function savePolished(draftId, document) {
  await mkdir(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(historyDir, `${draftId}.${stamp}.polished.md`);
  await writeFile(target, document, "utf8");
  return target;
}

export async function publishDraft({ id, onLog = () => {} }) {
  const draft = await readDraft(id);
  if (!draft.body.trim()) throw new PublishError("本文が空です。何か書いてから流してください。");

  const originalBranch = (
    await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { onLog })
  ).stdout.trim();
  if (originalBranch === "HEAD") throw new PublishError("detached HEAD では実行できません。");

  const dirty = (await run("git", ["status", "--porcelain"], { onLog })).stdout.trim();
  if (dirty) {
    throw new PublishError(
      `コミットされていない変更があります。先に片付けてから実行してください。\n${dirty}`
    );
  }

  await run("git", ["fetch", "origin", "main"], { onLog });
  const base = (await run("git", ["rev-parse", "origin/main"], { onLog })).stdout.trim();

  onLog("整形中…（エージェントの応答を待っています）");
  const { stdout } = await runAgent({ prompt: await polishPrompt(draft), onLog });
  const document = stripCodeFence(stdout);
  const polishedPath = await savePolished(id, document);
  const shown = path.relative(repoRoot, polishedPath);
  onLog(`整形結果を保存しました: ${shown.startsWith("..") ? polishedPath : shown}`);

  const { data, body, hasFrontmatter } = parseFrontmatter(document);
  if (!hasFrontmatter) throw new PublishError("出力に frontmatter がありません。");
  const title = requireField(data, "title");
  const provided = typeof data.description === "string" ? data.description.trim() : "";
  const description = provided || deriveDescription(body) || title;
  const published = String(data.published ?? "").trim() || today();
  const tags = (Array.isArray(data.tags) ? data.tags : []).map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6);
  const slug = draft.slug || normalizeSlug(data.slug, published.replace(/-/g, ""));
  const category = draft.category;
  const relativeFile = path.join("src", "content", category, `${slug}.md`);
  const absoluteFile = path.join(repoRoot, relativeFile);

  const branch = `write/${slug}`;

  // 一度出した PR をもう一度流したときは、同じブランチに積んで PR を更新する。
  // 誤字を直したいだけのときに、新しい PR を立てずに済む。
  const updating = Boolean(draft.pr && draft.slug);
  if (updating) {
    await run("git", ["fetch", "origin", branch], { onLog });
    const remote = await run("git", ["rev-parse", "--verify", `origin/${branch}`], {
      onLog,
      allowFailure: true
    });
    if (remote.code !== 0) {
      throw new PublishError(
        `${branch} がリモートにありません。PR ${draft.pr} を閉じてから、もう一度出し直してください。`
      );
    }
    const local = await run("git", ["rev-parse", "--verify", branch], { allowFailure: true });
    if (local.code === 0) {
      const ahead = (
        await run("git", ["log", "--oneline", `origin/${branch}..${branch}`], { allowFailure: true })
      ).stdout.trim();
      if (ahead) {
        throw new PublishError(
          `${branch} に push していないコミットがあります。先に片付けてください。\n${ahead}`
        );
      }
    }
  } else {
    if (await stat(absoluteFile).catch(() => null)) {
      throw new PublishError(`${relativeFile} は既にあります。slug を変えてください。`);
    }
    const existingBranch = (await run("git", ["branch", "--list", branch], { onLog })).stdout.trim();
    if (existingBranch) throw new PublishError(`ブランチ ${branch} が既にあります。`);
  }

  await snapshotDraft(id, updating ? "republish" : "publish");
  const startPoint = updating ? `origin/${branch}` : base;
  // -C は既存のローカルブランチをリモートに合わせ直す。
  // 前回の実行で残っているブランチをそのまま使うため。
  await run("git", ["switch", "-C", branch, startPoint], { onLog });
  onLog(
    updating
      ? `ブランチ ${branch} に積みます（${draft.pr} を更新）`
      : `ブランチ ${branch} を作成しました（origin/main から）`
  );

  let committed = false;
  try {
    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(
      absoluteFile,
      stringifyFrontmatter({ title, description, published, tags }, body),
      "utf8"
    );
    onLog(`書き出しました: ${relativeFile}`);

    await run("git", ["add", relativeFile], { onLog });

    if (process.env.SLYTXT_SKIP_CHECK !== "1") {
      onLog("型チェック中…");
      await run("pnpm", ["run", "check"], { onLog });
    }

    const changed = (await run("git", ["status", "--porcelain"], { onLog })).stdout.trim();
    if (!changed) {
      await run("git", ["switch", originalBranch], { onLog });
      onLog("内容に変更がありませんでした。PR はそのままです。");
      return { branch, file: relativeFile, prUrl: draft.pr, slug, title, updated: false };
    }

    await run("git", ["commit", "-m", updating ? `post: ${title} を修正` : `post: ${title}`], { onLog });
    committed = true;
    await run("git", ["push", "-u", "origin", branch], { onLog });

    if (updating) {
      await writeDraft(id, { status: "published", title, tags, pr: draft.pr, slug });
      await run("git", ["switch", originalBranch], { onLog });
      return { branch, file: relativeFile, prUrl: draft.pr, slug, title, updated: true };
    }

    const prBody = [
      "## 概要",
      "",
      description,
      "",
      "## 変更",
      "",
      `- \`${relativeFile.replace(/\\/g, "/")}\` を追加`,
      "",
      `カテゴリ: ${category} / タグ: ${tags.length ? tags.join(", ") : "なし"}`,
      "",
      "<details>",
      "<summary>元のメモ</summary>",
      "",
      "````text",
      draft.body.trim().slice(0, 4000),
      "````",
      "",
      "</details>",
      "",
      "---",
      "",
      "執筆ツール（`tools/writer`）から作成。"
    ].join("\n");

    const pr = await run(
      "gh",
      ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", prBody],
      { onLog }
    );
    const prUrl = pr.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("http")) ?? "";

    await writeDraft(id, { status: "published", title, tags, pr: prUrl, slug });
    await run("git", ["switch", originalBranch], { onLog });

    return { branch, file: relativeFile, prUrl, slug, title, updated: false };
  } catch (error) {
    if (!committed) {
      onLog("失敗したのでブランチを元に戻します");
      await run("git", ["reset"], { onLog, allowFailure: true });
      await rm(absoluteFile, { force: true });
      await run("git", ["switch", originalBranch], { onLog, allowFailure: true });
      await run("git", ["branch", "-D", branch], { onLog, allowFailure: true });
    } else {
      onLog(`コミットは ${branch} に残っています。手動で push してください。`);
    }
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const id = process.argv[2];
  if (!id) {
    console.error("使い方: node tools/writer/publish.mjs <ドラフト名>");
    process.exit(1);
  }
  try {
    const result = await publishDraft({ id, onLog: (line) => console.log(line) });
    console.log(`\n完了: ${result.prUrl || result.branch}`);
  } catch (error) {
    console.error(`\n失敗: ${error instanceof AgentError || error instanceof PublishError ? error.message : error}`);
    process.exit(1);
  }
}
