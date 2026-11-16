# 短文フィード投稿（feed.slytxt.dev）

短文フィードの投稿画面（PWA）と投稿 API です。公開一覧はサイト側（`slytxt.dev/feed/`、`functions/feed/index.ts`）が同じ D1 を読んで返します。データの形とテーブルは `db/feed/` を見てください。

| パス | 内容 |
| --- | --- |
| `/` | 投稿画面（textarea・画像添付・最近の投稿） |
| `POST /api/media` | 画像を1枚アップロード（`content-type` は image/jpeg・png・gif・webp、8MB まで）。R2 の `pub/` に置き、`{key, url}` を返す |
| `POST /api/posts` | `{body, images:[{key, alt}]}` を保存。本文の最初の URL から OGP を取ってリンクカードを作る |
| `GET /api/posts` | 直近の投稿（`?before=<ISO 8601>` でカーソル） |

実装は `src/index.mjs`（Worker の入口）と、サイト側の `src/lib/feed/api.ts`（処理本体）・`src/lib/feed/compose.ts`（検証・ID・OGP）です。書き込みは writer と同じく `x-slytxt-client: 1` と同一オリジンを要求します（入口の Cloudflare Access と合わせて二重に守る）。

## 準備

1. D1 を作る（サイト側と同じデータベース）。

   ```sh
   npx wrangler d1 create slytxt-feed
   npx wrangler d1 execute slytxt-feed --remote --file db/feed/0001_init.sql
   ```

2. `wrangler.toml` の `database_id` を、1 で返った ID に差し替える。
3. Cloudflare Access で `feed.slytxt.dev` にアプリケーションを作り、本人のメールアドレスだけを許可する（writer と同じ設定）。
4. デプロイする。

   ```sh
   npx wrangler deploy -c tools/feed-cloudflare/wrangler.toml
   ```

画像は writer と同じ R2 バケット `slytxt-writer-media` の `pub/` に置かれ、`https://media.slytxt.dev/<key>` で配信されます（`tools/media-cloudflare`）。フィードの画像は最初から `pub/` に置くので、writer の draft→pub の移動は通りません。

## ローカルで動かす

```sh
cd tools/feed-cloudflare
npx wrangler d1 execute slytxt-feed --local --file ../../db/feed/0001_init.sql
npx wrangler dev --port 8791
```

`/api/posts` への書き込みには `x-slytxt-client: 1` が要ります。

```sh
curl -s -X POST http://127.0.0.1:8791/api/media \
  -H 'x-slytxt-client: 1' -H 'content-type: image/png' --data-binary @test.png
```

## 投稿画面の操作

- 本文は2000文字まで。URL を貼ると、投稿時にサーバーが OGP を取ってリンクカードを作る（取得できなければカードなし）。
- 画像は4枚まで。1枚ずつ「画像の説明（alt）」を入れる（空だと投稿できない）。
- 投稿すると R2 の `pub/` へ上がった画像のキーだけが D1 に入る。公開ページは `media.slytxt.dev` から読む。
- iPhone は Safari で開いて「ホーム画面に追加」すると単体アプリとして起動する（manifest の `display: standalone`）。
