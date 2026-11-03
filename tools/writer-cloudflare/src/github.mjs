/**
 * 投稿フロー用の GitHub REST API クライアント。
 * ローカル版 publish.mjs が git / gh でやっていた操作の置き換え。
 * トークンは Worker の secret（GITHUB_TOKEN）から渡される想定で、
 * このモジュール自体は値を保持しない。
 */

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure"
]);
const OK_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Cloudflare Pages のチェック／ステータスを表示用の値に畳む（マージ条件には使わない）。 */
function pagesState(byName, statuses) {
  const run = [...byName.values()].find((entry) => /cloudflare/i.test(entry.name));
  if (run) {
    if (run.status !== "completed") return "pending";
    if (FAILED_CONCLUSIONS.has(run.conclusion)) return "failure";
    return OK_CONCLUSIONS.has(run.conclusion) ? "success" : "pending";
  }
  const status = statuses.find((entry) => /cloudflare/i.test(entry.context));
  if (!status) return "unknown";
  if (status.state === "success") return "success";
  if (status.state === "failure" || status.state === "error") return "failure";
  return "pending";
}

export function createGitHubClient(env) {
  const token = env.GITHUB_TOKEN ?? "";
  const owner = env.GITHUB_OWNER ?? "sayuyuyuyu";
  const repo = env.GITHUB_REPO ?? "slytxt-lab";

  async function api(pathname, { method = "GET", body } = {}) {
    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${owner}/${repo}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "slytxt-writer-cloudflare",
          "x-github-api-version": "2022-11-28"
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new GitHubError(`GitHub API へ接続できません: ${error.message}`);
    }
    const data = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, data };
  }

  async function must(pathname, options, label) {
    const result = await api(pathname, options);
    if (!result.ok) {
      const detail = result.data?.message ? `: ${result.data.message}` : "";
      throw new GitHubError(`${label}に失敗しました (${result.status})${detail}`, result.status);
    }
    return result.data;
  }

  return {
    /** main の先端コミット SHA。 */
    async getMainSha() {
      const data = await must("/git/ref/heads/main", {}, "main の取得");
      return data.object.sha;
    },

    async getBranch(branch) {
      const result = await api(`/git/ref/heads/${branch}`);
      return result.ok ? result.data : null;
    },

    async createBranch(branch, sha) {
      await must(
        "/git/refs",
        { method: "POST", body: { ref: `refs/heads/${branch}`, sha } },
        `ブランチ ${branch} の作成`
      );
    },

    async deleteBranch(branch) {
      const result = await api(`/git/refs/heads/${branch}`, { method: "DELETE" });
      return result.ok || result.status === 404 || result.status === 422;
    },

    /** ファイルの有無と、更新に要る blob SHA を返す。無ければ null。 */
    async getContent(filePath, ref) {
      const query = new URLSearchParams({ ref });
      const result = await api(`/contents/${filePath}?${query}`);
      if (result.status === 404) return null;
      if (!result.ok) {
        throw new GitHubError(
          `${filePath} の確認に失敗しました (${result.status})`,
          result.status
        );
      }
      return result.data;
    },

    async putContent({ path: filePath, content, message, branch, sha }) {
      const body = { message, content: encodeBase64(content), branch };
      if (sha) body.sha = sha;
      return must(`/contents/${filePath}`, { method: "PUT", body }, `${filePath} の書き込み`);
    },

    async createPull({ title, head, base, body }) {
      return must(
        "/pulls",
        { method: "POST", body: { title, head, base, body } },
        "PR の作成"
      );
    },

    async findOpenPull(branch) {
      const query = new URLSearchParams({ state: "open", head: `${owner}:${branch}` });
      const data = await must(`/pulls?${query}`, {}, "PR の検索");
      return Array.isArray(data) && data.length > 0 ? data[0] : null;
    },

    async getPull(number) {
      return must(`/pulls/${number}`, {}, `PR #${number} の取得`);
    },

    /**
     * head コミットに付いたチェックの総合判定。
     * 門番は CI（チェックラン名 ci）だけ（2026-11-04 本人決定）:
     * ci が成功すれば "success"、失敗すれば "failure"、未完了・未検出は
     * "pending"。Cloudflare Pages はマージ条件から外してあり、待たないし
     * 失敗してもブロックしない。状態は pages として返すだけ（表示用）。
     */
    async getChecks(sha) {
      const runsResult = await api(`/commits/${sha}/check-runs?per_page=100`);
      const runs = runsResult.ok ? (runsResult.data.check_runs ?? []) : [];
      const byName = new Map();
      for (const run of runs) {
        const prev = byName.get(run.name);
        if (!prev || String(run.started_at) > String(prev.started_at)) {
          byName.set(run.name, run);
        }
      }
      const statusResult = await api(`/commits/${sha}/status`);
      const statuses = statusResult.ok ? (statusResult.data.statuses ?? []) : [];

      const pages = pagesState(byName, statuses);

      const ci = byName.get("ci");
      if (!ci || ci.status !== "completed") return { state: "pending", pages };
      if (FAILED_CONCLUSIONS.has(ci.conclusion)) {
        return { state: "failure", message: "チェック ci が失敗しました", pages };
      }
      if (!OK_CONCLUSIONS.has(ci.conclusion)) return { state: "pending", pages };
      return { state: "success", pages };
    },

    async mergePull(number, title) {
      const result = await api(`/pulls/${number}/merge`, {
        method: "PUT",
        body: { merge_method: "squash", commit_title: title }
      });
      if (!result.ok || !result.data?.merged) {
        const detail = result.data?.message ? `: ${result.data.message}` : "";
        throw new GitHubError(
          `PR #${number} を merge できませんでした (${result.status})${detail}`,
          result.status
        );
      }
      return result.data;
    }
  };
}
