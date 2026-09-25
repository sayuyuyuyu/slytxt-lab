import { authorizeUrl, createPkce } from "../../../src/lib/bookmarks/oauth.ts";
import { matchesSecret, randomToken } from "../../../src/lib/bookmarks/secret.ts";
import type { PagesEnv, PagesFunction } from "../../../src/lib/bookmarks/types.ts";

const STATE_KEY = "oauth:";

/** 認可を始める。合言葉が無いと URL を返さない。 */
export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const key = url.searchParams.get("key") ?? context.request.headers.get("x-admin-token");
  if (!matchesSecret(key ?? undefined, context.env.BOOKMARKS_ADMIN_TOKEN)) {
    return new Response("Not Found", { status: 404 });
  }
  if (!context.env.X_CLIENT_ID) {
    return new Response("X_CLIENT_ID が設定されていません", { status: 500 });
  }

  const state = randomToken(16);
  const { verifier, challenge } = await createPkce();
  await context.env.BOOKMARKS.put(`${STATE_KEY}${state}`, verifier, { expirationTtl: 600 });

  const redirectUri = new URL("/api/bookmarks/callback", url.origin).href;
  return Response.redirect(
    authorizeUrl({
      clientId: context.env.X_CLIENT_ID,
      redirectUri,
      state,
      challenge
    }),
    302
  );
};
