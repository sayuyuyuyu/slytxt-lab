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

執筆用のエディタが `tools/writer/` にあります。ブラウザでメモを書いて、AIで整えて、Pull Request まで出せます。

```bash
pnpm write        # http://127.0.0.1:4326 を開く
pnpm write:host   # Tailscale など別の端末から触れるようにする
```

流れは3段階です。

1. **メモ** — 雑に書く。整形は考えない。タイトルは空のままでよく、一覧では本文の書き出しが名前になる。
2. **AIで膨らます** — メモを下書きに整える。事実は足さず、見出しと接続だけ補う。
3. **整形してPR** — 文体規範に沿って記事に整え、`write/<slug>` ブランチを切って `gh pr create` まで実行する。

一度出したメモは、そのあと編集して流すと **「PRを更新」** に変わります。同じブランチにコミットを積むので、PR は増えません。誤字を直したいだけのときに新しい PR を立てずに済みます。

編集は 900ms のデバウンスで自動保存します。保存に失敗したときは上部の丸い印が「保存できません・再試行」になり、押すと再送します。オフラインが戻ったときも自動で再送します。

下書きはリポジトリ直下の `drafts/` に置きます（`.gitignore` 済み）。`expand` と `publish` の直前には `drafts/.history/` へ退避するので、失敗しても書き直しになりません。戻したいときはツールバー右の `⋯` から **「直前の状態に戻す」** を選びます。

一覧は状態（メモ / 下書き / 出せる / PR済み）と語句で絞れます。

### 出先から使う

Mac を再起動しても使えるように、launchd に登録できます。

```bash
node tools/writer/service.mjs install    # 登録して Tailscale に公開する
node tools/writer/service.mjs status     # 状態と URL を出す
node tools/writer/service.mjs uninstall  # 登録を外す
```

`install` は以下を行います。

- `~/Library/LaunchAgents/ts.slytxt.writer.plist` を書き、`launchctl` に登録する（`RunAtLoad` + `KeepAlive`）
- token を `~/.config/slytxt-writer/token` に作る（既にあれば使う）
- `tailscale serve --bg --https=8443 http://127.0.0.1:4326` で tailnet に出す

出先からは `https://<tailnet のホスト名>:8443/?token=<token>` を開きます。初回に token を cookie に入れるので、以降は `https://<tailnet のホスト名>:8443/` だけで入れます。

Mac がスリープすると届きません。電源に繋いでスリープを止めておいてください。ポートは `--port` と `--https-port` で変えられます。

### 環境変数

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `SLYTXT_DRAFTS_DIR` | `./drafts` | 下書きの置き場所。iCloud などに逃がすときに使う |
| `SLYTXT_AGENT` | `pi` | `pi` または `codex` |
| `SLYTXT_AGENT_CMD` | なし | 任意のCLIを直接指定する |
| `SLYTXT_AGENT_MODEL` | なし | 使うモデルを固定する |
| `SLYTXT_STYLE_FILE` | `~/.agents/skills/slytxt-writing/SKILL.md` | 文体規範のファイル |
| `SLYTXT_SKIP_CHECK` | なし | `1` で公開前の `astro check` を飛ばす |
| `SLYTXT_TOKEN` | 起動ごとに生成 | `--host` で起動したときの合言葉を固定する |
| `PORT` | `4326` | 待ち受けポート |

`publish` は作業ツリーが汚れていると何もせずに止まります。`main` へは push しません。

## Content

公開する記事は以下に追加します。

```text
src/content/tech/      技術系の記事（/articles/tech/）
src/content/journal/   それ以外の記事（/articles/journal/）
src/content/notes/     短いメモ（/notes/）
src/content/projects/  つくったもの（/projects/）
```

Tech と Journal は `/articles/` にまとまります。Notes は記事より前の短いメモで、`/articles/` には含めません。

ローカル動作確認用のサンプルは `*.sample.mdx` または `sample-*.mdx` にしてください。`.gitignore` で除外されます。

### Tech / Journal / Notes

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

- 画面のラベルは英語、本文と説明文は日本語にしています。カテゴリ名は `src/lib/site.ts` の `categoryLabels` に集約しています。
- メニューは `navGroups` で writing（Articles / Notes）、works（Projects）、browse（Tags / Search）、meta（About）に分け、Articles の下に Tech / Journal を入れ子にしています。
- 共通の配色・文字・余白は `src/styles/global.css` に集約しています。青黒を基調にしたターミナル風で、ダーク（`--bg: #05070f`）が既定、`:root.light` が昼向けの配色です。切り替えは `html` の `light` クラスと `localStorage.theme` で行います。
- ターミナル風の見た目は `.terminal`（ウィンドウ枠）、`.prompt`、`.cursor`、`.eyebrow` の `❯` 接頭辞で作っています。
- 執筆用のエディタは `tools/writer/` にあります。`pnpm write` で起動します。
- スクロール出現と入場のアニメーションは Motion（`motion`）で行います。動かしたい要素に `data-motion` を付けます。JS が無い・動かない環境では2秒後に必ず表示されるようにしてあります。
- 動きは `prefers-reduced-motion` を尊重します。
- 技術メモと日々の一覧は `ArticleListing.astro`、ページ数・URL計算は `src/lib/pagination.ts` で共有します。
- 記事・制作物・このサイトの説明を検索対象にし、一覧・検索・404は検索結果から除外します。
- タグ一覧は `/tags/`、存在しないURLは `404.astro` から各ページへ戻れます。

### 検証

Node.js 22以降で実行してください。追加のテスト依存関係は不要です。

```sh
pnpm test          # ページ送りの境界・大規模一覧、ブックマーク、執筆ツールのテスト
pnpm run verify    # 型チェック、テスト、ビルド、生成物のリンク検証
```

公開記事がない状態でも記事UIを検証するには、`pnpm run fixture:ui` を実行します。表示される一時ディレクトリへ移動し、`pnpm build` → `pnpm preview --port 4322` で確認できます。12件の技術メモ、2件のジャーナル、1件のメモ、完成済み制作物と下書きを含む検証用コピーです。元リポジトリや本番用 `dist` にサンプル記事は追加しません。

確認箇所: 320px / 390px / デスクトップ幅、両テーマ、長い見出しとタグ、目次、ページ送り、検索・0件検索、キーボードの本文移動。
