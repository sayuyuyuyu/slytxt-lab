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

- `playwright.config.mjs`（リポジトリ直下）: PC（1280px）とスマホ（390px 相当、
  iPhone 13 プリセット + Chromium）の2プロジェクトで同じシナリオを回す。
- `e2e/start-site.mjs`: 使い捨てコピーに埋め込み確認用の記事を足して
  ビルドし、astro preview で配信する。
- `e2e/site.spec.mjs`: サイトの主要フローを確認する。
  - トップページに記事とフィードの見出しが出ること。
  - 記事ページで Spotify 埋め込みが描画されること。
  - メニューが開閉でき、リンクで遷移できること（iOS のフォーカス喪失でも閉じる）。
  - メニューを Esc で閉じるとボタンへフォーカスが戻ること。
  - PC 幅では主要ナビがヘッダーに並ぶこと。
  - 幅を変えてもナビの出し方が戻ること。
  - 幅をまたがない resize ではメニューの開閉状態が変わらないこと。
