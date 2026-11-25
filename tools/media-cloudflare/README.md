# 公開メディア配信（media.slytxt.dev）

しらゆラボの公開済み画像を配信する専用 Worker。Obsidian プラグインと短文フィードが使う Cloudflare R2 バケット `slytxt-writer-media` のうち、`pub/` プレフィックスだけを返す。`pub/` 以外のキー（writer 時代の `draft/` など）は取得できない。

## デプロイ

```sh
npx wrangler deploy -c tools/media-cloudflare/wrangler.toml
```

`wrangler.toml` の routes により `https://media.slytxt.dev` に割り当たる。バケット `slytxt-writer-media` は作成済みのものを使う（無ければ `npx wrangler r2 bucket create slytxt-writer-media`）。

## アップロード（Obsidian プラグインのカバー画像用）

配信（GET / HEAD）のほかに、`PUT /<キー>` で画像を `pub/` へ直接アップロードできる。キーは配信と同じ形（UUID または 32 桁 hex + jpg / png / gif / webp）、上限 8MB。認証は secret の `UPLOAD_TOKEN` と対になる Bearer トークン必須で、未設定のときは無効（503）。

```sh
npx wrangler secret put UPLOAD_TOKEN -c tools/media-cloudflare/wrangler.toml
```

プラグイン側の設定（slytxt publish の「アップロード用トークン」）に同じ値を入れる。トークンを変えたら両方を差し替える。

## キャッシュと画像の削除

レスポンスは `cache-control: public, max-age=31536000, s-maxage=300, immutable` です。URL が内容ハッシュなので、ブラウザには1年間持たせます。一方、R2 の `pub/` から画像を消しても CDN のエッジに残り続けないよう、エッジ側（`s-maxage`）の寿命は300秒にしています。

そのため、画像を消したあと media.slytxt.dev が 404 を返すまで最大で約5分かかります。削除の確認は次の順で行ってください。

1. `npx wrangler r2 object delete slytxt-writer-media/pub/<key>` を実行し、`Delete complete.` を確認する
2. `npx wrangler r2 object get slytxt-writer-media/pub/<key>` が `The specified key does not exist.` を返すことを確認する（R2 側の削除）
3. 5分以上待ってから `curl -sI https://media.slytxt.dev/<key>` を実行し、`HTTP/2 404` を確認する（エッジ側の反映）

すぐに消したい場合は、Cloudflare のダッシュボードでゾーン `slytxt.dev` の「キャッシュの消去」から `https://media.slytxt.dev/<key>` を個別にパージしてください（パージは手動で、このリポジトリの手順には含めていません）。ブラウザが既に取得した画像は、パージ後もブラウザのキャッシュから表示され得ます。
