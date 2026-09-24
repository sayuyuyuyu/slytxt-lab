/** ブックマーク連携で使う型。Cloudflare の型定義に依存しないよう自前で持つ。 */

export type BookmarkAuthor = {
  id: string;
  username: string;
  name: string;
};

export type BookmarkItem = {
  id: string;
  text: string;
  createdAt: string;
  url: string;
  author: BookmarkAuthor;
};

/** KV に置く1日1回の取得結果。 */
export type BookmarkSnapshot = {
  /** 最後に取得できた時刻。 */
  updatedAt: string;
  /** 最後に取得を試みた時刻。失敗しても更新する。 */
  attemptedAt: string;
  items: BookmarkItem[];
  /** 最後の取得が失敗したときの理由。 */
  error?: string;
};

export type TokenSet = {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  userId: string;
};

/** Cloudflare KV のうち使う部分だけ。テストでは差し替える。 */
export type KeyValueStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export type PagesEnv = {
  BOOKMARKS: KeyValueStore;
  BOOKMARKS_SECRET?: string;
  BOOKMARKS_ADMIN_TOKEN?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
};

export type PagesContext<Env> = {
  request: Request;
  params: Record<string, string | string[]>;
  env: Env;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
};

export type PagesFunction<Env> = (context: PagesContext<Env>) => Response | Promise<Response>;
