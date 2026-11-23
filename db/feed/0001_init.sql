-- 短文フィードの投稿。記事コレクション（src/content/）とは別レーンで、
-- Git ではなく D1 に置く。公開側（slytxt.dev/feed/）は Pages Functions が
-- このテーブルを読んで HTML を組み立てる。
--
--   npx wrangler d1 create slytxt-feed
--   npx wrangler d1 execute slytxt-feed --remote --file db/feed/0001_init.sql
--
-- 適用先を間違えないよう、ローカルで試すときは --local を付ける。
CREATE TABLE IF NOT EXISTS feed_posts (
  -- 並びとカーソルに使うので、時刻を含む ID（ULID 風の 26 文字）を入れる。
  id TEXT PRIMARY KEY,
  -- 投稿本文。プレーンテキスト（URL は表示時にリンクにする）。
  body TEXT NOT NULL,
  -- 投稿時刻。ISO 8601（UTC）。並び順と ?before= のカーソルに使う。
  created_at TEXT NOT NULL,
  -- 添付画像。[{"key":"<R2 のキー>","alt":"代替テキスト","width":1280,"height":720}]
  -- R2 は slytxt-writer-media の pub/ に置き、media.slytxt.dev から配信する。
  images TEXT NOT NULL DEFAULT '[]',
  -- リンクカード。{"url":"…","title":"…","description":"…","image":"…","site":"…"} の
  -- 単一オブジェクト（配列ではない）。投稿時にサーバー側で OGP を取得して入れる。
  -- 取得できなければ null。
  link TEXT,
  -- 削除は論理削除。公開側は deleted_at IS NULL だけを読む。
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS feed_posts_created_at ON feed_posts (created_at DESC, id DESC);
