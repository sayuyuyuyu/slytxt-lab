/** ブックマーク連携で使う型。Cloudflare の型定義に依存しないよう自前で持つ。 */

export type BookmarkAuthor = {
  id: string;
  username: string;
  name: string;
  /** プロフィール画像の URL。取得できなければ未設定。 */
  avatar?: string;
};

export type BookmarkMedia = {
  kind: "photo" | "video" | "gif";
  /** photo は画像そのもの、video / gif はプレビュー画像。 */
  image?: string;
  /** video / gif の再生用 mp4。取れなければ未設定で、プレビュー画像から投稿へ誘導する。 */
  videoUrl?: string;
  width?: number;
  height?: number;
  /** X が付けた代替テキスト。無ければ未設定で、表示側が本文から補う。 */
  alt?: string;
};

export type BookmarkItem = {
  id: string;
  text: string;
  createdAt: string;
  url: string;
  author: BookmarkAuthor;
  /** 投稿に付いた画像・動画。無ければ未設定。 */
  media?: BookmarkMedia[];
};

/** 取得失敗の種別。auth は X の再認可が必要な可能性が高い。 */
export type BookmarkErrorKind = "auth" | "temporary";

/** KV に置く1日1回の取得結果。 */
export type BookmarkSnapshot = {
  /** 最後に取得できた時刻。 */
  updatedAt: string;
  /** 最後に取得を試みた時刻。失敗しても更新する。 */
  attemptedAt: string;
  items: BookmarkItem[];
  /** 最後の取得が失敗したときの理由。 */
  error?: string;
  /** 最後の取得が失敗したときの種別。 */
  errorKind?: BookmarkErrorKind;
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
