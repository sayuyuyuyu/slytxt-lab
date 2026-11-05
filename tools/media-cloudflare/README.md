# 公開メディア配信（media.slytxt.dev）

しらゆラボの公開済み画像を配信する専用 Worker。執筆ツール（`tools/writer-cloudflare`）と同じ Cloudflare R2 バケット `slytxt-writer-media` を共有し、そのうち `pub/` プレフィックス（公開時に移された画像）だけを返す。下書き段階の画像（`draft/`）はここからは取得できず、writer（write.slytxt.dev、Cloudflare Access の裏）経由でのみ表示される。

## デプロイ

```sh
npx wrangler deploy -c tools/media-cloudflare/wrangler.toml
```

`wrangler.toml` の routes により `https://media.slytxt.dev` に割り当たる。バケットは writer 側の手順で作成済みのものを使う（無ければ `npx wrangler r2 bucket create slytxt-writer-media`）。
