# Obsidian プラグイン（slytxt publish）

Obsidian から slytxt-lab へ記事を公開するプラグインです。Mac / iPhone の Obsidian で書いたノートを、そのまま PR として公開します（#707 で writer から移行）。

## できること

- **ノート先頭の公開バー** … ノートを開くと、本文の上に細いバーが出る（カテゴリのチップ、タグのチップと入力欄、カバーのサムネイル、公開ボタン）。モーダルもコマンドも画面遷移も使わず、その場で直せる。値は開いた時点で入っている：タイトルは最初の見出し（バーには出さず公開時に使う）、説明は書き出し、カバーは本文の最初の画像（URL のとき）、カテゴリとタグは frontmatter の既存値。バーでの編集はすぐ frontmatter に反映される（値の正は frontmatter のまま）。
- **PR を作る（公開）** … ノートの frontmatter と本文から、GitHub API でブランチと PR を作り、PR に自動マージ（squash）を設定する。CI が通ればそのままマージされて公開される。自動マージを設定できなかった場合だけ、GitHub で手動マージする。タイトル未指定で本文の最初が見出しなら、その見出しをタイトルとして使い本文からは除く。カバー未指定なら本文の最初の画像をカバーにする（Vault 内の画像はアップロードする）。
- **公開後の共有** … PR を作ると結果のモーダルが出る。「PR を開く」で PR を、「X に投稿」でタイトルと記事 URL が入った X の投稿画面をブラウザで開く（misc はタイトルを入れない）。記事はマージの数十秒後から見られる。
- コマンド **「カバー画像をアップロード」** … 画像ファイルを選ぶと media Worker のアップロード口（`PUT media.slytxt.dev/<キー>`）へ上げ、公開 URL を frontmatter の cover に差す。バーのサムネイルを押しても同じことができる。画像は Git に入らない。
- コマンド **「埋め込み URL を挿入」** … URL を URL だけの段落としてカーソル位置へ挿入する。YouTube / Spotify / X は埋め込みに、それ以外はリンクカードになる（サイト側の規則と同じ）。
- 公開状態の確認は PR を見る。

説明文の AI 候補は未実装。候補は本文からの抜粋生成で代替している。

## 仕組み

- 記事のパス・ブランチ名・公開 URL の規則は `src/lib/slug.ts` にまとめています。ブランチはカテゴリによらず `write/<slug>` です。
- frontmatter はサイトのスキーマに合わせてキー順を固定し、必要な値だけ引用します（`src/lib/frontmatter.ts`）。
- GitHub との通信は `src/lib/github.ts` に閉じ込め、HTTP を差し替え可能にしてあります（Obsidian では `requestUrl` を渡す）。手順（ブランチ→ファイル→PR）と失敗時のメッセージはテストで確認しています。
- 公開バーは CodeMirror 6 のウィジェット（`src/bar-widget.ts`）で、値の決め方とタグ操作は純関数（`src/lib/bar.ts`）に分けています。`@codemirror/*` はバンドルせず、Obsidian 本体のものを使います（esbuild で external）。

## インストール（自分の Vault へ）

1. 依存を入れてビルドする（このディレクトリで）。

   ```sh
   pnpm install
   node esbuild.config.mjs
   ```

2. Vault の `.obsidian/plugins/slytxt-publish/` を作り、`main.js`・`manifest.json`・`styles.css` をコピーする。
3. Obsidian の設定 → コミュニティプラグイン → インストール済みを再読み込みし、`slytxt publish` を有効にする。
4. 設定 → slytxt publish で、オーナー（`sayuyuyuyu`）・リポジトリ（`slytxt-lab`）・ベースブランチ（`main`）・既定カテゴリ・GitHub トークンを入れる。カバー画像のアップロードを使う場合は、アップロード用トークン（media Worker の `UPLOAD_TOKEN` と対の値）も入れる。

### GitHub トークン

fine-grained PAT を作り、対象リポジトリを `slytxt-lab` だけに絞って、次の権限を付けます。

- Contents: Read and write（ブランチ作成・ファイル書き込み）
- Pull requests: Read and write（PR 作成）

トークンはプラグインの `data.json`（Vault 内の `.obsidian/plugins/slytxt-publish/`）にだけ保存されます。Vault を共有・同期している場合はその範囲で一緒に移動するので、扱いに注意してください。

## 使い方

1. ノートに本文を書く（frontmatter は無くてよい）。
2. ノート上部のプロパティで、タイトル・カテゴリ・タグ・説明・カバーを必要なら直す。項目はノートを開いた時点で自動で用意される（無ければ **公開の項目をノートに追加** でも出せる）。タイトルは空なら本文の最初の見出し、カバーは空なら本文の最初の画像が使われるので、何も直さなくても公開できる。
3. 本文への画像は、左端のリボンの画像アイコンか、エディタの右クリックメニュー **画像をアップロードして挿入** で、画像を選んでアップロードし、カーソル位置に差し込める。YouTube・Spotify・X などの埋め込みは、右クリックメニューの **埋め込み URL を挿入** から。
4. 左端のリボンの送信アイコン（またはファイルの右クリックメニュー **PR を作る（公開）**）を押す。成功すると `PR #12 を作成しました（CI が通れば自動でマージされ、公開されます）` と通知が出る。
5. CI が通れば自動でマージされ、記事ページに反映される。公開状態は PR で確認する。

## 開発

```sh
pnpm install
node esbuild.config.mjs --watch   # main.js を監視ビルド
pnpm typecheck                    # このディレクトリの tsc
```

純粋なロジック（slug・frontmatter・公開一式・GitHub 手順）はリポジトリ直下のテストで検証しています。

```sh
cd ../..
node --experimental-strip-types --test tests/obsidian-publish.test.mjs
```

## 注意

- iPhone 実機での通し確認（下書き作成 → 画像添付 → frontmatter 入力 → PR 作成 → 自動マージ → 記事ページ反映）はまだ行っていません。
- カバー画像の切り抜きは未実装（選んだ画像がそのまま上がる）。
