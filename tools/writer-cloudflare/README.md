# 執筆ツール（Cloudflare 版）

しらゆラボの執筆ツール。旧ローカル版（Mac 上で動くサーバー）から移行したもので、現在はこれが唯一の執筆環境。Mac が起きていなくても、Tailscale なしでも、ブラウザから書いて投稿できる。

設計の経緯と判断は `~/workspace/slytxt-writer-cloudflare/DESIGN.md`（モカの作業場所側）にある。このディレクトリには実装とデプロイ手順だけを置く。

## 構成

- 単一 Worker（`src/index.mjs`）+ Workers Static Assets（`public/`、生成物なので git 管理しない）。
- 下書きは端末（ブラウザの localStorage）へ即時保存され、サーバー側は Cloudflare KV（バインディング `DRAFTS`）で、同期は裏で間引いて行う（未同期の間は端末内だけに存在する）。キー `draft:<id>`、値は移行前のファイル保存版が `drafts/<id>.md` に書いていたテキストそのまま。直列化・正規化の規則はファイル保存版から変えていない（`src/drafts-kv.mjs`）。
- 純粋モジュール（`frontmatter.mjs` / `markdown.mjs` と、日付の `date.mjs`）は `src/` に同梱している（旧ローカル版から引き継いだもの）。
- 投稿は GitHub REST API（`src/github.mjs` / `src/publish.mjs`）。ブランチ作成 → ファイル作成 → PR 作成までを投稿リクエストの中で行い、CI 待ちと merge は UI のポーリング（`GET /api/publish/:id/status`）と Cron の見届け（`src/driver.mjs`、毎分）の両方が駆動して完了させる。どちらが先に merge しても冪等に収束し、タブを閉じても公開が完了する。結果は KV に `publish-result:<下書きID>` として残り、次回 writer を開いたときに UI が `GET /api/publish-results` で取得して知らせる。ローカルの `pnpm run check` は持たず、PR の CI（チェック名 `ci`）が門番で、成功したら merge する。Cloudflare Pages の結果はマージ条件に入れない（2026-11-04 本人決定。投稿の待ちを CI だけにするため）。
- 投稿は下書きの本文をそのまま使う。誤字チェック pass（Anthropic API）は 2026-11-04 に廃止した。
- 認証は Cloudflare Access が担う（`write.slytxt.dev` は本人のメールアドレスのみ許可。後述）。Worker 側にトークン認証は無い。`x-slytxt-client` による書き込み防御（認証とは別の層）は Worker 側に残してある。入口はカスタムドメインのみで、`workers_dev = false` で workers.dev 側を閉じてある（workers.dev は Access の外にあるため）。
- UI はこのディレクトリの `ui/` が正（`index.html` / `style.css` / `app.js`）。note 風のレイアウト（編集画面のヘッダー、公開確認パネル、一覧の「…」メニュー）は Cloudflare 版だけの差分として `ui/` 側に持つ。`markdown.mjs` は `src/markdown.mjs` をデプロイ準備のときに `public/` へコピーする。`/theme.css` は `src/styles/global.css` の `:root` 変数ブロックから静的に生成する（サイト側の変数を変えたら再生成と再デプロイが要る）。
- 本文の編集は WYSIWYG（Milkdown Crepe、`ui/editor.js` を esbuild でバンドルして `editor.js` / `editor.css` として配信）。本文の保存形式は従来どおり markdown で、自動保存も textarea 経由の従来の仕組みをそのまま使う。エディタが読み込めない・初期化できない場合は textarea にフォールバックする。このディレクトリはサブプロジェクトとして `package.json` を持ち、依存（Crepe / esbuild 等）はここで `pnpm install` する（`node_modules` は git 管理しない）。往復変換の確認は `node scripts/check-editor.mjs`。
- 画像は `POST /api/media` で Cloudflare R2（非公開バケット `slytxt-writer-media`）へ保存する。下書きでは writer 相対 URL（`/media/<キー>`）で参照し、公開時にだけ公開ファイル側で `https://media.slytxt.dev/<キー>` へ付け替える（次節）。

## デプロイ手順（本人の作業）

前提: サイト本体の Pages が入っているのと同じ Cloudflare アカウントを使う。wrangler はリポジトリに依存を足さず `npx wrangler` で実行する。

### 1. wrangler にログインする

```sh
npx wrangler login
```

ブラウザが開くので、そのアカウントで承認する。

### 2. KV 名前空間を作り、ID を wrangler.toml に反映する

```sh
npx wrangler kv namespace create slytxt-writer-drafts
```

出力された `id` を `tools/writer-cloudflare/wrangler.toml` の `[[kv_namespaces]]` の `id` と `preview_id`（同じ ID でよい）に差し替える。

### 3. GitHub fine-grained PAT を発行する

github.com の Settings → Developer settings → Personal access tokens → Fine-grained tokens で新規発行する。

- Repository access: `sayuyuyuyu/slytxt-lab` のみ
- Permissions: Contents（Read and write）、Pull requests（Read and write）、Actions（Read-only）、Commit statuses（Read-only）。後ろ2つは CI の状態取得に使う。発行 UI に Checks という権限は無く、GitHub Actions の check run の読み取りは Actions（Read-only）が担う。

Mac の `gh` が持っている classic トークンは流用しない。

### 4. secret を登録する

リポジトリのルートから:

```sh
npx wrangler secret put GITHUB_TOKEN -c tools/writer-cloudflare/wrangler.toml
```

