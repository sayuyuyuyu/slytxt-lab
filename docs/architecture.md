# アーキテクチャ

しらゆラボ（<https://slytxt.dev>）の全体構成と、執筆から公開までの流れをまとめます。各ツールのデプロイ手順は `tools/*/README.md` を参照してください。

## 全体像

![全体構成](diagrams/overview.svg)

図の要素と接続関係は次のとおりです（図のソースは `docs/diagrams/overview.mmd`、Mermaid 記法。SVG は Ondine で生成したもので、再生成は `npx ondine docs/diagrams/*.mmd` です）。

- 読者は Cloudflare Pages のサイト（slytxt.dev）を閲覧し、公開済み画像は media.slytxt.dev から受け取ります。
- 本人は2つの経路で書きます。Cloudflare Access の内側の執筆ツール（write.slytxt.dev）と、Mac / iPhone の Obsidian プラグイン（`tools/obsidian-slytxt/`）です。
- どちらの経路も GitHub にブランチと Pull Request を作り、マージされると Cloudflare Pages が main をビルドして公開します。下書きの置き場所は経路で違います（writer は KV slytxt-writer-drafts、プラグインは Vault のノート）。
- 執筆ツールは画像を R2（slytxt-writer-media）へ保存し、公開時に `draft/` から `pub/` へ移します。
- 健康状態の Worker（status.slytxt.dev）は KV（slytxt-status-data）に最新スナップショットを1件だけ持ちます。更新は Muse の VM 上のスクリプトが Apple Health の集計を POST します。サイト側からは現在読んでいません（About の「いまの状態」は撤去済み）。
- X のブックマークは Pages Functions が配信し、取得結果は KV（BOOKMARKS）にキャッシュします。

## 構成要素

### サイト本体（Cloudflare Pages）

Astro（TypeScript）で静的生成し、Cloudflare Pages が配信します。コンテンツは `src/content/` の6コレクション（`tech` / `misc` / `comic` / `game` / `anime` / `projects`）で、ビルド時に Pagefind の検索インデックスも `dist/` へ生成します。デプロイは main へのマージで自動です。

CSS は `src/styles/global.css` に手で書きます。Tailwind はリセット（preflight）のためだけに入れていて、`@import "tailwindcss" source(none)` でユーティリティの自動生成を止めています。走査を有効にすると、記事本文やスクリプト中の単語（`hidden`、`grid` など）がクラス名として拾われ、未使用のユーティリティが配信 CSS に混ざります。`.container` のように本体のクラス名と衝突してレイアウトを変えた例があるため、ユーティリティを意図的に使うときは `@source` を明示してください（#692 / #693）。

短文フィードの公開一覧（`/feed/`）とトップの最新3件は、Astro がビルドした HTML を雛形にし、`functions/feed/index.ts` と `functions/index.ts` が D1（`FEED`）から読んだ投稿を差し込みます。トップの記事一覧と Projects は静的のままです。

`functions/` の Pages Functions は、X のブックマークを推測不能な URL の下で一覧・RSS・JSON・埋め込み用スクリプトとして配信します。詳細は次の節を見てください。

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

### 執筆ツール writer（Worker: slytxt-writer）

コードは `tools/writer-cloudflare/` です。入口はカスタムドメイン write.slytxt.dev のみ（workers.dev は無効）で、認証は Cloudflare Access が担い、本人のメールアドレスだけを許可します。

下書きはブラウザの localStorage へ即時に保存され、裏で間引いて Cloudflare KV（バインディング `DRAFTS`、名前空間 slytxt-writer-drafts）へ同期されます。未同期の間は下書きが端末内だけに存在します。本文エディタは WYSIWYG（Milkdown Crepe）で、保存形式は markdown です。

投稿後の見届けは Worker の Cron Triggers（毎分）が担います。タブを閉じても公開が完了するように、状態はサーバー側で進み、結果は KV に保存されて次回 writer を開いたときに通知されます。

公開時の説明文には、任意で AI 要約（OpenCode Go）を使います。API キーの secret が未登録なら要約せず、本文の抜粋で公開します。

