# E2E テスト

Playwright でサイトの主要フローをローカルだけで確認する。
本番（Cloudflare や外部サービス）には繋がない。CI の `e2e` ジョブでも同じものを回す
（必須チェックは `ci` だけなので、赤でもマージは止まらない）。

## 実行方法

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test:e2e
```

## 構成

- `e2e/site.spec.mjs` … トップ・記事・メニュー・検索・絞り込み。
- `e2e/writer.spec.mjs` … writer の主要フロー（保存、公開パネル、カバー、X 投稿）。
- `e2e/start-*.mjs` … 使い捨てのサイト／writer をローカルで起動する。

PR では `site.spec.mjs` だけを回す。writer の spec は main へのマージ後と手動（`pnpm test:e2e`）で回す。