- `GITHUB_TOKEN`: 手順3の PAT（必須）。
- `OPENCODE_GO_API_KEY`: OpenCode Go の API キー（任意）。登録すると、公開時のディスクリプションに AI 要約が使われる（公開パネルで候補として表示され、編集もできる）。未設定の場合は要約をせず、本文の抜粋で公開される。エンドポイントとモデルは `wrangler.toml` の `[vars]`（`OPENCODE_GO_API_URL` / `OPENCODE_GO_MODEL`）で差し替えられる。

### 5. 静的ファイルを用意してデプロイする

エディタのバンドルにこのディレクトリの依存が要るので、初回と依存を変えたときは先に:

```sh
cd tools/writer-cloudflare && pnpm install && cd ../..
```

そのうえで:

```sh
node tools/writer-cloudflare/scripts/prepare-assets.mjs
npx wrangler deploy -c tools/writer-cloudflare/wrangler.toml
```

`wrangler.toml` の routes により `https://write.slytxt.dev` に割り当たる。アクセスすると Cloudflare Access のログインに飛ぶ（「認証（Cloudflare Access）」参照）。

### 6. 下書きを KV へ移す

ローカル版の `drafts/` にある既存の下書き（移行時点で15件）を、内容そのまま投入する。リポジトリのルートで:

```sh
for f in drafts/*.md; do
  id=$(basename "$f" .md)
  npx wrangler kv key put "draft:$id" --path "$f" --binding DRAFTS --preview false --remote -c tools/writer-cloudflare/wrangler.toml
done
npx wrangler kv key list --binding DRAFTS --remote -c tools/writer-cloudflare/wrangler.toml
```

最後のコマンドで件数と id が `drafts/` のファイルと一致することを確認する。現行の wrangler（4.157 で確認）では、投入に `--preview false`（`preview_id` と同じ ID を使っているため）と `--remote`（本番名前空間が対象であることの明示）が要る。

### 7. テスト投稿を通す

短いメモを1本投稿し、ブランチ → PR → CI → merge → 下書き削除 → 本番サイトへの反映まで進むことを確認する。

## 認証（Cloudflare Access）

下書きは未公開の文章なので、認証は Cloudflare Access が担う。設定済みの内容:

- Zero Trust の Access → Applications に、Self-hosted アプリケーションとして `write.slytxt.dev` を登録してある。
- Policy は Allow、Include は本人のメールアドレスのみ。
- Worker 側にトークン認証は無い（旧 `SLYTXT_TOKEN` の secret は削除済み）。`x-slytxt-client` の書き込み防御は残る。
- 入口はカスタムドメインのみ。`wrangler.toml` で `workers_dev = false` にしてあり、Access の外にある workers.dev 側からは入れない。

ポリシーを変えるときは、Zero Trust のダッシュボードでこのアプリケーションを編集する。

## 画像メディア（R2）

`POST /api/media`（`src/media.mjs`、書き込み防御の対象）が jpeg / png / gif / webp（10MB まで）を受け取り、Cloudflare R2 の非公開バケット `slytxt-writer-media` に保存する（キーは内容の SHA-256 ハッシュ先頭32桁＋拡張子。同じ画像は同じキーに収束する）。公開・非公開の境界はバケット内のプレフィックスで分ける:

1. アップロードした画像は `draft/` プレフィックスに置く。返却する URL は writer 相対の `/media/<キー>` で、下書きの markdown とカバーにはこの形が入る。表示は writer 自身が `GET /media/:key` で配信し、write.slytxt.dev は Cloudflare Access の裏にあるため、未認証では取得できない。
2. 投稿の公開時（`src/publish.mjs`）に、本文とカバーが参照する画像だけを `pub/` プレフィックスへ移し、公開ファイルの中では `https://media.slytxt.dev/<キー>` に付け替える。配信は専用 Worker（`tools/media-cloudflare`）が担い、`pub/` のものだけを返すため、下書きだけの画像は URL が推測できても取得できない。
3. 旧公開 URL（`https://slytxt.dev/media/<キー>`）は、サイト側の `_redirects` で media.slytxt.dev へ 301 を返す互換を残してある（移行前の下書きや外部リンクのため）。

アップロードは R2 への PUT で即時に完了し、エディタ内でもすぐ表示できる。R2 バインディング（`MEDIA`）が未設定の環境では、`POST /api/media` は 501 を返す。バケットが無ければ作る:

```sh
npx wrangler r2 bucket create slytxt-writer-media
npx wrangler deploy -c tools/media-cloudflare/wrangler.toml
```

2026-11-04 の方針変更で一時 GitHub の `public/media/`（ブランチ＋PR 方式）に切り替えていたが、公開リポジトリに原画が残る点と GitHub のコンテンツ規約の制約から、2026-11-05 の本人依頼で R2 保存に戻した。移行時点で `public/media/` にあった3ファイルは R2 の `pub/` へ移し、リポジトリからは削除した（git 履歴には残る）。

## ローカルで試す

```sh
node tools/writer-cloudflare/scripts/prepare-assets.mjs
npx wrangler dev -c tools/writer-cloudflare/wrangler.toml
```

KV はローカルエミュレーションになる。secret が要る場合は `tools/writer-cloudflare/.dev.vars` に `KEY=値` 形式で置く（git 管理しない）。投稿まで試す場合は、テスト用の下書きで、PR が本物になることに注意する。

## 移行の完了状態

- ローカル版は廃止済み。launchd サービス（`ts.slytxt.writer`）は登録解除し、リポジトリから `tools/writer/` を削除した。UI はこのディレクトリの `ui/` で完結する。
- 移行前の下書きファイル（リポジトリ直下の `drafts/`）は、移行時の原本としてデータだけ残してある。現在の下書きは端末へ即時保存され、KV へは裏で同期される（未同期の間は端末内だけに存在する）。
