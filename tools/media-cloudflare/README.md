# 公開メディア配信（media.slytxt.dev）

しらゆラボの公開済み画像を配信する専用 Worker。執筆ツール（`tools/writer-cloudflare`）と同じ Cloudflare R2 バケット `slytxt-writer-media` を共有し、そのうち `pub/` プレフィックス（公開時に移された画像）だけを返す。下書き段階の画像（`draft/`）はここからは取得できず、writer（write.slytxt.dev、Cloudflare Access の裏）経由でのみ表示される。

## デプロイ

```sh
npx wrangler deploy -c tools/media-cloudflare/wrangler.toml
```

`wrangler.toml` の routes により `https://media.slytxt.dev` に割り当たる。バケットは writer 側の手順で作成済みのものを使う（無ければ `npx wrangler r2 bucket create slytxt-writer-media`）。

## キャッシュと画像の削除

レスポンスは `cache-control: public, max-age=31536000, s-maxage=300, immutable` です。URL が内容ハッシュなので、ブラウザには1年間持たせます。一方、R2 の `pub/` から画像を消しても CDN のエッジに残り続けないよう、エッジ側（`s-maxage`）の寿命は300秒にしています。

そのため、画像を消したあと media.slytxt.dev が 404 を返すまで最大で約5分かかります。削除の確認は次の順で行ってください。

1. `npx wrangler r2 object delete slytxt-writer-media/pub/<key>` を実行し、`Delete complete.` を確認する
2. `npx wrangler r2 object get slytxt-writer-media/pub/<key>` が `The specified key does not exist.` を返すことを確認する（R2 側の削除）
3. 5分以上待ってから `curl -sI https://media.slytxt.dev/<key>` を実行し、`HTTP/2 404` を確認する（エッジ側の反映）

すぐに消したい場合は、Cloudflare のダッシュボードでゾーン `slytxt.dev` の「キャッシュの消去」から `https://media.slytxt.dev/<key>` を個別にパージしてください（パージは手動で、このリポジトリの手順には含めていません）。ブラウザが既に取得した画像は、パージ後もブラウザのキャッシュから表示され得ます。
