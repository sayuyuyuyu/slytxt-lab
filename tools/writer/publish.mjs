/**
 * ドラフトを公開まで一度に通す。
 * 誤字だけエージェントに直させ、あとは機械的にファイル化して、
 * ブランチ・コミット・push・Pull Request・CI待ち・merge まで実行する。
 * 直接 main へは push しない。作業ツリーが汚れているときは何もせず止まる。
 */
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentError, runAgent, stripCodeFence } from "./agent.mjs";
import { deleteDraft, readDraft, repoRoot } from "./drafts.mjs";
import { stringifyFrontmatter } from "./frontmatter.mjs";
import { plainText } from "./markdown.mjs";
import { fixPrompt, today } from "./prompt.mjs";

export class PublishError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 一覧に出す説明。エージェントに書かせず、本文の書き出しから最小限だけ作る。 */
export function deriveDescription(body, limit = 90) {
  const withoutHeadings = String(body ?? "").replace(/^\s{0,3}#{1,6}\s+.*$/gm, "");
  const text = plainText(withoutHeadings).replace(/\s+/g, " ").trim();
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

/** タイトルが無いドラフトは、本文の書き出しをタイトルにする。 */
function deriveTitle(draft, body) {
  if (draft.title && draft.title !== "無題") return draft.title;
  const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
  const text = plainText(firstLine).replace(/\s+/g, " ").trim();
  return (text || "無題").slice(0, 40);
}

export async function publishPost({ id, onLog = () => {} }) {
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

  onLog("誤字を確認しています…");
  const { stdout } = await runAgent({ prompt: fixPrompt(draft), onLog });
  const body = stripCodeFence(stdout).trim();
  if (!body) throw new PublishError("誤字チェックの出力が空でした。");

  const title = deriveTitle(draft, body);
  const description = deriveDescription(body) || title;
  const tags = draft.tags.slice(0, 6);
  const published = today();
  const slug = normalizeSlug(draft.id, published.replace(/-/g, "")) || draft.id;
  const note = draft.category === "notes";
  const relativeFile = path.join("src", "content", draft.category, `${slug}.md`);
  const absoluteFile = path.join(repoRoot, relativeFile);
  const branch = `${note ? "note" : "write"}/${slug}`;

  if (await stat(absoluteFile).catch(() => null)) {
    throw new PublishError(`${relativeFile} は既にあります。`);
  }

  await run("git", ["switch", "-C", branch, base], { onLog });
  onLog(`ブランチ ${branch} を作成しました`);

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

    await run("git", ["commit", "-m", `${note ? "note" : "post"}: ${title}`], { onLog });
    committed = true;
    await run("git", ["push", "-u", "origin", branch], { onLog });

    const pr = await run(
      "gh",
      ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", "執筆ツール（tools/writer）から投稿。"],
      { onLog }
    );
    const prUrl =
      pr.stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("http")) ?? "";

    onLog("CI を待っています…");
    const deadline = Date.now() + 12 * 60 * 1000;
    let ready = false;
    while (Date.now() < deadline) {
      const view = await run(
        "gh",
        ["pr", "view", prUrl, "--json", "state,mergeStateStatus", "--jq", '.state + " " + .mergeStateStatus'],
        { onLog, allowFailure: true }
      );
      const [prState, mergeState] = view.stdout.trim().split(/\s+/);
      if (prState === "MERGED") {
        ready = true;
        break;
      }
      if (mergeState === "CLEAN") {
        ready = true;
        break;
      }
      if (mergeState === "DIRTY") throw new PublishError(`PR が conflict しています: ${prUrl}`);
      if (mergeState === "UNSTABLE") throw new PublishError(`CI が失敗しました: ${prUrl}`);
      await sleep(8000);
    }
    if (!ready) throw new PublishError(`CI が終わりませんでした。PR を確認してください: ${prUrl}`);

    await run("gh", ["pr", "merge", prUrl, "--squash", "--delete-branch"], { onLog, allowFailure: true });
    const merged = await run("gh", ["pr", "view", prUrl, "--json", "state", "--jq", ".state"], {
      onLog,
      allowFailure: true
    });
    if (merged.stdout.trim() !== "MERGED") {
      throw new PublishError(
        `merge できませんでした。PR を確認してください: ${prUrl}\n${(merged.stderr || merged.stdout).slice(-2000)}`
      );
    }

    await run("git", ["switch", originalBranch], { onLog });
    await run("git", ["branch", "-D", branch], { onLog, allowFailure: true });
    await deleteDraft(id);
    return { branch, file: relativeFile, prUrl, slug, title, merged: true };
  } catch (error) {
    if (!committed) {
      onLog("失敗したのでブランチを元に戻します");
      await run("git", ["reset"], { onLog, allowFailure: true });
      await rm(absoluteFile, { force: true });
      await run("git", ["branch", "-D", branch], { onLog, allowFailure: true });
    }
    await run("git", ["switch", originalBranch], { onLog, allowFailure: true });
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
    const result = await publishPost({ id, onLog: (line) => console.log(line) });
    console.log(`\n完了: ${result.prUrl || result.branch}`);
  } catch (error) {
    console.error(`\n失敗: ${error instanceof AgentError || error instanceof PublishError ? error.message : error}`);
    process.exit(1);
  }
}
