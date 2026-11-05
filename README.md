# しらゆラボ

[![CI](https://github.com/sayuyuyuyu/slytxt-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/sayuyuyuyu/slytxt-lab/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/sayuyuyuyu/slytxt-lab)](https://github.com/sayuyuyuyu/slytxt-lab/commits/main)
[![Website](https://img.shields.io/badge/website-slytxt.dev-blue)](https://slytxt.dev/)

個人のメモと制作物を置くサイト [slytxt.dev](https://slytxt.dev/) のソースです。Astro / TypeScript / Tailwind CSS / Pagefind で作り、Cloudflare Pages で配信しています（`slytxt.pages.dev` も同じものを返します）。

コンテンツは `src/content/` に置きます（技術記事は `tech/`、それ以外の記事は `journal/`、短いメモは `notes/`、制作物は `projects/`）。

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

執筆は Cloudflare 版のエディタ（<https://write.slytxt.dev>、コードは `tools/writer-cloudflare/`）で行います。認証は Cloudflare Access（本人のメールアドレスのみ許可）です。書いて投稿ボタンを押すと、ファイル作成・ブランチ・Pull Request・CI 待ち・マージまで進みます（マージの条件は CI の成功のみ）。流れの詳細は [アーキテクチャ](docs/architecture.md) と `tools/writer-cloudflare/README.md` を参照してください。

## ドキュメント

- [アーキテクチャ](docs/architecture.md) — 全体構成と公開フロー
- [執筆ツール](tools/writer-cloudflare/README.md) — writer の構成とデプロイ手順
- [公開メディア配信](tools/media-cloudflare/README.md) — media.slytxt.dev の Worker
- [健康状態の受け口](tools/status-cloudflare/README.md) — status.slytxt.dev の Worker
- [E2E テスト](e2e/README.md) — Playwright の手順
- [作業方針](AGENTS.md) — ブランチ運用と UI・文章の規約

## 開発フロー

`main` への直接 push は禁止です。変更は作業ブランチから Pull Request を作成し、CI が通ってからマージします。
