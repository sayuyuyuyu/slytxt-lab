# 執筆ツール（Cloudflare 版）

`tools/writer/` の Cloudflare Workers 版。Mac が起きていなくても、Tailscale なしでも、ブラウザから書いて投稿できるようにするための移行先。

設計の経緯と判断は `~/workspace/slytxt-writer-cloudflare/DESIGN.md`（モカの作業場所側）にある。このディレクトリには実装とデプロイ手順だけを置く。

## 構成

- 単一 Worker（`src/index.mjs`）+ Workers Static Assets（`public/`、生成物なので git 管理しない）。
- 下書きは Cloudflare KV（バインディング `DRAFTS`）。キー `draft:<id>`、値はローカル版が `drafts/<id>.md` に書いているテキストそのまま。直列化・正規化の規則は `tools/writer/drafts.mjs` と同じ（`src/drafts-kv.mjs`）。
- 純粋モジュール（`frontmatter.mjs` / `markdown.mjs` / `prompt.mjs`）は `tools/writer/` から直接 import して共有する。コピーは作らない。
- 投稿は GitHub REST API（`src/github.mjs` / `src/publish.mjs`）。ブランチ作成 → ファイル作成 → PR 作成までを投稿リクエストの中で行い、CI 待ちと merge は `GET /api/publish/:id/status` を UI がポーリングして完了させる。ローカルの `pnpm run check` は持たず、PR の CI（チェック名 `ci`）が門番で、成功したら merge する。Cloudflare Pages の結果はマージ条件に入れない（2026-11-04 本人決定。投稿の待ちを CI だけにするため）。
- 投稿は下書きの本文をそのまま使う。誤字チェック pass（Anthropic API）は 2026-11-04 に廃止した。
- 認証は Cloudflare Access が担う（`write.slytxt.dev` は本人のメールアドレスのみ許可。後述）。Worker 側にトークン認証は無い。`x-slytxt-client` による書き込み防御（認証とは別の層）は Worker 側に残してある。入口はカスタムドメインのみで、`workers_dev = false` で workers.dev 側を閉じてある（workers.dev は Access の外にあるため）。
- UI はこのディレクトリの `ui/` が正（`index.html` / `style.css` / `app.js`）。note 風のレイアウト（編集画面のヘッダー、公開確認パネル、一覧の「…」メニュー）は Cloudflare 版だけの差分として `ui/` 側に持つ。`markdown.mjs` は `tools/writer/` からデプロイ準備のときにコピーする。`/theme.css` は `src/styles/global.css` の `:root` 変数ブロックから静的に生成する（サイト側の変数を変えたら再生成と再デプロイが要る）。
- 本文の編集は WYSIWYG（Milkdown Crepe、`ui/editor.js` を esbuild でバンドルして `editor.js` / `editor.css` として配信）。本文の保存形式は従来どおり markdown で、自動保存も textarea 経由の従来の仕組みをそのまま使う。エディタが読み込めない・初期化できない場合は textarea にフォールバックする。このディレクトリはサブプロジェクトとして `package.json` を持ち、依存（Crepe / esbuild 等）はここで `pnpm install` する（`node_modules` は git 管理しない）。往復変換の確認は `node scripts/check-editor.mjs`。
- 画像は `POST /api/media` で R2 に保存し、公開 URL を本文へ挿入する想定だが、2026-11-04 時点では未有効化（次節）。

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

Worker 版で短いメモを1本投稿し、ブランチ → PR → CI → merge → 下書き削除 → 本番サイトへの反映まで進むことを確認する。ローカル版（launchd + Tailscale serve）は切り替えが終わるまで止めない。

## 認証（Cloudflare Access）

下書きは未公開の文章なので、認証は Cloudflare Access が担う。設定済みの内容:

- Zero Trust の Access → Applications に、Self-hosted アプリケーションとして `write.slytxt.dev` を登録してある。
- Policy は Allow、Include は本人のメールアドレスのみ。
- Worker 側にトークン認証は無い（旧 `SLYTXT_TOKEN` の secret は削除済み）。`x-slytxt-client` の書き込み防御は残る。
- 入口はカスタムドメインのみ。`wrangler.toml` で `workers_dev = false` にしてあり、Access の外にある workers.dev 側からは入れない。

ポリシーを変えるときは、Zero Trust のダッシュボードでこのアプリケーションを編集する。

## 画像メディア（R2）

コード側は実装済み: `POST /api/media`（`src/media.mjs`、書き込み防御の対象）が jpeg / png / gif / webp（10MB まで）を受け取り、R2 バケット（binding `MEDIA`）へ `media/<uuid>.<ext>` で保存し、`MEDIA_PUBLIC_BASE_URL` 配下の公開 URL を返す。エディタの画像アップロードはこの API を使う。

ただし 2026-11-04 時点では、この Cloudflare アカウントで R2 自体が未有効化（`wrangler r2 bucket create` が code 10042 で失敗する）ため未稼働で、`POST /api/media` は 501 を返す。有効化はアカウント所有者のダッシュボード操作が要る:

1. Cloudflare ダッシュボードで R2 を有効化する（R2 のページを開き、利用開始の手続きをする）。
2. バケットを作る（リポジトリのルートで）:
   ```sh
   npx wrangler r2 bucket create slytxt-writer-media
   ```
3. `wrangler.toml` の `[[r2_buckets]]` のコメントを外す。
4. ダッシュボードの R2 → `slytxt-writer-media` → Settings → Public access で r2.dev の公開 URL を有効化し、表示された URL を `wrangler.toml` の `[vars]` に `MEDIA_PUBLIC_BASE_URL` として書く。
5. `prepare-assets` と `wrangler deploy` で再デプロイする。

## ローカルで試す

```sh
node tools/writer-cloudflare/scripts/prepare-assets.mjs
npx wrangler dev -c tools/writer-cloudflare/wrangler.toml
```

KV はローカルエミュレーションになる。secret が要る場合は `tools/writer-cloudflare/.dev.vars` に `KEY=値` 形式で置く（git 管理しない）。投稿まで試す場合は、テスト用の下書きで、PR が本物になることに注意する。

## 切り替え後の後片付け（移行完了後）

- ローカル版の常駐サービスを止める: `node tools/writer/service.mjs uninstall`（ローカル版のコードと CLI 投稿 `pnpm write:publish` は当面残す）。
- UI は Cloudflare 版の `ui/` で完結する。ローカル版（`tools/writer/ui`）とは別に保守する。
