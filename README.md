# しらゆラボ

Astro / TypeScript / Tailwind CSS / Pagefind で作る個人のメモと制作物を置くサイトです。

公開ページ: <https://slytxt.dev/>（Cloudflare Pages の `slytxt.pages.dev` も同じものを返します）

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm run verify
pnpm test:e2e
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

`id="x-bookmarks"` の要素があればその中に描き、無ければ script の位置に挿入します。`data-target` でセレクタを指定することもできます。投稿はアイコン付きのカードで並びます。Shadow DOM に描くので、埋め込み先の CSS と干渉しません。色は `--xb-text` `--xb-muted` `--xb-border` `--xb-card` `--xb-accent` で上書きできます。

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

## 執筆

執筆は Cloudflare 版のエディタ（https://write.slytxt.dev 、コードは `tools/writer-cloudflare/`）で行います。ブラウザで書いて、投稿ボタンで公開まで進みます。認証は Cloudflare Access（本人のメールアドレスのみ許可）です。

やることは2つだけです。

1. **書く** — カテゴリ（Tech / Journal / Notes）を選んで本文を書く。記事（Tech / Journal）はタイトル欄でタイトルを付けられます。タイトルが空のときだけ、公開タイトルは本文の書き出しから付けます。Notes はタイトル欄が無く、公開タイトルは空のままです。一覧などでの表示名だけが本文の書き出しから作られます。
2. **投稿** — ファイル化、ブランチ作成、Pull Request、CI 待ち、merge まで一度に進みます（merge の条件は CI の成功のみ）。公開できたドラフトは一覧から消えます。

編集は端末（ブラウザの localStorage）へ即時に自動保存され、サーバー（Cloudflare KV）への同期は裏で間引いて行われます。未同期の間は下書きが端末内だけに存在します。保存表示は、未同期なら「端末に保存済み」、同期済みなら「保存済み」です。

構成とデプロイ手順は `tools/writer-cloudflare/README.md` を参照してください。旧ローカル版（Mac 上のサーバーを launchd で常駐させる方式）は廃止しました。移行前の下書きファイルは、原本としてリポジトリ直下の `drafts/` に残してあります（`.gitignore` 済み。現在の下書きの正は KV）。


## Content

公開する記事は以下に追加します。

```text
src/content/tech/      技術系の記事（/articles/tech/）
src/content/journal/   それ以外の記事（/articles/journal/）
src/content/notes/     短いメモ（/notes/）
src/content/projects/  つくったもの（/projects/）
```

Tech と Journal は `/articles/` にまとまります。Notes は記事より前の短いメモで、`/articles/` には含めません。

ローカル動作確認用のサンプルは `*.sample.md` または `sample-*.md` にしてください。`.gitignore` で除外されます。

### Tech / Journal / Notes

```yaml
title:
description:
published:
updated:
tags:
cover:
draft:
adult:
```

`cover` は見出し画像の URL です（任意）。

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
```

`status` は `planning` / `active` / `maintenance` / `paused` / `completed` のいずれかです。

## UI と構成

- 画面のラベルは英語、本文と説明文は日本語にしています。カテゴリ名は `src/lib/site.ts` の `categoryLabels` に集約しています。
- メニューは `navGroups` で writing（Articles / Notes）、works（Projects）、browse（Tags / Search）、meta（About）に分け、Articles の下に Tech / Journal を入れ子にしています。
- 共通の配色・文字・余白は `src/styles/global.css` に集約しています。青黒を基調にしたターミナル風で、ダーク（`--bg: #05070f`）が既定、`:root.light` が昼向けの配色です。切り替えは `html` の `light` クラスと `localStorage.theme` で行います。
- ターミナル風の見た目は `.terminal`（ウィンドウ枠）、`.prompt`、`.eyebrow` の `❯` 接頭辞で作っています。
- 執筆用のエディタは Cloudflare 版（`tools/writer-cloudflare/`、https://write.slytxt.dev）です。
- スクロール出現と入場のアニメーションは Motion（`motion`）で行います。動かしたい要素に `data-motion` を付けます。JS が無い・動かない環境では2秒後に必ず表示されるようにしてあります。
- 動きは `prefers-reduced-motion` を尊重します。
- 技術メモと日々の一覧は `ArticleListing.astro`、ページ数・URL計算は `src/lib/pagination.ts` で共有します。
- 記事・制作物・このサイトの説明を検索対象にし、一覧・検索・404は検索結果から除外します。
- タグ一覧は `/tags/`、存在しないURLは `404.astro` から各ページへ戻れます。

### 検証

Node.js 22以降で実行してください。単体テスト（`pnpm test`）は追加のテスト依存関係なしで実行できます。E2Eテスト（`pnpm test:e2e`）は Playwright が必要です。手順は `e2e/README.md` を参照してください。

```sh
pnpm test          # ページ送りの境界・大規模一覧、ブックマーク、執筆ツールのテスト
pnpm run verify    # 型チェック、テスト、ビルド、生成物のリンク検証
pnpm test:e2e      # サイトと writer の主要フローを Playwright で確認（手順は e2e/README.md）
```

公開記事がない状態でも記事UIを検証するには、`pnpm run fixture:ui` を実行します。表示される一時ディレクトリへ移動し、`pnpm build` → `pnpm preview --port 4322` で確認できます。12件の技術メモ、2件のジャーナル、1件のメモ、完成済み制作物と下書きを含む検証用コピーです。元リポジトリや本番用 `dist` にサンプル記事は追加しません。

確認箇所: 320px / 390px / デスクトップ幅、両テーマ、長い見出しとタグ、目次、ページ送り、検索・0件検索、キーボードの本文移動。
