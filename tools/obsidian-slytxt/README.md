# Obsidian プラグイン（slytxt publish）

Obsidian から slytxt-lab へ記事を公開するプラグインです。Mac / iPhone の Obsidian で書いたノートを、そのまま PR として公開します（#707 で writer から移行）。

## できること

- **公開直前のパネル** … コマンド「PR を作る（公開）」でパネルを開く。タイトルは本文の最初の見出し、説明は本文から、カバーは本文の最初の画像（無ければ端末から選んでアップロード）、カテゴリは選択制、タグはチップで、実値が入った状態から確認・微修正して公開する。書いている間はノート画面に何も出さない。
- **PR を作る** … パネルの値だけで PR を作り、自動マージ（squash）を設定する。CI が通ればそのまま公開。プロパティが空でも公開できる。公開日と更新日だけはノートの frontmatter に残す（再公開のため）。
- コマンド **「カバー画像をアップロード」** … 画像を media Worker へ上げ、公開 URL を frontmatter の cover に差す。
- コマンド **「埋め込み URL を挿入」** … URL を単独段落として挿入する。
- 公開状態の確認は PR を見る。

## 仕組み

- 記事のパス・ブランチ名・公開 URL の規則は `src/lib/slug.ts` にまとめています。ブランチはカテゴリによらず `write/<slug>` です。
- frontmatter はサイトのスキーマに合わせてキー順を固定し、必要な値だけ引用します（`src/lib/frontmatter.ts`）。
- GitHub との通信は `src/lib/github.ts` に閉じ込め、HTTP を差し替え可能にしてあります（Obsidian では `requestUrl` を渡す）。手順（ブランチ→ファイル→PR）と失敗時のメッセージはテストで確認しています。
- プロパティの自動補完は `src/lib/note-properties.ts` の純関数で、値の決め方は公開時（`preparePublish`）と同じ規則です。書き込みは `file-open` のときに `processFrontMatter` で行い、空のキーだけを足します（本文が空のノートには何もしません）。

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
2. ノート上部のプロパティで、タイトル・カテゴリ・タグ・説明・カバーを必要なら直す。本文のあるノートを開くと、空の項目は自動で埋まる（新しく作った空のノートは、本文を書いてから開き直すか、コマンド **公開の項目をノートに追加** で埋まる）。タイトルは本文の最初の見出し、説明は見出しとタグの行を除いた書き出し、カテゴリは設定の既定値、タグは本文の `#タグ`、カバーは本文の最初の画像が URL のとき。カテゴリは入力済みの値がサジェストされる。
3. 本文への画像は、左端のリボンの画像アイコンか、エディタの右クリックメニュー **画像をアップロードして挿入** で、画像を選んでアップロードし、カーソル位置に差し込める。YouTube・Spotify・X などの埋め込みは、右クリックメニューの **埋め込み URL を挿入** から。
4. 左端のリボンの送信アイコン（またはファイルの右クリックメニュー **PR を作る（公開）**）を押す。成功すると `PR #12 を作成しました` のモーダルが出て、そこから PR を開いたり X に投稿したりできる。
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
