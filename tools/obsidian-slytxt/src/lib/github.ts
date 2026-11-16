/**
 * GitHub API 経由で公開 PR を作る。Obsidian の CORS 制約を避けるため、
 * HTTP は呼び出し側が渡す（アプリでは obsidian の requestUrl を使う）。
 * この分離で、通信の手順をテストから検証できる。
 */
import { branchName, contentPath, publicUrl, type PublishCategory } from "./slug.ts";

export type GitHubSettings = {
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
};

export type GitHubResponse = {
  status: number;
  json: unknown;
  text?: string;
};

/** requestUrl 相当（Obsidian では requestUrl を渡す）。 */
export type GitHubRequest = (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<GitHubResponse>;

export class PublishError extends Error {}

export type PublishInput = {
  category: PublishCategory;
  slug: string;
  title: string;
  content: string;
  prBody?: string;
};

export type PublishResult = {
  branch: string;
  path: string;
  prUrl: string;
  prNumber: number;
  url: string;
};

/** UTF-8 の文字列を base64 にする（btoa は ASCII しか扱えないため自前で変換）。 */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function apiUrl(settings: GitHubSettings, path: string): string {
  return `https://api.github.com/repos/${settings.owner}/${settings.repo}${path}`;
}

function headers(settings: GitHubSettings): Record<string, string> {
  return {
    authorization: `Bearer ${settings.token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28"
  };
}

async function call(
  request: GitHubRequest,
  settings: GitHubSettings,
  method: string,
  path: string,
  body?: unknown
): Promise<GitHubResponse> {
  return request({
    url: apiUrl(settings, path),
    method,
    headers: headers(settings),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function messageOf(response: GitHubResponse): string {
  const payload = response.json as { message?: string } | null;
  return payload?.message ?? response.text?.slice(0, 200) ?? `HTTP ${response.status}`;
}

/** 公開まわりの手順。ブランチを切り、ファイルを書き、PR を開く。 */
export async function publishNote(
  request: GitHubRequest,
  settings: GitHubSettings,
  input: PublishInput
): Promise<PublishResult> {
  const branch = branchName(input.category, input.slug);
  const path = contentPath(input.category, input.slug);

  const base = await call(request, settings, "GET", `/git/ref/heads/${settings.baseBranch}`);
  if (base.status === 404) {
    throw new PublishError(`ベースブランチ ${settings.baseBranch} が見つかりません。`);
  }
  if (base.status !== 200) throw new PublishError(`ブランチを読めませんでした: ${messageOf(base)}`);
  const baseSha = (base.json as { object?: { sha?: string } })?.object?.sha;
  if (!baseSha) throw new PublishError(`ブランチ ${settings.baseBranch} の SHA を読めませんでした。`);

  const created = await call(request, settings, "POST", "/git/refs", {
    ref: `refs/heads/${branch}`,
    sha: baseSha
  });
  if (created.status !== 201) {
    if (created.status === 422) {
      throw new PublishError(`ブランチ ${branch} は既にあります。PR を確認してください。`);
    }
    throw new PublishError(`ブランチを作れませんでした: ${messageOf(created)}`);
  }

  const put = await call(request, settings, "PUT", `/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    message: `post: ${input.title || input.slug}`,
    content: toBase64(input.content),
    branch
  });
  if (put.status !== 201 && put.status !== 200) {
    throw new PublishError(`ファイルを書けませんでした: ${messageOf(put)}`);
  }

  const pr = await call(request, settings, "POST", "/pulls", {
    title: input.title || input.slug,
    head: branch,
    base: settings.baseBranch,
    body: input.prBody ?? "執筆ツール（Obsidian）から投稿。"
  });
  if (pr.status !== 201) throw new PublishError(`PR を作れませんでした: ${messageOf(pr)}`);
  const prJson = pr.json as { html_url?: string; number?: number };
  return {
    branch,
    path,
    prUrl: prJson.html_url ?? "",
    prNumber: prJson.number ?? 0,
    url: publicUrl(input.category, input.slug)
  };
}
