# しらゆラボ

Astro / TypeScript / MDX / Tailwind CSS / Pagefind で作る個人のメモと制作物を置くサイトです。

公開ページ: <https://slytxt.pages.dev/>

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm run verify
```

Pagefind の検索インデックスは `pnpm build` 時に `dist/pagefind` へ生成されます。検索の動作確認は `pnpm build` 後に `pnpm preview` で行ってください。

## Environment

本番 URL は `SITE_URL` で指定します。

```bash
SITE_URL=https://slytxt.dev
```

Cloudflare Pages では以下を指定します。

```text
Build command: pnpm build
Output directory: dist
```

## Development Flow

`main` への直接 push は禁止です。変更は作業ブランチから Pull Request を作成し、CI が通ってから merge します。

## Content

公開する記事は以下に追加します。

```text
src/content/tech/
src/content/life/
src/content/projects/
```

ローカル動作確認用のサンプルは `*.sample.mdx` または `sample-*.mdx` にしてください。`.gitignore` で除外されます。

### Tech / Life

```yaml
title:
description:
published:
updated:
tags:
draft:
featured:
adult:
cover:
```

### Projects

```yaml
title:
description:
started:
updated:
status:
repo:
demo:
tags:
draft:
cover:
```

`status` は `planning` / `active` / `maintenance` / `paused` / `completed` のいずれかです。

## UI と構成

- 共通の配色・文字・余白は `src/styles/global.css` に集約しています。
- 技術メモと日々の一覧は `ArticleListing.astro`、ページ数・URL計算は `src/lib/pagination.ts` で共有します。
- 記事・制作物・このサイトの説明を検索対象にし、一覧・検索・404は検索結果から除外します。
- タグ一覧は `/tags/`、存在しないURLは `404.astro` から各ページへ戻れます。

### 検証

Node.js 22以降で実行してください。追加のテスト依存関係は不要です。

```sh
pnpm test          # ページ送りの境界・大規模一覧のテスト
pnpm run verify    # 型チェック、テスト、ビルド、生成物のリンク検証
```

公開記事がない状態でも記事UIを検証するには、`pnpm run fixture:ui` を実行します。表示される一時ディレクトリへ移動し、`pnpm build` → `pnpm preview --port 4322` で確認できます。12件の技術メモ、2件の日々の記録、完成済み制作物と下書きを含む検証用コピーです。元リポジトリや本番用 `dist` にサンプル記事は追加しません。

確認箇所: 320px / 390px / デスクトップ幅、両テーマ、長い見出しとタグ、目次、ページ送り、検索・0件検索、キーボードの本文移動。
