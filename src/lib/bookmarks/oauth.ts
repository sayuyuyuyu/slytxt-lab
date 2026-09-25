import { base64Url, randomToken } from "./secret.ts";
import type { TokenSet } from "./types.ts";

const API = "https://api.x.com";
const AUTHORIZE = "https://x.com/i/oauth2/authorize";

export const SCOPES = ["tweet.read", "users.read", "bookmark.read", "offline.access"] as const;

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(digest) };
}

export function authorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: SCOPES.join(" "),
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256"
  });
  return `${AUTHORIZE}?${params}`;
}

function basicAuth(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** 認可コードをトークンに交換する。 */
export async function exchangeCode(options: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  verifier: string;
  fetch: typeof fetch;
  now: () => number;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    code_verifier: options.verifier
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (options.clientSecret) {
    headers.Authorization = basicAuth(options.clientId, options.clientSecret);
  }

  const response = await options.fetch(`${API}/2/oauth2/token`, {
    method: "POST",
    headers,
    body
  });
  if (!response.ok) {
    throw new Error(`トークンを取得できませんでした (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    refreshToken: payload.refresh_token ?? "",
    accessToken: payload.access_token,
    expiresAt: options.now() + (payload.expires_in ?? 7200) * 1000,
    userId: ""
  };
}

/** 認可した本人の ID を引く。ブックマークの取得に使う。 */
export async function fetchUserId(
  fetchImpl: typeof fetch,
  accessToken: string
): Promise<string> {
  const response = await fetchImpl(`${API}/2/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`ユーザーを取得できませんでした (${response.status})`);
  }
  const payload = (await response.json()) as { data?: { id?: string } };
  if (!payload.data?.id) throw new Error("ユーザー ID を取得できませんでした");
  return payload.data.id;
}
