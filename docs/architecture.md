# アーキテクチャ

しらゆラボ（<https://slytxt.dev>）の全体構成と、執筆から公開までの流れをまとめます。各ツールのデプロイ手順は `tools/*/README.md` を参照してください。

## 全体像

![全体構成](diagrams/overview.svg)

図の要素と接続関係は次のとおりです（図のソースは `docs/diagrams/overview.mmd`、Mermaid 記法。SVG は Ondine で生成したもので、再生成は `npx ondine docs/diagrams/*.mmd` です）。

- 読者は Cloudflare Pages のサイト（slytxt.dev）を閲覧し、公開済み画像は media.slytxt.dev から受け取ります。
- 本人は Mac / iPhone の Obsidian プラグイン（`tools/obsidian-slytxt/`）で書きます。下書きは Vault のノートです。
- プラグインは GitHub にブランチと Pull Request を作り、マージされると Cloudflare Pages が main をビルドして公開します。
- 画像は R2（slytxt-writer-media）の `pub/` に置き、media.slytxt.dev から配信します。
- X のブックマークは Pages Functions が配信し、取得結果は KV（BOOKMARKS）にキャッシュします。
- 短文フィードは D1（slytxt-feed）に置きます。読者は Pages Functions が差し込んだ一覧を読み、投稿は feed.slytxt.dev の Worker が同じ D1 へ書きます。

## 構成要素

### サイト本体（Cloudflare Pages）

Astro（TypeScript）で静的生成し、Cloudflare Pages が配信します。コンテンツは `src/content/` の6コレクション（`tech` / `misc` / `comic` / `game` / `anime` / `projects`）で、ビルド時に Pagefind の検索インデックスも `dist/` へ生成します。デプロイは main へのマージで自動です。

CSS は `src/styles/global.css` に手で書きます。Tailwind はリセット（preflight）のためだけに入れていて、`@import "tailwindcss" source(none)` でユーティリティの自動生成を止めています。走査を有効にすると、記事本文やスクリプト中の単語（`hidden`、`grid` など）がクラス名として拾われ、未使用のユーティリティが配信 CSS に混ざります。`.container` のように本体のクラス名と衝突してレイアウトを変えた例があるため、ユーティリティを意図的に使うときは `@source` を明示してください（#692 / #693）。

短文フィードの公開一覧（`/feed/`）とトップの最新3件は、Astro がビルドした HTML を雛形にし、`functions/feed/index.ts` と `functions/index.ts` が D1（`FEED`）から読んだ投稿を差し込みます。トップの記事一覧と Projects は静的のままです。

`functions/` の Pages Functions は、短文フィードの一覧と、X のブックマークの配信を担当します。詳細は次の節を見てください。

### 短文フィード（D1 と Pages Functions、Worker: slytxt-feed）

記事未満の短文は、Git ではなく D1（データベース `slytxt-feed`、バインディング `FEED`）に置きます。テーブルは `db/feed/0001_init.sql`、データの形とローカル実行の手順は `db/feed/README.md` です。

- 読み取りは Pages Functions です。`functions/feed/index.ts` が `/feed/` の一覧を、`functions/index.ts` がトップページの最新3件を、Astro がビルドした HTML の目印の間に差し込みます。HTML の組み立ては `src/lib/feed/`（`render.ts` / `page.ts`）にまとめています。
- 書き込みは Worker `slytxt-feed`（feed.slytxt.dev、コードは `tools/feed-cloudflare/`）です。投稿画面（PWA）と API を持ち、Cloudflare Access で本人だけに絞ります。入口は `src/index.mjs`、処理本体は `src/lib/feed/api.ts` と `src/lib/feed/compose.ts` を共有します。
- 添付画像は R2 `slytxt-writer-media` の `pub/` に置き、公開 URL は media Worker が配信します（メディアの節と同じ）。
- リンクカードは投稿時にサーバーが OGP を取り、`link` 列に単一オブジェクトの JSON で保存します。削除は論理削除で、公開側は `deleted_at IS NULL` だけを読みます。

### X のブックマーク（Pages Functions）

コードは `src/lib/bookmarks/`（取得・描画）と `functions/bm/[secret]/`・`functions/api/bookmarks/`（入口）です。X API の OAuth2 認可（PKCE、スコープに `bookmark.read` と `offline.access`）で本人のブックマークを取得し、結果は KV バインディング `BOOKMARKS` にキャッシュします。

- 配信は秘密 URL の下の4形式です。一覧（HTML）/ `rss.xml` / `bookmarks.json` / `embed.js`。秘密文字列が一致しない場合はすべて 404 を返し、全形式に `noindex` を付けます。サイト本体のナビゲーションからはリンクしません。
- 取得は1日1回までで、JST 朝9時の境界を過ぎた最初のアクセスで取り直します（Cron ではなくアクセス駆動）。X API のページング（`next_token`）を辿り、スナップショットには最大100件を保持します。投稿に付いた画像・動画はメディア情報として一緒に保存し、一覧と埋め込みではカード内に表示します。一覧は最初の30件を表示し、残りは「もっと見る」で広げます。埋め込みは15件までです。
- KV のキーは `snapshot:v3`（取得結果と失敗理由・種別）、`authors:v2`（投稿者情報のキャッシュ）、`token`（OAuth トークン一式）、`oauth:` に state を付けたキー（認可途中の PKCE verifier、10分で失効）、`refresh-lock`（同時更新の防止）です。
- 取得に失敗しても前回の内容は残し、一覧に notice を出します。失敗の種別は `bookmarks.json` の `errorKind` にも出ます（`auth` は再認可が必要な可能性が高いもの、`temporary` は一時的なもの）。

