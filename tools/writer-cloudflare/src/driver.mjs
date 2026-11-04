/**
 * 投稿・画像の「見届け」をサーバー側で駆動する（Cron Triggers から毎分呼ばれる）。
 *
 * 背景: publishStatus / mediaStatus は GitHub の実状態から現在フェーズを
 * 判定する冪等な確認で、merge と後片付けも担う。以前はそれを駆動するのが
 * ブラウザのポーリングだけだったため、投稿後にタブを閉じると CI が通っても
 * merge されず PR が open のまま残った。ここで Worker の scheduled から
 * 定期的に同じ確認を回し、タブを閉じても公開が最後まで完了するようにする。
 * ブラウザのポーリングは従来どおり残る（開いている間の速報用。どちらが
 * 先に merge しても、冪等な確認同士なので競合しない）。
 *
 * 結果の通知: 公開が完了すると後片付けで下書き自体が消えるため、再訪時に
 * 「公開されたのか分からない」状態になる。そこで merged / failed の結果を
 * KV に publish-result:<下書きID> として残し（7日で失効）、UI が起動時に
 * 取得して知らせる。同じ下書き・同じ PR の結果は1スロットに上書きされる
 * ので、tick のたびに増え続けることはない。表示したかどうかの管理は
 * UI 側（localStorage）で行う。
 */
import { createDraftStore } from "./drafts-kv.mjs";
import { createGitHubClient } from "./github.mjs";
import { mediaStatus } from "./media.mjs";
import { publishStatus } from "./publish.mjs";

const RESULT_PREFIX = "publish-result:";
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 1回の tick で進める件数の上限（Workers の実行時間に収める）。 */
const MAX_PER_TICK = 10;

async function recordResult(env, draft, result) {
  const record = {
    id: draft.id,
    title: result.title || draft.title || "",
    state: result.state,
    url: result.url ?? "",
    prUrl: result.prUrl ?? "",
    message: result.message ?? "",
    at: new Date().toISOString()
  };
  await env.DRAFTS.put(`${RESULT_PREFIX}${draft.id}`, JSON.stringify(record), {
    expirationTtl: RESULT_TTL_SECONDS
  }).catch(() => {});
}

/** UI 起動時に返す、未失効の公開結果の一覧（新しい順）。 */
export async function listPublishResults(env) {
  const results = [];
  let cursor = undefined;
  for (;;) {
    const page = await env.DRAFTS.list({ prefix: RESULT_PREFIX, cursor });
    for (const entry of page.keys) {
      const raw = await env.DRAFTS.get(entry.name).catch(() => null);
      if (!raw) continue;
      try {
        results.push(JSON.parse(raw));
      } catch {
        // 壊れたレコードは落とす。
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return results.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * 保留中の投稿と画像を1ステップずつ進める。scheduled ハンドラから呼ばれる。
 * 個別の失敗は握って次の tick で再試行する（publishStatus / mediaStatus が
 * 冪等なので、途中からやり直しても同じ結果に収束する）。
 */
export async function drivePendingPublishes(env) {
  const store = createDraftStore(env.DRAFTS);

  const drafts = await store.listDrafts().catch(() => []);
  let driven = 0;
  for (const draft of drafts) {
    if (driven >= MAX_PER_TICK) break;
    if (!draft.pr) continue;
    driven += 1;
    try {
      const result = await publishStatus({ env, store, id: draft.id });
      // 見届けの成否は Workers のログで追えるようにする（以前は例外を
      // 握り潰すだけで、本番で何が起きているか分からなかった）。
      console.log(`driver: publish ${draft.id} -> ${result.state}`);
      if (result.state === "merged" || result.state === "failed") {
        await recordResult(env, draft, result);
      }
    } catch (error) {
      console.error(`driver: publish ${draft.id} failed: ${error?.message ?? error}`);
      // 次の tick で再試行する。
    }
  }

  // 画像 PR（media/*）も同じ見届けに乗せる。キーは PR の変更ファイル
  // （public/media/<ファイル名>）から復元する。
  if (!env.GITHUB_TOKEN) return;
  const gh = createGitHubClient(env);
  const pulls = await gh.listOpenPulls().catch(() => []);
  let media = 0;
  for (const pr of pulls) {
    if (media >= MAX_PER_TICK) break;
    if (!pr.head?.ref?.startsWith("media/")) continue;
    media += 1;
    try {
      const files = await gh.getPullFiles(pr.number);
      const file = files.find((entry) => entry.filename?.startsWith("public/media/"));
      if (file) {
        const result = await mediaStatus(env, file.filename.split("/").pop());
        console.log(`driver: media ${pr.head.ref} -> ${result.state}`);
      }
    } catch (error) {
      console.error(`driver: media ${pr.head.ref} failed: ${error?.message ?? error}`);
      // 次の tick で再試行する。
    }
  }
}
