# 短文フィード（D1）

記事コレクション（`src/content/`、PR 経由）とは別の、短文を置くレーンです。投稿は Git ではなく Cloudflare D1 に保存し、公開一覧（`/feed/`）は Pages Functions が D1 を読んで HTML を組み立てます。

| 役割 | 場所 |
| --- | --- |
| テーブル定義 | `db/feed/0001_init.sql` |
| 読み取り（型・SQL・HTML）と投稿 API の処理 | `src/lib/feed/` |
| 公開一覧 `GET /feed/` | `functions/feed/index.ts` → `src/lib/feed/page.ts` |
| ページの外枠 | `src/pages/feed/index.astro`（静的ビルド） |
| 投稿画面（PWA）と投稿 API | `tools/feed-cloudflare/` |
| 本文のスタイル | `src/styles/global.css` の `.feed-*` |

## 公開ページの組み立て

`/feed/` は静的ではなく、Pages Functions が返します。

1. Astro が `/feed/index.html` を書き出す。この HTML がヘッダー・フッター・CSS 込みの外枠になる。
2. 関数が `env.ASSETS.fetch("/feed/index.html")` で雛形を読み、`<!--feed:start-->` と `<!--feed:end-->` の間を D1 から読んだ一覧で置き換える。
3. 目印が消えると一覧が出なくなるので、`scripts/check-build.mjs` が2つの目印の存在を検証する。

ページ送りは `?before=<ISO 8601>` のカーソル方式です（JS 不要）。

## 準備（初回だけ）

D1 データベースを作り、テーブルを適用します。データベース ID は控えておきます。

```sh
npx wrangler d1 create slytxt-feed
npx wrangler d1 execute slytxt-feed --remote --file db/feed/0001_init.sql
```

Pages プロジェクト（slytxt.dev）に D1 バインディングを追加します。Git 連携でデプロイしているため、Cloudflare のダッシュボードで **Settings → Bindings → Add → D1 database** を開き、変数名 `FEED`、データベース `slytxt-feed` を選びます（Production と Preview の両方）。バインディングが無い場合、`/feed/` は空の一覧を返します。バインディングはあるがテーブルが無い場合は、空の一覧に見せかけず 503 と理由を返します（設定の誤りに気づけるように）。

## ローカルで動かす

`wrangler pages dev` は D1 もローカルで動かせます。

```sh
# ローカルの D1 にテーブルを作る（--local。初回と変更時だけ）
npx wrangler d1 execute slytxt-feed --local --config db/feed/wrangler.local.toml \
  --file db/feed/0001_init.sql

pnpm build
npx wrangler pages dev dist --persist-to db/feed/.wrangler/state \
  --d1=FEED=00000000-0000-0000-0000-000000000000
```

`--d1` には `wranger.local.toml` のダミー ID を渡す（名前で指定すると別のローカル DB が割り当てられ、`no such table` になる）。

投稿が無いと空状態が出ます。確認用の1件は次のように入れられます。

```sh
npx wrangler d1 execute slytxt-feed --local --config db/feed/wrangler.local.toml \
  --command "INSERT INTO feed_posts (id, body, created_at, images, link) VALUES ('01JC0000000000000000000001', '動作確認の投稿です。', '2026-11-16T09:00:00.000Z', '[]', NULL)"
```

## データの形

`feed_posts` の1行が1投稿です。

- `body` … プレーンテキスト。改行は表示に残し、URL は自動でリンクにする（Markdown は使わない）。
- `images` … `[{"key","alt","width","height"}]`。実体は R2 `slytxt-writer-media` の `pub/` に置き、`https://media.slytxt.dev/<key>` で配信する。`alt` は投稿時に必ず入れる。
- `link` … 投稿本文の最初の URL について、投稿時に取得した OGP（`url` / `title` / `description` / `image` / `site`）。取得できなければ `null`。
- `deleted_at` … 論理削除。公開側は `deleted_at IS NULL` だけを読む。

R2 のキーは media Worker が受け付ける形式（32桁の hex か UUID ＋ 拡張子）に合わせる。画像の alt は D1 側に持つので、media Worker に変更は要らない。
