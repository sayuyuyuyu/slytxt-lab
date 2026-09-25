import type {
  BookmarkAuthor,
  BookmarkItem,
  BookmarkSnapshot,
  KeyValueStore
} from "./types.ts";
import type { XClient } from "./x.ts";

export const SNAPSHOT_KEY = "snapshot";
export const AUTHORS_KEY = "authors";
export const LOCK_KEY = "refresh-lock";

/** 取得時刻の記録が古い投稿者から落とす上限。 */
const AUTHOR_CACHE_LIMIT = 1000;

type CachedAuthor = BookmarkAuthor & { seenAt: string };

export type RefreshPolicy = {
  /** 失敗直後の再試行を抑える分数。 */
  retryMinutes: number;
};

/** boundary をまたいでいれば取り直す。失敗した内容は同じ日でも再試行し、叩きすぎは retryMinutes で抑える。 */
export function shouldRefresh(
  snapshot: BookmarkSnapshot | null,
  now: Date,
  boundary: Date,
  policy: RefreshPolicy
): boolean {
  if (!snapshot) return true;
  const attempted = new Date(snapshot.attemptedAt).getTime();
  if (Number.isNaN(attempted)) return true;
  if (now.getTime() - attempted < policy.retryMinutes * 60_000) return false;
  // 前回が失敗なら、同じ日でも取り直して直り次第反映する。
  if (snapshot.error) return true;
  return attempted < boundary.getTime();
}

export function postUrl(author: BookmarkAuthor, id: string): string {
  return author.username
    ? `https://x.com/${author.username}/status/${id}`
    : `https://x.com/i/status/${id}`;
}

async function readJson<T>(store: KeyValueStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readAuthorCache(store: KeyValueStore): Promise<Record<string, CachedAuthor>> {
  return (await readJson<Record<string, CachedAuthor>>(store, AUTHORS_KEY)) ?? {};
}

function pruneAuthors(authors: Record<string, CachedAuthor>): Record<string, CachedAuthor> {
  const entries = Object.entries(authors);
  if (entries.length <= AUTHOR_CACHE_LIMIT) return authors;

  entries.sort((a, b) => b[1].seenAt.localeCompare(a[1].seenAt));
  return Object.fromEntries(entries.slice(0, AUTHOR_CACHE_LIMIT));
}

export type FeedDeps = {
  store: KeyValueStore;
  x: XClient;
  now: Date;
  boundary: Date;
  count: number;
  policy: RefreshPolicy;
};

export async function readSnapshot(store: KeyValueStore): Promise<BookmarkSnapshot | null> {
  return readJson<BookmarkSnapshot>(store, SNAPSHOT_KEY);
}

/** 投稿者を引いてから、表示する並びを組み立てる。 */
async function buildItems(deps: FeedDeps, posts: Awaited<ReturnType<XClient["bookmarks"]>>) {
  const store = deps.store;
  const authors = await readAuthorCache(store);
  const missing = [...new Set(posts.map((post) => post.authorId))].filter((id) => !authors[id]);

  if (missing.length > 0) {
    // 投稿者が引けなくても、その投稿だけ落として続ける。
    const fetched = await deps.x.authors(missing).catch(() => [] as BookmarkAuthor[]);
    for (const author of fetched) {
      authors[author.id] = { ...author, seenAt: deps.now.toISOString() };
    }
    await store.put(AUTHORS_KEY, JSON.stringify(pruneAuthors(authors)));
  }

  const items: BookmarkItem[] = [];
  for (const post of posts) {
    const author = authors[post.authorId] ?? {
      id: post.authorId,
      username: "",
      name: "不明なアカウント"
    };
    items.push({
      id: post.id,
      text: post.text,
      createdAt: post.createdAt,
      url: postUrl(author, post.id),
      author
    });
  }
  return items;
}

/** X から取り直して KV を更新する。失敗しても既存の内容は壊さない。 */
export async function refreshSnapshot(deps: FeedDeps): Promise<BookmarkSnapshot> {
  const previous = await readSnapshot(deps.store);
  const attemptedAt = deps.now.toISOString();

  try {
    const posts = await deps.x.bookmarks(deps.count);
    const snapshot: BookmarkSnapshot = {
      updatedAt: attemptedAt,
      attemptedAt,
      items: await buildItems(deps, posts)
    };
    await deps.store.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch (error) {
    const snapshot: BookmarkSnapshot = {
      updatedAt: previous?.updatedAt ?? attemptedAt,
      attemptedAt,
      items: previous?.items ?? [],
      error: error instanceof Error ? error.message : "取得に失敗しました。"
    };
    await deps.store.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  }
}

/** KV ベースの best effort な排他。取れなければ null を返す。 */
async function withLock<T>(store: KeyValueStore, run: () => Promise<T>): Promise<T | null> {
  if ((await store.get(LOCK_KEY)) !== null) return null;
  await store.put(LOCK_KEY, "1", { expirationTtl: 60 });
  try {
    return await run();
  } finally {
    await store.delete(LOCK_KEY);
  }
}

/** 必要なら取得し直してから、表示に使う内容を返す。 */
export async function readFeed(
  deps: FeedDeps
): Promise<{ snapshot: BookmarkSnapshot | null; refreshed: boolean }> {
  const current = await readSnapshot(deps.store);
  if (!shouldRefresh(current, deps.now, deps.boundary, deps.policy)) {
    return { snapshot: current, refreshed: false };
  }

  const refreshed = await withLock(deps.store, () => refreshSnapshot(deps));
  if (refreshed) return { snapshot: refreshed, refreshed: true };

  // 別のリクエストが更新中。いまある内容をそのまま返す。
  return { snapshot: await readSnapshot(deps.store), refreshed: false };
}
