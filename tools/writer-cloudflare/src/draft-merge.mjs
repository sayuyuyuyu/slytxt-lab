/**
 * 端末コピー（localStorage）とサーバー側の下書きを突き合わせる判断。
 *
 * DOM にも fetch にも触らない純関数だけを置き、UI 本体（ui/app.js）から
 * import する。判断そのものを tests/ から直接確かめられるようにするため
 * （#771 / #788 の再現と修正確認を、ブラウザを立てずに行えるようにする）。
 */

/** 保存内容の比較。キー順は collect() が固定しているので JSON で足りる。 */
export function samePayload(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** サーバーから読んだ下書きを、collect() と同じ形の payload にする。 */
export function payloadOf(draft) {
  return {
    category: draft.category,
    title: draft.title && draft.title !== "無題" ? draft.title.trim() : "",
    tags: [...(draft.tags ?? [])],
    cover: draft.cover ?? "",
    description: String(draft.description ?? "").trim(),
    body: draft.body ?? ""
  };
}

/** タイトル・本文・カバー・タグ・説明がすべて空の端末コピーか。 */
export function isEmptyPayload(payload) {
  if (!payload) return true;
  return !(
    String(payload.title ?? "").trim() ||
    String(payload.body ?? "").trim() ||
    String(payload.cover ?? "").trim() ||
    String(payload.description ?? "").trim() ||
    (payload.tags ?? []).length
  );
}

/**
 * 端末コピーをどう扱うか決める。
 *
 * - `useLocal`: 端末コピーの内容を画面に出す
 * - `removeLocal`: そのコピーを片付ける（同じ内容、空のコピー、負けたコピー）
 * - `backupLocal`: 負けたコピーを退避キーへ残す（黙って消さない）
 *
 * 中身のある下書きに対して空の端末コピーが勝つと、空の編集画面になり、
 * さらに自動保存でサーバー側まで空になる（#788）。
 */
export function resolveLocalRestore({ serverDraft, local }) {
  if (!local) return { useLocal: false, removeLocal: false, backupLocal: false };
  if (samePayload(local.payload, payloadOf(serverDraft))) {
    return { useLocal: false, removeLocal: true, backupLocal: false };
  }
  if (isEmptyPayload(local.payload) && !isEmptyPayload(payloadOf(serverDraft))) {
    return { useLocal: false, removeLocal: true, backupLocal: false };
  }
  const localIsNewer =
    local.base === serverDraft.updated ||
    String(local.savedAt ?? "") > String(serverDraft.updated ?? "");
  if (localIsNewer) return { useLocal: true, removeLocal: false, backupLocal: false };
  return { useLocal: false, removeLocal: true, backupLocal: true };
}

/**
 * 保存で送る cover を決める。
 *
 * 見出し画像を外す操作をしていないのに空なら、サーバーに残っている値を送る。
 * 読み込み直しなどでクライアント側だけカバーを失ったときに、PUT でサーバー側
 * まで消さないため（#814）。
 */
export function resolveCoverForSave({ cover, coverRemoved, knownCover }) {
  if (cover) return cover;
  if (coverRemoved) return "";
  return knownCover || "";
}
