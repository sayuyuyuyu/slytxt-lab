# Obsidian プラグイン（slytxt publish）

Obsidian から slytxt-lab へ記事を公開するプラグインです。書く場所を Obsidian（iOS アプリ）に寄せ、writer（`write.slytxt.dev`）を引退させるための移行先になります（#707）。

## できること

- **公開画面** … カテゴリ・タイトル・タグ・説明文・カバーの編集と公開を1画面で完結させる。初期値は本文から補う：タイトルは最初の見出し（H1）、説明は書き出し、カバーは本文の最初の画像。タグは1件ずつ追加・削除する。公開すると、使った値がノートの frontmatter にも残る。
- 公開画面の **「公開する」** … ノートの frontmatter と本文から、GitHub API でブランチと PR を作り、PR に自動マージ（squash）を設定する。CI が通ればそのままマージされて公開される。自動マージを設定できなかった場合だけ、GitHub で手動マージする。タイトル未指定で本文の最初が見出しなら、その見出しをタイトルとして使い本文からは除く。カバー未指定なら本文の最初の画像をカバーにする（Vault 内の画像はアップロードする）。
- コマンド **「カバー画像をアップロード」** … 画像ファイルを選ぶと media Worker のアップロード口（`PUT media.slytxt.dev/<キー>`）へ上げ、公開 URL を frontmatter の cover に差す。画像は Git に入らない。
- コマンド **「埋め込み URL を挿入」** … URL を URL だけの段落としてカーソル位置へ挿入する。YouTube / Spotify / X は埋め込みに、それ以外はリンクカードになる（サイト側の規則と同じ）。
- 公開状態の確認は PR を見る（writer の画面は無い）。

説明文の AI 候補は未実装。writer の summary エンドポイントはサーバー側の下書き（KV）専用で、端末ローカルのノートからは叩けないため、候補は本文からの抜粋生成で代替している。

## 仕組み

- 記事のパス・ブランチ名・公開 URL は writer と同じ規則です（`src/lib/slug.ts`）。ブランチはカテゴリによらず `write/<slug>` です。
- frontmatter はサイトのスキーマに合わせてキー順を固定し、必要な値だけ引用します（`src/lib/frontmatter.ts`）。
- GitHub との通信は `src/lib/github.ts` に閉じ込め、HTTP を差し替え可能にしてあります（Obsidian では `requestUrl` を渡す）。手順（ブランチ→ファイル→PR）と失敗時のメッセージはテストで確認しています。

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
2. 左端のリボンの送信アイコン（またはファイルの右クリックメニュー **公開する（項目の確認・編集）**）で公開画面を開く。タイトル・カテゴリ・タグ・説明・カバーはすべてこの画面で編集できる。タイトルは本文の最初の見出し、カバーは本文の最初の画像が初期値として入るので、直すところだけ直せばよい。ノート上部のプロパティ欄で編集したい場合は **公開の項目をノートに追加** で欄を用意することもできる。
3. 本文への画像は、左端のリボンの画像アイコンか、エディタの右クリックメニュー **画像をアップロードして挿入** で、画像を選んでアップロードし、カーソル位置に差し込める。YouTube・Spotify・X などの埋め込みは、右クリックメニューの **埋め込み URL を挿入** から。
4. 公開画面の **公開する** を押す。成功すると `PR #12 を作成しました（CI が通れば自動でマージされ、公開されます）` と通知が出る。
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
