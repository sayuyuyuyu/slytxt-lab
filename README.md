# しらゆラボ

[![CI](https://github.com/sayuyuyuyu/slytxt-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/sayuyuyuyu/slytxt-lab/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/sayuyuyuyu/slytxt-lab)](https://github.com/sayuyuyuyu/slytxt-lab/commits/main)
[![Website](https://img.shields.io/badge/website-slytxt.dev-blue)](https://slytxt.dev/)

個人のメモと制作物を置くサイト [slytxt.dev](https://slytxt.dev/) のソースです。Astro / TypeScript / Pagefind で作り、Cloudflare Pages で配信しています（`slytxt.pages.dev` も同じものを返します）。CSS は `src/styles/global.css` に手で書き、ブラウザ間の差異を埋めるリセット（Tailwind の preflight）だけを Tailwind から借りています。スタイルは Tailwind のユーティリティではなく独自クラスで当てます。

コンテンツは `src/content/` に置きます（技術記事は `tech/`、漫画は `comic/`、ゲームは `game/`、アニメは `anime/`、それ以外は `misc/`、制作物は `projects/`）。

## 開発

前提は Node.js 22 以降と pnpm です。

```bash
pnpm install
pnpm dev          # 開発サーバー
pnpm run verify   # 型チェック・テスト・ビルド・生成物のリンク検証
pnpm test:e2e     # Playwright で主要フローを確認（手順は e2e/README.md）
```

検索インデックス（Pagefind）は `pnpm build` のときに `dist/pagefind` へ生成されるので、検索の動作確認はビルド後に `pnpm preview` で行います。本番 URL は環境変数 `SITE_URL`（既定は `https://slytxt.dev`）で指定します。

## 執筆と公開

執筆の経路は2つあります。どちらも `src/content/<カテゴリ>/<slug>.md` を Pull Request で作り、`main` へのマージで Cloudflare Pages がビルドして公開する点は同じです。

- **Obsidian プラグイン**（[tools/obsidian-slytxt](tools/obsidian-slytxt/README.md)）— writer の置き換え先です。ノートから「PR を作る（公開）」でブランチと Pull Request を作り、自動マージ（squash）を設定します。CI が通ればそのまま公開されます。Mac では本番反映まで確認済みで、iPhone への導入が残っています。
- **writer**（<https://write.slytxt.dev>、[tools/writer-cloudflare](tools/writer-cloudflare/README.md)）— 現行の本体です。認証は Cloudflare Access（本人のメールアドレスのみ許可）。下書きを端末と KV に持ち、投稿ボタンからファイル作成・ブランチ・Pull Request・CI 待ち・マージまで進みます。

共通部分と writer 固有の部分の切り分けは [アーキテクチャ](docs/architecture.md) の「公開フロー」を参照してください。

## ドキュメント

- [アーキテクチャ](docs/architecture.md) — 全体構成と公開フロー
- [執筆ツール](tools/writer-cloudflare/README.md) — writer の構成とデプロイ手順
- [短文フィード](db/feed/README.md) — D1 に置く短文と公開一覧（`/feed/`）。投稿画面は [feed-cloudflare](tools/feed-cloudflare/README.md)
- [Obsidian プラグイン](tools/obsidian-slytxt/README.md) — Obsidian から PR で公開する
- [公開メディア配信](tools/media-cloudflare/README.md) — media.slytxt.dev の Worker
- [E2E テスト](e2e/README.md) — Playwright の手順
- [作業方針](AGENTS.md) — ブランチ運用と UI・文章の規約

## 開発フロー

`main` への直接 push は禁止です。変更は作業ブランチから Pull Request を作成し、CI が通ってからマージします。
