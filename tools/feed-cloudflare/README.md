# 短文フィード投稿（feed.slytxt.dev）

短文フィードの投稿画面（PWA）と投稿 API です。公開一覧はサイト側（`slytxt.dev/feed/`、`functions/feed/index.ts`）が同じ D1 を読んで返します。データの形とテーブルは `db/feed/` を見てください。

| パス | 内容 |
| --- | --- |
| `/` | 投稿画面（textarea・画像添付・最近の投稿） |
| `POST /api/media` | 画像を1枚アップロード（`content-type` は image/jpeg・png・gif・webp、8MB まで）。R2 の `pub/` に置き、`{key, url}` を返す |
| `POST /api/posts` | `{body, images:[{key, alt}]}` を保存。本文の最初の URL から OGP を取ってリンクカードを作る |
| `GET /api/posts` | 直近の投稿（`?before=<ISO 8601>` でカーソル） |
| `DELETE /api/posts/<id>` | 論理削除（公開一覧から外れる。画像の実体は R2 に残る） |

実装は `src/index.mjs`（Worker の入口）と、サイト側の `src/lib/feed/api.ts`（処理本体）・`src/lib/feed/compose.ts`（検証・ID・OGP）です。書き込みは writer と同じく `x-slytxt-client: 1` と同一オリジンを要求します（入口の Cloudflare Access と合わせて二重に守る）。

## 準備

1. D1 のテーブルを適用する（データベース `slytxt-feed` は作成済みで、ID は `wrangler.toml` に設定済み）。リポジトリのルートで実行する。

   ```sh
   ./scripts/feed.sh db
   ```

2. 作り直した場合だけ、`wrangler.toml` の `database_id` を新しい ID に差し替える。バインディング名は `FEED` のまま（コードが `env.FEED` を読む）。
3. Cloudflare Access で `feed.slytxt.dev` にアプリケーションを作り、本人のメールアドレスだけを許可する（writer と同じ設定）。
4. デプロイする。

   デプロイは Workers Builds の GitHub 連携で、`main` への push 時に自動で行われます（2026-11-18 連携。ルートディレクトリ `tools/feed-cloudflare`、ビルドコマンドなし、デプロイコマンド `npx wrangler deploy`）。手動で出す場合は従来どおり:

   ```sh
   ./scripts/feed.sh deploy
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

## 投稿の削除

投稿画面の「最近の投稿」から削除すると、`deleted_at` が入り公開一覧から外れます（行は残る）。画像の実体は R2 の `pub/` に残るため、まとめて消すときはキーを控えて手で削除してください。

```sh
npx wrangler r2 object delete slytxt-writer-media/pub/<key>
```

消した画像は `media.slytxt.dev` でも最大5分で 404 になります（`tools/media-cloudflare/README.md`）。ほかの記事が同じ画像を使っている可能性があるので、削除前に `grep` で参照を確認してください。

## 投稿画面の操作

- 本文は2000文字まで。URL を貼ると、投稿時にサーバーが OGP を取ってリンクカードを作る（取得できなければカードなし）。
- 画像は4枚まで。1枚ずつ「画像の説明（alt）」を入れる（空だと投稿できない）。
- 投稿すると R2 の `pub/` へ上がった画像のキーだけが D1 に入る。公開ページは `media.slytxt.dev` から読む。
- iPhone は Safari で開いて「ホーム画面に追加」すると単体アプリとして起動する（manifest の `display: standalone`）。
