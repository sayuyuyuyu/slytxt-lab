# しらゆラボ

[![CI](https://github.com/sayuyuyuyu/slytxt-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/sayuyuyuyu/slytxt-lab/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/sayuyuyuyu/slytxt-lab)](https://github.com/sayuyuyuyu/slytxt-lab/commits/main)
[![Website](https://img.shields.io/badge/website-slytxt.dev-blue)](https://slytxt.dev/)

個人のメモと制作物を置くサイト [slytxt.dev](https://slytxt.dev/) のソースです。Astro / TypeScript / Pagefind で作り、Cloudflare Pages で配信しています（`slytxt.pages.dev` も同じものを返します）。CSS は `src/styles/global.css` に手で書き、ブラウザ間の差異を埋めるリセット（Tailwind の preflight）だけを Tailwind から借りています。スタイルは Tailwind のユーティリティではなく独自クラスで当てます。

コンテンツは `src/content/` に置きます（技術記事は `tech/`、漫画は `comic/`、ゲームは `game/`、アニメは `anime/`、それ以外は `misc/`、制作物は `projects/`）。

## 開発

前提は Node.js 22 以降と pnpm です。pnpm の版は `package.json` の `packageManager`（10.14.0）に従います。

```bash
pnpm install
pnpm dev            # 開発サーバー
pnpm run verify     # 型チェック・テスト・ビルド・生成物のリンク検証
./scripts/verify.sh # 同じ検証。pnpm が無い環境では node_modules の実行ファイルで代用する
pnpm test:e2e       # Playwright で主要フローを確認（手順は e2e/README.md）
```

検索インデックス（Pagefind）は `pnpm build` のときに `dist/pagefind` へ生成されるので、検索の動作確認はビルド後に `pnpm preview` で行います。本番 URL は環境変数 `SITE_URL`（既定は `https://slytxt.dev`）で指定します。

## 執筆と公開

執筆は Obsidian プラグインで行います。`src/content/<カテゴリ>/<slug>.md` を Pull Request で作り、`main` へのマージで Cloudflare Pages がビルドして公開します。

- **Obsidian プラグイン**（[tools/obsidian-slytxt](tools/obsidian-slytxt/README.md)）— ノートから「PR を作る（公開）」でブランチと Pull Request を作り、自動マージ（squash）を設定します。CI が通ればそのまま公開されます。Mac では本番反映まで確認済みで、iPhone への導入が残っています。

公開フローの詳細は [アーキテクチャ](docs/architecture.md) を参照してください。

## ドキュメント

- [アーキテクチャ](docs/architecture.md) — 全体構成と公開フロー
- [短文フィード](db/feed/README.md) — D1 に置く短文と公開一覧（`/feed/`）。投稿画面は [feed-cloudflare](tools/feed-cloudflare/README.md)
- [Obsidian プラグイン](tools/obsidian-slytxt/README.md) — Obsidian から PR で公開する
- [公開メディア配信](tools/media-cloudflare/README.md) — media.slytxt.dev の Worker
- [E2E テスト](e2e/README.md) — Playwright の手順
- [作業方針](AGENTS.md) — ブランチ運用と UI・文章の規約

## 開発フロー

`main` への直接 push は禁止です。変更は作業ブランチから Pull Request を作成し、CI が通ってからマージします。

```bash
./scripts/merge-pr.sh <PR番号>   # main の取り込み直し → ci 待ち → squash merge
```

`main` の branch protection は strict で、必須チェックは `ci` だけです。main が進むと PR の required check が「expected」のままになり merge が弾かれるため、上のスクリプトは先に `gh pr update-branch` します。

既知の失敗: `Workers Builds: slytxt-feed` はすべての PR で赤になります（Cloudflare 側のビルド設定の問題で、必須チェックではありません）。`ci` と `Cloudflare Pages` が通っていればマージできます。
