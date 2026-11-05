/**
 * 投稿の「見届け」をサーバー側で駆動する（Cron Triggers から毎分呼ばれる）。
 *
 * 背景: publishStatus は GitHub の実状態から現在フェーズを
 * 判定する冪等な確認で、merge と後片付けも担う。以前はそれを駆動するのが
 * ブラウザのポーリングだけだったため、投稿後にタブを閉じると CI が通っても
 * merge されず PR が open のまま残った。ここで Worker の scheduled から
 * 定期的に同じ確認を回し、タブを閉じても公開が最後まで完了するようにする。
 * ブラウザのポーリングは従来どおり残る（開いている間の速報用。どちらが
 * 先に merge しても、冪等な確認同士なので競合しない）。
 * 画像メディアは R2 保存（media.mjs）になり PR を使わないため、
 * 見届けの対象は投稿だけになった。
 *
 * 結果の通知: 公開が完了すると後片付けで下書き自体が消えるため、再訪時に
 * 「公開されたのか分からない」状態になる。そこで merged / failed の結果を
 * KV に publish-result:<下書きID> として残し（7日で失効）、UI が起動時に
 * 取得して知らせる。同じ下書き・同じ PR の結果は1スロットに上書きされる
 * ので、tick のたびに増え続けることはない。表示したかどうかの管理は
 * UI 側（localStorage）で行う。
 */
import { createDraftStore } from "./drafts-kv.mjs";
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
 * 保留中の投稿を1ステップずつ進める。scheduled ハンドラから呼ばれる。
 * 個別の失敗は握って次の tick で再試行する（publishStatus が
 * 冪等なので、途中からやり直しても同じ結果に収束する）。
 */
export async function drivePendingPublishes(env) {
  const store = createDraftStore(env.DRAFTS);

  const drafts = await store.listDrafts().catch((error) => {
    console.error(`driver: listDrafts failed: ${error?.message ?? error}`);
    return [];
  });
  console.log(
    `driver: tick drafts=${drafts.length} withPr=${drafts.filter((d) => d.pr).length}`
  );
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
}
