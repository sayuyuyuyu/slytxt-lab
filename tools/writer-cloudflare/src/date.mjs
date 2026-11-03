/**
 * 日付ユーティリティ。
 * 旧ローカル版 prompt.mjs から、投稿日の生成に使う today だけを引き継いだ
 * （誤字チェック用プロンプトは、誤字チェック pass の廃止に伴い削除した）。
 */

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
