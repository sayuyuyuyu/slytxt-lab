/**
 * 日付ユーティリティ。
 * 投稿日の生成に使う today を提供する。
 */

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
