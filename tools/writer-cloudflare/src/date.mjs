/**
 * 日付ユーティリティ。
 * 投稿日の生成に使う today を提供する。
 */

export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now);
}
