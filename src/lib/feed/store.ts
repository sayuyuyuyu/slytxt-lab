/**
 * 短文フィードの読み書き。SQL はここに閉じ込め、行とドメイン型の対応も
 * このファイルで行う（表示側は FeedPost だけを知っていればよい）。
 */
import type { FeedDatabase, FeedImage, FeedLink, FeedPost, FeedRow } from "./types.ts";

/** 一覧の並びは投稿時刻の降順。同時刻は ID の降順で安定させる。 */
const LIST_SQL = `SELECT id, body, created_at, images, link
FROM feed_posts
WHERE deleted_at IS NULL
  AND (?1 IS NULL OR created_at < ?1)
ORDER BY created_at DESC, id DESC
LIMIT ?2`;

function parseImages(raw: string): FeedImage[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.key === "string")
      .map((item) => ({
        key: item.key,
        alt: typeof item.alt === "string" ? item.alt : "",
        ...(Number.isFinite(item.width) ? { width: item.width } : {}),
        ...(Number.isFinite(item.height) ? { height: item.height } : {})
      }));
  } catch {
    return [];
  }
}

function parseLink(raw: string | null): FeedLink | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.url !== "string") return undefined;
    return {
      url: parsed.url,
      ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
      ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
      ...(typeof parsed.image === "string" ? { image: parsed.image } : {}),
      ...(typeof parsed.site === "string" ? { site: parsed.site } : {})
    };
  } catch {
    return undefined;
  }
}

/** D1 の行を表示用の型に変える。壊れた JSON は空として扱い、一覧を止めない。 */
export function rowToPost(row: FeedRow): FeedPost {
  const link = parseLink(row.link);
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    images: parseImages(row.images),
    ...(link ? { link } : {})
  };
}

export type ListOptions = {
  /** これより前（古い）の投稿だけを返す。?before= のカーソル。 */
  before?: string | null;
  limit?: number;
};

/** 「次がある」を判定するため、limit より1件多く読む。 */
export async function listFeedPosts(
  db: FeedDatabase,
  { before = null, limit }: ListOptions = {}
): Promise<FeedPost[]> {
  const size = limit ?? 20;
  const { results } = await db
    .prepare(LIST_SQL)
    .bind(before, size + 1)
    .all<FeedRow>();
  return (results ?? []).map(rowToPost);
}

/** 一覧の1ページ分と、次ページのカーソルを返す。 */
export async function readFeedPage(
  db: FeedDatabase | undefined,
  options: ListOptions = {}
): Promise<{ posts: FeedPost[]; nextBefore: string | null }> {
  if (!db) return { posts: [], nextBefore: null };
  const rows = await listFeedPosts(db, options);
  const size = options.limit ?? 20;
  const posts = rows.slice(0, size);
  const nextBefore = rows.length > size ? posts[posts.length - 1].createdAt : null;
  return { posts, nextBefore };
}

/**
 * 投稿を論理削除する。画像は R2 に残るので、実体の削除は手で行う
 * （tools/feed-cloudflare/README.md の手順）。公開一覧からは即座に消える。
 */
export async function deleteFeedPost(db: FeedDatabase, id: string, at: string): Promise<boolean> {
  const result = (await db
    .prepare(
      `UPDATE feed_posts SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`
    )
    .bind(id, at)
    .run()) as { meta?: { changes?: number } } | undefined;
  const changes = result?.meta?.changes;
  // D1 は changes を返すが、返さない実装（テストの代返など）では true 扱いにする。
  return changes === undefined ? true : changes > 0;
}

/** 投稿を1件作る（投稿用 Worker から使う）。 */
export async function createFeedPost(
  db: FeedDatabase,
  post: FeedPost
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO feed_posts (id, body, created_at, images, link)
VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(
      post.id,
      post.body,
      post.createdAt,
      JSON.stringify(post.images),
      post.link ? JSON.stringify(post.link) : null
    )
    .run();
}
