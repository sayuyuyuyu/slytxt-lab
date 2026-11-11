/**
 * 公開済み記事を writer で開くための読み込み導線（ギャップ分析 G10 の残り）。
 *
 * 公開済み記事の正は GitHub の main にある src/content/<カテゴリ>/<slug>.md。
 * - 一覧: カテゴリごとのディレクトリを Contents API で辿り、各ファイルの
 *   frontmatter から表示用の情報を作る。対応する下書き（同じカテゴリで、
 *   下書き ID を正規化すると slug になるもの）があれば、その ID も返す。
 * - 開く: 対応する下書きがあればそれを開き、無ければ記事の中身を下書き
 *   として KV に取り込む。下書き ID は slug そのものにする（publish 側は
 *   下書き ID から投稿先ファイルを決めるため、再投稿は PR #616 の再編集
 *   フロー＝更新 PR・公開日の元日付引き継ぎに乗る）。
 * - 記事の frontmatter のうち下書きが管理しないキー（published 等）は、
 *   下書きの extras としてそのまま保持される（drafts-kv の carriedLines）。
 *   公開日そのものは再投稿時に publish 側が公開済みファイルから引き継ぐ。
 *   それ以外のキー（adult など）は再投稿時に更新 PR へそのまま書き戻す。
 */
import { parseFrontmatter } from "./frontmatter.mjs";
import { plainText, truncateText } from "./markdown.mjs";
import { createGitHubClient } from "./github.mjs";
import { PublishError, decodeContentText, normalizeSlug, publicUrl } from "./publish.mjs";
import { CATEGORIES, assertId } from "./drafts-kv.mjs";

function requireGitHub(env) {
  if (!env.GITHUB_TOKEN) {
    throw new PublishError(
      "GITHUB_TOKEN が未設定です。wrangler secret put GITHUB_TOKEN で登録してください。"
    );
  }
  return createGitHubClient(env);
}

/** 下書き一覧から「カテゴリ:slug → 下書きID」の対応を作る。 */
function draftIdByArticle(drafts) {
  const map = new Map();
  for (const draft of drafts) {
    const key = `${draft.category}:${normalizeSlug(draft.id)}`;
    if (!map.has(key)) map.set(key, draft.id);
  }
  return map;
}

/**
 * 公開済み記事の一覧（サイト側で下書きフラグの付いたものは除く）。
 * 表示に必要な情報だけを返し、本文そのものは含めない。
 */
export async function listPublished({ env, store }) {
  const gh = requireGitHub(env);
  const drafts = await store.listDrafts().catch(() => []);
  const byArticle = draftIdByArticle(drafts);
  const articles = [];
  for (const category of CATEGORIES) {
    const entries = await gh.getContent(`src/content/${category}`, "main");
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.type !== "file" || !entry.name?.endsWith(".md")) continue;
      const slug = entry.name.slice(0, -".md".length);
      const file = await gh.getContent(entry.path, "main").catch(() => null);
      const text = file ? decodeContentText(file) : null;
      if (text == null) continue;
      const { data, body } = parseFrontmatter(text);
      if (data.draft === true) continue;
      const draftId = byArticle.get(`${category}:${slug}`) ?? null;
      articles.push({
        category,
        slug,
        url: publicUrl(category, slug),
        title: typeof data.title === "string" ? data.title : "",
        published: typeof data.published === "string" ? data.published : "",
        excerpt: truncateText(plainText(body), 120),
        hasDraft: draftId != null,
        draftId
      });
    }
  }
  // 新しい公開日のものから並べる。同日はカテゴリと slug で安定させる。
  articles.sort(
    (a, b) =>
      String(b.published).localeCompare(String(a.published)) ||
      `${a.category}/${a.slug}`.localeCompare(`${b.category}/${b.slug}`)
  );
  return articles;
}

/**
 * 公開済み記事を下書きとして開く。
 * 対応する下書きが既にあれば作り直さずそれを返し（created: false）、
 * 無ければ記事を取り込んで下書きを作る（created: true）。
 */
export async function openPublished({ env, store, category, slug }) {
  if (!CATEGORIES.includes(category)) {
    throw new PublishError(`カテゴリが不正です: ${category}`);
  }
  try {
    assertId(slug);
  } catch {
    throw new PublishError(`記事の指定が不正です: ${slug}`);
  }

  const drafts = await store.listDrafts().catch(() => []);
  const existing = drafts.find(
    (draft) => draft.category === category && normalizeSlug(draft.id) === slug
  );
  if (existing) {
    return { draft: await store.readDraft(existing.id), created: false };
  }
  // 同じ ID の下書きが別カテゴリで既にある場合は、二重に作らずそれを開く
  // （下書き ID が投稿先を決めるため、別 ID で作ると別記事になってしまう）。
  const sameId = await store.readDraft(slug).catch(() => null);
  if (sameId) return { draft: sameId, created: false };

  const gh = requireGitHub(env);
  const file = await gh.getContent(`src/content/${category}/${slug}.md`, "main");
  if (!file) {
    throw new PublishError("公開済み記事が見つかりませんでした。");
  }
  const text = decodeContentText(file);
  if (text == null) {
    throw new PublishError("公開済み記事の内容を取得できませんでした。");
  }
  const { data, body, raw } = parseFrontmatter(text);
  if (data.draft === true) {
    throw new PublishError("この記事は公開されていないため、ここからは開けません。");
  }
  const draft = await store.importDraft(
    slug,
    {
      title: typeof data.title === "string" ? data.title : "",
      description: typeof data.description === "string" ? data.description : "",
      category,
      tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag)) : [],
      cover: typeof data.cover === "string" ? data.cover : ""
    },
    body,
    raw
  );
  return { draft, created: true };
}