### メディア（R2 と Worker: slytxt-media）

画像は非公開の R2 バケット `slytxt-writer-media` に置きます。下書き分は `draft/`、公開分は `pub/` のプレフィックスで分けます。

下書きの画像は writer（Cloudflare Access の裏）経由でのみ表示されます。公開された画像だけが Worker `slytxt-media`（media.slytxt.dev、認証なし）から配信され、未公開のキーは URL を当てても 404 になります。旧来の `/media/*` URL は `public/_redirects` で media.slytxt.dev へ 301 リダイレクトします。

### 健康状態（Worker: slytxt-status）

コードは `tools/status-cloudflare/` です。健康状態スナップショット（心拍・睡眠・歩数など）を、KV（バインディング `STATUS_DATA`、名前空間 slytxt-status-data）のキー `latest` に1件だけ保持します。位置情報は含めません。表示先だった About の「いまの状態」は撤去したため、現在サイト側に読み取り元はありません。

`GET /api/status` は公開で、CORS は https://slytxt.dev だけを許可します。`POST /api/status` は Bearer トークン（secret `STATUS_POST_TOKEN`）が一致したときだけ保存します。更新は Muse の VM 上のスクリプトが Apple Health の集計から組み立てて POST します。

## 公開フロー

![公開フロー](diagrams/publish-flow.svg)

図のソースは `docs/diagrams/publish-flow.mmd`（Mermaid 記法）で、この図は writer の経路を描いたものです。手順は次のとおりです。

1. 書く — 保存先は経路で違います。writer は本文を localStorage へ即時保存し、KV へ裏で同期します。Obsidian プラグインは Vault のノートをそのまま下書きにし、KV への同期はしません。
2. 投稿 — GitHub REST API で作業ブランチを作り、記事ファイルを `src/content/<カテゴリ>/<slug>.md` として作成して Pull Request を開きます。writer で公開済み記事の一覧から開いて再編集した場合は、同じカテゴリなら同じファイルへの更新 PR になります。カテゴリを変えた場合は、新しいカテゴリへの書き出しと元カテゴリの削除を同じ PR で行う移動になります。どちらも公開日は元の記事から引き継がれ、更新日は再編集日に更新されます。writer ではこのとき画像を R2 の `draft/` から `pub/` へ移し、本文中の URL を media.slytxt.dev へ付け替えます。
3. CI — Pull Request の CI（チェック名 `ci`）が成功することだけがマージの条件です。Cloudflare Pages のプレビュー結果は条件に入りません。
4. マージ — 駆動するのは経路で違います。writer は UI のポーリングと Cron の見届け（毎分）の両方が進め、どちらが先でも冪等に収束します。結果は KV に `publish-result:` キーで残り、次回 writer を開いたときに通知され、公開できた下書きは一覧から消えます。Obsidian プラグインは PR に自動マージ（squash）を設定し、設定できなかった場合だけ GitHub で手動マージします。
5. 公開 — main へのマージで Cloudflare Pages がビルドし、slytxt.dev に反映されます。

writer 固有なのは下書きの KV 同期、画像の `draft/` → `pub/` 付け替え、`publish-result:` の見届けです。PR を作って CI の成功でマージされ、Pages が公開する部分は両経路で共通です。

## 認証と秘密情報

- writer は Cloudflare Access（本人のメールアドレスのみ）。Worker 側に独自のトークン認証はありません。
- status への POST は Bearer トークン、X ブックマークは推測不能な URL と管理トークンで守ります。
- GitHub の fine-grained PAT や API キーは各 Worker の secret に登録し、リポジトリには値を書きません（登録方法は `tools/writer-cloudflare/README.md` を参照）。

## デプロイ

- サイト本体は main へのマージで Cloudflare Pages が自動デプロイします。
- 3つの Worker（writer / media / status）は `npx wrangler deploy -c tools/<対象>/wrangler.toml` で個別にデプロイします。wrangler はリポジトリの依存には足しません。
