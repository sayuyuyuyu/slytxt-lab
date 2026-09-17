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

## 執筆

執筆用のエディタが `tools/writer/` にあります。ブラウザでメモを書いて、AIで整えて、Pull Request まで出せます。

```bash
pnpm write        # http://127.0.0.1:4326 を開く
pnpm write:host   # Tailscale など別の端末から触れるようにする
```

流れは3段階です。

1. **メモ** — 雑に書く。整形は考えない。
2. **AIで膨らます** — メモを下書きに整える。事実は足さず、見出しと接続だけ補う。
3. **整形してPR** — 文体規範に沿って記事に整え、`write/<slug>` ブランチを切って `gh pr create` まで実行する。

下書きはリポジトリ直下の `drafts/` に置きます（`.gitignore` 済み）。`expand` と `publish` の直前には `drafts/.history/` へ退避し、整形結果もそこに残るので、失敗しても書き直しになりません。

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

- 執筆用のエディタは `tools/writer/` にあります。`pnpm write` で起動します。
- 共通の配色・文字・余白は `src/styles/global.css` に集約しています。
- 技術メモと日々の一覧は `ArticleListing.astro`、ページ数・URL計算は `src/lib/pagination.ts` で共有します。
- 記事・制作物・このサイトの説明を検索対象にし、一覧・検索・404は検索結果から除外します。
- タグ一覧は `/tags/`、存在しないURLは `404.astro` から各ページへ戻れます。

### 検証

Node.js 22以降で実行してください。追加のテスト依存関係は不要です。

```sh
pnpm test          # ページ送りの境界・大規模一覧、執筆ツールのテスト
pnpm run verify    # 型チェック、テスト、ビルド、生成物のリンク検証
```

公開記事がない状態でも記事UIを検証するには、`pnpm run fixture:ui` を実行します。表示される一時ディレクトリへ移動し、`pnpm build` → `pnpm preview --port 4322` で確認できます。12件の技術メモ、2件の日々の記録、完成済み制作物と下書きを含む検証用コピーです。元リポジトリや本番用 `dist` にサンプル記事は追加しません。

確認箇所: 320px / 390px / デスクトップ幅、両テーマ、長い見出しとタグ、目次、ページ送り、検索・0件検索、キーボードの本文移動。
