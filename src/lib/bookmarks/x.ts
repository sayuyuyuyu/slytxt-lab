import type { BookmarkAuthor, KeyValueStore, TokenSet } from "./types.ts";

const API = "https://api.x.com";
export const TOKEN_KEY = "token";

export class XApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.body = body;
  }
}

type RawPost = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  note_tweet?: { text?: string };
};

export type BookmarkPost = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
};

export type XClientOptions = {
  clientId: string;
  clientSecret?: string;
  fetch: typeof fetch;
  now: () => number;
};

export type XClient = {
  /** 現在の access token。期限切れなら更新する。 */
  accessToken(): Promise<string>;
  /** 先頭から最大 max 件のブックマーク。 */
  bookmarks(max: number): Promise<BookmarkPost[]>;
  /** 投稿者を引く。未知の ID だけ渡す。 */
  authors(ids: string[]): Promise<BookmarkAuthor[]>;
};

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readTokens(store: KeyValueStore): Promise<TokenSet | null> {
  const raw = await store.get(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

export function createXClient(store: KeyValueStore, options: XClientOptions): XClient {
  const { clientId, clientSecret, fetch, now } = options;

  async function refresh(current: TokenSet): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: clientId
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded"
    };
    if (clientSecret) headers.Authorization = `Basic ${base64(`${clientId}:${clientSecret}`)}`;

    const response = await fetch(`${API}/2/oauth2/token`, { method: "POST", headers, body });
    if (!response.ok) {
      throw new XApiError(
        response.status,
        await response.text(),
        "トークンを更新できませんでした。Xでの再認可が必要かもしれません。"
      );
    }
    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      refreshToken: payload.refresh_token ?? current.refreshToken,
      accessToken: payload.access_token,
      expiresAt: now() + (payload.expires_in ?? 7200) * 1000,
      userId: current.userId
    };
  }

  async function accessToken(): Promise<string> {
    const current = await readTokens(store);
    if (!current) throw new XApiError(0, "", "まだXと接続していません。");
    if (current.accessToken && current.expiresAt > now() + 60_000) return current.accessToken;

    try {
      const next = await refresh(current);
      await store.put(TOKEN_KEY, JSON.stringify(next));
      return next.accessToken;
    } catch (error) {
      // 同時に走った別の実行が先に更新した場合は、その結果を使う。
      const latest = await readTokens(store);
      if (
        latest &&
        latest.accessToken !== current.accessToken &&
        latest.expiresAt > now() + 60_000
      ) {
        return latest.accessToken;
      }
      throw error;
    }
  }

  async function request<T>(path: string): Promise<T> {
    const token = await accessToken();
    const response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new XApiError(response.status, await response.text(), `X API が ${response.status} を返しました。`);
    }
    return (await response.json()) as T;
  }

  return {
    accessToken,

    async bookmarks(max) {
      const tokens = await readTokens(store);
      if (!tokens?.userId) throw new XApiError(0, "", "まだXと接続していません。");

      const params = new URLSearchParams({
        max_results: String(max),
        "tweet.fields": "created_at,author_id,note_tweet"
      });
      const payload = await request<{ data?: RawPost[] }>(
        `/2/users/${tokens.userId}/bookmarks?${params}`
      );
      const posts = payload.data ?? [];

      return posts
        .filter((post) => post.author_id)
        .map((post) => ({
          id: post.id,
          text: post.note_tweet?.text ?? post.text,
          createdAt: post.created_at ?? new Date(now()).toISOString(),
          authorId: post.author_id as string
        }));
    },

    async authors(ids) {
      if (ids.length === 0) return [];
      const params = new URLSearchParams({
        ids: ids.slice(0, 100).join(","),
        "user.fields": "username,name,profile_image_url"
      });
      const payload = await request<{
        data?: { id: string; username?: string; name?: string; profile_image_url?: string }[];
      }>(`/2/users?${params}`);

      return (payload.data ?? []).map((user) => ({
        id: user.id,
        username: user.username ?? "",
        name: user.name ?? "",
        avatar: user.profile_image_url
      }));
    }
  };
}
