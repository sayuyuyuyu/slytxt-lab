# しらゆラボ

Astro / TypeScript / MDX / Tailwind CSS / Pagefind で作る個人のメモと制作物を置くサイトです。

公開ページ: <https://slytxt.dev/>（Cloudflare Pages の `slytxt.pages.dev` も同じものを返します）

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

## Xのブックマーク

自分のXブックマークの最新15件を、推測不能なURLの下で一覧・RSS・JSONとして配信します。仕事のエージェントにURLを渡して読ませる用途です。

```text
/bm/<BOOKMARKS_SECRET>/                 一覧
/bm/<BOOKMARKS_SECRET>/rss.xml          RSS
/bm/<BOOKMARKS_SECRET>/bookmarks.json   JSON
/bm/<BOOKMARKS_SECRET>/embed.js         埋め込み用
```

### 埋め込み

別のページに一覧を埋め込むときは、次のスニペットを置きます。

```html
<script src="https://slytxt.dev/bm/<BOOKMARKS_SECRET>/embed.js" async></script>
```

`id="x-bookmarks"` の要素があればその中に描き、無ければ script の位置に挿入します。`data-target` でセレクタを指定することもできます。Shadow DOM に描くので、埋め込み先の CSS と干渉しません。色は `--xb-text` `--xb-muted` `--xb-border` `--xb-accent` で上書きできます。

初回だけ、ブラウザで次を開いてXの認可を通します。`key` は `BOOKMARKS_ADMIN_TOKEN` です。

```text
https://slytxt.dev/api/bookmarks/connect?key=<BOOKMARKS_ADMIN_TOKEN>
```

Xのアプリ設定では、コールバックURLに `https://slytxt.dev/api/bookmarks/callback` を登録し、スコープに `tweet.read` `users.read` `bookmark.read` `offline.access` を付けます。

### Cloudflare Pages の設定

- KV 名前空間を1つ作り、`BOOKMARKS` としてバインドする
- 環境変数を登録する

```text
BOOKMARKS_SECRET        URL に使うランダム文字列
BOOKMARKS_ADMIN_TOKEN   認可を始めるときの合言葉
X_CLIENT_ID             X アプリの Client ID
X_CLIENT_SECRET         X アプリの Client Secret
```

取得は1日1回、朝9時（JST）以降の最初のアクセスで走ります。失敗しても10分は再試行せず、前回の内容を残すので一覧が空にはなりません。投稿者は KV にキャッシュし、毎回の再取得課金を避けています。

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
pnpm test          # ページ送りとブックマークのテスト
pnpm run verify    # 型チェック、テスト、ビルド、生成物のリンク検証
```

公開記事がない状態でも記事UIを検証するには、`pnpm run fixture:ui` を実行します。表示される一時ディレクトリへ移動し、`pnpm build` → `pnpm preview --port 4322` で確認できます。12件の技術メモ、2件の日々の記録、完成済み制作物と下書きを含む検証用コピーです。元リポジトリや本番用 `dist` にサンプル記事は追加しません。

確認箇所: 320px / 390px / デスクトップ幅、両テーマ、長い見出しとタグ、目次、ページ送り、検索・0件検索、キーボードの本文移動。
