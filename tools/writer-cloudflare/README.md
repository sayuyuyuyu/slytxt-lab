# 執筆ツール（Cloudflare 版）

`tools/writer/` の Cloudflare Workers 版。Mac が起きていなくても、Tailscale なしでも、ブラウザから書いて投稿できるようにするための移行先。

設計の経緯と判断は `~/workspace/slytxt-writer-cloudflare/DESIGN.md`（モカの作業場所側）にある。このディレクトリには実装とデプロイ手順だけを置く。

## 構成

- 単一 Worker（`src/index.mjs`）+ Workers Static Assets（`public/`、生成物なので git 管理しない）。
- 下書きは Cloudflare KV（バインディング `DRAFTS`）。キー `draft:<id>`、値はローカル版が `drafts/<id>.md` に書いているテキストそのまま。直列化・正規化の規則は `tools/writer/drafts.mjs` と同じ（`src/drafts-kv.mjs`）。
- 純粋モジュール（`frontmatter.mjs` / `markdown.mjs` / `prompt.mjs`）は `tools/writer/` から直接 import して共有する。コピーは作らない。
- 投稿は GitHub REST API（`src/github.mjs` / `src/publish.mjs`）。ブランチ作成 → ファイル作成 → PR 作成までを投稿リクエストの中で行い、CI 待ちと merge は `GET /api/publish/:id/status` を UI がポーリングして完了させる。ローカルの `pnpm run check` は持たず、PR の CI（ci と Cloudflare Pages の両方）が門番。
- 誤字修正 pass は Anthropic API（`src/fix.mjs`）。プロンプトは現行 `prompt.mjs` の `fixPrompt` を流用。`ANTHROPIC_API_KEY` が未設定なら pass を省略して投稿を続行する。キーがあるのに呼び出しが失敗したら投稿を止める。
- 認証は初回疎通用に現行トークン方式（`SLYTXT_TOKEN` → クッキー + `x-slytxt-client` 書き込み防御）を移植してある。最終形は Cloudflare Access（後述）。
- UI は `tools/writer/ui` が正。`index.html` / `style.css` / `markdown.mjs` はデプロイ準備のときにコピーし、`app.js` だけは投稿後の status ポーリングを足した差分版を `ui/app.js` に置く。`/theme.css` は `src/styles/global.css` の `:root` 変数ブロックから静的に生成する（サイト側の変数を変えたら再生成と再デプロイが要る）。

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
- Permissions: Contents（Read and write）、Pull requests（Read and write）。加えて Checks（Read）と Commit statuses（Read）が選べる場合は付ける（CI の状態取得に使う）

Mac の `gh` が持っている classic トークンは流用しない。

### 4. secret を登録する

リポジトリのルートから:

```sh
npx wrangler secret put GITHUB_TOKEN -c tools/writer-cloudflare/wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY -c tools/writer-cloudflare/wrangler.toml
npx wrangler secret put SLYTXT_TOKEN -c tools/writer-cloudflare/wrangler.toml
```

- `GITHUB_TOKEN`: 手順3の PAT（必須）。
- `ANTHROPIC_API_KEY`: 誤字修正 pass 用（任意）。登録しない場合は pass が省略される。キーは console.anthropic.com で発行する。
- `SLYTXT_TOKEN`: 初回疎通用。自分で決めた文字列でよい。Access へ切り替えたら `wrangler secret delete SLYTXT_TOKEN` で消す。

### 5. 静的ファイルを用意してデプロイする

```sh
node tools/writer-cloudflare/scripts/prepare-assets.mjs
npx wrangler deploy -c tools/writer-cloudflare/wrangler.toml
```

`wrangler.toml` の routes により `https://write.slytxt.dev` に割り当たる。初回は `https://write.slytxt.dev/?token=<SLYTXT_TOKEN>` を開くとクッキーに移る。

### 6. 下書きを KV へ移す

ローカル版の `drafts/` にある既存の下書き（移行時点で15件）を、内容そのまま投入する。リポジトリのルートで:

```sh
for f in drafts/*.md; do
  id=$(basename "$f" .md)
  npx wrangler kv key put "draft:$id" --path "$f" --binding DRAFTS -c tools/writer-cloudflare/wrangler.toml
done
npx wrangler kv key list --binding DRAFTS -c tools/writer-cloudflare/wrangler.toml
```

最後のコマンドで件数と id が `drafts/` のファイルと一致することを確認する。

### 7. テスト投稿を通す

Worker 版で短いメモを1本投稿し、ブランチ → PR → CI → merge → 下書き削除 → 本番サイトへの反映まで進むことを確認する。ローカル版（launchd + Tailscale serve）は切り替えが終わるまで止めない。

## Cloudflare Access への切り替え

下書きは未公開の文章なので、常用を始める前に Access を入れる。

1. Cloudflare Zero Trust のダッシュボードで Access → Applications → Add an application → Self-hosted を選ぶ。
2. Application domain に `write.slytxt.dev` を指定する。
3. Policy は Allow、Include に自分のメールアドレスだけを入れる。
4. 動作を確認したら `SLYTXT_TOKEN` の secret を削除する（Worker 側のトークン認証は secret が無ければ素通りし、防御は Access が担う。`x-slytxt-client` の書き込み防御は残る）。

## ローカルで試す

```sh
node tools/writer-cloudflare/scripts/prepare-assets.mjs
npx wrangler dev -c tools/writer-cloudflare/wrangler.toml
```

KV はローカルエミュレーションになる。secret が要る場合は `tools/writer-cloudflare/.dev.vars` に `KEY=値` 形式で置く（git 管理しない）。投稿まで試す場合は、テスト用の下書きで、PR が本物になることに注意する。

## 切り替え後の後片付け（移行完了後）

- ローカル版の常駐サービスを止める: `node tools/writer/service.mjs uninstall`（ローカル版のコードと CLI 投稿 `pnpm write:publish` は当面残す）。
- `tools/writer/ui/app.js` を変更したら、`ui/app.js`（このディレクトリ）へ差分を写し直す。