#### 再認可の手順（トークン失効時）

refresh token が失効すると、取得が失敗し続けます。症状は、一覧の notice が「Xとの接続の有効期限が切れている可能性があります」のまま変わらないこと、`bookmarks.json` の `errorKind` が `auth` のまま続くことです。その場合は再接続します。

1. ブラウザで `https://slytxt.dev/api/bookmarks/connect?key=<管理トークン>` を開きます。管理トークンは環境変数 `BOOKMARKS_ADMIN_TOKEN` の値で、Cloudflare Pages の環境変数に登録されています（この文書には値を書きません）。`key` が一致しない場合は 404 になり、認可は始まりません。
2. X の認可画面で許可すると、`/api/bookmarks/callback` に戻り、新しいトークンが KV に保存されます。同時に古いスナップショットは消去されるので、次に一覧を開いた時点で取り直されます。
3. 一覧の notice が消え、更新日時が新しくなれば復旧です。認可の途中で10分以上空くと state が失効してやり直しになります。

#### 埋め込み（embed.js）の使い方

一覧を外部のページに埋め込むためのスクリプトも正式な機能として提供します。

```html
<div id="x-bookmarks"></div>
<script src="https://slytxt.dev/bm/<秘密文字列>/embed.js"></script>
```

- 配置先は `id="x-bookmarks"` の要素です。スクリプトタグに `data-target` 属性を付けると、そのセレクタの要素に描きます。
- 描画は Shadow DOM の中で行うため、埋め込み先の CSS とは干渉しません。色は CSS 変数 `--xb-text` / `--xb-accent` / `--xb-muted` / `--xb-border` / `--xb-card` / `--xb-surface` で埋め込み先から合わせられます。
- URL には秘密文字列が含まれるため、埋め込み先も非公開の範囲に限ります。公開ページには置きません。

テストは `tests/bookmarks.test.mjs`（lib 層）と `tests/bookmarks-functions.test.mjs`（Functions の HTTP 層）です。

### メディア（R2 と Worker: slytxt-media）

画像は非公開の R2 バケット `slytxt-writer-media` の `pub/` に置き、Worker `slytxt-media`（media.slytxt.dev、認証なし）から配信します。記事のカバーはプラグインが、短文フィードの画像は feed の Worker が、それぞれ `pub/` へ上げます。`pub/` 以外のキーは URL を当てても 404 になります。旧来の `/media/*` URL は `public/_redirects` で media.slytxt.dev へ 301 リダイレクトします。

`draft/` は writer 時代の下書き用のプレフィックスです。いまは書き込みません（残っているオブジェクトは順次削除します）。

## 公開フロー

![公開フロー](diagrams/publish-flow.svg)

図のソースは `docs/diagrams/publish-flow.mmd`（Mermaid 記法）です。手順は次のとおりです。

1. 書く — Obsidian（Mac / iPhone）のノートがそのまま下書きです。サーバーへの同期はしません。
2. 画像 — カバー画像は media Worker のアップロード口（`PUT media.slytxt.dev/<キー>`）へ上げ、公開 URL を frontmatter の `cover` に差します。画像は Git に入れません。
3. 投稿 — プラグインの「PR を作る（公開）」が GitHub REST API で作業ブランチ `write/<slug>` を作り、記事ファイルを `src/content/<カテゴリ>/<slug>.md` として作成して Pull Request を開きます。同じパスの記事が既にあれば更新 PR になります。タイトル未指定で本文の最初が見出しなら、その見出しをタイトルに使います。
4. CI — Pull Request の CI（チェック名 `ci`）が成功することだけがマージの条件です。Cloudflare Pages のプレビュー結果は条件に入りません。
5. マージ — プラグインが PR に自動マージ（squash）を設定します。設定できなかった場合だけ GitHub で手動マージします。
6. 公開 — main へのマージで Cloudflare Pages がビルドし、slytxt.dev に反映されます。

## 認証と秘密情報

- 短文フィードの投稿画面（feed.slytxt.dev）は Cloudflare Access（本人のメールアドレスのみ）で守り、Worker 側でも `x-slytxt-client: 1` を要求します。
- X ブックマークは推測不能な URL と管理トークンで守ります。
- GitHub の fine-grained PAT や API キーは、使う側（プラグインの設定、各 Worker の secret）に置き、リポジトリには値を書きません（登録方法は各 `tools/*/README.md` を参照）。

## デプロイ

- サイト本体は main へのマージで Cloudflare Pages が自動デプロイします。
- 2つの Worker（media / feed）は `npx wrangler deploy -c tools/<対象>/wrangler.toml` で個別にデプロイします。wrangler はリポジトリの依存には足しません。
