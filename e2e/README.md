# E2E テスト

Playwright でサイトと writer の主要フローをローカルだけで確認する。
本番（Cloudflare Access の内側）には繋がない。CI の必須チェックには含めていない。

## 実行方法

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test:e2e
```

初回だけ `tools/writer-cloudflare` の依存も必要（`e2e/start-writer.mjs` が
無ければ自動で `pnpm install` する）。

## 構成

- `playwright.config.mjs`（リポジトリ直下）: PC（1280px）とスマホ（390px 相当、
  iPhone 13 プリセット + Chromium）の2プロジェクトで同じシナリオを回す。
- `e2e/start-writer.mjs`: writer を wrangler dev で起動（ローカル KV は
  一時ディレクトリで、実行ごとに空）。
- `e2e/start-site.mjs`: 使い捨てコピーに埋め込み確認用の記事を足して
  ビルドし、astro preview で配信する。
- `e2e/writer.spec.mjs`: 下書き作成→本文編集（見出しと Spotify URL の
  貼り付け）→自動保存→カテゴリ切替とタイトル扱い（notes ではタイトル欄と
  確認行を出さない）→プレビュー（見出し・Spotify プレイヤー）→公開パネル
  の表示まで（実際の GitHub 公開はしない）。もう1件で、編集画面と公開
  フィクスチャ記事の computed style（フォント・本文サイズ・行間・カラム幅、
  タイトルのタイポグラフィ）が一致することと、エディタ内の Spotify
  埋め込みが実プレイヤー（iframe）で描画されることを確認する。
- `e2e/site.spec.mjs`: トップページのターミナル表示と、記事ページで
  Spotify 埋め込みが描画されることのスモーク確認。もう2件で、メニューが
  開閉できリンクで遷移できること（iOS のフォーカス喪失でも閉じる）と、
  メニューを Esc で閉じるとボタンへフォーカスが戻ることを確認する。
